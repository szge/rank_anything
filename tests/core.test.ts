import { describe, expect, test } from "vitest";
import {
  DistributionError,
  LabeledDistribution,
  PiecewiseDistribution,
  convert,
  formatDuration,
  normalizeLabel,
  parseDuration,
  parseNumber,
} from "../src/distributions.ts";
import { fromDict } from "../src/spec.ts";
import { approx } from "./helpers.ts";

test("parseNumber", () => {
  expect(parseNumber("85,000")).toBe(85000);
  expect(parseNumber("$85k")).toBe(85000);
  expect(parseNumber("1.2M")).toBe(1_200_000);
  expect(parseNumber("-3.5")).toBe(-3.5);
  expect(() => parseNumber("gold")).toThrow(DistributionError);
});

test("normalizeLabel", () => {
  expect(normalizeLabel("Gold II")).toBe(normalizeLabel("gold 2"));
  expect(normalizeLabel("gold 2")).toBe(normalizeLabel("GOLD-2"));
  // Roman numeral only converted after the first token ("I" alone is a word)
  expect(normalizeLabel("Iron IV")).toBe("iron4");
});

test("piecewise interpolates between known points", () => {
  const d = new PiecewiseDistribution("x", [[0, 0], [100, 50], [300, 100]]);
  approx(d.toPercentile(50).percentile, 25);
  approx(d.toPercentile(200).percentile, 75);
  approx(d.fromPercentile(75).value, 200);
});

test("piecewise clamp tail", () => {
  const d = new PiecewiseDistribution("x", [[10, 20], [20, 80]], { tail: "clamp" });
  const p = d.toPercentile(5);
  expect(p.clamped).toBe(true);
  expect(p.percentile).toBe(20);
  const v = d.fromPercentile(99);
  expect(v.clamped).toBe(true);
  expect(v.value).toBe(20);
});

test("hard bounds clamp even with auto tail", () => {
  // 0% and 100% endpoints are real limits (e.g. a max score): nothing beyond.
  const d = new PiecewiseDistribution("sat", [[400, 0], [1600, 100]]);
  expect(d.toPercentile(2000).clamped).toBe(true);
  expect(d.toPercentile(2000).percentile).toBe(100);
});

test("pareto upper tail keeps ranking extreme values", () => {
  const d = new PiecewiseDistribution("inc", [[0, 0], [1_000, 90], [10_000, 99], [100_000, 99.9]]);
  const [a, b, c] = [1e6, 1e7, 1e9].map((x) => d.toPercentile(x));
  expect(a.extrapolated && !a.clamped).toBe(true);
  expect(99.9 < a.percentile && a.percentile < b.percentile && b.percentile < c.percentile && c.percentile < 100).toBe(true);
  // Pareto fit from the last two points: each 10x cuts the top share 10x.
  approx(100 - a.percentile, 0.01);
  // And the inverse agrees.
  approx(d.fromPercentile(a.percentile).value, 1e6);
});

test("lower tail and exponential tail", () => {
  const d = new PiecewiseDistribution("x", [[-10, 5], [0, 50], [10, 80], [20, 95]]);
  expect(d.upperTail?.kind).toBe("pareto");
  expect(d.lowerTail?.kind).toBe("exponential");
  const lo = d.toPercentile(-20);
  expect(lo.extrapolated && lo.percentile > 0 && lo.percentile < 5).toBe(true);
  approx(d.fromPercentile(lo.percentile).value, -20);
  expect(() => new PiecewiseDistribution("x", [[-10, 5], [0, 50]], { tail: "pareto" })).toThrow(DistributionError);
});

test("lower is better", () => {
  const d = new PiecewiseDistribution("t", [[120, 0], [300, 100]], { higherIsBetter: false });
  approx(d.toPercentile(120).percentile, 100);
  approx(d.fromPercentile(100).value, 120);
});

test("labeled from frequencies: bands and positions", () => {
  const d = LabeledDistribution.fromFrequencies("r", [["Bronze", 50], ["Silver", 30], ["Gold", 20]]);
  approx(d.toPercentile("bronze").percentile, 25);
  approx(d.toPercentile("Silver", 0).percentile, 50);
  approx(d.toPercentile("Silver", 1).percentile, 80);
  const pl = d.fromPercentile(65);
  expect(pl.value).toBe("Silver");
  approx(pl.position, 0.5);
  expect(d.fromPercentile(100).value).toBe("Gold");
  expect(d.fromPercentile(0).value).toBe("Bronze");
});

test("labeled prefix match and errors", () => {
  const d = LabeledDistribution.fromFrequencies("r", [["Bronze", 1], ["Silver", 1], ["Grandmaster", 1]]);
  expect(d.find("grand").label).toBe("Grandmaster");
  expect(() => d.find("platinum")).toThrow(DistributionError);
});

test("convert numeric to labeled", () => {
  const src = new PiecewiseDistribution("inc", [[0, 0], [100, 100]]);
  const dst = LabeledDistribution.fromFrequencies("r", [["A", 50], ["B", 50]]);
  const c = convert(75, src, dst);
  expect(c.targetPlacement.value).toBe("B");
  approx(c.targetPlacement.position, 0.5);
});

