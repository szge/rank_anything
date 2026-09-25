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
    # True if the requested value/percentile was outside the known range and
    # was pinned to the nearest endpoint (hard bound, e.g. a max score).
    clamped: bool = False
    # True if it was outside the known range and estimated by extending the
    # distribution's tail beyond the last known points.
    extrapolated: bool = False

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
    # Numeric only: values are durations in seconds, entered/shown as clock
    # times. "mm:ss" or "h:mm" says how a two-part time like "3:31" is read.
    duration: str = ""
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


DURATION_STYLES = ("mm:ss", "h:mm")


def parse_duration(raw: Union[str, float, int], style: str = "mm:ss") -> float:
    """Parse a duration to seconds: '1:02:03', '25:20' (mm:ss, or h:mm when
    ``style`` is 'h:mm'), '3h31m', '25m20s', or a plain number of minutes."""
    if isinstance(raw, (int, float)):
        return float(raw) * 60
    s = raw.strip().lower().replace(" ", "")
    if ":" in s:
        parts = s.split(":")
        try:
            nums = [float(x) for x in parts]
        except ValueError:
            raise DistributionError(f"Could not parse a time from {raw!r}") from None
        if len(nums) == 3:
            h, m, sec = nums
        elif len(nums) == 2:
            h, m, sec = (nums[0], nums[1], 0.0) if style == "h:mm" else (0.0, nums[0], nums[1])
        else:
            raise DistributionError(f"Could not parse a time from {raw!r}")
        return h * 3600 + m * 60 + sec
    m = re.fullmatch(r"(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s)?", s)
    if m and any(m.groups()):
        h, mi, sec = (float(g) if g else 0.0 for g in m.groups())
        return h * 3600 + mi * 60 + sec
    return parse_number(s) * 60  # bare number = minutes


def format_duration(seconds: float) -> str:
    total = int(round(seconds))
    sign = "-" if total < 0 else ""
    h, rem = divmod(abs(total), 3600)
    m, sec = divmod(rem, 60)
    return f"{sign}{h}:{m:02d}:{sec:02d}" if h else f"{sign}{m}:{sec:02d}"


def format_percent(p: float) -> str:
    """Readable percent that keeps ~2 significant digits of the distance to
    0%/100%, so far tails stay distinguishable (99.9988%, 0.0012%)."""
    tail = min(p, 100 - p)
    if tail >= 1:
        digits = 1
    elif tail > 0:
        digits = min(12, 1 - math.floor(math.log10(tail)))
    else:
        digits = 0
    text = f"{p:.{digits}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text + "%"


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

    # cdf/ppf return (result, status) where status is "", "clamped" or "extrapolated".
    def cdf(self, x: float) -> tuple[float, str]:
        raise NotImplementedError

    def ppf(self, p: float) -> tuple[float, str]:
        raise NotImplementedError

    def parse_value(self, raw) -> float:
        if self.duration:
            # Text is human input ("25:20", or "25" = minutes); numbers are
            # already in the stored unit, seconds.
            if isinstance(raw, (int, float)):
                return float(raw)
            return parse_duration(raw, self.duration)
        return parse_number(raw)

    def format_value(self, value) -> str:
        if self.duration:
            return format_duration(float(value))
        if self.unit == "%":
            return format_percent(float(value))
        s = _fmt_number(float(value))
        return f"{s} {self.unit}".strip() if self.unit else s

    def to_percentile(self, value, position: float = 0.5) -> Placement:
        x = self.parse_value(value)
        p, status = self.cdf(x)
        rank = p if self.higher_is_better else 100.0 - p
        return Placement(rank, x, clamped=status == "clamped", extrapolated=status == "extrapolated")

    def from_percentile(self, percentile: float) -> Placement:
        p = percentile if self.higher_is_better else 100.0 - percentile
        x, status = self.ppf(p)
        return Placement(
            percentile, x, clamped=status == "clamped", extrapolated=status == "extrapolated"
        )


