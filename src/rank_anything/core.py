"""Core distribution model.

Every distribution is reduced to a monotone mapping between its own values and a
*rank percentile* in [0, 100] ("better than X% of the population"). Converting
between two distributions is then:

    value --(source.to_percentile)--> percentile --(target.from_percentile)--> value

Whenever an exact value is not one of the known points, we linearly interpolate
between the nearest known points (numeric distributions) or within a label's
band (labeled/tiered distributions).
"""

from __future__ import annotations

import bisect
import math
import re
from dataclasses import dataclass
from statistics import NormalDist
from typing import ClassVar, Optional, Sequence, Union

Value = Union[float, str]


class DistributionError(ValueError):
    """Raised for malformed distributions or values that can't be placed."""


@dataclass
class Placement:
    """Where a percentile lands in a particular distribution."""

    percentile: float
    value: Value
    # For labeled distributions: how far through the label's band (0..1).
    position: Optional[float] = None
    # True if the requested value/percentile was outside the known range.
    clamped: bool = False

    @property
    def top_percent(self) -> float:
        return 100.0 - self.percentile


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _interp(x: float, xs: Sequence[float], ys: Sequence[float]) -> float:
    """Piecewise-linear interpolation of ``x`` over sorted ``xs``.

    ``xs`` must be non-decreasing and ``x`` within [xs[0], xs[-1]]. Flat runs
    (repeated xs) resolve to the midpoint of their ys.
    """
    lo = bisect.bisect_left(xs, x)
    hi = bisect.bisect_right(xs, x)
    if lo != hi:  # x matches one or more known points exactly
        return (ys[lo] + ys[hi - 1]) / 2
    if lo == 0:
        return ys[0]
    if lo >= len(xs):
        return ys[-1]
    x0, x1, y0, y1 = xs[lo - 1], xs[lo], ys[lo - 1], ys[lo]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)


@dataclass
class Distribution:
    name: str
    title: str = ""
    description: str = ""
    unit: str = ""
    source: str = ""
    date: str = ""
    higher_is_better: bool = True
    kind: ClassVar[str] = ""

    def to_percentile(self, value: Value, position: float = 0.5) -> Placement:
        raise NotImplementedError

    def from_percentile(self, percentile: float) -> Placement:
        raise NotImplementedError

    def parse_value(self, raw: str) -> Value:
        return raw

    def format_value(self, value: Value) -> str:
        return str(value)

    @property
    def display_name(self) -> str:
        return self.title or self.name


# --------------------------------------------------------------------------- numeric

_SUFFIXES = {"k": 1e3, "m": 1e6, "b": 1e9}


def parse_number(raw: Union[str, float, int]) -> float:
    """Parse numbers like ``85000``, ``85,000``, ``$85k``, ``1.2M``, ``-3.5``."""
    if isinstance(raw, (int, float)):
        return float(raw)
    s = raw.strip().lower().replace(",", "").replace("_", "")
    s = re.sub(r"^(?:[a-z]{0,2}[$€£¥₹₩])\s*", "", s)  # currency: $, C$, US$, €...
    m = re.fullmatch(r"([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([kmb])?\s*%?", s)
    if not m:
        raise DistributionError(f"Could not parse a number from {raw!r}")
    return float(m.group(1)) * _SUFFIXES.get(m.group(2) or "", 1.0)


def _fmt_number(x: float) -> str:
    if abs(x) >= 1000:
        return f"{x:,.0f}"
    if x == int(x):
        return f"{x:.0f}"
    return f"{x:.4g}" if abs(x) < 1 else f"{x:,.2f}".rstrip("0").rstrip(".")


class NumericDistribution(Distribution):
    """Base for distributions over numbers. Subclasses provide ``cdf``/``ppf``
    in terms of "% of population with a *smaller* value" (0..100)."""

    kind = "numeric"

    def cdf(self, x: float) -> tuple[float, bool]:
        raise NotImplementedError

    def ppf(self, p: float) -> tuple[float, bool]:
        raise NotImplementedError

    def parse_value(self, raw) -> float:
        return parse_number(raw)

    def format_value(self, value) -> str:
        s = _fmt_number(float(value))
        return f"{s} {self.unit}".strip() if self.unit else s

    def to_percentile(self, value, position: float = 0.5) -> Placement:
        x = self.parse_value(value)
        p, clamped = self.cdf(x)
        rank = p if self.higher_is_better else 100.0 - p
        return Placement(percentile=rank, value=x, clamped=clamped)

    def from_percentile(self, percentile: float) -> Placement:
        p = percentile if self.higher_is_better else 100.0 - percentile
        x, clamped = self.ppf(p)
        return Placement(percentile=percentile, value=x, clamped=clamped)


