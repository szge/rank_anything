"""Rebuild the standardized-test distributions from official percentile tables.

The tables below are copied verbatim (by script, not by hand) from:
- ACT: National Ranks, Composite column, for tests Sep 2026 - Aug 2027
  (graduates of 2024-2026). "% at or below".
  https://www.act.org/content/act/en/products-and-services/the-act/scores/national-ranks.html
- GRE: ETS Interpretive Data Table 1B, test takers Jul 2022 - Jun 2025. "% below".
  https://www.ets.org/pdfs/gre/gre-guide-table-1a.pdf
- LSAT: LSAC percentile table, 2023-2026 testing years. "% below" (hundredths).
  https://www.lsac.org/data-research/data/lsat-percentiles
- MCAT: AAMC total score percentile ranks in effect May 2026 - Apr 2027
  (2023-2025 tests, N = 305,494). "% at or below".
  https://students-residents.aamc.org/media/19701/download

Everything is converted to "% scoring below" (so the percentile reads as
"better than X%"). For "at or below" tables that is exact: % below score s
equals % at or below the next lower score. AAMC's "<1" is taken as 0.5.
Scores outside each scale are clamped rather than extrapolated.

Run:  python scripts/build_test_scores.py
"""

import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "src/rank_anything/data"

ACT_COMPOSITE_AT_OR_BELOW = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 2, 11: 6, 12: 13, 13: 20, 14: 28, 15: 34, 16: 41, 17: 47, 18: 52, 19: 58, 20: 63, 21: 68, 22: 72, 23: 77, 24: 80, 25: 83, 26: 86, 27: 89, 28: 91, 29: 93, 30: 94, 31: 96, 32: 97, 33: 98, 34: 99, 35: 99, 36: 100}

LSAT_PERCENT_BELOW = {120: 0.0, 121: 0.66, 122: 0.76, 123: 0.83, 124: 0.93, 125: 1.04, 126: 1.2, 127: 1.37, 128: 1.58, 129: 1.85, 130: 2.17, 131: 2.54, 132: 3.02, 133: 3.57, 134: 4.22, 135: 4.96, 136: 5.86, 137: 6.89, 138: 8.05, 139: 9.44, 140: 11.0, 141: 12.66, 142: 14.61, 143: 16.73, 144: 19.04, 145: 21.48, 146: 24.2, 147: 27.06, 148: 30.07, 149: 33.24, 150: 36.56, 151: 39.81, 152: 43.37, 153: 46.93, 154: 50.43, 155: 54.03, 156: 57.62, 157: 61.04, 158: 64.48, 159: 67.93, 160: 71.06, 161: 74.22, 162: 77.2, 163: 80.05, 164: 82.75, 165: 85.17, 166: 87.49, 167: 89.53, 168: 91.36, 169: 93.03, 170: 94.48, 171: 95.77, 172: 96.72, 173: 97.59, 174: 98.24, 175: 98.72, 176: 99.08, 177: 99.34, 178: 99.57, 179: 99.74, 180: 99.85}

GRE_VERBAL_PERCENT_BELOW = {131: 1, 132: 1, 133: 2, 134: 2, 135: 3, 136: 4, 137: 5, 138: 6, 139: 8, 140: 10, 141: 11, 142: 14, 143: 16, 144: 18, 145: 21, 146: 24, 147: 27, 148: 30, 149: 34, 150: 39, 151: 43, 152: 48, 153: 54, 154: 59, 155: 64, 156: 68, 157: 72, 158: 76, 159: 79, 160: 82, 161: 85, 162: 88, 163: 90, 164: 93, 165: 95, 166: 96, 167: 97, 168: 98, 169: 99, 170: 99}

GRE_QUANT_PERCENT_BELOW = {133: 1, 134: 1, 135: 1, 136: 2, 137: 2, 138: 3, 139: 4, 140: 5, 141: 6, 142: 7, 143: 9, 144: 10, 145: 12, 146: 14, 147: 16, 148: 19, 149: 21, 150: 23, 151: 26, 152: 29, 153: 31, 154: 34, 155: 37, 156: 39, 157: 42, 158: 45, 159: 47, 160: 50, 161: 53, 162: 57, 163: 60, 164: 63, 165: 67, 166: 72, 167: 75, 168: 80, 169: 85, 170: 89}