class _Tail:
    """Extends a piecewise distribution past its last known point.

    Fitted to the two outermost known points, in terms of the population share
    beyond x (``mass``: the % above x for the upper tail, below x for the lower):

    * ``pareto``: mass shrinks as a power of x (``mass ∝ x^-a`` upward,
      ``x^a`` toward 0). Used when values are positive, which suits skewed
      data like incomes, wealth or follower counts.
    * ``exponential``: mass shrinks exponentially with distance, for data that
      can be zero or negative.

    Endpoints at 0% / 100% are hard bounds (e.g. a max score), so there is no
    tail there and values beyond are clamped instead.
    """

    def __init__(self, x0: float, m0: float, x1: float, m1: float, kind: str, upper: bool):
        # (x0, m0) is the outermost point, (x1, m1) the next one in.
        self.x0, self.m0, self.upper = x0, m0, upper
        ratio = math.log(m1 / m0)  # > 0: mass grows moving inward
        if kind == "pareto":
            self.kind, self.rate = kind, ratio / abs(math.log(x0 / x1))
        else:
            self.kind, self.rate = "exponential", ratio / abs(x0 - x1)

    def mass(self, x: float) -> float:
        if self.kind == "pareto":
            if x <= 0:
                return 0.0
            return self.m0 * (x / self.x0) ** (-self.rate if self.upper else self.rate)
        d = x - self.x0 if self.upper else self.x0 - x
        return self.m0 * math.exp(-self.rate * d)

    def value(self, mass: float) -> float:
        if mass <= 0:
            return math.inf if self.upper else (0.0 if self.kind == "pareto" else -math.inf)
        k = math.log(mass / self.m0) / self.rate  # <= 0 in the tail
        if self.kind == "pareto":
            return self.x0 * math.exp(-k if self.upper else k)
        return self.x0 - k if self.upper else self.x0 + k


TAIL_KINDS = ("auto", "pareto", "exponential", "clamp")
INTERPOLATIONS = ("linear", "loglog")


