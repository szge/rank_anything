/** Shared helpers for the dataset refresh scripts. */

import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/importers.ts";
import { orderedObject, stringifyJson } from "../src/json.ts";
import { toFixed, toFixedGrouped } from "../src/text.ts";
import { DATA, writeBuiltins } from "./gen_builtins.ts";

export { DATA, orderedObject };

export const UA = { "User-Agent": "rank-anything distribution refresh script" };

/** Where to write datasets: `--out DIR` on the command line, else data/. */
export function outDir(argv: readonly string[] = process.argv.slice(2)): string {
  const i = argv.indexOf("--out");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : DATA;
}

/** Write `spec` as DIR/<name>.json. Writing into data/ also refreshes src/builtins.ts. */
export function writeDataset(spec: { name: string }, dir = outDir()): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${spec.name}.json`);
  writeFileSync(path, stringifyJson(spec, 2) + "\n");
  if (dir === DATA) writeBuiltins();
  return path;
}

/** Round to `digits` decimals, exact ties to even. */
export function round(x: number, digits: number): number {
  return Number(toFixed(x, digits));
}

/** `f"{n:,}"` / `f"{n:,.0f}"` */
export function thousands(n: number): string {
  return toFixedGrouped(n, 0);
}

/** Today's local date as YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function fetchText(url: string, headers: Record<string, string> = UA): Promise<string> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

export async function fetchBytes(url: string): Promise<Buffer> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The text of the first file in a zip archive whose name ends with `suffix` (case-insensitive). */
export function readZipEntry(zip: Buffer, suffix: string): string {
  // End of central directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    names.push(name);
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      const raw = zip.subarray(start, start + size);
      const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
      if (!data) throw new Error(`${name}: unsupported compression method ${method}`);
      return data.toString("utf8").replace(/^﻿/, "");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no file ending in ${suffix} in the archive (${names.join(", ")})`);
}

/** CSV rows as objects keyed by the header row. */
export function csvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text).filter((r) => r.length);
  const header = rows[0] ?? [];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** For each q (percent), the smallest value whose cumulative weight reaches q% of the total. */
export function weightedPercentiles(pairs: ReadonlyArray<readonly [number, number]>, qs: readonly number[]): Map<number, number> {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  const out = new Map<number, number>();
  let cum = 0;
  let i = 0;
  for (const q of [...qs].sort((a, b) => a - b)) {
    const target = (q / 100) * total;
    while (cum + sorted[i][1] < target) {
      cum += sorted[i][1];
      i++;
    }
    out.set(q, sorted[i][0]);
  }
  return out;
}

/**
 * Bucket lower edges + counts -> {edge: % of population below edge}.
 * Leaves out the final 100% point so the upper tail stays open.
 */
export function edgesToPoints(edges: readonly number[], counts: readonly number[]): Record<string, unknown> {
  const total = counts.reduce((a, b) => a + b, 0);
  let below = 0;
  return orderedObject(
    edges.map((edge, i) => {
      const point = [String(edge), round((100 * below) / total, 4)] as const;
      below += counts[i];
      return point;
    }),
  );
}

/** True when this module is the script being run (not imported). */
export function isMain(url: string): boolean {
  return process.argv[1] !== undefined && fileURLToPath(url) === process.argv[1];
}
