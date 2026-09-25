/**
 * Rebuild github-stars.json from live GitHub search counts.
 *
 * GitHub doesn't publish a star distribution, but repository search reports how
 * many public repositories match `stars:>=N`, which gives the share above any
 * threshold. The population is public repositories with at least 1 star (the
 * count for 0+ stars is flagged incomplete by the API, and most repositories
 * have none). Forks are excluded, as in GitHub search by default.
 *
 * Set GITHUB_TOKEN for a higher rate limit (the script also works without one).
 *
 * Run:  node scripts/build_github_stars.ts [--out DIR]
 */

import { fetchText, isMain, orderedObject, round, sleep, thousands, today, writeDataset } from "./common.ts";

const THRESHOLDS = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000];

async function countAtLeast(stars: number): Promise<number> {
  const q = new URLSearchParams({ q: `stars:>=${stars}`, per_page: "1" });
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "rank-anything" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const body = JSON.parse(await fetchText(`https://api.github.com/search/repositories?${q}`, headers));
  if (body.incomplete_results) throw new Error(`GitHub reported incomplete results for stars>=${stars}`);
  return body.total_count;
}

export async function build() {
  const counts = new Map<number, number>();
  for (const n of THRESHOLDS) {
    counts.set(n, await countAtLeast(n));
    await sleep(7000); // unauthenticated search allows 10 requests/minute
  }
  const base = counts.get(1)!;
  const points = [...counts].filter(([, c]) => c > 0).map(([n, c]) => [String(n), round((100 * (base - c)) / base, 5)] as const);
  const date = today();
  const top = THRESHOLDS[THRESHOLDS.length - 1];
  return {
    name: "github-stars",
    title: "GitHub repository stars",
    description:
      `Stars on public GitHub repositories with at least 1 star (${thousands(base)} repos, ` +
      `forks excluded), from GitHub search counts on ${date}. ` +
      `${thousands(counts.get(top)!)} repos have ${thousands(top)}+ stars.`,
    type: "percentile",
    percentile_kind: "below",
    interpolation: "loglog",
    unit: "stars",
    source: "https://api.github.com/search/repositories?q=stars:>=N",
    date,
    data: orderedObject(points),
  };
}

if (isMain(import.meta.url)) {
  const spec = await build();
  console.log(`wrote ${writeDataset(spec)}: ${spec.description}`);
}