class PiecewiseDistribution(NumericDistribution):
    """Numeric distribution defined by known (value, cdf-percentile) points.
    Values between points are linearly interpolated."""

    def __init__(self, name: str, points: Sequence[tuple[float, float]], **meta):
        super().__init__(name, **meta)
        if len(points) < 2:
            raise DistributionError(f"{name}: need at least 2 points to interpolate")
        pts = sorted((float(x), float(p)) for x, p in points)
        xs = [x for x, _ in pts]
        ps = [p for _, p in pts]
        for a, b in zip(ps, ps[1:]):
            if b < a:
                raise DistributionError(
                    f"{name}: percentiles must increase with value (got {a} then {b})"
                )
        if ps[0] < 0 or ps[-1] > 100:
            raise DistributionError(f"{name}: percentiles must be within 0..100")
        if ps[0] == ps[-1]:
            raise DistributionError(f"{name}: all points have the same percentile")
        self.xs, self.ps = xs, ps

    def cdf(self, x: float) -> tuple[float, bool]:
        if x < self.xs[0]:
            return self.ps[0], True
        if x > self.xs[-1]:
            return self.ps[-1], True
        return _interp(x, self.xs, self.ps), False

    def ppf(self, p: float) -> tuple[float, bool]:
        if p < self.ps[0]:
            return self.xs[0], True
        if p > self.ps[-1]:
            return self.xs[-1], True
        return _interp(p, self.ps, self.xs), False

    @classmethod
    def from_samples(cls, name: str, samples: Sequence[float], **meta):
        """Empirical distribution: the smallest sample is the 0th percentile, the
        largest the 100th, evenly spaced in between."""
        xs = sorted(float(v) for v in samples)
        if len(xs) < 2:
            raise DistributionError(f"{name}: need at least 2 samples")
        n = len(xs)
        return cls(name, [(x, 100.0 * i / (n - 1)) for i, x in enumerate(xs)], **meta)

    @classmethod
    def from_weighted(cls, name: str, weights: Sequence[tuple[float, float]], **meta):
        """Histogram of numeric values -> each value sits at the midpoint of its
        cumulative share of the population."""
        items = sorted((float(v), float(w)) for v, w in weights)
        total = sum(w for _, w in items)
        if total <= 0 or any(w < 0 for _, w in items):
            raise DistributionError(f"{name}: frequencies must be non-negative, sum > 0")
        pts, cum = [], 0.0
        for v, w in items:
            pts.append((v, 100.0 * (cum + w / 2) / total))
            cum += w
        return cls(name, pts, **meta)


class NormalDistribution(NumericDistribution):
    def __init__(self, name: str, mean: float, std: float, **meta):
        super().__init__(name, **meta)
        if std <= 0:
            raise DistributionError(f"{name}: std must be positive")
        self.mean, self.std = float(mean), float(std)
        self._dist = NormalDist(self.mean, self.std)

    def cdf(self, x: float) -> tuple[float, bool]:
        return 100.0 * self._dist.cdf(x), False

    def ppf(self, p: float) -> tuple[float, bool]:
        eps = 1e-9
        clamped = p <= 0 or p >= 100
        return self._dist.inv_cdf(_clamp(p / 100.0, eps, 1 - eps)), clamped


class LogNormalDistribution(NumericDistribution):
    """Log-normal, parameterised by its median and sigma (std of ln(x))."""

    def __init__(self, name: str, median: float, sigma: float, **meta):
        super().__init__(name, **meta)
        if median <= 0 or sigma <= 0:
            raise DistributionError(f"{name}: median and sigma must be positive")
        self.median, self.sigma = float(median), float(sigma)
        self._dist = NormalDist(math.log(self.median), self.sigma)

    def cdf(self, x: float) -> tuple[float, bool]:
        if x <= 0:
            return 0.0, x < 0
        return 100.0 * self._dist.cdf(math.log(x)), False

    def ppf(self, p: float) -> tuple[float, bool]:
        eps = 1e-9
        clamped = p <= 0 or p >= 100
        return math.exp(self._dist.inv_cdf(_clamp(p / 100.0, eps, 1 - eps))), clamped


# --------------------------------------------------------------------------- labeled

_ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}


def normalize_label(label: str) -> str:
    """Case/spacing-insensitive key; 'Gold II' == 'gold 2' == 'GOLD-2'."""
    tokens = re.findall(r"[a-z0-9]+", str(label).lower())
    tokens = [_ROMAN.get(t, t) if i > 0 else t for i, t in enumerate(tokens)]
    return "".join(tokens)


