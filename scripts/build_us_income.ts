/**
 * Rebuild data/us-income.json from IRS SOI tables (tax year 2023).
 *
 * US individual income: adjusted gross income (AGI) reported on individual
 * income tax returns (wages plus investment, business and capital-gains income).
 *
 * Top half (median and up): IRS SOI Table 4.1, "AGI floor on percentiles"
 * (current dollars), all returns excluding dependents (153.1M returns).
 * https://www.irs.gov/statistics/soi-tax-stats-individual-statistical-tables-by-tax-rate-and-income-percentile
 * https://www.irs.gov/pub/irs-soi/23in41ts.xlsx
 *
 * Bottom half: IRS SOI Table 1.1, number of returns by size of AGI, used only
 * below the $53,801 median floor.
 * https://www.irs.gov/pub/irs-soi/23in11si.xls
 *
 * Table 1.1 covers 160.6M returns, *including* 7.53M dependents' returns that
 * Table 4.1 excludes. Unadjusted, it puts 49.5% of returns below $50k, leaving
 * an implausible 0.5% between $50k and the $53,801 median (vs ~0.8% per $1k in
 * the neighbouring brackets). Dependents' returns are overwhelmingly small
 * (teen and student jobs), so we remove them from the $1-$15k brackets pro rata.
 * That gives 47.05% below $50k, which joins Table 4.1 smoothly (~0.78% per $1k
 * from $50k to the median). Only the shape below $15k depends on this choice.
 *
 * Consistency check at the top: Table 1.1 counts 0.52% of returns (rescaled to
 * Table 4.1's population) at $1M+, vs 0.55% implied by Table 4.1's top-1% and
 * top-0.1% floors.
 *
 * Run:  node scripts/build_us_income.ts [--out DIR]
 */

import { isMain, orderedObject, round, writeDataset } from "./common.ts";

// Table 4.1, 2023: "top X percent" -> AGI floor (current dollars)
const TOP_FLOORS: Array<[number, number]> = [
  [50, 53_801], [40, 69_564], [30, 91_224], [25, 105_604], [20, 123_406], [10, 187_608],
  [5, 272_209], [4, 307_631], [3, 361_737], [2, 453_137], [1, 675_602],
  [0.1, 3_100_950], [0.01, 16_086_174], [0.001, 78_617_933],
];

// Table 1.1, 2023: upper edge of AGI bracket -> number of returns in bracket
// (bracket "No AGI" has upper edge 0). Only brackets below the median are used.
const TOTAL_RETURNS_T11 = 160_602_107;
const TOTAL_RETURNS_T41 = 153_076_443; // excluding dependents
const DEPENDENT_RETURNS = TOTAL_RETURNS_T11 - TOTAL_RETURNS_T41;
const DEPENDENTS_BELOW = 15_000; // dependents' returns are removed from $1..this, pro rata
const BOTTOM_BRACKETS: Array<[number, number]> = [
  [0, 2_180_146], // no adjusted gross income
  [5_000, 7_357_751],
  [10_000, 8_077_917],
  [15_000, 8_986_005],
  [20_000, 8_702_094],
  [25_000, 7_925_999],
  [30_000, 7_594_157],
  [40_000, 15_210_266],
  [50_000, 13_519_034],
];

export function build() {
  const dependentBracket = (upper: number) => upper > 0 && upper <= DEPENDENTS_BELOW;
  const small = BOTTOM_BRACKETS.filter(([upper]) => dependentBracket(upper)).reduce((s, [, n]) => s + n, 0);
  const keep = 1 - DEPENDENT_RETURNS / small;
  const points = new Map<number, number>();
  let cum = 0;
  for (const [upper, count] of BOTTOM_BRACKETS) {
    cum += dependentBracket(upper) ? count * keep : count;
    points.set(upper, round((100 * cum) / TOTAL_RETURNS_T41, 4));
  }
  for (const [top, floor] of TOP_FLOORS) points.set(floor, round(100 - top, 4));
  return {
    name: "us-income",
    title: "US individual income (USD, before tax)",
    description:
      "Adjusted gross income on US individual income tax returns, tax year 2023. " +
      "Median and up: IRS Table 4.1 percentile floors (to the top 0.001%). Below the median: " +
      "IRS Table 1.1 AGI brackets, adjusted to exclude dependents' returns. See scripts/build_us_income.ts.",
    type: "percentile",
    percentile_kind: "below",
    interpolation: "loglog",
    unit: "USD",
    source: "https://www.irs.gov/pub/irs-soi/23in41ts.xlsx ; https://www.irs.gov/pub/irs-soi/23in11si.xls",
    date: "2023",
    data: orderedObject([...points].sort((a, b) => a[0] - b[0]).map(([x, p]) => [String(x), p])),
  };
}

if (isMain(import.meta.url)) console.log(`wrote ${writeDataset(build())}`);