class PiecewiseDistribution(NumericDistribution):
    """Numeric distribution defined by known (value, cdf-percentile) points.
    Values between points are linearly interpolated; values beyond the
    outermost points follow a fitted tail (see :class:`_Tail`)."""

    def __init__(self, name: str, points: Sequence[tuple[float, float]], tail: str = "auto",
                 interpolation: str = "linear", **meta):
        super().__init__(name, **meta)
        if interpolation not in INTERPOLATIONS:
            raise DistributionError(
                f"{name}: 'interpolation' must be one of {', '.join(INTERPOLATIONS)}"
            )
        self.interpolation = interpolation
        if len(points) < 2:
            raise DistributionError(f"{name}: need at least 2 points to interpolate")
        if tail not in TAIL_KINDS:
            raise DistributionError(f"{name}: 'tail' must be one of {', '.join(TAIL_KINDS)}")
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
        self.tail = tail
        # Segments interpolated as a power law instead of a straight line.
        self._power = [
            interpolation == "loglog" and self._power_ok(i) for i in range(len(xs) - 1)
        ]
        self.upper_tail = self._fit_tail(upper=True)
        self.lower_tail = self._fit_tail(upper=False)

    def _power_ok(self, i: int) -> bool:
        """``loglog`` applies to upper-half segments with positive values and
        a shrinking, non-zero share above (the Pareto-like part of the data)."""
        x0, x1, p0, p1 = self.xs[i], self.xs[i + 1], self.ps[i], self.ps[i + 1]
        return p0 >= 50 and x0 > 0 and x1 > x0 and 100 - p1 > 0 and p1 > p0

    def _power_cdf(self, i: int, x: float) -> float:
        """Share above x follows m0 * (x/x0)^-a through segment i's endpoints."""
        x0, x1, m0, m1 = self.xs[i], self.xs[i + 1], 100 - self.ps[i], 100 - self.ps[i + 1]
        a = math.log(m0 / m1) / math.log(x1 / x0)
        return 100.0 - m0 * (x / x0) ** -a

    def _power_ppf(self, i: int, p: float) -> float:
        x0, x1, m0, m1 = self.xs[i], self.xs[i + 1], 100 - self.ps[i], 100 - self.ps[i + 1]
        a = math.log(m0 / m1) / math.log(x1 / x0)
        return x0 * ((100 - p) / m0) ** (-1 / a)

    def _fit_tail(self, upper: bool) -> Optional[_Tail]:
        if self.tail == "clamp":
            return None
        pts = list(zip(self.xs, self.ps))
        if upper:
            pts = [(x, 100.0 - p) for x, p in reversed(pts)]
        x0, m0 = pts[0]
        if m0 <= 0:  # endpoint at 0%/100%: a hard bound
            return None
        # Next point inward with strictly more mass and a different value.
        inner = next(((x, m) for x, m in pts[1:] if m > m0 and x != x0), None)
        if inner is None:
            return None
        kind = self.tail
        if kind == "auto":
            kind = "pareto" if x0 > 0 and inner[0] > 0 else "exponential"
        if kind == "pareto" and (x0 <= 0 or inner[0] <= 0):
            raise DistributionError(f"{self.name}: a pareto tail needs positive values")
        return _Tail(x0, m0, inner[0], inner[1], kind, upper)

    def cdf(self, x: float) -> tuple[float, str]:
        if x < self.xs[0]:
            if self.lower_tail:
                return self.lower_tail.mass(x), "extrapolated"
            return self.ps[0], "clamped"
        if x > self.xs[-1]:
            if self.upper_tail:
                return 100.0 - self.upper_tail.mass(x), "extrapolated"
            return self.ps[-1], "clamped"
        i = bisect.bisect_left(self.xs, x) - 1
        if 0 <= i < len(self._power) and self._power[i] and self.xs[i] < x:
            return self._power_cdf(i, x), ""
        return _interp(x, self.xs, self.ps), ""

    def ppf(self, p: float) -> tuple[float, str]:
        if p < self.ps[0]:
            if self.lower_tail and p > 0:
                return self.lower_tail.value(p), "extrapolated"
            return self.xs[0], "clamped"
        if p > self.ps[-1]:
            if self.upper_tail and p < 100:
                return self.upper_tail.value(100.0 - p), "extrapolated"
            return self.xs[-1], "clamped"
        i = bisect.bisect_left(self.ps, p) - 1
        if 0 <= i < len(self._power) and self._power[i] and self.ps[i] < p:
            return self._power_ppf(i, p), ""
        return _interp(p, self.ps, self.xs), ""

    @classmethod
    def from_samples(cls, name: str, samples: Sequence[float], **meta):
        """Empirical distribution: the i-th smallest of n samples sits at the
        midpoint of its 1/n share, (i + 0.5) / n. This leaves room below the
        smallest and above the largest sample for the tails."""
        xs = sorted(float(v) for v in samples)
        if len(xs) < 2:
            raise DistributionError(f"{name}: need at least 2 samples")
        return cls.from_weighted(name, [(x, 1.0) for x in xs], **meta)

    @classmethod
    def from_weighted(cls, name: str, weights: Sequence[tuple[float, float]], **meta):
        """Histogram of numeric values -> each value sits at the midpoint of its
        cumulative share of the population."""
        merged: dict[float, float] = {}
        for v, w in weights:
            merged[float(v)] = merged.get(float(v), 0.0) + float(w)
        items = sorted(merged.items())
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

    def cdf(self, x: float) -> tuple[float, str]:
        return 100.0 * self._dist.cdf(x), ""

    def ppf(self, p: float) -> tuple[float, str]:
        eps = 1e-15
        status = "clamped" if p / 100.0 <= eps or p / 100.0 >= 1 - eps else ""
        return self._dist.inv_cdf(_clamp(p / 100.0, eps, 1 - eps)), status


class LogNormalDistribution(NumericDistribution):
    """Log-normal, parameterised by its median and sigma (std of ln(x))."""

    def __init__(self, name: str, median: float, sigma: float, **meta):
        super().__init__(name, **meta)
        if median <= 0 or sigma <= 0:
            raise DistributionError(f"{name}: median and sigma must be positive")
        self.median, self.sigma = float(median), float(sigma)
        self._dist = NormalDist(math.log(self.median), self.sigma)

    def cdf(self, x: float) -> tuple[float, str]:
        if x <= 0:
            return 0.0, "clamped" if x < 0 else ""
        return 100.0 * self._dist.cdf(math.log(x)), ""

    def ppf(self, p: float) -> tuple[float, str]:
        eps = 1e-15
        status = "clamped" if p / 100.0 <= eps or p / 100.0 >= 1 - eps else ""
        return math.exp(self._dist.inv_cdf(_clamp(p / 100.0, eps, 1 - eps))), status


# --------------------------------------------------------------------------- labeled

_ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5"}


