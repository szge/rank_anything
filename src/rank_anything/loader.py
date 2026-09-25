"""Load distributions from JSON (built-in, user-installed, or any file path).

JSON format (see README for full details)::

    {
      "name": "lol-rank",
      "title": "League of Legends solo queue rank",
      "type": "frequency" | "percentile" | "samples" | "normal" | "lognormal",
      "data": ...,
      "unit": "CAD", "source": "...", "date": "...", "description": "...",
      "higher_is_better": true,          # numeric only
      "percentile_kind": "below" | "top" # "percentile" type only
    }
"""

from __future__ import annotations

import json
import os
import shutil
from importlib import resources
from pathlib import Path
from typing import Any, Iterable, Union

from .core import (
    Distribution,
    DistributionError,
    LabeledDistribution,
    LogNormalDistribution,
    NormalDistribution,
    PiecewiseDistribution,
    parse_number,
)

TYPES = ("frequency", "percentile", "samples", "normal", "lognormal")
META_KEYS = ("title", "description", "unit", "source", "date")


def user_dir() -> Path:
    """Where ``rank-anything add`` installs distributions."""
    env = os.environ.get("RANK_ANYTHING_HOME")
    base = Path(env) if env else Path.home() / ".rank_anything"
    return base / "distributions"


def _pairs(data: Any, what: str) -> list[tuple[str, Any]]:
    """Accept either an ordered object ``{"a": 1}`` or a list of pairs
    ``[["a", 1]]`` / ``[{"label": "a", "value": 1}]``."""
    if isinstance(data, dict):
        return [(str(k), v) for k, v in data.items()]
    if isinstance(data, list):
        out = []
        for item in data:
            if isinstance(item, (list, tuple)) and len(item) == 2:
                out.append((str(item[0]), item[1]))
            elif isinstance(item, dict) and len(item) == 2:
                label = item.get("label", item.get("value"))
                num = next((item[k] for k in ("frequency", "percentile", "count", "share") if k in item), None)
                if label is None or num is None:
                    raise DistributionError(f"{what}: can't read entry {item!r}")
                out.append((str(label), num))
            else:
                raise DistributionError(f"{what}: can't read entry {item!r}")
        return out
    raise DistributionError(f"{what}: 'data' must be an object or a list of pairs")


def _all_numeric(keys: Iterable[str]) -> bool:
    try:
        for k in keys:
            parse_number(k)
        return True
    except DistributionError:
        return False


def from_dict(spec: dict, default_name: str = "custom") -> Distribution:
    if not isinstance(spec, dict):
        raise DistributionError("distribution JSON must be an object")
    name = str(spec.get("name") or default_name)
    dtype = spec.get("type")
    if dtype not in TYPES:
        raise DistributionError(f"{name}: 'type' must be one of {', '.join(TYPES)} (got {dtype!r})")
    meta = {k: str(spec[k]) for k in META_KEYS if spec.get(k) is not None}
    meta["higher_is_better"] = bool(spec.get("higher_is_better", True))
    data = spec.get("data")

    if dtype == "samples":
        if not isinstance(data, list):
            raise DistributionError(f"{name}: 'samples' data must be a list of numbers")
        return PiecewiseDistribution.from_samples(name, [parse_number(v) for v in data], **meta)

    if dtype == "normal":
        params = data if isinstance(data, dict) else spec
        return NormalDistribution(name, float(params["mean"]), float(params["std"]), **meta)

    if dtype == "lognormal":
        params = data if isinstance(data, dict) else spec
        return LogNormalDistribution(name, float(params["median"]), float(params["sigma"]), **meta)

    pairs = _pairs(data, name)
    if not pairs:
        raise DistributionError(f"{name}: 'data' is empty")
    nums = [(k, float(v)) for k, v in pairs]
    numeric_keys = _all_numeric(k for k, _ in nums) and not spec.get("labels_are_categories")

    if dtype == "frequency":
        if numeric_keys:
            return PiecewiseDistribution.from_weighted(
                name, [(parse_number(k), f) for k, f in nums], **meta
            )
        meta.pop("higher_is_better")
        return LabeledDistribution.from_frequencies(name, nums, **meta)

    # dtype == "percentile"
    kind = spec.get("percentile_kind", "below")
    if kind not in ("below", "top"):
        raise DistributionError(f"{name}: percentile_kind must be 'below' or 'top'")
    if kind == "top":
        nums = [(k, 100.0 - p) for k, p in nums]
    if numeric_keys:
        return PiecewiseDistribution(name, [(parse_number(k), p) for k, p in nums], **meta)
    meta.pop("higher_is_better")
    return LabeledDistribution.from_starts(name, nums, **meta)


def load_file(path: Union[str, Path]) -> Distribution:
    path = Path(path)
    try:
        spec = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise DistributionError(f"{path}: invalid JSON ({e})") from e
    return from_dict(spec, default_name=path.stem)


def _builtin_files() -> dict[str, Any]:
    root = resources.files("rank_anything") / "data"
    return {p.name[:-5]: p for p in root.iterdir() if p.name.endswith(".json")}


def _user_files() -> dict[str, Path]:
    d = user_dir()
    return {p.stem: p for p in d.glob("*.json")} if d.is_dir() else {}


# Pseudo-distributions usable anywhere a name is accepted.
PSEUDO = {
    "percentile": lambda: PiecewiseDistribution(
        "percentile", [(0, 0), (100, 100)], title="Percentile (better than X%)"
    ),
    "top": lambda: PiecewiseDistribution(
        "top", [(0, 0), (100, 100)], title="Top X%", unit="%", higher_is_better=False
    ),
}


def available() -> dict[str, str]:
    """name -> origin ('builtin', 'user', or 'pseudo'). User files shadow builtins."""
    out = {n: "pseudo" for n in PSEUDO}
    out.update({n: "builtin" for n in _builtin_files()})
    out.update({n: "user" for n in _user_files()})
    return dict(sorted(out.items()))


def load(ref: Union[str, Path, Distribution]) -> Distribution:
    """Load a distribution by name (user > builtin > pseudo) or JSON file path."""
    if isinstance(ref, Distribution):
        return ref
    ref = str(ref)
    user = _user_files()
    if ref in user:
        return load_file(user[ref])
    builtin = _builtin_files()
    if ref in builtin:
        spec = json.loads(builtin[ref].read_text())
        return from_dict(spec, default_name=ref)
    if ref in PSEUDO:
        return PSEUDO[ref]()
    if ref.endswith(".json") or os.path.sep in ref:
        if not Path(ref).exists():
            raise DistributionError(f"No such file: {ref}")
        return load_file(ref)
    names = available()
    close = [n for n in names if ref.lower() in n.lower()]
    hint = f" Did you mean: {', '.join(close)}?" if close else " Run `rank-anything list` to see options."
    raise DistributionError(f"Unknown distribution {ref!r}.{hint}")


def install(path: Union[str, Path], name: str | None = None, force: bool = False) -> Path:
    """Validate a JSON file and copy it into the user directory."""
    dist = load_file(path)
    name = name or dist.name
    dest = user_dir() / f"{name}.json"
    if dest.exists() and not force:
        raise DistributionError(f"{dest} already exists (use --force to overwrite)")
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, dest)
    return dest
