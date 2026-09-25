# Rank Anything!

**What League of Legends rank is your income?**

`rank_anything` converts a value from one statistical distribution into the equivalent value in another: your income in CAD, your SAT score, your Valorant rank. It works by matching percentiles.

```console
$ rank-anything convert 120k --from canada-income --to lol-rank
120,000 CAD in Canadian individual income (CAD, before tax)
  = better than 91.9% (top 8.1%)
  ≈ Emerald II  (86% of the way through) in League of Legends solo queue rank
```

It's written in TypeScript and ships with
several real datasets. Use it as a command-line tool, or as a library in Node
or in the browser: the whole thing runs client-side, with the datasets
embedded. To add your own, write a small JSON file; there's a built-in prompt
for getting one out of Perplexity, ChatGPT or Claude.

---

## Install

Needs Node.js 18 or newer.

```bash
npm install -g rank-anything   # installs the `rank-anything` command
# or run it once without installing:
npx rank-anything --help
```

To use it as a library, `npm install rank-anything`; see
[Library use](#library-use-node-and-browser).

From source:

```bash
git clone https://github.com/szge/rank_anything.git && cd rank_anything
npm install               # also builds dist/
npm link                  # installs the `rank-anything` command
# or, without installing:
node dist/bin.js --help
node src/bin.ts --help    # straight from source, on Node 22.18+
```

## Quick start

```bash
rank-anything list                                           # what's available
rank-anything convert 85k --from canada-income --to lol-rank # one target
rank-anything convert E5 --from meta-level                   # compare against everything
rank-anything convert 1520 --from sat-score --to lol-rank --raw  # just the answer: Diamond II
rank-anything percentile 1520 --from sat-score               # just the percentile: 97.6
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

**Game ranks, chess and running:**

```console
$ rank-anything convert gold --from lol-rank --to lichess-rapid --to dota2-rank --to cs2-premier
Gold IV – Gold I in League of Legends solo queue rank
  = better than 52% (top 48%)

distribution   equivalent
-------------  ----------------------------------
lichess-rapid  1,422 rating
dota2-rank     Archon 1  (34% of the way through)
cs2-premier    12,240 rating

$ rank-anything convert 25:20 --from 5k-time --to marathon-time
25:20 in 5K race finish time
  = better than 90% (top 10%)
  ≈ 3:31:46 in Marathon finish time
```

Common abbreviations work too. Acronyms such as `gc 2` (Grand Champion 2) are
matched automatically, and nicknames such as `SSL`, `GM` and `pred` are
defined as aliases in the dataset files.

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

**Any file, no install step.** Pass a `.json` distribution, or a `.csv` /
`.txt` file containing a list of numbers:

```bash
rank-anything convert 97k --from examples/team-salaries.json --to canada-income
rank-anything convert 97k --from examples/team-salaries.csv --to lol-rank
```

**Scripting.** For output you can pipe into other programs, add `--raw`
to print only the equivalent value, or use `percentile` to print only the
percentile, as a bare number:

```console
$ rank-anything convert 1520 --from sat-score --to lol-rank --raw
Diamond II

$ rank-anything percentile 1520 --from sat-score
97.6

$ rank-anything percentile 1520 --from sat-score --top
2.4
```

With several targets (or none, which compares against all), `--raw` prints
one `name<TAB>value` line per target. Numbers come out without units or
thousands separators, times as clock times, and percentiles without `%`:

```console
$ rank-anything convert 1520 -f sat-score -t lol-rank -t canada-income -t percentile -t marathon-time --raw
lol-rank	Diamond II
canada-income	239970
percentile	97.6
marathon-time	2:57:10
```

For everything at once (unrounded percentile, position within a tier, and
whether a value was clamped or extrapolated), add `--json` instead:

```bash
rank-anything convert Challenger -f lol-rank -t valorant-rank --json
```

Numbers can be written the way people usually write them: `85000`, `85,000`,
`85k`, `$85k`, `C$85k`, `1.2M`.

## Commands

| Command | What it does |
|---|---|
| `convert VALUE -f SRC [-t DST ...] [-p POS] [--json \| --raw]` | Convert a value. Repeat `-t` for several targets, or omit it to compare against all distributions. `--raw` prints only the equivalent value(s). |
| `percentile VALUE -f SRC [-p POS] [--top]` | Print just the percentile of a value ("better than X%"), or with `--top` the top X%, as a bare number. |
| `table -f SRC -t DST` | Map every label of SRC onto DST. For a numeric SRC, the rows are standard percentiles. |
| `show NAME` | Metadata plus the data table (bands, points, or standard percentiles). |
| `list` | Every built-in, user-installed and pseudo distribution. |
| `import FILE [-c COL] [--unit U] [--lower-is-better] [-o OUT \| --add]` | Turn a `.csv`/`.tsv`/`.txt` of numbers into a JSON distribution, or install it directly with `--add`. |
| `add FILE [--name N] [--force]` | Validate a distribution (`.json`, or a `.csv`/`.txt` of numbers) and install it, so it can be used by name. |
| `validate FILE` | Check a distribution file without installing it. |
| `remove NAME` | Uninstall a user distribution. |
| `prompt "TOPIC" [--type T]` | Print an AI prompt that returns a distribution as JSON. |

`convert` can be shortened to `c` and `list` to `ls`. Run
`rank-anything COMMAND --help` for details on any command.

## Built-in distributions

Run `rank-anything list` to see them all, and `rank-anything show NAME` for
the data and the source of any one.

**Competitive games**

| Name | Values | Source |
|---|---|---|
| `lol-rank` | Iron IV … Challenger | [Esports Tales](https://www.esportstales.com/league-of-legends/rank-distribution-percentage-of-players-by-tier), Aug 2026, all regions |
| `valorant-rank` | Iron 1 … Radiant | [Esports Tales](https://www.esportstales.com/valorant/rank-distribution-and-percentage-of-players-by-tier), V26 Act 5 |
| `dota2-rank` | Herald 1 … Immortal | [Esports Tales](https://www.esportstales.com/dota-2/seasonal-rank-distribution-and-mmr-medals) (Stratz / Valve API), Aug 2026 |
| `cs2-premier` | Premier rating | [Esports Tales](https://www.esportstales.com/csgo/rank-distribution-and-percentage-of-players) (Leetify), Jul 2026 |
| `overwatch-rank` | Bronze … Champion (tiers only) | [Esports Tales](https://www.esportstales.com/overwatch/competitive-rank-distribution-pc-and-console), Season 17, Jul 2025 (latest published) |
| `rocket-league-rank` | Bronze 1 … Supersonic Legend | [Esports Tales](https://www.esportstales.com/rocket-league/seasonal-rank-distribution-and-players-percentage-by-tier), Ranked Doubles, Season 22 |
| `apex-rank` | Rookie IV … Apex Predator | [Esports Tales](https://www.esportstales.com/apex-legends/rank-distribution-and-percentage-of-players-by-tier), Season 30 |
| `r6-rank` | Copper 5 … Champion | [Esports Tales](https://www.esportstales.com/rainbow-six-siege/seasonal-rank-distribution-and-percentage-of-players) (official Ubisoft data), Y10S3 |
| `lichess-blitz`, `lichess-rapid` | rating | [Lichess](https://lichess.org/stat/rating/distribution/blitz) live stats: every player active that week |
| `chesscom-rapid` | rating | **approximate**: community-reported ranges; Chess.com doesn't publish its distribution |
| `github-stars` | stars | [GitHub search](https://docs.github.com/en/rest/search/search) counts of repos with ≥ N stars; population = the 32M public repos with at least 1 star |
| `monkeytype-wpm` | words per minute | [Monkeytype API](https://api.monkeytype.com/public/speedHistogram?language=english&mode=time&mode2=60): 60-second English personal bests. People who use a typing-test site type faster than average. |

**Fitness and body**

| Name | Values | Source |
|---|---|---|
| `5k-time` | e.g. `25:20` | [RunRepeat](https://runrepeat.com/how-do-you-masure-up-the-runners-percentile-calculator): 35M race results, all runners |
| `marathon-time` | e.g. `3:45` or `3:45:30` | same as above |
| `us-male-height` | normal(175.4, 7.6) cm | CDC NHANES (approximate) |
| `us-female-height` | normal(161.3, 7.1) cm | CDC NHANES 2015–2018 (approximate) |

**Money, work and school**

| Name | Values | Source |
|---|---|---|
| `us-income` | USD | US individual income (adjusted gross income on individual tax returns), 2023. Median and up: [IRS Table 4.1](https://www.irs.gov/statistics/soi-tax-stats-individual-statistical-tables-by-tax-rate-and-income-percentile) percentile floors, to the top 0.001%. Below median: [IRS Table 1.1](https://www.irs.gov/statistics/soi-tax-stats-individual-statistical-tables-by-size-of-adjusted-gross-income). Method: `scripts/build_us_income.ts` |
| `us-net-worth` | USD | Household net worth, 2022 [Survey of Consumer Finances](https://www.federalreserve.gov/econres/scfindex.htm) (Federal Reserve): weighted percentiles computed from the public microdata. Method: `scripts/build_net_worth.ts` |
| `canada-net-worth` | CAD | Family net worth, 2023 [Survey of Financial Security](https://www150.statcan.gc.ca/n1/pub/13m0006x/13m0006x2021001-eng.htm) (Statistics Canada) microdata; top 1% from the [Parliamentary Budget Officer](https://www.pbo-dpb.ca/en/publications/RP-2526-009-S--estimating-top-tail-family-wealth-distribution-in-canada-2025-update--estimation-extremite-superieure-distribution-patrimoine-familial-canada-mises-jour-2025) |
| `credit-score` | 300–850 | FICO Score 8 by range, [Experian](https://www.experian.com/blogs/ask-experian/what-is-the-average-credit-score-in-the-u-s/), Sep 2025 (only 5 ranges published) |
| `canada-income` | CAD | [Statistics Canada](https://www150.statcan.gc.ca/n1/daily-quotidien/251031/dq251031b-eng.htm) 2023 top-1%/0.1%/0.01% cutoffs; lower percentiles are approximate |
| `meta-level` | E3 … E9 | **rough community estimate** (not official) |
| `sat-score` | 400–1600 | College Board SAT User Percentiles (via [Larry Learns](https://www.larrylearns.com/blog/sat-percentiles)) |
| `act-score` | 1–36 | [ACT National Ranks](https://www.act.org/content/act/en/products-and-services/the-act/scores/national-ranks.html), Composite, 2026–27 |
| `gre-verbal`, `gre-quant` | 130–170 | [ETS GRE interpretive data](https://www.ets.org/pdfs/gre/gre-guide-table-1a.pdf), Jul 2022–Jun 2025 |
| `lsat-score` | 120–180 | [LSAC percentile table](https://www.lsac.org/data-research/data/lsat-percentiles), 2023–2026 |
| `mcat-score` | 472–528 | [AAMC percentile ranks](https://students-residents.aamc.org/media/19701/download), in effect May 2026–Apr 2027 |
| `iq` | normal(100, 15) | Standard test norming |

**Pseudo-distributions:** `percentile` ("better than X%") and `top` ("top X%").

**Refreshing data.** The scripts in `scripts/` rebuild datasets from their
sources (run them with `node scripts/NAME.ts` on Node 22.18+, or add `--out DIR` to write
somewhere other than `data/`). `build_live_stats.ts` fetches Lichess and Monkeytype,
`build_github_stars.ts` queries GitHub search, and `build_net_worth.ts`
recomputes net worth from the Fed and Statistics Canada microdata.
`build_test_scores.ts` and `build_us_income.ts` hold the published tables.
Every other dataset is a fixed snapshot whose `source` field says where to
look for newer figures.

Test scores use "% of test takers scoring below", so a percentile reads as
"better than X%". ACT and MCAT publish "% at or below", which is converted
exactly. Scores outside a test's scale are clamped.

**Leaderboards (speedruns etc.).** There's no general speedrun distribution,
because every game and category has its own leaderboard. Export a leaderboard's
times to a CSV and use it directly with
`rank-anything import times.csv --lower-is-better`.

The `examples/` folder has one file for each input format:
`team-salaries.json` (samples), `marathon-times.json` (lower is better),
`chess-ratings.json` (numeric histogram), `team-salaries.csv` (a spreadsheet
export) and `5k-times.txt` (a plain list of numbers).

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

### Values beyond the known data

Numeric data only covers a limited range. For example, the highest income
point is the top 0.01% cutoff, C$3.49M. Past the outermost known points, the
tool **extends the distribution's tail** instead of stopping. It fits the tail
to the last two known points, so extreme values still get different
percentiles:

```console
$ rank-anything convert 12M --from canada-income --to lol-rank
12,000,000 CAD  [beyond known data, extrapolated] in Canadian individual income (CAD, before tax)
  = better than 99.9988% (top 0.0012%)
  ≈ Challenger  (95% of the way through) in League of Legends solo queue rank

$ rank-anything convert 1.2B --from canada-income --to lol-rank
1,200,000,000 CAD  [beyond known data, extrapolated] in Canadian individual income (CAD, before tax)
  = better than 99.99999962% (top 0.00000038%)
  ≈ Challenger  (100% of the way through) in League of Legends solo queue rank
```

Which tail is used depends on the data (the `"tail"` field in the JSON):

| `tail` | Behaviour past the last point | Used when (`"auto"`, the default) |
|---|---|---|
| `pareto` | the share beyond *x* falls off as a power of *x* (a power law). This suits incomes, wealth, follower counts. | the outermost values are positive |
| `exponential` | the share beyond *x* falls off exponentially with distance | values can be zero or negative |
| `clamp` | pinned to the endpoint | an endpoint is at 0% or 100%, which marks a hard limit (e.g. SAT 1600) |

### Sparse top-end data: `"interpolation": "loglog"`

Income-like data often has only a few widely spaced points near the top, for
example $675,602 (top 1%) and $3,100,950 (top 0.1%). A straight line between
two such points overstates the values in between: it puts the top-0.5% cutoff
at ~$2.02M instead of ~$1.07M. Setting `"interpolation": "loglog"` makes every
segment above the median follow the power law through its two endpoints (the
same Pareto shape used for the tail). Segments below the median stay linear.
`us-income` uses this setting.

Clamped results are marked `[outside known range, clamped]` and extrapolated
ones `[beyond known data, extrapolated]`. Extrapolated results are estimates:
the further they are from the data, the less reliable they get.

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
  "higher_is_better": true,       // numeric only: set false for e.g. race times
  "tail": "auto",                 // numeric points only: auto | pareto | exponential | clamp
  "interpolation": "linear",      // numeric points only: linear | loglog (see below)
  "duration": "mm:ss",            // numeric only: values are times (see below)
  "aliases": { "SSL": "Supersonic Legend" }  // labeled only: extra names for labels
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

Give the raw observations. **Order doesn't matter:** the numbers are sorted
for you, so you can paste them in any order. Duplicates are fine too.

```json
{ "name": "team-salaries", "type": "samples", "unit": "USD",
  "data": [104000, 68000, 150000, 85000, 72000, 91000] }
```

With *n* samples, each one is placed at the middle of its 1/*n* share of the
population, so the smallest of 10 samples is the 5th percentile and the
largest is the 95th. Values in between are interpolated, and values past the
smallest or largest sample follow the fitted tail.

If your numbers are in a spreadsheet or text file, you don't need to write
this JSON by hand. See [From a CSV or text file](#from-a-csv-or-text-file).

### 4. `normal` / `lognormal`

```json
{ "name": "iq", "type": "normal", "data": { "mean": 100, "std": 15 } }
{ "name": "incomes", "type": "lognormal", "data": { "median": 60000, "sigma": 0.8 } }
```

### Times (race results, speedruns)

Add `"duration": "mm:ss"` or `"duration": "h:mm"` and write the values as
clock times. They're stored in seconds and shown as clock times. Input accepts
`25:20`, `1:02:03`, `3h31m`, `25m20s`, or a bare number of minutes. The style
decides how a two-part time is read: `3:31` is 3 min 31 s with `mm:ss`, and
3 h 31 min with `h:mm`. Add `"higher_is_better": false` when faster is better.

```json
{ "name": "5k-time", "type": "percentile", "duration": "mm:ss", "higher_is_better": false,
  "data": { "18:40": 1, "25:20": 10, "34:37": 50, "50:04": 90 } }
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

### From a CSV or text file

If you have a pile of raw numbers (a spreadsheet export, a column of survey
answers, times copied from a results page), use the file as it is. As with
`samples`, **the order of the numbers doesn't matter.**

**Use it directly.** A `.csv`, `.tsv` or `.txt` path works anywhere a
distribution name does:

```bash
rank-anything convert 97k --from examples/team-salaries.csv --to lol-rank
```

**Or import it** to save it as a named distribution, with a unit and a
direction:

```console
$ rank-anything import examples/5k-times.txt --name parkrun --unit min --lower-is-better --add
Imported 15 values and installed 'parkrun' -> ~/.rank_anything/distributions/parkrun.json

$ rank-anything convert 20 --from parkrun --to lol-rank
20 min in parkrun
  = better than 89.3% (top 10.7%)
  ≈ Emerald III  (70% of the way through) in League of Legends solo queue rank
```

Leave out `--add` to write `NAME.json` for you to review or edit first. Use
`-o out.json` to choose the path, or `-o -` to print to stdout.

What the importer accepts:

- **`.txt`**: numbers one per line, or separated by spaces, tabs, commas or
  semicolons. Lines starting with `#` are comments. Thousands separators such
  as `85,000` are read as one number.
- **`.csv` / `.tsv`**: one column of numbers is used. A header row is
  detected and skipped automatically, as are blank cells. If the file has
  several numeric columns, choose one with `--column salary` (header name) or
  `--column 3` (1-based position).
- **Number formats**: `85000`, `85,000`, `$85,000`, `85k`, `1.2M`, `1.5e3`.

```text
# examples/5k-times.txt
24.5 31.2 19.8 27.0 22.1
35.4, 28.3, 21.7, 26.4, 30.0
18.9
```

```text
# examples/team-salaries.csv: the only numeric column (salary) is picked automatically
name,team,salary
Ana,Platform,"$104,000"
Ben,Platform,"$85,000"
```

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

## Library use (Node and browser)

```ts
import { convert, percentile, load, fromDict } from "rank-anything";

const c = convert("85k", "canada-income", "lol-rank");
c.percentile;                     // 81.48...
c.targetPlacement.value;          // 'Platinum I'
c.targetPlacement.position;       // 0.74  (how far through the tier)

percentile("E6", "meta-level");   // 90.5
fromDict({ type: "normal", data: { mean: 0, std: 1 } });
```

There are three entry points:

| Import | Contents | Runs in |
|---|---|---|
| `rank-anything` | Everything below, plus the built-in datasets (about 26 KB of JSON). | browser, Node, workers |
| `rank-anything/core` | The same, without the built-in datasets: bring your own data. | browser, Node, workers |
| `rank-anything/node` | Also loads file paths (`load("examples/marathon-times.json")`) and the user directory that `rank-anything add` installs into. This is what the CLI uses. | Node |

A pre-bundled ES module for a plain `<script type="module">`, with no build
step, is at `dist/browser/rank-anything.js` (also exported as
`rank-anything/browser`). `examples/web/index.html` is a small demo page that
uses it, including adding a dataset from an uploaded file.

**Your own data in the browser.** User distributions live in memory in a
`Registry`. The default one behind `convert`, `load` and friends is exported as
`registry`:

```ts
import { registry, specFromText, convertMany, describe } from "rank-anything";

// From an object, from JSON text, or from an uploaded .json/.csv/.txt file
registry.add({ name: "team", type: "samples", data: [68000, 85000, 97000, 150000] });
registry.add(specFromText(await file.text(), file.name));

const { placement, results } = convertMany("90k", "team");   // against every distribution
for (const c of results) console.log(c.target.name, describe(c.target, c.targetPlacement));
```

Use `new Registry({ builtins: BUILTIN_SPECS })` for a separate set, or
`new Registry()` from `rank-anything/core` for one with no built-ins.
`describe`, `rankLine`, `dataTable` and `mappingTable` produce the same text
and tables as the CLI, for showing results in a UI.

One JavaScript quirk: objects list integer-like keys (`"10"`, `"2"`) first,
whatever order they were written in. That matters for labeled `frequency`
data, where the order is the ranking. JSON text passed to `registry.add`,
`specFromText` or `parseJson` keeps its original order. If you build a spec
as a JS object with integer-like labels, write `data` as a list of pairs
instead.

## Development

```bash
npm install
npm test            # vitest
npm run typecheck   # also checks that the browser entry points don't use Node APIs
npm run build       # dist/: compiled modules, type declarations, browser bundle
npm run gen         # after editing data/*.json: re-embed the datasets in src/builtins.ts
```

`tests/golden.test.ts` checks CLI output byte for byte, and the math, parsing
and label matching, against recorded reference outputs
(`tests/fixtures/golden.json`).

## Caveats

The results are only as good as the input data. Game-rank shares change every
season.