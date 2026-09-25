"""Rebuild src/rank_anything/data/us-salary.json from published tables.

Body (10th-90th percentile): BLS "Usual Weekly Earnings of Wage and Salary
Workers", Table 5, full-time workers 16+, Q2 2026. Weekly x 52 = annual.
https://www.bls.gov/news.release/wkyeng.t05.htm

Top end (above ~$250k): IRS Statistics of Income, Form W-2 statistics,
Table 1.B "Taxpayers with Wage Income by Size of Wage Income", tax year 2020
(latest published). https://www.irs.gov/pub/irs-soi/20in01w2all.xlsx

The IRS counts every W-2 earner, so to express the top brackets as a share
of *full-time* workers we divide by the BLS full-time count for the same
period (Q4 2020: 111.48M), on the assumption that nearly everyone earning
$200k+ works full time. Dollar thresholds are then scaled to 2026 by the
growth of the BLS full-time 90th percentile (Q4 2020 $2,321/wk -> Q2 2026
$2,924/wk). Sanity check: BLS's own 2020 p75/p90 extrapolated as a Pareto
tail predicts 3.24% of full-time workers above $200k; the IRS gives 3.45%.

Run:  python scripts/build_us_salary.py
"""

import json
from pathlib import Path

WEEKS = 52

# BLS Table 5, Q2 2026: percentile -> usual weekly earnings (USD)
BLS_2026 = {10: 642, 25: 850, 50: 1251, 75: 1915, 90: 2924}

# BLS Table 5, Q4 2020 (for scaling the 2020 IRS data)
FULL_TIME_2020 = 111_480_000
P90_WEEKLY_2020 = 2321

# IRS SOI 2020 Table 1.B: lower edge of wage bracket -> number of taxpayers
IRS_2020_BRACKETS = {
    200_000: 3_215_115,
    500_000: 463_015,
    1_000_000: 81_976,
    1_500_000: 29_482,
    2_000_000: 39_449,
    5_000_000: 8_504,
    10_000_000: 4_316,
}


def build() -> dict:
    growth = BLS_2026[90] / P90_WEEKLY_2020
    points = {str(w * WEEKS): p for p, w in BLS_2026.items()}
    above = 0
    for edge in sorted(IRS_2020_BRACKETS, reverse=True):
        above += IRS_2020_BRACKETS[edge]
        value = int(round(edge * growth, -2))
        points[str(value)] = round(100 - 100 * above / FULL_TIME_2020, 5)
    points = dict(sorted(points.items(), key=lambda kv: float(kv[0])))
    return {
        "name": "us-salary",
        "title": "US full-time salary (USD/yr, before tax)",
        "description": (
            "Annual earnings of full-time US wage and salary workers. 10th-90th "
            "percentiles: BLS usual weekly earnings, Q2 2026 (x52). Above ~$250k: IRS "
            "W-2 wage brackets (tax year 2020, up to $10M+) as a share of full-time "
            "workers, scaled to 2026 wage levels. See scripts/build_us_salary.py."
        ),
        "type": "percentile",
        "percentile_kind": "below",
        "interpolation": "loglog",
        "unit": "USD",
        "source": (
            "https://www.bls.gov/news.release/wkyeng.t05.htm ; "
            "https://www.irs.gov/statistics/soi-tax-stats-individual-information-return-form-w2-statistics"
        ),
        "date": "2026-Q2 (top end: 2020 scaled to 2026)",
        "data": points,
    }


if __name__ == "__main__":
    out = Path(__file__).resolve().parents[1] / "src/rank_anything/data/us-salary.json"
    out.write_text(json.dumps(build(), indent=2) + "\n")
    print(f"wrote {out}")
