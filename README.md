# rank_anything

**What League of Legends rank is your salary?**

`rank_anything` converts a value from one statistical distribution into the
equivalent value in another: your income in CAD, your level at Meta, your SAT
score, your Valorant rank. It works by matching percentiles.

```console
$ rank-anything convert 120k --from canada-income --to lol-rank
120,000 CAD in Canadian individual income (CAD, before tax)
  = better than 91.9% (top 8.1%)
  ≈ Emerald II  (86% of the way through) in League of Legends solo queue rank
```

It has no dependencies (pure Python 3.9+ stdlib) and ships with several real
datasets. To add your own, write a small JSON file; there's a built-in prompt
for getting one out of Perplexity, ChatGPT or Claude.

---

## Install

```bash
git clone <this repo> && cd rank_anything
pip install -e .          # installs the `rank-anything` command
# or, without installing:
PYTHONPATH=src python -m rank_anything --help
```

## Quick start

```bash
rank-anything list                                           # what's available
rank-anything convert 85k --from canada-income --to lol-rank # one target
rank-anything convert E5 --from meta-level                   # compare against everything
rank-anything table --from valorant-rank --to lol-rank       # full side-by-side mapping
rank-anything show lol-rank                                  # inspect a distribution
```

## Examples

**Your Meta level in every other distribution.** Leave out `--to` to compare
against all of them:

```console
$ rank-anything convert E5 --from meta-level
E5 in Meta software engineering level
  = better than 71.5% (top 28.5%)

distribution    equivalent
--------------  -------------------------------------
canada-income   67,400 CAD
iq              108.52 IQ
lol-rank        Platinum III  (7% of the way through)
sat-score       1,173 points
us-male-height  179.72 cm
valorant-rank   Platinum 2  (12% of the way through)
```

**Game rank to game rank.** Label matching ignores case and treats roman
numerals and digits the same, and you can abbreviate. `plat 2` means
`Platinum II`, and a bare tier such as `gold` or `imm` covers the whole tier:

```console
$ rank-anything convert imm --from valorant-rank --to lol-rank
Immortal 1 – Immortal 3 in Valorant competitive rank
  = better than 99.27% (top 0.73%)
  ≈ Master  (21% of the way through) in League of Legends solo queue rank
```

**Where you sit inside a tier.** A labeled value defaults to the middle of
its band. Use `--position` to choose a point from 0 (just promoted) to 1
(about to promote):

```bash
rank-anything convert "Platinum II" --from lol-rank --to valorant-rank --position 0.9
```

