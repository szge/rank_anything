"""Command-line interface: ``rank-anything``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Sequence

from . import __version__
from .core import (
    Distribution,
    DistributionError,
    LabeledDistribution,
    LogNormalDistribution,
    NormalDistribution,
    Placement,
    PiecewiseDistribution,
    convert,
    format_percent as fmt_pct,
)
from .importers import dump_spec, samples_spec
from .loader import available, install, load, load_file, user_dir
from .prompts import PROMPT_TYPES, build_prompt

STANDARD_PERCENTILES = (1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9)

EPILOG = """\
examples:
  rank-anything convert 85k --from canada-income --to lol-rank
  rank-anything convert E6 --from meta-level --to lol-rank --to valorant-rank
  rank-anything convert "Gold II" --from lol-rank             # compare against everything
  rank-anything convert 5 --from top --to iq                  # top 5% IQ
  rank-anything table --from meta-level --to lol-rank
  rank-anything show lol-rank
  rank-anything add my-dist.json
  rank-anything convert 97k --from salaries.csv --to lol-rank  # CSV/TXT of numbers works directly
  rank-anything import salaries.csv --column salary --unit USD --add
  rank-anything prompt "Chess.com rapid ratings" --type frequency
"""


# --------------------------------------------------------------------------- formatting


def describe(dist: Distribution, pl: Placement, show_position: bool = True) -> str:
    text = dist.format_value(pl.value)
    if show_position and isinstance(dist, LabeledDistribution) and pl.position is not None:
        text += f"  ({pl.position:.0%} of the way through)"
    if pl.clamped:
        text += "  [outside known range, clamped]"
    elif pl.extrapolated:
        text += "  [beyond known data, extrapolated]"
    return text


def rank_line(p: float) -> str:
    return f"better than {fmt_pct(p)} (top {fmt_pct(100 - p)})"


def dist_type(d: Distribution) -> str:
    if isinstance(d, LabeledDistribution):
        return "labeled"
    if isinstance(d, NormalDistribution):
        return "normal"
    if isinstance(d, LogNormalDistribution):
        return "lognormal"
    return "numeric"


def print_table(rows: list[list[str]], header: list[str]) -> None:
    widths = [max(len(str(r[i])) for r in [header] + rows) for i in range(len(header))]
    line = "  ".join(h.ljust(w) for h, w in zip(header, widths))
    print(line.rstrip())
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print("  ".join(str(c).ljust(w) for c, w in zip(r, widths)).rstrip())


# --------------------------------------------------------------------------- commands


def default_targets(source: Distribution) -> list[str]:
    return [n for n, origin in available().items() if origin != "pseudo" and n != source.name]


def cmd_convert(args) -> int:
    source = load(args.source)
    targets = args.targets or default_targets(source)
    placed = source.to_percentile(args.value, position=args.position)
    results = [(t, convert(args.value, source, load(t), args.position)) for t in targets]

    if args.json:
        print(json.dumps({
            "source": source.name,
            "value": placed.value,
            "percentile": placed.percentile,
            "top_percent": placed.top_percent,
            "clamped": placed.clamped,
            "extrapolated": placed.extrapolated,
            "results": [
                {
                    "target": c.target.name,
                    "value": c.target_placement.value,
                    "position": c.target_placement.position,
                    "clamped": c.target_placement.clamped,
                    "extrapolated": c.target_placement.extrapolated,
                }
                for _, c in results
            ],
        }, indent=2))
        return 0

    print(f"{describe(source, placed, show_position=args.position != 0.5)} in {source.display_name}")
    print(f"  = {rank_line(placed.percentile)}")
    if len(results) == 1:
        c = results[0][1]
        print(f"  ≈ {describe(c.target, c.target_placement)} in {c.target.display_name}")
    else:
        print()
        rows = [[c.target.name, describe(c.target, c.target_placement)] for _, c in results]
        print_table(rows, ["distribution", "equivalent"])
    return 0


def cmd_list(args) -> int:
    rows = []
    for name, origin in available().items():
        try:
            d = load(name)
            rows.append([name, origin, dist_type(d), d.display_name])
        except DistributionError as e:
            rows.append([name, origin, "ERROR", str(e)])
    print_table(rows, ["name", "origin", "type", "title"])
    print(f"\nUser distributions live in {user_dir()}")
    return 0


def _summary(d: Distribution) -> None:
    print(d.display_name)
    print(f"  name: {d.name}   type: {dist_type(d)}")
    for key in ("description", "unit", "source", "date"):
        val = getattr(d, key)
        if val:
            print(f"  {key}: {val}")
    if not isinstance(d, LabeledDistribution) and not d.higher_is_better:
        print("  lower values rank higher")
    print()


def cmd_show(args) -> int:
    d = load(args.name)
    _summary(d)
    if isinstance(d, LabeledDistribution):
        rows = [
            [b.label, fmt_pct(b.hi - b.lo), f"{fmt_pct(b.lo)} – {fmt_pct(b.hi)}", f"top {fmt_pct(100 - b.lo)}"]
            for b in d.bands
        ]
        print_table(rows, ["label", "share", "better than", "label & above"])
    elif isinstance(d, PiecewiseDistribution) and len(d.xs) <= 40:
        pts = zip(d.xs, d.ps) if d.higher_is_better else zip(d.xs, [100 - p for p in d.ps])
        print_table([[d.format_value(x), fmt_pct(p)] for x, p in pts], ["value", "better than"])
    else:
        rows = [[fmt_pct(p), d.format_value(d.from_percentile(p).value)] for p in STANDARD_PERCENTILES]
        print_table(rows, ["better than", "value"])
    return 0


def cmd_table(args) -> int:
    src, dst = load(args.source), load(args.target)
    rows = []
    if isinstance(src, LabeledDistribution):
        for b in src.bands:
            c = convert(b.label, src, dst)
            rows.append([b.label, fmt_pct(c.percentile), describe(dst, c.target_placement)])
    else:
        for p in STANDARD_PERCENTILES:
            v = src.from_percentile(p).value
            c = convert(v, src, dst)
            rows.append([src.format_value(v), fmt_pct(c.percentile), describe(dst, c.target_placement)])
    print(f"{src.display_name}  →  {dst.display_name}\n")
    print_table(rows, [src.name, "better than", dst.name])
    return 0


def cmd_validate(args) -> int:
    d = load_file(args.file)
    _summary(d)
    print("✓ valid")
    return 0


def cmd_add(args) -> int:
    dest = install(args.file, name=args.name, force=args.force)
    name = dest.stem
    print(f"Installed {name!r} -> {dest}")
    print(f"Try: rank-anything show {name}")
    return 0


def cmd_import(args) -> int:
    spec = samples_spec(
        args.file, column=args.column, name=args.name, title=args.title, unit=args.unit,
        higher_is_better=not args.lower_is_better,
    )
    n = len(spec["data"])
    if args.add:
        dest = install(args.file, spec=spec, force=args.force)
        print(f"Imported {n} values and installed {spec['name']!r} -> {dest}")
        print(f"Try: rank-anything show {spec['name']}")
        return 0
    text = dump_spec(spec)
    if args.output == "-":
        sys.stdout.write(text)
        return 0
    out = Path(args.output or f"{spec['name']}.json")
    if out.exists() and not args.force:
        raise DistributionError(f"{out} already exists (use --force to overwrite, or -o to pick a path)")
    out.write_text(text)
    print(f"Imported {n} values -> {out}")
    print(f"Try: rank-anything show {out}    or install it: rank-anything add {out}")
    return 0


def cmd_remove(args) -> int:
    path = user_dir() / f"{args.name}.json"
    if not path.exists():
        raise DistributionError(f"No user distribution named {args.name!r} (built-ins can't be removed)")
    path.unlink()
    print(f"Removed {path}")
    return 0


def cmd_prompt(args) -> int:
    print(build_prompt(args.topic, args.type))
    return 0


# --------------------------------------------------------------------------- parser


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="rank-anything",
        description="Convert a value in one distribution to its equivalent in another "
        "(e.g. your income -> your League of Legends rank).",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command", metavar="COMMAND")

    c = sub.add_parser("convert", aliases=["c"], help="convert a value between distributions")
    c.add_argument("value", help="value to convert, e.g. 85000, 85k, 'Gold II', E5")
    c.add_argument("-f", "--from", dest="source", required=True,
                   help="source: a distribution name, a .json file, or a .csv/.txt of numbers "
                        "('percentile' and 'top' also work)")
    c.add_argument("-t", "--to", dest="targets", action="append",
                   help="target distribution (repeatable). Omit to compare against all.")
    c.add_argument("-p", "--position", type=float, default=0.5,
                   help="for labeled sources: where within the label, 0=just reached, 1=about to "
                        "promote (default 0.5)")
    c.add_argument("--json", action="store_true", help="machine-readable output")
    c.set_defaults(func=cmd_convert)

    s = sub.add_parser("list", aliases=["ls"], help="list available distributions")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="show a distribution's details and data")
    s.add_argument("name")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("table", help="side-by-side mapping of one distribution onto another")
    s.add_argument("-f", "--from", dest="source", required=True)
    s.add_argument("-t", "--to", dest="target", required=True)
    s.set_defaults(func=cmd_table)

    s = sub.add_parser("add", help="validate a distribution (.json, or .csv/.txt of numbers) and install it")
    s.add_argument("file")
    s.add_argument("--name", help="install under this name (default: the file's 'name')")
    s.add_argument("--force", action="store_true", help="overwrite an existing one")
    s.set_defaults(func=cmd_add)

    s = sub.add_parser("import", help="turn a .csv/.tsv/.txt of numbers into a JSON distribution")
    s.add_argument("file", help=".csv/.tsv (one column of numbers) or .txt (numbers separated by "
                                "newlines, spaces or commas)")
    s.add_argument("-c", "--column", help="CSV column to use: header name or 1-based index "
                                          "(default: the only numeric column)")
    s.add_argument("--name", help="distribution name (default: from the file name)")
    s.add_argument("--title", help="human-readable title")
    s.add_argument("--unit", help="unit label, e.g. USD or cm")
    s.add_argument("--lower-is-better", action="store_true",
                   help="smaller numbers rank higher (e.g. race times)")
    s.add_argument("-o", "--output", help="where to write the JSON (default: NAME.json; '-' for stdout)")
    s.add_argument("--add", action="store_true", help="install it directly instead of writing a file")
    s.add_argument("--force", action="store_true", help="overwrite existing files")
    s.set_defaults(func=cmd_import)

    s = sub.add_parser("remove", aliases=["rm"], help="remove a user-installed distribution")
    s.add_argument("name")
    s.set_defaults(func=cmd_remove)

    s = sub.add_parser("validate", help="check a distribution file without installing it")
    s.add_argument("file")
    s.set_defaults(func=cmd_validate)

    s = sub.add_parser("prompt", help="print an AI prompt for extracting a distribution as JSON")
    s.add_argument("topic", help="what to get the distribution of, e.g. 'US household income'")
    s.add_argument("--type", choices=PROMPT_TYPES, default="auto",
                   help="preferred JSON format (default: let the AI choose)")
    s.set_defaults(func=cmd_prompt)
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 1
    try:
        return args.func(args)
    except DistributionError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
