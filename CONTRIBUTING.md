# Contributing

The most useful contribution is a new dataset. Every distribution added to
`data/` can be converted to and from every other one, so each new one makes
the whole tool better. Games, exams, sports, finances, body measurements and
anything else people like to compare themselves on are all welcome.

Bug fixes, corrections to existing data and refreshed numbers are welcome too.
For bigger code changes, please open an issue first so we can agree on the
approach.

## Adding a dataset

### What makes a good dataset

- **A real, citable source.** An official statistics office, a game
  developer's published distribution, a test maker's percentile tables, a
  public API or a well-known tracker site. Please don't submit numbers that
  an AI came up with, or community guesses. If the best available source is
  rough, say so in the `title` and `description`, as `chesscom-rapid` does.
- **A clearly defined population.** Who is counted (all ranked players?
  tax filers? test takers in 2024-25?), where, and when. The same measure can
  look very different across populations, so it has to be clear which one
  this is.
- **Enough points to follow the shape.** Percentile tables, rank shares or
  histograms are best. A mean and a standard deviation are fine when the data
  really is close to normal.

### Steps

1. **Fork the repo** and run `npm install`.

2. **Write `data/<name>.json`.** The formats (`frequency`, `percentile`,
   `samples`, `normal`, `lognormal`) and every optional field are described
   in [Adding your own distribution](README.md#adding-your-own-distribution).
   Built-in datasets should also have:

   | Field | Guidance |
   |---|---|
   | `name` | kebab-case, and the same as the file name. Follow the existing patterns: `-rank` for tiers, `-score` for exams, `country-measure` for statistics (`canada-income`, `us-net-worth`). |
   | `title` | Short and readable, with the scale or unit when that helps: `"ACT composite score (1-36)"`. |
   | `description` | The population, the time period, and any caveats or adjustments you made. |
   | `source` | A URL for the data you used. |
   | `date` | When the data was collected or published, e.g. `"2026-08"` or `"2025"`. |
   | `unit` | For numeric data: `"USD"`, `"cm"`, `"points"`, … |

   Set `"higher_is_better": false` for data such as race times, and use
   `aliases` for common short names of labels (`"SSL"`, `"plat"`).

3. **Check it:**

   ```bash
   node src/bin.ts validate data/<name>.json        # Node 22.18+; or build first and use dist/bin.js
   node src/bin.ts show data/<name>.json
   node src/bin.ts convert <some value> -f data/<name>.json -t lol-rank
   ```

   Try a few values you know: does the median come out near the 50th
   percentile? Do the ends of the range look sensible?

4. **Embed it:** run `npm run gen`. This regenerates `src/builtins.ts`, which
   the library and the browser bundle load their data from. Commit the
   regenerated file along with your JSON.

5. **Document it:** add a row to the matching table under
   [Built-in distributions](README.md#built-in-distributions) in the README,
   with the source linked.

6. **Run `npm run check`** (typecheck and tests). Every built-in is tested
   automatically: it must load, and its percentile ↔ value conversions must
   round-trip.

7. **Open a pull request.** Say where the numbers came from and anything you
   had to adjust or estimate.

### Datasets derived from raw data

If you computed the distribution yourself (weighted percentiles from survey
microdata, counts from an API, merging two published tables), please add the
script as `scripts/build_<name>.ts`, so others can check the method and
refresh the data later. Follow the existing scripts:

- A header comment giving the source URLs, what the population is, any
  adjustments and why, and how to run the script.
- Use the helpers in `scripts/common.ts`, and accept `--out DIR` (default
  `data/`).
- Link to the script from the README table ("Method:
  `scripts/build_<name>.ts`").

`scripts/build_us_income.ts` is a good example.

### Updating an existing dataset

Game rank shares change every season and statistics agencies publish new
years. When refreshing a dataset, update `source`, `date` and `description`
as well as the numbers, then run `npm run gen` and `npm run check`. If the
dataset has a build script, run the script instead of editing the JSON by hand.

## Development

```bash
npm install
npm test            # vitest
npm run typecheck   # also checks that the browser entry points don't use Node APIs
npm run build       # dist/: compiled modules, type declarations, browser bundle
npm run gen         # after editing data/*.json: re-embed the datasets in src/builtins.ts
```

`tests/golden.test.ts` compares output with recorded reference outputs. It
only loads the datasets that existed when they were recorded, so adding a
dataset doesn't affect it. If you change behaviour on purpose, explain why in
the PR.

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
