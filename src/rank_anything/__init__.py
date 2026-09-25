"""rank_anything: convert a value in one distribution to its equivalent in another."""

from .core import (
    Conversion,
    Distribution,
    DistributionError,
    LabeledDistribution,
    NumericDistribution,
    Placement,
    convert as _convert,
)
from .loader import available, from_dict, install, load, load_file

__version__ = "0.1.0"


def convert(value, source, target, position: float = 0.5) -> Conversion:
    """Convert ``value`` from ``source`` to ``target``.

    ``source``/``target`` may be names (``"lol-rank"``), JSON paths, or
    Distribution objects.

    >>> convert(90, "percentile", "lol-rank").target_placement.value
    'Emerald III'
    """
    return _convert(value, load(source), load(target), position=position)


def percentile(value, source, position: float = 0.5) -> float:
    """Rank percentile (0-100, "better than X%") of ``value`` in ``source``."""
    return load(source).to_percentile(value, position=position).percentile


__all__ = [
    "Conversion", "Distribution", "DistributionError", "LabeledDistribution",
    "NumericDistribution", "Placement", "available", "convert", "from_dict",
    "install", "load", "load_file", "percentile",
]