MCAT_TOTAL_AT_OR_BELOW = {472: '<1', 473: '<1', 474: '<1', 475: 1, 476: 1, 477: 2, 478: 2, 479: 3, 480: 4, 481: 5, 482: 6, 483: 8, 484: 9, 485: 11, 486: 12, 487: 14, 488: 16, 489: 18, 490: 20, 491: 23, 492: 25, 493: 28, 494: 31, 495: 33, 496: 36, 497: 39, 498: 42, 499: 45, 500: 48, 501: 52, 502: 55, 503: 58, 504: 61, 505: 64, 506: 67, 507: 71, 508: 74, 509: 76, 510: 79, 511: 82, 512: 84, 513: 86, 514: 89, 515: 91, 516: 92, 517: 94, 518: 95, 519: 96, 520: 97, 521: 98, 522: 99, 523: 99, 524: 99, 525: 100, 526: 100, 527: 100, 528: 100}


def below_from_at_or_below(table: dict, scale_min: int) -> dict:
    def num(v):
        return 0.5 if v == "<1" else float(v)
    out = {scale_min: 0.0}
    for s in sorted(table):
        if s + 1 in table:
            out[s + 1] = num(table[s])
    return out


def with_floor(table: dict, scale_min: int) -> dict:
    out = {scale_min: 0.0}
    out.update({s: float(p) for s, p in table.items() if s != scale_min})
    return dict(sorted(out.items()))


def spec(name, title, description, source, date, points, unit="points"):
    return {
        "name": name,
        "title": title,
        "description": description,
        "type": "percentile",
        "percentile_kind": "below",
        "tail": "clamp",
        "unit": unit,
        "source": source,
        "date": date,
        "data": {str(s): p for s, p in sorted(points.items())},
    }


def build() -> list[dict]:
    return [
        spec("act-score", "ACT composite score (1-36)",
             "ACT National Ranks for the Composite score, based on ACT-tested high school "
             "graduates of 2024-2026 (used for tests Sep 2026 - Aug 2027).",
             "https://www.act.org/content/act/en/products-and-services/the-act/scores/national-ranks.html",
             "2026", below_from_at_or_below(ACT_COMPOSITE_AT_OR_BELOW, 1)),
        spec("gre-verbal", "GRE Verbal Reasoning (130-170)",
             "ETS percentile ranks for Verbal Reasoning, 788,021 test takers, Jul 2022 - Jun 2025.",
             "https://www.ets.org/pdfs/gre/gre-guide-table-1a.pdf", "2025",
             with_floor(GRE_VERBAL_PERCENT_BELOW, 130)),
        spec("gre-quant", "GRE Quantitative Reasoning (130-170)",
             "ETS percentile ranks for Quantitative Reasoning, 790,864 test takers, Jul 2022 - Jun 2025.",
             "https://www.ets.org/pdfs/gre/gre-guide-table-1a.pdf", "2025",
             with_floor(GRE_QUANT_PERCENT_BELOW, 130)),
        spec("lsat-score", "LSAT score (120-180)",
             "LSAC percentile table for the 2023-24, 2024-25 and 2025-26 testing years.",
             "https://www.lsac.org/data-research/data/lsat-percentiles", "2026",
             with_floor(LSAT_PERCENT_BELOW, 120)),
        spec("mcat-score", "MCAT total score (472-528)",
             "AAMC total score percentile ranks in effect May 2026 - Apr 2027, based on "
             "305,494 results from the 2023-2025 testing years.",
             "https://students-residents.aamc.org/media/19701/download", "2026",
             below_from_at_or_below(MCAT_TOTAL_AT_OR_BELOW, 472)),
    ]


if __name__ == "__main__":
    for s in build():
        (DATA / f"{s['name']}.json").write_text(json.dumps(s, indent=2) + "\n")
        print(f"wrote {s['name']}.json")
