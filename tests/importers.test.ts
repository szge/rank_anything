import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { DistributionError } from "../src/distributions.ts";
import { numbersFromTable, numbersFromText } from "../src/importers.ts";
import { available, fromDict, load, percentile, readNumbers, samplesSpec } from "../src/node.ts";
import { approx, run, tmpDir } from "./helpers.ts";

afterEach(() => {
  delete process.env.RANK_ANYTHING_HOME;
});

test("text: separators, comments and thousands", () => {
  const text = "# header comment\n1 2\t3;4\n5, 6,7\n85,000  $1,250,000\n\n1.5e3 # trailing\n";
  expect(numbersFromText(text)).toEqual([1, 2, 3, 4, 5, 6, 7, 85000, 1250000, 1500]);
});

test("text rejects garbage", () => {
  expect(() => numbersFromText("1\nbanana\n")).toThrow(/line 2/);
});

test("table picks the only numeric column and skips the header", () => {
  expect(numbersFromTable('name,salary\nAna,"$104,000"\nBen,85k\n,\n')).toEqual([104000, 85000]);
});

test("table without header", () => {
  expect(numbersFromTable("3\n1\n2\n")).toEqual([3, 1, 2]);
});

test("table column by name or index", () => {
  const text = "a;b\n1;10\n2;20\n";
  expect(numbersFromTable(text, "b")).toEqual([10, 20]);
  expect(numbersFromTable(text, "1")).toEqual([1, 2]);
  expect(() => numbersFromTable(text)).toThrow(/--column/);
  expect(() => numbersFromTable(text, "c")).toThrow(/no column/);
});

test("order does not matter", () => {
  const dir = tmpDir();
  const [a, b] = [join(dir, "a.txt"), join(dir, "b.txt")];
  writeFileSync(a, "5 1 4 2 3");
  writeFileSync(b, "1 2 3 4 5");
  for (const x of [0.5, 2.5, 4.2, 9]) expect(percentile(x, a)).toBe(percentile(x, b));
});

test("csv and txt load directly", () => {
  expect(load("examples/team-salaries.csv").kind).toBe("numeric");
  approx(percentile(97000, "examples/team-salaries.csv"), percentile(97000, "examples/team-salaries.json"));
  expect(readNumbers("examples/5k-times.txt")).toHaveLength(15);
});

test("samplesSpec metadata", () => {
  const f = join(tmpDir(), "My Race Times.txt");
  writeFileSync(f, "20 25 30");
  const spec = samplesSpec(f, { unit: "min", higherIsBetter: false });
  expect(spec.name).toBe("my-race-times");
  expect(spec.higher_is_better).toBe(false);
  expect(spec.data).toEqual([20, 25, 30]);
  expect(fromDict(spec).toPercentile(20).percentile).toBeGreaterThan(50); // faster = better
});

test("CLI import writes JSON, and --add installs", () => {
  const dir = tmpDir();
  process.env.RANK_ANYTHING_HOME = join(dir, "home");
  const out = join(dir, "salaries.json");
  expect(run("import", "examples/team-salaries.csv", "--unit", "USD", "-o", out).code).toBe(0);
  const spec = JSON.parse(readFileSync(out, "utf8"));
  expect(spec.type).toBe("samples");
  expect(spec.data).toHaveLength(12);
  expect(run("import", "examples/team-salaries.csv", "-o", out).code).toBe(2); // exists

  expect(run("import", "examples/5k-times.txt", "--name", "parkrun", "--lower-is-better", "--add").code).toBe(0);
  expect(Object.keys(available())).toContain("parkrun");
  const r = run("convert", "20", "-f", "parkrun", "-t", "percentile");
  expect(r.code).toBe(0);
  expect(r.out).toContain("better than 89.3%");
});

test("CLI add accepts csv", () => {
  const dir = tmpDir();
  process.env.RANK_ANYTHING_HOME = dir;
  expect(run("add", "examples/team-salaries.csv", "--name", "salaries").code).toBe(0);
  expect(JSON.parse(readFileSync(join(dir, "distributions", "salaries.json"), "utf8")).name).toBe("salaries");
});

test("installing can't escape the user directory", () => {
  process.env.RANK_ANYTHING_HOME = tmpDir();
  expect(() => fromDict({ type: "samples", data: [1] })).toThrow(DistributionError);
  const r = run("add", "examples/team-salaries.csv", "--name", "../evil");
  expect(r.code).toBe(2);
  expect(r.err).toContain("path separators");
});
