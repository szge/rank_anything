import pytest

from rank_anything import from_dict
from rank_anything.core import (
    DistributionError,
    LabeledDistribution,
    PiecewiseDistribution,
    convert,
    normalize_label,
    parse_number,
)


def test_parse_number():
    assert parse_number("85,000") == 85000
    assert parse_number("$85k") == 85000
    assert parse_number("1.2M") == 1_200_000
    assert parse_number("-3.5") == -3.5
    with pytest.raises(DistributionError):
        parse_number("gold")


def test_normalize_label():
    assert normalize_label("Gold II") == normalize_label("gold 2") == normalize_label("GOLD-2")
    # Roman numeral only converted after the first token ("I" alone is a word)
    assert normalize_label("Iron IV") == "iron4"


def test_piecewise_interpolates_between_known_points():
    d = PiecewiseDistribution("x", [(0, 0), (100, 50), (300, 100)])
    assert d.to_percentile(50).percentile == pytest.approx(25)
    assert d.to_percentile(200).percentile == pytest.approx(75)
    assert d.from_percentile(75).value == pytest.approx(200)


def test_piecewise_clamps_outside_range():
    d = PiecewiseDistribution("x", [(10, 20), (20, 80)])
    p = d.to_percentile(5)
    assert p.clamped and p.percentile == 20
    v = d.from_percentile(99)
    assert v.clamped and v.value == 20


def test_samples_even_spacing():
    d = PiecewiseDistribution.from_samples("s", [5, 1, 3, 2, 4])
    assert d.to_percentile(3).percentile == pytest.approx(50)
    assert d.to_percentile(3.5).percentile == pytest.approx(62.5)


def test_lower_is_better():
    d = PiecewiseDistribution("t", [(120, 0), (300, 100)], higher_is_better=False)
    assert d.to_percentile(120).percentile == pytest.approx(100)
    assert d.from_percentile(100).value == pytest.approx(120)


def test_labeled_from_frequencies_bands_and_positions():
    d = LabeledDistribution.from_frequencies("r", [("Bronze", 50), ("Silver", 30), ("Gold", 20)])
    assert d.to_percentile("bronze").percentile == pytest.approx(25)
    assert d.to_percentile("Silver", position=0).percentile == pytest.approx(50)
    assert d.to_percentile("Silver", position=1).percentile == pytest.approx(80)
    pl = d.from_percentile(65)
    assert pl.value == "Silver" and pl.position == pytest.approx(0.5)
    assert d.from_percentile(100).value == "Gold"
    assert d.from_percentile(0).value == "Bronze"


def test_labeled_prefix_match_and_errors():
    d = LabeledDistribution.from_frequencies("r", [("Bronze", 1), ("Silver", 1), ("Grandmaster", 1)])
    assert d.find("grand").label == "Grandmaster"
    with pytest.raises(DistributionError):
        d.find("platinum")


def test_convert_numeric_to_labeled():
    src = PiecewiseDistribution("inc", [(0, 0), (100, 100)])
    dst = LabeledDistribution.from_frequencies("r", [("A", 50), ("B", 50)])
    c = convert(75, src, dst)
    assert c.target_placement.value == "B"
    assert c.target_placement.position == pytest.approx(0.5)


def test_round_trip_numeric():
    a = PiecewiseDistribution("a", [(0, 0), (10, 30), (50, 90), (100, 100)])
    b = PiecewiseDistribution("b", [(1, 0), (2, 100)])
    for x in (3, 10, 27.5, 80):
        y = convert(x, a, b).target_placement.value
        assert convert(y, b, a).target_placement.value == pytest.approx(x)


def test_from_dict_types():
    lab = from_dict({"type": "percentile", "percentile_kind": "top",
                     "data": {"E3": 100, "E4": 60, "E5": 20}})
    assert lab.kind == "labeled"
    assert lab.to_percentile("E5", position=0).percentile == pytest.approx(80)

    num = from_dict({"type": "percentile", "data": {"10000": 10, "50000": 50}})
    assert num.to_percentile(30000).percentile == pytest.approx(30)

    hist = from_dict({"type": "frequency", "data": [["1", 1], ["2", 2], ["3", 1]]})
    assert hist.to_percentile(2).percentile == pytest.approx(50)

    norm = from_dict({"type": "normal", "data": {"mean": 100, "std": 15}})
    assert norm.to_percentile(115).percentile == pytest.approx(84.13, abs=0.01)

    logn = from_dict({"type": "lognormal", "data": {"median": 50000, "sigma": 0.8}})
    assert logn.to_percentile(50000).percentile == pytest.approx(50)


def test_from_dict_rejects_bad_input():
    with pytest.raises(DistributionError):
        from_dict({"type": "nope", "data": []})
    with pytest.raises(DistributionError):
        from_dict({"type": "percentile", "data": {"10": 50, "20": 40}})
