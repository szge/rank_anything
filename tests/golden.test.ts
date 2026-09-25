/**
 * Compares against reference outputs (tests/fixtures/golden.json, recorded at
 * commit bd8187a): CLI output byte for byte, and API results over percentile
 * grids, label matching, parsing, formatting and importers.
 *
 * Intentional differences from the recording: the version (0.1.0 -> the current VERSION),
 * and (updated in the fixture) us-income's description, which now points at
 * scripts/build_us_income.ts, and the help and usage text for `convert --raw`
 * and the `percentile` command, which were added later.
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { main } from "../src/cli.ts";
import {
  DistributionError,
  LabeledDistribution,
  PiecewiseDistribution,
  type Placement,
  formatDuration,
  formatNumber,
  formatPercent,
  normalizeLabel,
  parseDuration,
  parseNumber,
} from "../src/distributions.ts";
import { distType } from "../src/format.ts";
import { dumpSpec, numbersFromTable, numbersFromText } from "../src/importers.ts";
import { load } from "../src/node.ts";
import { toFixed } from "../src/text.ts";
import { erf, normalCdf, normalInvCdf } from "../src/stats.ts";
import { VERSION } from "../src/version.ts";

type Num = number | { nonfinite: string };
interface CliCase { argv: string[]; code: number; stdout: string; stderr: string; json?: boolean }
interface GoldenPlacement { percentile: Num; value: Num | string; position: number | null; clamped: boolean; extrapolated: boolean }
type Result<T> = { ok: T } | { error: string };

const golden = JSON.parse(readFileSync(new URL("./fixtures/golden.json", import.meta.url), "utf8"));

beforeAll(() => {
  process.env.RANK_ANYTHING_HOME = "/nonexistent/ra-golden-home";
});

function run(argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = main(argv, { stdout: (s) => void (stdout += s), stderr: (s) => void (stderr += s), columns: 80 });
  return { code, stdout, stderr };
}

function num(x: Num): number {
  if (typeof x === "number") return x;
  return { inf: Infinity, "-inf": -Infinity, nan: NaN }[x.nonfinite]!;
}

function close(actual: unknown, expected: unknown, what: string, rel = 1e-9, abs = 1e-10): void {
  if (typeof expected === "number" || (expected && typeof expected === "object" && "nonfinite" in expected)) {
    const e = num(expected as Num);
    const a = actual as number;
    if (!Number.isFinite(e)) {
      expect(a, what).toBe(e);
      return;
    }
    expect(typeof a, what).toBe("number");
    const ok = Math.abs(a - e) <= Math.max(abs, rel * Math.abs(e));
    if (!ok) expect.fail(`${what}: expected ${e}, got ${a}`);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), what).toBe(true);
    expect((actual as unknown[]).length, what).toBe(expected.length);
    expected.forEach((e, i) => close((actual as unknown[])[i], e, `${what}[${i}]`, rel, abs));
    return;
  }
  if (expected && typeof expected === "object") {
    expect(Object.keys(actual as object).sort(), what).toEqual(Object.keys(expected).sort());
    for (const [k, e] of Object.entries(expected)) close((actual as Record<string, unknown>)[k], e, `${what}.${k}`, rel, abs);
    return;
  }
  expect(actual, what).toEqual(expected);
}

function placementJson(p: Placement) {
  return { percentile: p.percentile, value: p.value, position: p.position, clamped: p.clamped, extrapolated: p.extrapolated };
}

function attempt<T>(fn: () => T): Result<T> {
  try {
    return { ok: fn() };
  } catch (e) {
    if (e instanceof DistributionError) return { error: e.message };
    throw e;
  }
}

function sameResult<T>(actual: Result<T>, expected: Result<unknown>, what: string, rel?: number): void {
  if ("error" in expected) {
    expect(actual, what).toEqual(expected);
  } else {
    if ("error" in actual) expect.fail(`${what}: unexpected error ${actual.error}`);
    close(actual.ok, expected.ok, what, rel);
  }
}

describe("CLI output matches reference outputs", () => {
  const cases = golden.cli as CliCase[];
  test.each(cases.filter((c) => !c.json).map((c) => [c.argv.join(" "), c] as const))("%s", (_, c) => {
    const out = run(c.argv);
    expect(out.stderr).toBe(c.stderr);
    expect(out.stdout).toBe(c.stdout);
    expect(out.code).toBe(c.code);
  });

  test.each([...cases.filter((c) => c.json), ...(golden.json_cli as CliCase[])].map((c) => [c.argv.join(" "), c] as const))(
    "%s",
    (_, c) => {
      const out = run(c.argv);
      expect(out.code).toBe(c.code);
      expect(out.stderr).toBe(c.stderr);
      if (c.code === 0) close(JSON.parse(out.stdout), JSON.parse(c.stdout), "json");
    },
  );

  test.each([...(golden.usage as CliCase[]), ...(golden.help as CliCase[])].map((c) => [c.argv.join(" ") || "(none)", c] as const))(
    "usage/help: %s",
    (_, c) => {
      const out = run(c.argv);
      expect(out.stdout).toBe(c.stdout.replace("rank-anything 0.1.0", `rank-anything ${VERSION}`));
      expect(out.stderr).toBe(c.stderr);
      expect(out.code).toBe(c.code);
    },
  );
});

describe("distributions match reference outputs", () => {
  test.each(Object.keys(golden.api))("%s", (name) => {
    const g = golden.api[name];
    const d = load(name);
    expect(d.kind).toBe(g.info.kind);
    expect(distType(d)).toBe(g.info.type);
    expect(d.displayName).toBe(g.info.display);
    if (d instanceof LabeledDistribution) close(d.bands.map((b) => [b.label, b.lo, b.hi]), g.info.bands, "bands");
    if (d instanceof PiecewiseDistribution) {
      close(d.xs, g.info.xs, "xs");
      close(d.ps, g.info.ps, "ps");
      expect([d.lowerTail?.kind ?? null, d.upperTail?.kind ?? null]).toEqual(g.info.tails);
    }
    for (const row of g.grid as Array<{ p: number; from: GoldenPlacement; back: Result<GoldenPlacement> }>) {
      const fp = d.fromPercentile(row.p);
      close(placementJson(fp), row.from, `${name} fromPercentile(${row.p})`);
      const back = attempt(() => placementJson(d.toPercentile(fp.value, fp.position ?? 0.5)));
      sameResult(back, row.back, `${name} round trip at ${row.p}`);
    }
    for (const row of g.extra) {
      const got = row.label !== undefined
        ? attempt(() => placementJson(d.toPercentile(row.label, row.pos)))
        : attempt(() => placementJson(d.toPercentile(row.x)));
      // Labeled rows store the placement directly; numeric rows store {ok} or {error}.
      const expected = row.label !== undefined ? { ok: row.to } : row.to;
      sameResult(got, expected, `${name} ${row.label ?? row.x}`);
    }
  });
});

describe("label matching matches reference outputs", () => {
  test.each(Object.keys(golden.labels))("%s", (name) => {
    const d = load(name) as LabeledDistribution;
    for (const q of golden.labels[name]) {
      sameResult(attempt(() => d.find(q.q).label), q.find, `find(${q.q})`);
      sameResult(attempt(() => { const b = d.findSpan(q.q); return [b.label, b.lo, b.hi]; }), q.span, `findSpan(${q.q})`);
    }
  });
});

describe("parsing and formatting match reference outputs", () => {
  const g = golden.parsing;
  test("parseNumber", () => {
    for (const [s, r] of Object.entries(g.number)) sameResult(attempt(() => parseNumber(s)), r as Result<number>, `parseNumber(${s})`);
  });
  test("parseDuration", () => {
    for (const [s, r] of Object.entries(g.duration_mmss)) sameResult(attempt(() => parseDuration(s)), r as Result<number>, s);
    for (const [s, r] of Object.entries(g.duration_hmm)) sameResult(attempt(() => parseDuration(s, "h:mm")), r as Result<number>, s);
  });
  test("formatNumber / formatPercent / formatDuration", () => {
    for (const [x, s] of g.fmt_number) expect(formatNumber(x), String(x)).toBe(s);
    for (const [x, s] of g.fmt_percent) expect(formatPercent(x), String(x)).toBe(s);
    for (const [x, s] of g.fmt_duration) expect(formatDuration(x), String(x)).toBe(s);
    for (const [x, s] of g.position_pct) expect(`${toFixed(x * 100, 0)}%`, String(x)).toBe(s);
  });
  test("normalizeLabel", () => {
    for (const [s, k] of Object.entries(g.normalize)) expect(normalizeLabel(s), s).toBe(k);
  });
  test("erf and the normal distribution", () => {
    for (const [x, y] of g.erf) close(erf(x), y, `erf(${x})`, 1e-14, 1e-16);
    for (const [kind, x, y] of g.normal) {
      if (kind === "inv") close(normalInvCdf(x, 100, 15), y, `inv_cdf(${x})`, 1e-14);
      else close(normalCdf(x, 100, 15), y, `cdf(${x})`, 1e-13, 1e-16);
    }
  });
});

describe("importers match reference outputs", () => {
  const g = golden.importers;
  test("numbersFromText", () => {
    for (const [text, r] of g.text) sameResult(attempt(() => numbersFromText(text)), r, JSON.stringify(text));
  });
  test("numbersFromTable", () => {
    for (const [text, col, r] of g.table) sameResult(attempt(() => numbersFromTable(text, col)), r, `${JSON.stringify(text)} ${col}`);
  });
  test("dumpSpec", () => {
    expect(dumpSpec({ name: "x", type: "samples", data: [1, 2.5, 3] })).toBe(g.dump[0]);
    expect(dumpSpec({ name: "x", type: "frequency", title: "Ünï – x", data: { a: 1, b: 2 } })).toBe(g.dump[1]);
  });
});
