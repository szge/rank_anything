import math

import pytest

import rank_anything as ra


@pytest.mark.parametrize("name", list(ra.available()))
def test_every_distribution_loads_and_round_trips(name):
    d = ra.load(name)
    for p in (1, 25, 50, 75, 99):
        placed = d.from_percentile(p)
        if placed.clamped:  # e.g. 11% of GRE Quant takers score 170: no value above 89%
            continue
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


def test_published_anchor_points():
    # RunRepeat: 25:20 is the 10th-fastest percentile, i.e. better than 90%.
    assert ra.percentile("25:20", "5k-time") == pytest.approx(90)
    assert ra.percentile("4:26:33", "marathon-time") == pytest.approx(50)
    assert ra.percentile("4:26", "marathon-time") > 50  # h:mm, slightly faster than median
    # Dota 2: Immortal = everything above Divine 5's cumulative 95.56%.
    assert ra.percentile("Immortal", "dota2-rank", position=0) == pytest.approx(95.56)
    # Rocket League is published as "this rank or higher".
    assert ra.percentile("SSL", "rocket-league-rank", position=0) == pytest.approx(100 - 0.038)
    assert ra.percentile("Bronze 1", "rocket-league-rank", position=0) == pytest.approx(0)
    # R6 labels count down within a tier: Copper 5 is the lowest rank.
    assert ra.load("r6-rank").labels[0] == "Copper 5"


def test_live_stats_are_sane():
    for name in ("lichess-blitz", "lichess-rapid", "monkeytype-wpm"):
        d = ra.load(name)
        assert d.from_percentile(10).value < d.from_percentile(50).value < d.from_percentile(90).value
    assert 1000 < ra.convert(50, "percentile", "lichess-blitz").target_placement.value < 2000
    assert 40 < ra.convert(50, "percentile", "monkeytype-wpm").target_placement.value < 120


def test_official_test_score_tables():
    # "At or below" tables are converted to "% below": ACT 22 is 72 at-or-below, so 68 below.
    assert ra.percentile(22, "act-score") == pytest.approx(68)
    assert ra.percentile(508, "mcat-score") == pytest.approx(71)
    assert ra.percentile(154, "lsat-score") == pytest.approx(50.43)
    assert ra.percentile(170, "gre-quant") == pytest.approx(89)
    assert ra.percentile(130, "gre-verbal") == pytest.approx(0)
    # Scores off the scale are clamped, not extrapolated.
    assert ra.load("lsat-score").to_percentile(190).clamped
    assert ra.percentile(740, "credit-score") == pytest.approx(49.7)


def test_net_worth_and_github_stars():
    assert ra.percentile(192_700, "us-net-worth") == pytest.approx(50)
    assert ra.percentile(519_450, "canada-net-worth") == pytest.approx(50)
    assert ra.percentile("7.4M", "canada-net-worth") == pytest.approx(99)  # PBO anchor
    assert ra.percentile(-5_000, "us-net-worth") < 10  # debts > assets
    assert ra.percentile(1, "github-stars") == 0  # population: repos with 1+ stars
    assert ra.percentile(10, "github-stars") < ra.percentile(1000, "github-stars") < 100
