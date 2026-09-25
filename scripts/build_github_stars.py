"""Rebuild github-stars.json from live GitHub search counts.

GitHub doesn't publish a star distribution, but repository search reports how
many public repositories match `stars:>=N`, which gives the share above any
threshold. The population is public repositories with at least 1 star (the
count for 0+ stars is flagged incomplete by the API, and most repositories
have none). Forks are excluded, as in GitHub search by default.

Set GITHUB_TOKEN for a higher rate limit (the script also works without one).

Run:  python scripts/build_github_stars.py
"""

import datetime as dt
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "src/rank_anything/data"
THRESHOLDS = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000,
              10_000, 20_000, 50_000, 100_000, 200_000]


def count_at_least(stars: int) -> int:
    q = urllib.parse.urlencode({"q": f"stars:>={stars}", "per_page": 1})
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "rank-anything"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    req = urllib.request.Request(f"https://api.github.com/search/repositories?{q}", headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.load(r)
    if body.get("incomplete_results"):
        raise RuntimeError(f"GitHub reported incomplete results for stars>={stars}")
    return body["total_count"]


def build() -> dict:
    counts = {}
    for n in THRESHOLDS:
        counts[n] = count_at_least(n)
        time.sleep(7)  # unauthenticated search allows 10 requests/minute
    base = counts[1]
    points = {str(n): round(100 * (base - c) / base, 5) for n, c in counts.items() if c > 0}
    today = dt.date.today().isoformat()
    return {
        "name": "github-stars",
        "title": "GitHub repository stars",
        "description": (
            f"Stars on public GitHub repositories with at least 1 star ({base:,} repos, "
            f"forks excluded), from GitHub search counts on {today}. "
            f"{counts[THRESHOLDS[-1]]:,} repos have {THRESHOLDS[-1]:,}+ stars."
        ),
        "type": "percentile",
        "percentile_kind": "below",
        "interpolation": "loglog",
        "unit": "stars",
        "source": "https://api.github.com/search/repositories?q=stars:>=N",
        "date": today,
        "data": points,
    }


if __name__ == "__main__":
    spec = build()
    path = DATA / "github-stars.json"
    path.write_text(json.dumps(spec, indent=2) + "\n")
    print(f"wrote {path.name}: {spec['description']}")