def _label_tokens(label: str) -> list[str]:
    tokens = re.findall(r"[a-z]+|[0-9]+", str(label).lower())
    return [_ROMAN.get(t, t) if i > 0 else t for i, t in enumerate(tokens)]


def normalize_label(label: str) -> str:
    """Case/spacing-insensitive key; 'Gold II' == 'gold 2' == 'GOLD-2'."""
    return "".join(_label_tokens(label))


def _token_prefix_match(query: list[str], label: list[str]) -> bool:
    """'plat 2' matches 'Platinum II': each query token prefixes a label token."""
    return 0 < len(query) <= len(label) and all(l.startswith(q) for q, l in zip(query, label))


@dataclass
class Band:
    label: str
    lo: float  # rank percentile where this label starts
    hi: float  # rank percentile where this label ends


class LabeledDistribution(Distribution):
    """Ordered categories (ranks, levels, grades), worst -> best. Each label
    covers a band of rank percentiles; positions inside a band interpolate."""

    kind = "labeled"

    def __init__(self, name: str, bands: Sequence[Band], aliases: Optional[dict] = None, **meta):
        super().__init__(name, **meta)
        if not bands:
            raise DistributionError(f"{name}: no labels given")
        self.bands = list(bands)
        self._index: dict[str, int] = {}
        self._tokens = [_label_tokens(b.label) for b in self.bands]
        # "Grand Champion 2" -> "gc2": initials of the words plus any numbers,
        # for labels with at least two words.
        self._acronyms = [
            "".join(t[0] for t in toks if t.isalpha()) + "".join(t for t in toks if t.isdigit())
            if sum(t.isalpha() for t in toks) >= 2 else ""
            for toks in self._tokens
        ]
        for i, b in enumerate(self.bands):
            if b.hi < b.lo:
                raise DistributionError(f"{name}: label {b.label!r} has negative width")
            key = normalize_label(b.label)
            if key in self._index:
                raise DistributionError(f"{name}: duplicate label {b.label!r}")
            self._index[key] = i
        # Extra names people use for a label, e.g. {"SSL": "Supersonic Legend"}.
        self._aliases: dict[str, int] = {}
        for alias, target in (aliases or {}).items():
            key, target_key = normalize_label(alias), normalize_label(target)
            if target_key not in self._index:
                raise DistributionError(f"{name}: alias {alias!r} points to unknown label {target!r}")
            if key in self._index:
                raise DistributionError(f"{name}: alias {alias!r} clashes with a label")
            self._aliases[key] = self._index[target_key]

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

    def _prefix_matches(self, label: str) -> list[int]:
        query = _label_tokens(label)
        key = "".join(query)
        return [
            i for i, (k, toks, acr) in enumerate(zip(self._index, self._tokens, self._acronyms))
            if (key and (k.startswith(key) or (acr and acr.startswith(key))))
            or _token_prefix_match(query, toks)
        ]

    def find(self, label: str) -> Band:
        key = normalize_label(label)
        if key in self._index:
            return self.bands[self._index[key]]
        if key in self._aliases:
            return self.bands[self._aliases[key]]
        matches = [self.bands[i] for i in self._prefix_matches(label)]
        if len(matches) == 1:
            return matches[0]
        hint = (
            f" Did you mean one of: {', '.join(b.label for b in matches[:8])}?"
            if matches
            else f" Known labels: {', '.join(self.labels)}"
        )
        raise DistributionError(f"{self.name}: unknown label {label!r}.{hint}")

    def find_span(self, label: str) -> Band:
        """Like :meth:`find`, but a prefix matching several *adjacent* labels
        (e.g. 'gold' -> Gold IV..Gold I) returns their combined band."""
        key = normalize_label(label)
        if key not in self._index and key not in self._aliases:
            idx = self._prefix_matches(label)
            if len(idx) > 1 and idx == list(range(idx[0], idx[-1] + 1)):
                first, last = self.bands[idx[0]], self.bands[idx[-1]]
                return Band(f"{first.label} – {last.label}", first.lo, last.hi)
        return self.find(label)

    def parse_value(self, raw) -> str:
        return self.find_span(str(raw)).label

    def format_value(self, value) -> str:
        return str(value)

    def to_percentile(self, value, position: float = 0.5) -> Placement:
        if not 0 <= position <= 1:
            raise DistributionError("position must be between 0 and 1")
        b = self.find_span(str(value))
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
