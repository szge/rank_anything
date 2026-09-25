/** Turn plain .csv / .tsv / .txt text of numbers into `samples` distributions. */

import { DistributionError, parseNumber } from "./distributions.ts";
import { stringifyJson } from "./json.ts";
import { strRepr } from "./text.ts";
import type { DistributionSpec } from "./spec.ts";

export const TABLE_SUFFIXES = [".csv", ".tsv"] as const;
export const TEXT_SUFFIXES = [".txt"] as const;
export const IMPORT_SUFFIXES: readonly string[] = [...TABLE_SUFFIXES, ...TEXT_SUFFIXES];

// "85,000" or "$1,250,000.50k": commas here are thousands separators, not delimiters.
const THOUSANDS = /^[^\d,]*\d{1,3}(,\d{3})+(\.\d+)?[^\d,]*$/;

function tryNumber(cell: string): number | undefined {
  try {
    return parseNumber(cell);
  } catch (e) {
    if (e instanceof DistributionError) return undefined;
    throw e;
  }
}

/** The last path component: "dir/salaries.csv" -> "salaries.csv". */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** "salaries.csv" -> ".csv" (lowercased); "" when there is no extension. */
export function suffix(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i).toLowerCase() : "";
}

/** "dir/salaries.csv" -> "salaries". */
export function stem(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(0, i) : name;
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

/**
 * Numbers from free-form text: one per line, or separated by spaces, tabs,
 * semicolons or commas. `#` starts a comment. Thousands separators like
 * `85,000` are understood.
 */
export function numbersFromText(text: string): number[] {
  const out: number[] = [];
  const lines = text.split(LINE_BREAK);
  lines.forEach((raw, i) => {
    const line = raw.split("#")[0];
    for (const token of line.split(/[\s;]+/)) {
      const parts = THOUSANDS.test(token) ? [token] : token.split(",");
      for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
        const value = tryNumber(part);
        if (value === undefined) throw new DistributionError(`line ${i + 1}: ${strRepr(part)} is not a number`);
        out.push(value);
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ CSV

/** Parse CSV text (quoted fields, doubled quotes, any line ending) with the given delimiter. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let rowStarted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "" && !quotedField) {
      inQuotes = quotedField = rowStarted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      quotedField = false;
      rowStarted = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (rowStarted || field) row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quotedField = rowStarted = false;
    } else {
      field += c;
      rowStarted = true;
    }
  }
  if (rowStarted || field) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const PREFERRED = [",", "\t", ";", " ", ":"];

/** Delimiter guess from the characters next to quoted fields. */
function guessQuoteAndDelimiter(data: string, delimiters: string): string {
  const d = String.raw`[^\p{L}\p{N}_\n"']`;
  const patterns = [
    String.raw`(?<delim>${d})(?<space> ?)(?<quote>["']).*?\k<quote>\k<delim>`,
    String.raw`(?:^|\n)(?<quote>["']).*?\k<quote>(?<delim>${d})(?<space> ?)`,
    String.raw`(?<delim>${d})(?<space> ?)(?<quote>["']).*?\k<quote>(?:$|\n)`,
    String.raw`(?:^|\n)(?<quote>["']).*?\k<quote>(?:$|\n)`,
  ];
  for (const p of patterns) {
    const matches = [...data.matchAll(new RegExp(p, "gmsu"))];
    if (!matches.length) continue;
    const delims = new Map<string, number>();
    for (const m of matches) {
      const key = m.groups?.delim;
      if (key && delimiters.includes(key)) delims.set(key, (delims.get(key) ?? 0) + 1);
    }
    let best = "";
    let count = 0;
    for (const [k, n] of delims) if (n > count) [best, count] = [k, n];
    return best === "\n" ? "" : best;
  }
  return "";
}

/** Delimiter guess: the character that appears equally often on (almost) every line. */
function guessDelimiter(sample: string, delimiters: string): string {
  const data = sample.split("\n").filter(Boolean);
  const chunkLength = Math.min(10, data.length);
  const charFrequency = new Map<string, Map<number, number>>();
  const delims = new Map<string, [number, number]>();
  let iteration = 0;
  for (let start = 0, end = chunkLength; start < data.length; start = end, end += chunkLength) {
    iteration++;
    for (const line of data.slice(start, end)) {
      for (const ch of delimiters) {
        const meta = charFrequency.get(ch) ?? new Map<number, number>();
        const freq = line.split(ch).length - 1;
        meta.set(freq, (meta.get(freq) ?? 0) + 1);
        charFrequency.set(ch, meta);
      }
    }
    const modes = new Map<string, [number, number]>();
    for (const [ch, meta] of charFrequency) {
      const items = [...meta.entries()];
      if (items.length === 1 && items[0][0] === 0) continue;
      let mode = items[0];
      for (const it of items) if (it[1] > mode[1]) mode = it;
      const rest = items.filter((it) => it !== mode).reduce((s, it) => s + it[1], 0);
      modes.set(ch, [mode[0], mode[1] - rest]);
    }
    const total = Math.min(chunkLength * iteration, data.length);
    for (let consistency = 1.0; delims.size === 0 && consistency >= 0.9; consistency -= 0.01) {
      for (const [k, v] of modes) {
        if (v[0] > 0 && v[1] > 0 && v[1] / total >= consistency) delims.set(k, v);
      }
    }
    if (delims.size === 1) return [...delims.keys()][0];
  }
  if (!delims.size) return "";
  for (const d of PREFERRED) if (delims.has(d)) return d;
  const items = [...delims.entries()].sort(
    ([ka, a], [kb, b]) => a[0] - b[0] || a[1] - b[1] || (ka < kb ? -1 : ka > kb ? 1 : 0),
  );
  return items[items.length - 1][0];
}

/** Guess a CSV delimiter among `delimiters`; "," if unsure. */
export function sniffDelimiter(sample: string, delimiters = ",\t;|"): string {
  return guessQuoteAndDelimiter(sample, delimiters) || guessDelimiter(sample, delimiters) || ",";
}

/**
 * Numbers from one column of a CSV/TSV. `column` is a header name or a
 * 1-based index. With no `column`, the only numeric column is used. A
 * non-numeric first row is treated as a header; blank cells are skipped.
 */
export function numbersFromTable(text: string, column?: string | null, delimiter?: string | null): number[] {
  const delim = delimiter ?? sniffDelimiter(text.slice(0, 4096));
  const rows = parseCsv(text, delim).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) throw new DistributionError("file is empty");

  const width = Math.max(...rows.map((r) => r.length));
  const firstIsHeader = rows[0].some((c) => c.trim() && tryNumber(c) === undefined);
  const header = firstIsHeader
    ? [...rows[0].map((c) => c.trim()), ...Array<string>(width - rows[0].length).fill("")]
    : [];
  const body = firstIsHeader ? rows.slice(1) : rows;
  const names = (header.length ? header : Array<string>(width).fill("")).map((h, i) => h || `column ${i + 1}`);
  const cells = (i: number) => body.filter((r) => i < r.length && r[i].trim()).map((r) => r[i].trim());

  let idx: number;
  if (column != null) {
    if (header.includes(column)) idx = header.indexOf(column);
    else if (/^\d+$/.test(column) && Number(column) >= 1 && Number(column) <= width) idx = Number(column) - 1;
    else throw new DistributionError(`no column ${strRepr(column)}. Columns: ${names.join(", ")}`);
  } else {
    const numeric = [...Array(width).keys()].filter((i) => {
      const cs = cells(i);
      return cs.length > 0 && cs.every((c) => tryNumber(c) !== undefined);
    });
    if (numeric.length !== 1) {
      const found = numeric.length ? numeric.map((i) => names[i]).join(", ") : "none";
      throw new DistributionError(
        `can't tell which column to use (numeric columns: ${found}). Pick one with --column. Columns: ${names.join(", ")}`,
      );
    }
    idx = numeric[0];
  }

  const values: number[] = [];
  const bad: string[] = [];
  for (const c of cells(idx)) {
    const v = tryNumber(c);
    if (v === undefined) bad.push(c);
    else values.push(v);
  }
  if (bad.length) {
    throw new DistributionError(`column ${strRepr(names[idx])} has ${bad.length} non-numeric value(s), e.g. ${strRepr(bad[0])}`);
  }
  return values;
}

/**
 * Numbers from the contents of a .csv/.tsv/.txt file. `filename` picks the
 * format (by extension) and prefixes error messages.
 */
export function numbersFromFile(text: string, filename: string, column?: string | null): number[] {
  if (text.startsWith("﻿")) text = text.slice(1);
  const ext = suffix(filename);
  let values: number[];
  try {
    if ((TABLE_SUFFIXES as readonly string[]).includes(ext)) {
      values = numbersFromTable(text, column, ext === ".tsv" ? "\t" : null);
    } else if (column != null) {
      throw new DistributionError("--column only applies to .csv/.tsv files");
    } else {
      values = numbersFromText(text);
    }
  } catch (e) {
    if (e instanceof DistributionError) throw new DistributionError(`${filename}: ${e.message}`);
    throw e;
  }
  if (values.length < 2) throw new DistributionError(`${filename}: need at least 2 numbers, found ${values.length}`);
  return values;
}

export interface SamplesSpecOptions {
  /** CSV column: header name or 1-based index. Default: the only numeric column. */
  column?: string | null;
  name?: string | null;
  title?: string | null;
  unit?: string | null;
  description?: string | null;
  higherIsBetter?: boolean;
}

/** Build a `samples` JSON spec from the contents of a .csv/.tsv/.txt file of numbers. */
export function samplesSpecFromText(text: string, filename: string, options: SamplesSpecOptions = {}): DistributionSpec {
  const values = numbersFromFile(text, filename, options.column);
  const name = options.name || stem(filename).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
  const spec: Record<string, unknown> = { name };
  if (options.title) spec.title = options.title;
  spec.description = options.description || `Imported from ${basename(filename)} (${values.length} values)`;
  if (options.unit) spec.unit = options.unit;
  if (options.higherIsBetter === false) spec.higher_is_better = false;
  spec.type = "samples";
  spec.data = values;
  return spec as unknown as DistributionSpec;
}

/** Pretty JSON, but with a `samples` data list kept on a single line. */
export function dumpSpec(spec: object): string {
  const s = spec as { type?: unknown; data?: unknown };
  const inline = s.type === "samples" && Array.isArray(s.data) ? ["data"] : [];
  return stringifyJson(spec, 2, inline) + "\n";
}
