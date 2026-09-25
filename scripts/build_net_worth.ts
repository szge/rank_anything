/**
 * Rebuild us-net-worth.json and canada-net-worth.json from official microdata.
 *
 * US: Federal Reserve Survey of Consumer Finances 2022, summary extract
 * (SCFP2022, variable NETWORTH, weight WGT, all five implicates).
 * https://www.federalreserve.gov/econres/scfindex.htm
 * Check: the weighted median reproduces the Fed's published $192,700.
 *
 * Canada: Statistics Canada Survey of Financial Security 2023, public use
 * microdata file (variable PWNETWPG = net worth, pensions on a going-concern
 * basis; weight PWEIGHT).
 * https://www150.statcan.gc.ca/n1/pub/13m0006x/13m0006x2021001-eng.htm
 * Check: the weighted median is $519,450 vs the published $519,700 (the public
 * file is lightly perturbed for confidentiality).
 *
 * Surveys under-sample the very wealthy, and the public SFS file is thin above
 * the 99th percentile, so Canada's top end uses the Parliamentary Budget
 * Officer's high-net-worth estimates for 2023: top 1% starts at $7.4M, and
 * 108,000 families have $10M+.
 * https://www.pbo-dpb.ca/en/publications/RP-2526-009-S--estimating-top-tail-family-wealth-distribution-in-canada-2025-update--estimation-extremite-superieure-distribution-patrimoine-familial-canada-mises-jour-2025
 *
 * Run:  node scripts/build_net_worth.ts [--out DIR]   (downloads ~85 MB)
 */

import { toFixed } from "../src/text.ts";
import { csvRecords, fetchBytes, isMain, orderedObject, readZipEntry, round, thousands, weightedPercentiles, writeDataset } from "./common.ts";

const SCF_URL = "https://www.federalreserve.gov/econres/files/scfp2022excel.zip";
const SFS_URL = "https://www150.statcan.gc.ca/n1/pub/13m0006x/2021001/SFS2023-eng.zip";

const US_PERCENTILES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 97, 98, 99, 99.5, 99.9];
const CA_PERCENTILES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 97, 98];

// PBO 2023 top-end anchors (Canada)
const PBO_TOP1_FLOOR = 7_400_000;
const PBO_FAMILIES_10M = 108_000;

async function downloadCsv(url: string, memberSuffix: string) {
  return csvRecords(readZipEntry(await fetchBytes(url), memberSuffix));
}

/** {value (rounded to a whole number): percentile}, in value order. */
export function toPoints(pcts: Map<number, number>): Array<[string, number]> {
  return [...pcts].sort((a, b) => a[0] - b[0]).map(([q, v]) => [toFixed(v, 0), q]);
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`sanity check failed: ${what}`);
}

export async function buildUs() {
  const rows = await downloadCsv(SCF_URL, "SCFP2022.csv");
  const pairs = rows.map((r) => [Number(r.NETWORTH), Number(r.WGT)] as const);
  const pcts = weightedPercentiles(pairs, [...US_PERCENTILES, 50]);
  const median = pcts.get(50)!;
  check(Math.abs(median - 192_700) < 1_000, `US median ${median}`);
  return {
    name: "us-net-worth",
    title: "US household net worth (USD)",
    description:
      "Net worth of US families (households), 2022 Survey of Consumer Finances, " +
      "weighted percentiles computed from the Fed's public summary extract. Median " +
      `$${thousands(median)}. Negative values mean debts exceed assets.`,
    type: "percentile",
    percentile_kind: "below",
    interpolation: "loglog",
    unit: "USD",
    source: SCF_URL,
    date: "2022",
    data: orderedObject(toPoints(pcts)),
  };
}

export async function buildCanada() {
  const rows = await downloadCsv(SFS_URL, "sfs2023_efam_pumf.csv");
  const pairs = rows.map((r) => [Number(r.PWNETWPG), Number(r.PWEIGHT)] as const);
  const families = pairs.reduce((s, [, w]) => s + w, 0);
  const pcts = weightedPercentiles(pairs, [...CA_PERCENTILES, 50]);
  const median = pcts.get(50)!;
  check(Math.abs(median - 519_700) < 5_000, `Canada median ${median}`);
  const points = new Map(toPoints(pcts));
  points.set(String(PBO_TOP1_FLOOR), 99);
  points.set("10000000", round(100 - (100 * PBO_FAMILIES_10M) / families, 3));
  return {
    name: "canada-net-worth",
    title: "Canadian family net worth (CAD)",
    description:
      "Net worth of Canadian family units, 2023 Survey of Financial Security, " +
      `weighted percentiles from the public microdata (median $${thousands(median)}; ` +
      "official $519,700). Top end from the Parliamentary Budget Officer's " +
      "high-net-worth estimates: top 1% starts at $7.4M; 108,000 families have $10M+.",
    type: "percentile",
    percentile_kind: "below",
    interpolation: "loglog",
    unit: "CAD",
    source: `${SFS_URL} ; PBO RP-2526-009-S (2025)`,
    date: "2023",
    data: orderedObject([...points].sort((a, b) => Number(a[0]) - Number(b[0]))),
  };
}

if (isMain(import.meta.url)) {
  for (const spec of [await buildUs(), await buildCanada()]) console.log(`wrote ${writeDataset(spec)}`);
}
