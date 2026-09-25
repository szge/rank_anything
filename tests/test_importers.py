import json

import pytest

import rank_anything as ra
from rank_anything.cli import main
from rank_anything.importers import numbers_from_table, numbers_from_text, read_numbers, samples_spec


def test_text_separators_comments_and_thousands():
    text = "# header comment\n1 2\t3;4\n5, 6,7\n85,000  $1,250,000\n\n1.5e3 # trailing\n"
    assert numbers_from_text(text) == [1, 2, 3, 4, 5, 6, 7, 85000, 1250000, 1500]


def test_text_rejects_garbage():
    with pytest.raises(ra.DistributionError, match="line 2"):
        numbers_from_text("1\nbanana\n")


def test_table_picks_only_numeric_column_and_skips_header():
    text = 'name,salary\nAna,"$104,000"\nBen,85k\n,\n'
    assert numbers_from_table(text) == [104000, 85000]


def test_table_without_header():
    assert numbers_from_table("3\n1\n2\n") == [3, 1, 2]


def test_table_column_by_name_or_index():
    text = "a;b\n1;10\n2;20\n"
    assert numbers_from_table(text, "b") == [10, 20]
    assert numbers_from_table(text, "1") == [1, 2]
    with pytest.raises(ra.DistributionError, match="--column"):
        numbers_from_table(text)
    with pytest.raises(ra.DistributionError, match="no column"):
        numbers_from_table(text, "c")


def test_order_does_not_matter(tmp_path):
    a, b = tmp_path / "a.txt", tmp_path / "b.txt"
    a.write_text("5 1 4 2 3")
    b.write_text("1 2 3 4 5")
    for x in (0.5, 2.5, 4.2, 9):
        assert ra.percentile(x, str(a)) == ra.percentile(x, str(b))


def test_csv_and_txt_load_directly():
    assert ra.load("examples/team-salaries.csv").kind == "numeric"
    assert ra.percentile(97000, "examples/team-salaries.csv") == pytest.approx(
        ra.percentile(97000, "examples/team-salaries.json"))
    assert len(read_numbers("examples/5k-times.txt")) == 15


def test_samples_spec_metadata(tmp_path):
    f = tmp_path / "My Race Times.txt"
    f.write_text("20 25 30")
    spec = samples_spec(f, unit="min", higher_is_better=False)
    assert spec["name"] == "my-race-times"
    assert spec["higher_is_better"] is False and spec["data"] == [20, 25, 30]
    assert ra.from_dict(spec).to_percentile(20).percentile > 50  # faster = better


def test_cli_import_writes_json_and_add_installs(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("RANK_ANYTHING_HOME", str(tmp_path / "home"))
    out = tmp_path / "salaries.json"
    assert main(["import", "examples/team-salaries.csv", "--unit", "USD", "-o", str(out)]) == 0
    spec = json.loads(out.read_text())
    assert spec["type"] == "samples" and len(spec["data"]) == 12
    assert main(["import", "examples/team-salaries.csv", "-o", str(out)]) == 2  # exists

    assert main(["import", "examples/5k-times.txt", "--name", "parkrun", "--lower-is-better", "--add"]) == 0
    assert "parkrun" in ra.available()
    assert main(["convert", "20", "-f", "parkrun", "-t", "percentile"]) == 0
    assert "better than 89.3%" in capsys.readouterr().out


def test_cli_add_accepts_csv(tmp_path, monkeypatch):
    monkeypatch.setenv("RANK_ANYTHING_HOME", str(tmp_path))
    assert main(["add", "examples/team-salaries.csv", "--name", "salaries"]) == 0
    assert json.loads((tmp_path / "distributions" / "salaries.json").read_text())["name"] == "salaries"
