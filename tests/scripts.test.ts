import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { expect, test } from "vitest";
import { parseJson, stringifyJson } from "../src/json.ts";
import { csvRecords, edgesToPoints, readZipEntry, weightedPercentiles } from "../scripts/common.ts";
import { build as buildTestScores } from "../scripts/build_test_scores.ts";
import { build as buildUsIncome } from "../scripts/build_us_income.ts";

const onDisk = (name: string) => parseJson(readFileSync(`data/${name}.json`, "utf8"));

test("deterministic dataset scripts reproduce data/", () => {
  for (const spec of [...buildTestScores(), buildUsIncome()]) {
    // Same content and the same key order.
    expect(stringifyJson(spec), spec.name).toBe(stringifyJson(onDisk(spec.name)));
  }
});

test("weightedPercentiles: smallest value whose cumulative weight reaches q%", () => {
  const pairs: Array<[number, number]> = [[30, 1], [10, 1], [20, 2], [40, 6]];
  expect([...weightedPercentiles(pairs, [50, 10, 40, 41, 100])]).toEqual([[10, 10], [40, 30], [41, 40], [50, 40], [100, 40]]);
});

test("edgesToPoints leaves the top open", () => {
  expect(stringifyJson(edgesToPoints([400, 425, 450], [1, 2, 1]), 0)).toBe('{"400":0,"425":25,"450":75}');
});

function zip(files: Record<string, string>, deflate: boolean): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test.each([false, true])("readZipEntry + csvRecords (deflate=%s)", (deflate) => {
  const archive = zip({ "README.txt": "hi", "Data/SCFP2022.CSV": "﻿NETWORTH,WGT\n-5,1.5\n\"1,000\",2\n" }, deflate);
  const rows = csvRecords(readZipEntry(archive, "scfp2022.csv"));
  expect(rows).toEqual([{ NETWORTH: "-5", WGT: "1.5" }, { NETWORTH: "1,000", WGT: "2" }]);
  expect(() => readZipEntry(archive, "missing.csv")).toThrow(/README.txt/);
});
