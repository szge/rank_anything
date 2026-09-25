import { expect, test } from "vitest";
import { DistributionError, type LabeledDistribution } from "../src/distributions.ts";
import { available, convert, load, percentile } from "../src/index.ts";
import { approx } from "./helpers.ts";

test.each(Object.keys(available()))("%s loads and round-trips", (name) => {
  const d = load(name);
  for (const p of [1, 25, 50, 75, 99]) {
    const placed = d.fromPercentile(p);
    if (placed.clamped) continue; // e.g. 11% of GRE Quant takers score 170: no value above 89%
    const back = d.toPercentile(placed.value, placed.position ?? 0.5);
    approx(back.percentile, p, { abs: 1e-6 });
  }
});

test("percentile and top pseudo-distributions", () => {
  approx(convert(90, "percentile", "top").targetPlacement.value, 10);
  approx(percentile(5, "top"), 95);
});

test("known conversions", () => {
  expect(convert(50, "percentile", "lol-rank").targetPlacement.value).toBe("Gold III");
  expect(convert("Challenger", "lol-rank", "valorant-rank").targetPlacement.value).toBe("Radiant");
  approx(convert(3_487_600, "canada-income", "percentile").targetPlacement.value, 99.99);
  expect(convert("E3", "meta-level", "meta-level").targetPlacement.value).toBe("E3");
  // Between the IRS top-25% and top-20% floors, the share above follows a power law.
  const a = Math.log(25 / 20) / Math.log(123406 / 105604);
  approx(percentile("$115k", "us-income"), 100 - 25 * (115000 / 105604) ** -a);
  // us-income: IRS Table 4.1 floors are exact percentile anchors.
  approx(percentile(53_801, "us-income"), 50);
  approx(percentile(675_602, "us-income"), 99);
  approx(percentile(78_617_933, "us-income"), 99.999);
  const beyond = load("us-income").toPercentile("1B");
  expect(beyond.extrapolated && beyond.percentile > 99.999 && beyond.percentile < 100).toBe(true);
  expect(percentile("1M", "us-income")).toBeGreaterThan(percentile("700k", "us-income"));
  expect(percentile("700k", "us-income")).toBeGreaterThan(99);
});

test("unknown name suggests", () => {
  expect(() => load("lol")).toThrow(DistributionError);
  expect(() => load("lol")).toThrow(/lol-rank/);
});

test("published anchor points", () => {
  // RunRepeat: 25:20 is the 10th-fastest percentile, i.e. better than 90%.
  approx(percentile("25:20", "5k-time"), 90);
  approx(percentile("4:26:33", "marathon-time"), 50);
  expect(percentile("4:26", "marathon-time")).toBeGreaterThan(50); // h:mm, slightly faster than median
  // Dota 2: Immortal = everything above Divine 5's cumulative 95.56%.
  approx(percentile("Immortal", "dota2-rank", 0), 95.56);
  // Rocket League is published as "this rank or higher".
  approx(percentile("SSL", "rocket-league-rank", 0), 100 - 0.038);
  approx(percentile("Bronze 1", "rocket-league-rank", 0), 0);
  // R6 labels count down within a tier: Copper 5 is the lowest rank.
  expect((load("r6-rank") as LabeledDistribution).labels[0]).toBe("Copper 5");
});

test("live stats are sane", () => {
  for (const name of ["lichess-blitz", "lichess-rapid", "monkeytype-wpm"]) {
    const d = load(name);
    const [p10, p50, p90] = [10, 50, 90].map((p) => d.fromPercentile(p).value as number);
    expect(p10 < p50 && p50 < p90).toBe(true);
  }
  const blitz = convert(50, "percentile", "lichess-blitz").targetPlacement.value as number;
  expect(blitz > 1000 && blitz < 2000).toBe(true);
  const wpm = convert(50, "percentile", "monkeytype-wpm").targetPlacement.value as number;
  expect(wpm > 40 && wpm < 120).toBe(true);
});

test("official test score tables", () => {
  // "At or below" tables are converted to "% below": ACT 22 is 72 at-or-below, so 68 below.
  approx(percentile(22, "act-score"), 68);
  approx(percentile(508, "mcat-score"), 71);
  approx(percentile(154, "lsat-score"), 50.43);
  approx(percentile(170, "gre-quant"), 89);
  approx(percentile(130, "gre-verbal"), 0);
  // Scores off the scale are clamped, not extrapolated.
  expect(load("lsat-score").toPercentile(190).clamped).toBe(true);
  approx(percentile(740, "credit-score"), 49.7);
});

test("net worth and GitHub stars", () => {
  approx(percentile(192_700, "us-net-worth"), 50);
  approx(percentile(519_450, "canada-net-worth"), 50);
  approx(percentile("7.4M", "canada-net-worth"), 99); // PBO anchor
  expect(percentile(-5_000, "us-net-worth")).toBeLessThan(10); // debts > assets
  expect(percentile(1, "github-stars")).toBe(0); // population: repos with 1+ stars
  expect(percentile(10, "github-stars")).toBeLessThan(percentile(1000, "github-stars"));
  expect(percentile(1000, "github-stars")).toBeLessThan(100);
});