@dataclass
class Band:
    label: str
    lo: float  # rank percentile where this label starts
    hi: float  # rank percentile where this label ends


class LabeledDistribution(Distribution):
    """Ordered categories (ranks, levels, grades), worst -> best. Each label
    covers a band of rank percentiles; positions inside a band interpolate."""

    kind = "labeled"

    def __init__(self, name: str, bands: Sequence[Band], **meta):
        super().__init__(name, **meta)
        if not bands:
            raise DistributionError(f"{name}: no labels given")
        self.bands = list(bands)
        self._index: dict[str, int] = {}
        for i, b in enumerate(self.bands):
            if b.hi < b.lo:
                raise DistributionError(f"{name}: label {b.label!r} has negative width")
            key = normalize_label(b.label)
            if key in self._index:
                raise DistributionError(f"{name}: duplicate label {b.label!r}")
            self._index[key] = i

    @classmethod
    def from_frequencies(cls, name: str, freqs: Sequence[tuple[str, float]], **meta):
        """Labels (worst -> best) with the share of population in each."""
        total = sum(float(f) for _, f in freqs)
        if total <= 0 or any(float(f) < 0 for _, f in freqs):
            raise DistributionError(f"{name}: frequencies must be non-negative, sum > 0")
        bands, cum = [], 0.0
        for label, f in freqs:
            lo = 100.0 * cum / total
            cum += float(f)
            bands.append(Band(str(label), lo, 100.0 * cum / total))
        bands[-1].hi = 100.0  # guard against float drift
        return cls(name, bands, **meta)

    @classmethod
    def from_starts(cls, name: str, starts: Sequence[tuple[str, float]], **meta):
        """Labels with the rank percentile at which each one *starts*
        (i.e. % of population below it). Each band ends where the next starts."""
        items = sorted(((str(l), float(p)) for l, p in starts), key=lambda t: t[1])
        if any(not 0 <= p <= 100 for _, p in items):
            raise DistributionError(f"{name}: percentiles must be within 0..100")
        bands = []
        for i, (label, p) in enumerate(items):
            hi = items[i + 1][1] if i + 1 < len(items) else 100.0
            bands.append(Band(label, p, hi))
        return cls(name, bands, **meta)

    @property
    def labels(self) -> list[str]:
        return [b.label for b in self.bands]

    def find(self, label: str) -> Band:
        key = normalize_label(label)
        if key in self._index:
            return self.bands[self._index[key]]
        matches = [b for k, b in zip(self._index, self.bands) if k.startswith(key)] if key else []
        if len(matches) == 1:
            return matches[0]
        hint = (
            f" Did you mean one of: {', '.join(b.label for b in matches[:8])}?"
            if matches
            else f" Known labels: {', '.join(self.labels)}"
        )
        raise DistributionError(f"{self.name}: unknown label {label!r}.{hint}")

    def parse_value(self, raw) -> str:
        return self.find(str(raw)).label

    def to_percentile(self, value, position: float = 0.5) -> Placement:
        if not 0 <= position <= 1:
            raise DistributionError("position must be between 0 and 1")
        b = self.find(str(value))
        return Placement(b.lo + position * (b.hi - b.lo), b.label, position)

    def from_percentile(self, percentile: float) -> Placement:
        clamped = not 0 <= percentile <= 100
        p = _clamp(percentile, 0.0, 100.0)
        # Last band whose start is <= p (ties at a boundary go to the better label).
        idx = bisect.bisect_right([b.lo for b in self.bands], p) - 1
        idx = max(0, idx)
        # Skip empty bands sitting exactly at p.
        while idx > 0 and self.bands[idx].hi == self.bands[idx].lo and p <= self.bands[idx].lo:
            idx -= 1
        b = self.bands[idx]
        width = b.hi - b.lo
        pos = (p - b.lo) / width if width > 0 else 0.5
        return Placement(percentile, b.label, _clamp(pos, 0.0, 1.0), clamped)


# --------------------------------------------------------------------------- convert


@dataclass
class Conversion:
    source: Distribution
    target: Distribution
    source_placement: Placement
    target_placement: Placement

    @property
    def percentile(self) -> float:
        return self.source_placement.percentile


def convert(value, source: Distribution, target: Distribution, position: float = 0.5) -> Conversion:
    """Map ``value`` in ``source`` to the equivalent value in ``target``."""
    sp = source.to_percentile(value, position=position)
    tp = target.from_percentile(sp.percentile)
    return Conversion(source, target, sp, tp)