**Percentiles directly.** The pseudo-distributions `percentile` ("better than
X%") and `top` ("top X%") work anywhere a distribution name is accepted:

```bash
rank-anything convert 5 --from top --to iq          # top 5% IQ → 124.67
rank-anything convert 130 --from iq --to top        # IQ 130 → top 2.28%
rank-anything convert 99 --from percentile --to canada-income
```

**Full mapping tables:**

```console
$ rank-anything table --from meta-level --to lol-rank
meta-level  better than  lol-rank
----------  -----------  -------------------------------------
E3          14%          Bronze II  (60% of the way through)
E4          43%          Gold IV  (33% of the way through)
E5          71.5%        Platinum III  (7% of the way through)
E6          90.5%        Emerald II  (18% of the way through)
E7          97.5%        Diamond II  (24% of the way through)
E8          99.45%       Master  (43% of the way through)
E9          99.9%        Master  (97% of the way through)
```

**Any JSON file, no install step:**

```bash
rank-anything convert 97k --from examples/team-salaries.json --to canada-income
```

**Scripting.** Add `--json` for machine-readable output:

```bash
rank-anything convert Challenger -f lol-rank -t valorant-rank --json
```

Numbers can be written the way people usually write them: `85000`, `85,000`,
`85k`, `$85k`, `C$85k`, `1.2M`.

## Commands

| Command | What it does |
|---|---|
| `convert VALUE -f SRC [-t DST ...] [-p POS] [--json]` | Convert a value. Repeat `-t` for several targets, or omit it to compare against all distributions. |
| `table -f SRC -t DST` | Map every label of SRC onto DST. For a numeric SRC, the rows are standard percentiles. |
| `show NAME` | Metadata plus the data table (bands, points, or standard percentiles). |
| `list` | Every built-in, user-installed and pseudo distribution. |
| `add FILE [--name N] [--force]` | Validate a JSON file and install it, so it can be used by name. |
| `validate FILE` | Check a JSON file without installing it. |
| `remove NAME` | Uninstall a user distribution. |
| `prompt "TOPIC" [--type T]` | Print an AI prompt that returns a distribution as JSON. |

`convert` can be shortened to `c` and `list` to `ls`. Run
`rank-anything COMMAND --help` for details on any command.

## Built-in distributions

| Name | Type | Source |
|---|---|---|
| `lol-rank` | labeled (Iron IV … Challenger) | [Esports Tales](https://www.esportstales.com/league-of-legends/rank-distribution-percentage-of-players-by-tier), Aug 2026, all regions |
| `valorant-rank` | labeled (Iron 1 … Radiant) | [Esports Tales](https://www.esportstales.com/valorant/rank-distribution-and-percentage-of-players-by-tier), V26 Act 5 |
| `canada-income` | numeric, CAD | [Statistics Canada](https://www150.statcan.gc.ca/n1/daily-quotidien/251031/dq251031b-eng.htm) 2023 top-1%/0.1%/0.01% cutoffs; lower percentiles are approximate |
| `meta-level` | labeled (E3 … E9) | **rough community estimate** (not official) |
| `sat-score` | numeric, 400–1600 | College Board SAT User Percentiles (via [Larry Learns](https://www.larrylearns.com/blog/sat-percentiles)) |
| `iq` | normal(100, 15) | Standard test norming |
| `us-male-height` | normal(175.4, 7.6) cm | CDC NHANES (approximate) |
| `percentile`, `top` | pseudo | "better than X%" and "top X%" |

The `examples/` folder has one file for each input format:
`team-salaries.json` (samples), `marathon-times.json` (lower is better) and
`chess-ratings.json` (numeric histogram).

## How it works

Every distribution is reduced to a monotone mapping between its values and a
**rank percentile**, meaning the share of the population you're better than
(0–100). A conversion is two lookups:

```
value ──source──▶ percentile ──target──▶ equivalent value
```

When the value you ask about isn't one of the known points, the tool
**interpolates**:

- **Numeric distributions** (income, SAT, samples) are piecewise-linear
  between known points. For example, if C$45,000 is the 50th percentile and
  C$54,000 is the 60th, then C$49,500 is the 55th.
- **Labeled distributions** (ranks, levels) give each label a band of
  percentiles, and positions inside a band are interpolated linearly. Gold II
  covers the 54.6th–60th percentiles, so the 57.3rd percentile is Gold II, 50%
  of the way through.
- **Parametric distributions** (`normal`, `lognormal`) use the exact CDF.

A value outside the known data range is clamped to the nearest end and marked
`[outside known range, clamped]`.

## Adding your own distribution

A distribution is a JSON file. `type` must be one of the five formats below,
and `data` holds the numbers.

```jsonc
{
  "name": "my-dist",              // required: id used on the command line
  "type": "frequency",            // required: frequency | percentile | samples | normal | lognormal
  "data": { ... },                // required: see below
  "title": "Human readable name", // optional metadata ↓
  "description": "Who/where/when this covers",
  "unit": "USD",
  "source": "https://...",
  "date": "2026",
  "higher_is_better": true        // numeric only: set false for e.g. race times
}
```

### 1. `frequency`: `label: frequency`

Give the share of the population in each category, ordered **from worst to
best**. The values can be percentages or raw counts, and they don't need to
add up to 100.

```json
{ "name": "lol-rank", "type": "frequency",
  "data": { "Iron IV": 0.38, "Iron III": 0.42, "Gold IV": 8.3, "Challenger": 0.023 } }
```

If every key is a number (for example rating buckets such as `"1200": 13`),
the data is treated as a numeric histogram and values between buckets are
interpolated. See `examples/chess-ratings.json`.

### 2. `percentile`: `label: percentile`

Give known values and the percentile at each. Keys can be numbers, which are
interpolated between, or labels, which become bands. Set `percentile_kind` to
match how your source reports the numbers:

- `"below"` (the default) means X% of people are below this value.
- `"top"` means this value and above make up the top X%.

```json
{ "name": "canada-income", "type": "percentile", "percentile_kind": "below", "unit": "CAD",
  "data": { "0": 0, "45000": 50, "108000": 90, "293800": 99, "930100": 99.9 } }
```

```json
{ "name": "meta-level", "type": "percentile", "percentile_kind": "top",
  "data": { "E3": 100, "E4": 72, "E5": 42, "E6": 15, "E7": 4, "E8": 0.9, "E9": 0.2 } }
```

With labels, each label's band starts at its percentile and ends where the
next label begins.

### 3. `samples`: a list of numbers

Give the raw observations. The smallest is the 0th percentile, the largest
the 100th, and everything in between is interpolated.

```json
{ "name": "team-salaries", "type": "samples", "unit": "USD",
  "data": [68000, 72000, 85000, 91000, 104000, 150000] }
```

### 4. `normal` / `lognormal`

```json
{ "name": "iq", "type": "normal", "data": { "mean": 100, "std": 15 } }
{ "name": "incomes", "type": "lognormal", "data": { "median": 60000, "sigma": 0.8 } }
```

`data` can also be written as a list of pairs, `[["Iron IV", 0.38], ...]`, if
you want the order to be explicit.

Then:

```bash
rank-anything validate my-dist.json   # check it
rank-anything add my-dist.json        # install → usable as `-f my-dist`
```

Installed files go to `~/.rank_anything/distributions/`. Set
`RANK_ANYTHING_HOME` to use a different location. A user distribution with
the same name as a built-in one takes precedence.

## Getting distributions from AI tools

`rank-anything prompt` prints a prompt that asks an AI assistant (Perplexity
works well because it cites sources) to return the data as valid JSON:

```bash
rank-anything prompt "Chess.com rapid ratings" --type frequency | pbcopy
rank-anything prompt "US household income, 2025"                # let the AI pick the format
```

Paste the prompt into the assistant, save the JSON it returns to a file, then
run `rank-anything validate file.json` and `rank-anything add file.json`.
Check the numbers against the cited sources, because AI tools do sometimes
make up statistics.

## Python API

```python
import rank_anything as ra

c = ra.convert("85k", "canada-income", "lol-rank")
c.percentile                   # 81.48...
c.target_placement.value       # 'Platinum I'
c.target_placement.position    # 0.74  (how far through the tier)

ra.percentile("E6", "meta-level")        # 90.5
ra.load("examples/marathon-times.json")  # any JSON path works
ra.from_dict({"type": "normal", "data": {"mean": 0, "std": 1}})
```

## Development

```bash
pip install -e '.[dev]'
pytest
```

## Caveats

The results are only as good as the input data. Game-rank shares change every
season, the `meta-level` numbers are estimates, and comparing two different
populations by percentile is a fun heuristic rather than a statement about
skill. Keep that in mind when you tell your friends what rank your salary is.
