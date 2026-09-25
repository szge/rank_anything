"""Prompt templates for extracting distributions from AI tools (Perplexity, ChatGPT, Claude...)."""

from __future__ import annotations

PROMPT_TYPES = ("auto", "frequency", "percentile", "samples", "normal")

_FORMATS = {
    "frequency": """\
"frequency" - ordered categories with the share of the population in each,
listed from WORST/LOWEST to BEST/HIGHEST:
  {"name": "lol-rank", "type": "frequency",
   "data": {"Iron IV": 0.38, "Iron III": 0.42, "...": 0, "Challenger": 0.023}}
(Numbers may be percentages or raw counts; they don't need to sum to 100.)""",
    "percentile": """\
"percentile" - known values and the percentile at each. Keys may be numbers
(interpolated) or labels. Use "percentile_kind": "below" when the number is
"% of people below this value", or "top" when it is "top X%":
  {"name": "canada-income", "type": "percentile", "percentile_kind": "below",
   "unit": "CAD", "data": {"45000": 50, "108000": 90, "293800": 99}}
  {"name": "meta-level", "type": "percentile", "percentile_kind": "top",
   "data": {"E3": 100, "E4": 72, "E5": 42, "E6": 15}}""",
    "samples": """\
"samples" - a raw list of observed numbers, in any order:
  {"name": "team-salaries", "type": "samples", "unit": "USD",
   "data": [72000, 85000, 91000, 104000, 150000]}""",
    "normal": """\
"normal" - a bell curve given by mean and standard deviation:
  {"name": "iq", "type": "normal", "data": {"mean": 100, "std": 15}}""",
}

_TEMPLATE = """\
I need the population distribution of: {topic}

Find the most recent, reputable data you can and return it as a single JSON
object (no commentary outside the JSON) in the format below.

{formats}

Required fields: "name" (short kebab-case id), "type", "data".
Also include:
  "title": human-readable name,
  "description": what population this covers (region, year, who is included),
  "unit": unit of numeric values if any (e.g. "USD", "cm"),
  "source": URL(s) of the data,
  "date": year or year-month of the data,
  "higher_is_better": false  (ONLY if smaller numbers rank higher, e.g. race times).
Order labels from worst to best. Prefer finer detail (e.g. divisions, deciles)
when the source provides it. Do not invent numbers: if you must estimate,
say so in "description".
"""


def build_prompt(topic: str, kind: str = "auto") -> str:
    if kind == "auto":
        formats = "Choose whichever format best fits the data:\n\n" + "\n\n".join(
            _FORMATS[k] for k in ("frequency", "percentile", "samples", "normal")
        )
    else:
        formats = "Use this format:\n\n" + _FORMATS[kind]
    return _TEMPLATE.format(topic=topic, formats=formats)
