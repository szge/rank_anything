import math

import pytest

import rank_anything as ra


@pytest.mark.parametrize("name", list(ra.available()))
def test_every_distribution_loads_and_round_trips(name):
    d = ra.load(name)
    for p in (1, 25, 50, 75, 99):
        placed = d.from_percentile(p)
        back = d.to_percentile(placed.value, position=placed.position or 0.5)
        assert back.percentile == pytest.approx(p, abs=1e-6)


def test_percentile_and_top_pseudo():
    assert ra.convert(90, "percentile", "top").target_placement.value == pytest.approx(10)
    assert ra.percentile(5, "top") == pytest.approx(95)


def test_known_conversions():
    assert ra.convert(50, "percentile", "lol-rank").target_placement.value == "Gold III"
    assert ra.convert("Challenger", "lol-rank", "valorant-rank").target_placement.value == "Radiant"
    assert ra.convert(3_487_600, "canada-income", "percentile").target_placement.value == pytest.approx(99.99)
    assert ra.convert("E3", "meta-level", "meta-level").target_placement.value == "E3"
    # Between the IRS top-25% and top-20% floors, the share above follows a power law.
    a = math.log(25 / 20) / math.log(123406 / 105604)
    assert ra.percentile("$115k", "us-income") == pytest.approx(100 - 25 * (115000 / 105604) ** -a)
    # us-income: IRS Table 4.1 floors are exact percentile anchors.
    assert ra.percentile(53_801, "us-income") == pytest.approx(50)
    assert ra.percentile(675_602, "us-income") == pytest.approx(99)
    assert ra.percentile(78_617_933, "us-income") == pytest.approx(99.999)
    beyond = ra.load("us-income").to_percentile("1B")
    assert beyond.extrapolated and 99.999 < beyond.percentile < 100
    assert ra.percentile("1M", "us-income") > ra.percentile("700k", "us-income") > 99


def test_unknown_name_suggests():
    with pytest.raises(ra.DistributionError, match="lol-rank"):
        ra.load("lol")
