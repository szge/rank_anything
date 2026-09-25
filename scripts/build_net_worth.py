"""Rebuild us-net-worth.json and canada-net-worth.json from official microdata.

US: Federal Reserve Survey of Consumer Finances 2022, summary extract
(SCFP2022, variable NETWORTH, weight WGT, all five implicates).
https://www.federalreserve.gov/econres/scfindex.htm
Check: the weighted median reproduces the Fed's published $192,700.

Canada: Statistics Canada Survey of Financial Security 2023, public use
microdata file (variable PWNETWPG = net worth, pensions on a going-concern
basis; weight PWEIGHT).
https://www150.statcan.gc.ca/n1/pub/13m0006x/13m0006x2021001-eng.htm
Check: the weighted median is $519,450 vs the published $519,700 (the public
file is lightly perturbed for confidentiality).

Surveys under-sample the very wealthy, and the public SFS file is thin above
the 99th percentile, so Canada's top end uses the Parliamentary Budget
Officer's high-net-worth estimates for 2023: top 1% starts at $7.4M, and
108,000 families have $10M+.
https://www.pbo-dpb.ca/en/publications/RP-2526-009-S--estimating-top-tail-family-wealth-distribution-in-canada-2025-update--estimation-extremite-superieure-distribution-patrimoine-familial-canada-mises-jour-2025

Run:  python scripts/build_net_worth.py   (downloads ~85 MB)
"""

import csv
import io
import json
import urllib.request
import zipfile
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "src/rank_anything/data"
UA = {"User-Agent": "rank-anything distribution refresh script"}

SCF_URL = "https://www.federalreserve.gov/econres/files/scfp2022excel.zip"
SFS_URL = "https://www150.statcan.gc.ca/n1/pub/13m0006x/2021001/SFS2023-eng.zip"

US_PERCENTILES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 97, 98, 99, 99.5, 99.9]
CA_PERCENTILES = [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 97, 98]

# PBO 2023 top-end anchors (Canada)
PBO_TOP1_FLOOR = 7_400_000
PBO_FAMILIES_10M = 108_000


def download_csv(url: str, member_suffix: str) -> list[dict]:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        archive = zipfile.ZipFile(io.BytesIO(r.read()))
    name = next(n for n in archive.namelist() if n.lower().endswith(member_suffix.lower()))
    with archive.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def weighted_percentiles(pairs: list[tuple[float, float]], qs: list[float]) -> dict[float, float]:
    """Smallest value whose cumulative weight reaches q% of the total."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    out, cum, i = {}, 0.0, 0
    for q in sorted(qs):
        target = q / 100 * total
        while cum + pairs[i][1] < target:
            cum += pairs[i][1]
            i += 1
        out[q] = pairs[i][0]
    return out


def to_points(pcts: dict[float, float]) -> dict[str, float]:
    return {f"{v:.0f}": q for q, v in sorted(pcts.items())}


def build_us() -> dict:
    rows = download_csv(SCF_URL, "SCFP2022.csv")
    pairs = [(float(r["NETWORTH"]), float(r["WGT"])) for r in rows]
    pcts = weighted_percentiles(pairs, US_PERCENTILES + [50])
    assert abs(pcts[50] - 192_700) < 1_000, pcts[50]
    return {
        "name": "us-net-worth",
        "title": "US household net worth (USD)",
        "description": (
            "Net worth of US families (households), 2022 Survey of Consumer Finances, "
            "weighted percentiles computed from the Fed's public summary extract. Median "
            f"${pcts[50]:,.0f}. Negative values mean debts exceed assets."
        ),
        "type": "percentile",
        "percentile_kind": "below",
        "interpolation": "loglog",
        "unit": "USD",
        "source": SCF_URL,
        "date": "2022",
        "data": to_points(pcts),
    }


def build_canada() -> dict:
    rows = download_csv(SFS_URL, "sfs2023_efam_pumf.csv")
    pairs = [(float(r["PWNETWPG"]), float(r["PWEIGHT"])) for r in rows]
    families = sum(w for _, w in pairs)
    pcts = weighted_percentiles(pairs, CA_PERCENTILES + [50])
    assert abs(pcts[50] - 519_700) < 5_000, pcts[50]
    points = to_points(pcts)
    points[f"{PBO_TOP1_FLOOR}"] = 99
    points["10000000"] = round(100 - 100 * PBO_FAMILIES_10M / families, 3)
    return {
        "name": "canada-net-worth",
        "title": "Canadian family net worth (CAD)",
        "description": (
            "Net worth of Canadian family units, 2023 Survey of Financial Security, "
            f"weighted percentiles from the public microdata (median ${pcts[50]:,.0f}; "
            "official $519,700). Top end from the Parliamentary Budget Officer's "
            "high-net-worth estimates: top 1% starts at $7.4M; 108,000 families have $10M+."
        ),
        "type": "percentile",
        "percentile_kind": "below",
        "interpolation": "loglog",
        "unit": "CAD",
        "source": f"{SFS_URL} ; PBO RP-2526-009-S (2025)",
        "date": "2023",
        "data": dict(sorted(points.items(), key=lambda kv: float(kv[0]))),
    }


if __name__ == "__main__":
    for spec in (build_us(), build_canada()):
        path = DATA / f"{spec['name']}.json"
        path.write_text(json.dumps(spec, indent=2) + "\n")
        print(f"wrote {path.name}")
