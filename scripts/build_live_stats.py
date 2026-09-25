"""Refresh distributions that come from live public stats endpoints.

- lichess-blitz / lichess-rapid: https://lichess.org/stat/rating/distribution/<perf>
  The page embeds {"freq": [...]}: players active this week per 25-point
  rating bucket, bucket i covering [400 + 25*i, 425 + 25*i) (see
  ui/chart/src/chart.ratingDistribution.ts in lichess-org/lila).
- monkeytype-wpm: https://api.monkeytype.com/public/speedHistogram
  Number of accounts whose English 60-second personal best falls in each
  10-WPM bucket (bucket "60" = 60-69 WPM).

Each is written as a "percentile" distribution: the % of players below each
bucket edge. The top edge is left open so higher values extend via the
fitted tail instead of hitting a hard 100%.

Run:  python scripts/build_live_stats.py
"""

import datetime as dt
import json
import re
import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "src/rank_anything/data"
UA = {"User-Agent": "rank-anything (https://github.com/; distribution refresh script)"}


def fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode()


def edges_to_points(edges: list[float], counts: list[int]) -> dict:
    """Bucket lower edges + counts -> {edge: % of population below edge}.
    Leaves out the final 100% point so the upper tail stays open."""
    total = sum(counts)
    points, below = {}, 0
    for edge, n in zip(edges, counts):
        points[f"{edge:g}"] = round(100 * below / total, 4)
        below += n
    return points


def lichess(perf: str) -> dict:
    url = f"https://lichess.org/stat/rating/distribution/{perf}"
    freq = json.loads(re.search(r'"freq":(\[[\d,]*\])', fetch(url)).group(1))
    # Drop trailing empty buckets so the last edge is a real observation.
    while freq and freq[-1] == 0:
        freq.pop()
    edges = [400 + 25 * i for i in range(len(freq))]
    week = dt.date.today().isoformat()
    return {
        "name": f"lichess-{perf}",
        "title": f"Lichess {perf} rating",
        "description": (
            f"Glicko-2 ratings of the {sum(freq):,} players who played rated {perf} on "
            f"Lichess in the week before {week}."
        ),
        "type": "percentile",
        "percentile_kind": "below",
        "unit": "rating",
        "source": url,
        "date": week,
        "data": edges_to_points(edges, freq),
    }


def monkeytype() -> dict:
    url = "https://api.monkeytype.com/public/speedHistogram?language=english&mode=time&mode2=60"
    hist = {int(k): v for k, v in json.loads(fetch(url))["data"].items()}
    edges = list(range(0, max(hist) + 10, 10))
    counts = [hist.get(e, 0) for e in edges]
    today = dt.date.today().isoformat()
    return {
        "name": "monkeytype-wpm",
        "title": "Typing speed (Monkeytype WPM)",
        "description": (
            f"Personal bests of {sum(counts):,} Monkeytype accounts on the 60-second "
            "English test. Skews faster than the general population: these are people "
            "who practise typing tests, and each counts with their best result."
        ),
        "type": "percentile",
        "percentile_kind": "below",
        "unit": "WPM",
        "source": url,
        "date": today,
        "data": edges_to_points(edges, counts),
    }


if __name__ == "__main__":
    for spec in (lichess("blitz"), lichess("rapid"), monkeytype()):
        path = DATA / f"{spec['name']}.json"
        path.write_text(json.dumps(spec, indent=2) + "\n")
        print(f"wrote {path.name}: {spec['description'][:70]}...")
