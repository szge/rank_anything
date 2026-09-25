import json

import pytest

from rank_anything.cli import fmt_pct, main


def run(capsys, *argv):
    code = main(list(argv))
    out = capsys.readouterr()
    return code, out.out, out.err


def test_convert_single_target(capsys):
    code, out, _ = run(capsys, "convert", "85k", "--from", "canada-income", "--to", "lol-rank")
    assert code == 0
    assert "Platinum I" in out and "top 18.5%" in out


def test_convert_all_targets(capsys):
    code, out, _ = run(capsys, "convert", "E6", "-f", "meta-level")
    assert code == 0
    for name in ("lol-rank", "valorant-rank", "iq", "canada-income"):
        assert name in out


def test_convert_json(capsys):
    code, out, _ = run(capsys, "convert", "Challenger", "-f", "lol-rank", "-t", "valorant-rank", "--json")
    data = json.loads(out)
    assert data["results"][0]["value"] == "Radiant"
    assert data["percentile"] > 99.9


def test_tier_prefix(capsys):
    code, out, _ = run(capsys, "convert", "plat 2", "-f", "lol-rank", "-t", "percentile")
    assert code == 0 and "Platinum II" in out


def test_errors_are_friendly(capsys):
    code, _, err = run(capsys, "convert", "banana", "-f", "lol-rank", "-t", "iq")
    assert code == 2 and "unknown label" in err
    code, _, err = run(capsys, "convert", "1", "-f", "nope", "-t", "iq")
    assert code == 2 and "Unknown distribution" in err


def test_show_table_list_prompt(capsys):
    assert run(capsys, "show", "lol-rank")[1].count("\n") > 30
    assert "E9" in run(capsys, "table", "-f", "meta-level", "-t", "lol-rank")[1]
    assert "sat-score" in run(capsys, "list")[1]
    assert '"type"' in run(capsys, "prompt", "US household income")[1]


def test_add_validate_remove(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RANK_ANYTHING_HOME", str(tmp_path))
    f = tmp_path / "mine.json"
    f.write_text(json.dumps({"name": "mine", "type": "samples", "data": [1, 2, 3, 4]}))
    assert run(capsys, "validate", str(f))[0] == 0
    assert run(capsys, "add", str(f))[0] == 0
    assert run(capsys, "add", str(f))[0] == 2  # already exists
    code, out, _ = run(capsys, "convert", "3", "-f", "mine", "-t", "percentile")
    assert code == 0 and "62.5%" in out
    assert run(capsys, "remove", "mine")[0] == 0


def test_json_path_directly(capsys):
    code, out, _ = run(capsys, "convert", "240", "-f", "examples/marathon-times.json", "-t", "percentile")
    assert code == 0 and "better than 62%" in out  # lower time is better


@pytest.mark.parametrize("p,s", [
    (50, "50%"), (81.48, "81.5%"), (99.9, "99.9%"), (99.977, "99.977%"), (0.38, "0.38%"),
    (99.998841, "99.9988%"), (99.99999962, "99.99999962%"), (100, "100%"),
])
def test_fmt_pct(p, s):
    assert fmt_pct(p) == s


def test_extreme_values_stay_distinct(capsys):
    outs = [run(capsys, "convert", v, "-f", "canada-income", "-t", "lol-rank")[1]
            for v in ("12000000", "1200000000")]
    assert outs[0] != outs[1]
    assert all("extrapolated" in o for o in outs)
