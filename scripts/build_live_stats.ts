/**
 * Refresh distributions that come from live public stats endpoints.
 *
 * - lichess-blitz / lichess-rapid: https://lichess.org/stat/rating/distribution/<perf>
 *   The page embeds {"freq": [...]}: players active this week per 25-point
 *   rating bucket, bucket i covering [400 + 25*i, 425 + 25*i) (see
 *   ui/chart/src/chart.ratingDistribution.ts in lichess-org/lila).
 * - monkeytype-wpm: https://api.monkeytype.com/public/speedHistogram
 *   Number of accounts whose English 60-second personal best falls in each
 *   10-WPM bucket (bucket "60" = 60-69 WPM).
 *
 * Each is written as a "percentile" distribution: the % of players below each
 * bucket edge. The top edge is left open so higher values extend via the
 * fitted tail instead of hitting a hard 100%.
 *
 * Run:  node scripts/build_live_stats.ts [--out DIR]
 */

import { edgesToPoints, fetchText, isMain, thousands, today, writeDataset } from "./common.ts";

const UA = { "User-Agent": "rank-anything (https://github.com/; distribution refresh script)" };

export async function lichess(perf: string) {
  const url = `https://lichess.org/stat/rating/distribution/${perf}`;
  const m = /"freq":(\[[\d,]*\])/.exec(await fetchText(url, UA));
  if (!m) throw new Error(`${url}: no rating histogram found in the page`);
  const freq = JSON.parse(m[1]) as number[];
  // Drop trailing empty buckets so the last edge is a real observation.
  while (freq.length && freq[freq.length - 1] === 0) freq.pop();
  const edges = freq.map((_, i) => 400 + 25 * i);
  const week = today();
  return {
    name: `lichess-${perf}`,
    title: `Lichess ${perf} rating`,
    description:
      `Glicko-2 ratings of the ${thousands(freq.reduce((a, b) => a + b, 0))} players who played rated ${perf} on ` +
      `Lichess in the week before ${week}.`,
    type: "percentile",
    percentile_kind: "below",
    unit: "rating",
    source: url,
    date: week,
    data: edgesToPoints(edges, freq),
  };
}

export async function monkeytype() {
  const url = "https://api.monkeytype.com/public/speedHistogram?language=english&mode=time&mode2=60";
  const data = (JSON.parse(await fetchText(url, UA)) as { data: Record<string, number> }).data;
  const hist = new Map(Object.entries(data).map(([k, v]) => [Number(k), v]));
  const edges: number[] = [];
  for (let e = 0; e < Math.max(...hist.keys()) + 10; e += 10) edges.push(e);
  const counts = edges.map((e) => hist.get(e) ?? 0);
  return {
    name: "monkeytype-wpm",
    title: "Typing speed (Monkeytype WPM)",
    description:
      `Personal bests of ${thousands(counts.reduce((a, b) => a + b, 0))} Monkeytype accounts on the 60-second ` +
      "English test. Skews faster than the general population: these are people " +
      "who practise typing tests, and each counts with their best result.",
    type: "percentile",
    percentile_kind: "below",
    unit: "WPM",
    source: url,
    date: today(),
    data: edgesToPoints(edges, counts),
  };
}

if (isMain(import.meta.url)) {
  for (const spec of [await lichess("blitz"), await lichess("rapid"), await monkeytype()]) {
    console.log(`wrote ${writeDataset(spec)}: ${spec.description.slice(0, 70)}...`);
  }
}
