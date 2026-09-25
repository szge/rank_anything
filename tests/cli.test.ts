import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { formatPercent } from "../src/distributions.ts";
import { run, tmpDir } from "./helpers.ts";

let home: string;
beforeEach(() => {
  home = tmpDir();
  process.env.RANK_ANYTHING_HOME = home;
});
afterEach(() => {
  delete process.env.RANK_ANYTHING_HOME;
});

test("convert: single target", () => {
  const { code, out } = run("convert", "85k", "--from", "canada-income", "--to", "lol-rank");
  expect(code).toBe(0);
  expect(out).toContain("Platinum I");
  expect(out).toContain("top 18.5%");
});

test("convert: all targets", () => {
  const { code, out } = run("convert", "E6", "-f", "meta-level");
  expect(code).toBe(0);
  for (const name of ["lol-rank", "valorant-rank", "iq", "canada-income"]) expect(out).toContain(name);
});

test("convert --json", () => {
  const { out } = run("convert", "Challenger", "-f", "lol-rank", "-t", "valorant-rank", "--json");
  const data = JSON.parse(out);
  expect(data.results[0].value).toBe("Radiant");
  expect(data.percentile).toBeGreaterThan(99.9);
});

test("tier prefix", () => {
  const { code, out } = run("convert", "plat 2", "-f", "lol-rank", "-t", "percentile");
  expect(code).toBe(0);
  expect(out).toContain("Platinum II");
});

test("errors are friendly", () => {
  let r = run("convert", "banana", "-f", "lol-rank", "-t", "iq");
  expect(r.code).toBe(2);
  expect(r.err).toContain("unknown label");
  r = run("convert", "1", "-f", "nope", "-t", "iq");
  expect(r.code).toBe(2);
  expect(r.err).toContain("Unknown distribution");
});

test("show, table, list, prompt", () => {
  expect(run("show", "lol-rank").out.split("\n").length - 1).toBeGreaterThan(30);
  expect(run("table", "-f", "meta-level", "-t", "lol-rank").out).toContain("E9");
  expect(run("list").out).toContain("sat-score");
  expect(run("prompt", "US household income").out).toContain('"type"');
});

test("add, validate, remove", () => {
  const f = join(home, "mine.json");
  writeFileSync(f, JSON.stringify({ name: "mine", type: "samples", data: [1, 2, 3, 4] }));
  expect(run("validate", f).code).toBe(0);
  expect(run("add", f).code).toBe(0);
  expect(run("add", f).code).toBe(2); // already exists
  const { code, out } = run("convert", "3", "-f", "mine", "-t", "percentile");
  expect(code).toBe(0);
  expect(out).toContain("62.5%");
  expect(run("list").out).toMatch(/mine\s+user/);
  expect(run("remove", "mine").code).toBe(0);
  expect(run("remove", "mine").code).toBe(2);
});

test("a JSON path works directly", () => {
  const { code, out } = run("convert", "240", "-f", "examples/marathon-times.json", "-t", "percentile");
  expect(code).toBe(0);
  expect(out).toContain("better than 62%"); // lower time is better
});

test.each([
  [50, "50%"], [81.48, "81.5%"], [99.9, "99.9%"], [99.977, "99.977%"], [0.38, "0.38%"],
  [99.998841, "99.9988%"], [99.99999962, "99.99999962%"], [100, "100%"],
])("formatPercent(%s) = %s", (p, s) => {
  expect(formatPercent(p)).toBe(s);
});

test("extreme values stay distinct", () => {
  const outs = ["12000000", "1200000000"].map((v) => run("convert", v, "-f", "canada-income", "-t", "lol-rank").out);
  expect(outs[0]).not.toBe(outs[1]);
  for (const o of outs) expect(o).toContain("extrapolated");
});

test("convert --raw prints just the value(s)", () => {
  expect(run("convert", "1520", "--from", "sat-score", "--to", "lol-rank", "--raw")).toEqual({ code: 0, out: "Diamond II\n", err: "" });
  const multi = run("convert", "1520", "-f", "sat-score", "-t", "lol-rank", "-t", "canada-income", "-t", "percentile", "-t", "marathon-time", "--raw");
  expect(multi.out).toBe("lol-rank\tDiamond II\ncanada-income\t239970\npercentile\t97.6\nmarathon-time\t2:57:10\n");
  // No --to: one line per distribution.
  const all = run("convert", "E5", "-f", "meta-level", "--raw").out.trim().split("\n");
  expect(all).toContain("lol-rank\tPlatinum III");
  expect(all).toContain("iq\t108.52");
  expect(run("convert", "1.2B", "-f", "canada-income", "-t", "top", "--raw").out).toBe("0.00000038\n");
  const both = run("convert", "1", "-f", "iq", "-t", "lol-rank", "--raw", "--json");
  expect(both.code).toBe(2);
  expect(both.err).toContain("can't be used together");
});

test("percentile prints just the number", () => {
  expect(run("percentile", "1520", "--from", "sat-score")).toEqual({ code: 0, out: "97.6\n", err: "" });
  expect(run("percentile", "1520", "-f", "sat-score", "--top").out).toBe("2.4\n");
  expect(run("percentile", "12M", "-f", "canada-income").out).toBe("99.9988\n");
  expect(run("percentile", "gold", "-f", "lol-rank", "-p", "0").out).toBe("40.3\n");
  expect(run("percentile", "97k", "-f", "examples/team-salaries.csv").code).toBe(0);
  expect(run("percentile", "banana", "-f", "lol-rank").code).toBe(2);
  expect(run("percentile", "1520").err).toContain("required: -f/--from");
  expect(run("percentile", "-h").out).toContain("--top");
  expect(run("--help").out).toContain("percentile");
});

test("option parsing: --opt=value, prefixes, attached short values, negative numbers", () => {
  const base = run("convert", "Gold II", "-f", "lol-rank", "-t", "iq", "-p", "0.25").out;
  expect(run("convert", "Gold II", "--from=lol-rank", "--to", "iq", "--pos", "0.25").out).toBe(base);
  expect(run("convert", "-flol-rank", "-tiq", "-p0.25", "Gold II").out).toBe(base);
  expect(run("convert", "-5000", "-f", "us-net-worth", "-t", "percentile").code).toBe(0);
  expect(run("convert", "1", "-f", "iq", "--", "-t").code).toBe(2); // "-t" is an extra positional after --
});
