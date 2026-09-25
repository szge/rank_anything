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


def test_unknown_name_suggests():
    with pytest.raises(ra.DistributionError, match="lol-rank"):
        ra.load("lol")
