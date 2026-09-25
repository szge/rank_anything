"""Turn plain .csv / .tsv / .txt files of numbers into ``samples`` distributions."""

from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path
from typing import Optional, Union

from .core import DistributionError, parse_number

TABLE_SUFFIXES = (".csv", ".tsv")
TEXT_SUFFIXES = (".txt",)
IMPORT_SUFFIXES = TABLE_SUFFIXES + TEXT_SUFFIXES

# "85,000" or "$1,250,000.50k": commas here are thousands separators, not delimiters.
_THOUSANDS = re.compile(r"^[^\d,]*\d{1,3}(,\d{3})+(\.\d+)?[^\d,]*$")


def _try_number(cell: str) -> Optional[float]:
    try:
        return parse_number(cell)
    except DistributionError:
        return None


def numbers_from_text(text: str) -> list[float]:
    """Numbers from free-form text: one per line, or separated by spaces, tabs,
    semicolons or commas. ``#`` starts a comment. Thousands separators like
    ``85,000`` are understood."""
    out = []
    for lineno, line in enumerate(text.splitlines(), 1):
        line = line.split("#", 1)[0]
        for token in re.split(r"[\s;]+", line):
            parts = [token] if _THOUSANDS.match(token) else token.split(",")
            for part in filter(None, (p.strip() for p in parts)):
                value = _try_number(part)
                if value is None:
                    raise DistributionError(f"line {lineno}: {part!r} is not a number")
                out.append(value)
    return out


def numbers_from_table(text: str, column: Optional[str] = None, delimiter: Optional[str] = None) -> list[float]:
    """Numbers from one column of a CSV/TSV. ``column`` is a header name or a
    1-based index. With no ``column``, the only numeric column is used. A
    non-numeric first row is treated as a header; blank cells are skipped."""
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",\t;|").delimiter
        except csv.Error:
            delimiter = ","
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delimiter) if any(c.strip() for c in r)]
    if not rows:
        raise DistributionError("file is empty")

    width = max(len(r) for r in rows)
    first_is_header = any(c.strip() and _try_number(c) is None for c in rows[0])
    header = [c.strip() for c in rows[0]] + [""] * (width - len(rows[0])) if first_is_header else []
    body = rows[1:] if first_is_header else rows
    names = [h or f"column {i + 1}" for i, h in enumerate(header or [""] * width)]

    def cells(i: int) -> list[str]:
        return [r[i].strip() for r in body if i < len(r) and r[i].strip()]

    if column is not None:
        if column in header:
            idx = header.index(column)
        elif column.isdigit() and 1 <= int(column) <= width:
            idx = int(column) - 1
        else:
            raise DistributionError(f"no column {column!r}. Columns: {', '.join(names)}")
    else:
        numeric = [i for i in range(width) if cells(i) and all(_try_number(c) is not None for c in cells(i))]
        if len(numeric) != 1:
            found = ", ".join(names[i] for i in numeric) if numeric else "none"
            raise DistributionError(
                f"can't tell which column to use (numeric columns: {found}). "
                f"Pick one with --column. Columns: {', '.join(names)}"
            )
        idx = numeric[0]

    values, bad = [], []
    for c in cells(idx):
        v = _try_number(c)
        (bad if v is None else values).append(c if v is None else v)
    if bad:
        raise DistributionError(
            f"column {names[idx]!r} has {len(bad)} non-numeric value(s), e.g. {bad[0]!r}"
        )
    return values


def read_numbers(path: Union[str, Path], column: Optional[str] = None) -> list[float]:
    path = Path(path)
    if not path.exists():
        raise DistributionError(f"No such file: {path}")
    text = path.read_text(encoding="utf-8-sig")
    suffix = path.suffix.lower()
    try:
        if suffix in TABLE_SUFFIXES:
            values = numbers_from_table(text, column, "\t" if suffix == ".tsv" else None)
        elif column is not None:
            raise DistributionError("--column only applies to .csv/.tsv files")
        else:
            values = numbers_from_text(text)
    except DistributionError as e:
        raise DistributionError(f"{path}: {e}") from e
    if len(values) < 2:
        raise DistributionError(f"{path}: need at least 2 numbers, found {len(values)}")
    return values


def samples_spec(
    path: Union[str, Path],
    column: Optional[str] = None,
    name: Optional[str] = None,
    title: Optional[str] = None,
    unit: Optional[str] = None,
    description: Optional[str] = None,
    higher_is_better: bool = True,
) -> dict:
    """Build a ``samples`` JSON spec from a file of numbers."""
    path = Path(path)
    values = read_numbers(path, column)
    spec: dict = {"name": name or re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-") or "custom"}
    if title:
        spec["title"] = title
    spec["description"] = description or f"Imported from {path.name} ({len(values)} values)"
    if unit:
        spec["unit"] = unit
    if not higher_is_better:
        spec["higher_is_better"] = False
    spec["type"] = "samples"
    spec["data"] = [int(v) if v.is_integer() else v for v in values]
    return spec


def dump_spec(spec: dict) -> str:
    """Pretty JSON, but with a ``samples`` data list kept on a single line."""
    if spec.get("type") != "samples" or not isinstance(spec.get("data"), list):
        return json.dumps(spec, indent=2, ensure_ascii=False) + "\n"
    marker = "__RANK_ANYTHING_DATA__"
    text = json.dumps({**spec, "data": marker}, indent=2, ensure_ascii=False)
    return text.replace(json.dumps(marker), json.dumps(spec["data"])) + "\n"
