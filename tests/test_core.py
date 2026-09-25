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


def test_piecewise_clamp_tail():
    d = PiecewiseDistribution("x", [(10, 20), (20, 80)], tail="clamp")
    p = d.to_percentile(5)
    assert p.clamped and p.percentile == 20
    v = d.from_percentile(99)
    assert v.clamped and v.value == 20


def test_hard_bounds_clamp_even_with_auto_tail():
    # 0% and 100% endpoints are real limits (e.g. a max score): nothing beyond.
    d = PiecewiseDistribution("sat", [(400, 0), (1600, 100)])
    assert d.to_percentile(2000).clamped
    assert d.to_percentile(2000).percentile == 100


def test_pareto_upper_tail_keeps_ranking_extreme_values():
    d = PiecewiseDistribution("inc", [(0, 0), (1_000, 90), (10_000, 99), (100_000, 99.9)])
    a, b, c = (d.to_percentile(x) for x in (1e6, 1e7, 1e9))
    assert a.extrapolated and not a.clamped
    assert 99.9 < a.percentile < b.percentile < c.percentile < 100
    # Pareto fit from the last two points: each 10x cuts the top share 10x.
    assert 100 - a.percentile == pytest.approx(0.01)
    # And the inverse agrees.
    assert d.from_percentile(a.percentile).value == pytest.approx(1e6)


def test_lower_tail_and_exponential_tail():
    d = PiecewiseDistribution("x", [(-10, 5), (0, 50), (10, 80), (20, 95)])
    assert d.upper_tail.kind == "pareto" and d.lower_tail.kind == "exponential"
    lo = d.to_percentile(-20)
    assert lo.extrapolated and 0 < lo.percentile < 5
    assert d.from_percentile(lo.percentile).value == pytest.approx(-20)
    with pytest.raises(DistributionError):
        PiecewiseDistribution("x", [(-10, 5), (0, 50)], tail="pareto")


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


def test_loglog_interpolation_follows_power_law_in_upper_half():
    # Exact Pareto with a=2: share above x = 10% * (x/100)^-2.
    pts = [(10, 0), (50, 40), (100, 90), (1000, 99.9)]
    lin = PiecewiseDistribution("lin", pts)
    log = PiecewiseDistribution("log", pts, interpolation="loglog")
    assert log.to_percentile(300).percentile == pytest.approx(100 - 10 / 9)
    assert lin.to_percentile(300).percentile == pytest.approx(92.2)  # a straight line badly understates it
    assert log.from_percentile(99).value == pytest.approx(100 * 10 ** 0.5)
    # Lower half and exact points are unchanged.
    for x in (30, 50, 100, 1000):
        assert log.to_percentile(x).percentile == pytest.approx(lin.to_percentile(x).percentile)
    with pytest.raises(DistributionError):
        PiecewiseDistribution("x", pts, interpolation="cubic")


def test_parse_and_format_duration():
    from rank_anything.core import format_duration, parse_duration
    assert parse_duration("25:20") == 25 * 60 + 20
    assert parse_duration("3:31", "h:mm") == 3 * 3600 + 31 * 60
    assert parse_duration("3:31:46") == parse_duration("3:31:46", "h:mm") == 12706
    assert parse_duration("3h31m") == 12660 and parse_duration("25m20s") == 1520
    assert parse_duration("25") == 1500  # bare number = minutes
    assert format_duration(1520) == "25:20" and format_duration(12706) == "3:31:46"
    with pytest.raises(DistributionError):
        parse_duration("fast")


def test_duration_distribution_from_dict():
    d = from_dict({"type": "percentile", "duration": "h:mm", "higher_is_better": False,
                   "data": {"3:00": 10, "4:00": 50, "5:00": 90}})
    assert d.to_percentile("3:30").percentile == pytest.approx(70)  # faster = better
    assert d.format_value(d.from_percentile(70).value) == "3:30:00"
    assert d.to_percentile(3.5 * 3600).percentile == pytest.approx(70)  # numbers = seconds
    with pytest.raises(DistributionError):
        from_dict({"type": "normal", "duration": "hours", "data": {"mean": 1, "std": 1}})


def test_acronyms_and_aliases():
    d = LabeledDistribution.from_frequencies(
        "rl", [("Gold 1", 1), ("Grand Champion 1", 1), ("Grand Champion 2", 1), ("Supersonic Legend", 1)],
        aliases={"SSL": "Supersonic Legend"},
    )
    assert d.find("gc 2").label == "Grand Champion 2"
    assert d.find("GC1").label == "Grand Champion 1"
    assert d.find("ssl").label == "Supersonic Legend"
    assert d.find_span("gc").label == "Grand Champion 1 – Grand Champion 2"
    with pytest.raises(DistributionError, match="unknown label"):
        LabeledDistribution.from_frequencies("x", [("A", 1)], aliases={"b": "Nope"})