test("round trip numeric", () => {
  const a = new PiecewiseDistribution("a", [[0, 0], [10, 30], [50, 90], [100, 100]]);
  const b = new PiecewiseDistribution("b", [[1, 0], [2, 100]]);
  for (const x of [3, 10, 27.5, 80]) {
    const y = convert(x, a, b).targetPlacement.value;
    approx(convert(y, b, a).targetPlacement.value, x);
  }
});

test("fromDict types", () => {
  const lab = fromDict({ type: "percentile", percentile_kind: "top", data: { E3: 100, E4: 60, E5: 20 } });
  expect(lab.kind).toBe("labeled");
  approx(lab.toPercentile("E5", 0).percentile, 80);

  const num = fromDict({ type: "percentile", data: { "10000": 10, "50000": 50 } });
  approx(num.toPercentile(30000).percentile, 30);

  const hist = fromDict({ type: "frequency", data: [["1", 1], ["2", 2], ["3", 1]] });
  approx(hist.toPercentile(2).percentile, 50);

  const norm = fromDict({ type: "normal", data: { mean: 100, std: 15 } });
  approx(norm.toPercentile(115).percentile, 84.13, { abs: 0.01 });

  const logn = fromDict({ type: "lognormal", data: { median: 50000, sigma: 0.8 } });
  approx(logn.toPercentile(50000).percentile, 50);
});

test("fromDict rejects bad input", () => {
  expect(() => fromDict({ type: "nope", data: [] })).toThrow(DistributionError);
  expect(() => fromDict({ type: "percentile", data: { "10": 50, "20": 40 } })).toThrow(DistributionError);
  expect(() => fromDict({ type: "normal", data: { mean: 1 } })).toThrow(DistributionError);
  expect(() => fromDict({ type: "frequency", data: { a: "<1" } })).toThrow(DistributionError);
  expect(() => fromDict({ type: "samples", data: [1, null] })).toThrow(DistributionError);
});

test("loglog interpolation follows a power law in the upper half", () => {
  // Exact Pareto with a=2: share above x = 10% * (x/100)^-2.
  const pts: Array<[number, number]> = [[10, 0], [50, 40], [100, 90], [1000, 99.9]];
  const lin = new PiecewiseDistribution("lin", pts);
  const log = new PiecewiseDistribution("log", pts, { interpolation: "loglog" });
  approx(log.toPercentile(300).percentile, 100 - 10 / 9);
  approx(lin.toPercentile(300).percentile, 92.2); // a straight line badly understates it
  approx(log.fromPercentile(99).value, 100 * 10 ** 0.5);
  // Lower half and exact points are unchanged.
  for (const x of [30, 50, 100, 1000]) approx(log.toPercentile(x).percentile, lin.toPercentile(x).percentile);
  expect(() => new PiecewiseDistribution("x", pts, { interpolation: "cubic" as "linear" })).toThrow(DistributionError);
});

test("parse and format duration", () => {
  expect(parseDuration("25:20")).toBe(25 * 60 + 20);
  expect(parseDuration("3:31", "h:mm")).toBe(3 * 3600 + 31 * 60);
  expect(parseDuration("3:31:46")).toBe(12706);
  expect(parseDuration("3:31:46", "h:mm")).toBe(12706);
  expect(parseDuration("3h31m")).toBe(12660);
  expect(parseDuration("25m20s")).toBe(1520);
  expect(parseDuration("25")).toBe(1500); // bare number = minutes
  expect(formatDuration(1520)).toBe("25:20");
  expect(formatDuration(12706)).toBe("3:31:46");
  expect(() => parseDuration("fast")).toThrow(DistributionError);
});

test("duration distribution from dict", () => {
  const d = fromDict({ type: "percentile", duration: "h:mm", higher_is_better: false, data: { "3:00": 10, "4:00": 50, "5:00": 90 } });
  approx(d.toPercentile("3:30").percentile, 70); // faster = better
  expect(d.formatValue(d.fromPercentile(70).value)).toBe("3:30:00");
  approx(d.toPercentile(3.5 * 3600).percentile, 70); // numbers = seconds
  expect(() => fromDict({ type: "normal", duration: "hours", data: { mean: 1, std: 1 } })).toThrow(DistributionError);
});

describe("acronyms and aliases", () => {
  test("matching", () => {
    const d = LabeledDistribution.fromFrequencies(
      "rl",
      [["Gold 1", 1], ["Grand Champion 1", 1], ["Grand Champion 2", 1], ["Supersonic Legend", 1]],
      { aliases: { SSL: "Supersonic Legend" } },
    );
    expect(d.find("gc 2").label).toBe("Grand Champion 2");
    expect(d.find("GC1").label).toBe("Grand Champion 1");
    expect(d.find("ssl").label).toBe("Supersonic Legend");
    expect(d.findSpan("gc").label).toBe("Grand Champion 1 – Grand Champion 2");
  });
  test("unknown alias target", () => {
    expect(() => LabeledDistribution.fromFrequencies("x", [["A", 1]], { aliases: { b: "Nope" } })).toThrow(/unknown label/);
  });
});
