/** Command-line interface: `rank-anything`. */

import { existsSync, writeFileSync } from "node:fs";
import { ArgumentParser, type Args, type CommandSpec, ParserExit } from "./argparse.ts";
import { DistributionError, formatPercent } from "./distributions.ts";
import { dataTable, describe, distType, mappingTable, rankLine, rawValue, renderTable, summaryLines } from "./format.ts";
import { dumpSpec, stem } from "./importers.ts";
import { loadFile, registry, samplesSpec, userDir } from "./node.ts";
import { PROMPT_TYPES, type PromptType, buildPrompt } from "./prompts.ts";
import { strRepr } from "./text.ts";
import { VERSION } from "./version.ts";

const EPILOG = `examples:
  rank-anything convert 85k --from canada-income --to lol-rank
  rank-anything convert E6 --from meta-level --to lol-rank --to valorant-rank
  rank-anything convert "Gold II" --from lol-rank             # compare against everything
  rank-anything convert 5 --from top --to iq                  # top 5% IQ
  rank-anything convert 1520 --from sat-score --to lol-rank --raw   # just "Diamond II"
  rank-anything percentile 1520 --from sat-score              # just "97.6"
  rank-anything table --from meta-level --to lol-rank
  rank-anything show lol-rank
  rank-anything add my-dist.json
  rank-anything convert 97k --from salaries.csv --to lol-rank  # CSV/TXT of numbers works directly
  rank-anything import salaries.csv --column salary --unit USD --add
  rank-anything prompt "Chess.com rapid ratings" --type frequency
`;

const COMMANDS: CommandSpec[] = [
  {
    name: "convert",
    aliases: ["c"],
    help: "convert a value between distributions",
    args: [
      { kind: "positional", dest: "value", help: "value to convert, e.g. 85000, 85k, 'Gold II', E5" },
      {
        kind: "option", flags: ["-f", "--from"], dest: "source", required: true,
        help: "source: a distribution name, a .json file, or a .csv/.txt of numbers ('percentile' and 'top' also work)",
      },
      {
        kind: "option", flags: ["-t", "--to"], dest: "targets", action: "append",
        help: "target distribution (repeatable). Omit to compare against all.",
      },
      {
        kind: "option", flags: ["-p", "--position"], dest: "position", type: "float", default: 0.5,
        help: "for labeled sources: where within the label, 0=just reached, 1=about to promote (default 0.5)",
      },
      { kind: "option", flags: ["--json"], dest: "json", action: "store_true", help: "machine-readable output" },
      {
        kind: "option", flags: ["--raw"], dest: "raw", action: "store_true",
        help: "print only the equivalent value, for piping into other programs (one target: just the value; " +
          "several: NAME<tab>VALUE per line). Numbers have no units or separators.",
      },
    ],
  },
  {
    name: "percentile",
    help: "print just the percentile of a value (\"better than X%\"), as a bare number",
    args: [
      { kind: "positional", dest: "value", help: "value to rank, e.g. 1520, 85k, 'Gold II'" },
      {
        kind: "option", flags: ["-f", "--from"], dest: "source", required: true,
        help: "distribution: a name, a .json file, or a .csv/.txt of numbers",
      },
      {
        kind: "option", flags: ["-p", "--position"], dest: "position", type: "float", default: 0.5,
        help: "for labeled sources: where within the label, 0=just reached, 1=about to promote (default 0.5)",
      },
      { kind: "option", flags: ["--top"], dest: "top", action: "store_true", help: "print the top X% instead (100 minus the percentile)" },
    ],
  },
  { name: "list", aliases: ["ls"], help: "list available distributions", args: [] },
  { name: "show", help: "show a distribution's details and data", args: [{ kind: "positional", dest: "name" }] },
  {
    name: "table",
    help: "side-by-side mapping of one distribution onto another",
    args: [
      { kind: "option", flags: ["-f", "--from"], dest: "source", required: true },
      { kind: "option", flags: ["-t", "--to"], dest: "target", required: true },
    ],
  },
  {
    name: "add",
    help: "validate a distribution (.json, or .csv/.txt of numbers) and install it",
    args: [
      { kind: "positional", dest: "file" },
      { kind: "option", flags: ["--name"], dest: "name", help: "install under this name (default: the file's 'name')" },
      { kind: "option", flags: ["--force"], dest: "force", action: "store_true", help: "overwrite an existing one" },
    ],
  },
  {
    name: "import",
    help: "turn a .csv/.tsv/.txt of numbers into a JSON distribution",
    args: [
      {
        kind: "positional", dest: "file",
        help: ".csv/.tsv (one column of numbers) or .txt (numbers separated by newlines, spaces or commas)",
      },
      {
        kind: "option", flags: ["-c", "--column"], dest: "column",
        help: "CSV column to use: header name or 1-based index (default: the only numeric column)",
      },
      { kind: "option", flags: ["--name"], dest: "name", help: "distribution name (default: from the file name)" },
      { kind: "option", flags: ["--title"], dest: "title", help: "human-readable title" },
      { kind: "option", flags: ["--unit"], dest: "unit", help: "unit label, e.g. USD or cm" },
      {
        kind: "option", flags: ["--lower-is-better"], dest: "lower_is_better", action: "store_true",
        help: "smaller numbers rank higher (e.g. race times)",
      },
      {
        kind: "option", flags: ["-o", "--output"], dest: "output",
        help: "where to write the JSON (default: NAME.json; '-' for stdout)",
      },
      { kind: "option", flags: ["--add"], dest: "add", action: "store_true", help: "install it directly instead of writing a file" },
      { kind: "option", flags: ["--force"], dest: "force", action: "store_true", help: "overwrite existing files" },
    ],
  },
  { name: "remove", aliases: ["rm"], help: "remove a user-installed distribution", args: [{ kind: "positional", dest: "name" }] },
  { name: "validate", help: "check a distribution file without installing it", args: [{ kind: "positional", dest: "file" }] },
  {
    name: "prompt",
    help: "print an AI prompt for extracting a distribution as JSON",
    args: [
      { kind: "positional", dest: "topic", help: "what to get the distribution of, e.g. 'US household income'" },
      {
        kind: "option", flags: ["--type"], dest: "type", choices: PROMPT_TYPES, default: "auto",
        help: "preferred JSON format (default: let the AI choose)",
      },
    ],
  },
];

/** Where the CLI writes; tests capture it. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Terminal width for help text (default: $COLUMNS, the terminal's width, or 80). */
  columns?: number;
}

type Print = (line?: string) => void;

// --------------------------------------------------------------------------- commands

function cmdConvert(args: Args, print: Print): number {
  const { source, placement: placed, results } = registry.convertMany(args.value as string, args.source as string, {
    targets: (args.targets as string[] | null) ?? undefined,
    position: args.position as number,
  });

  if (args.json && args.raw) throw new DistributionError("--json and --raw can't be used together");

  if (args.raw) {
    for (const c of results) {
      const value = rawValue(c.target, c.targetPlacement.value);
      print(results.length === 1 ? value : `${c.target.name}\t${value}`);
    }
    return 0;
  }

  if (args.json) {
    const out = {
      source: source.name,
      value: placed.value,
      percentile: placed.percentile,
      top_percent: placed.topPercent,
      clamped: placed.clamped,
      extrapolated: placed.extrapolated,
      results: results.map((c) => ({
        target: c.target.name,
        value: c.targetPlacement.value,
        position: c.targetPlacement.position,
        clamped: c.targetPlacement.clamped,
        extrapolated: c.targetPlacement.extrapolated,
      })),
    };
    print(JSON.stringify(out, null, 2));
    return 0;
  }

  print(`${describe(source, placed, args.position !== 0.5)} in ${source.displayName}`);
  print(`  = ${rankLine(placed.percentile)}`);
  if (results.length === 1) {
    const c = results[0];
    print(`  ≈ ${describe(c.target, c.targetPlacement)} in ${c.target.displayName}`);
  } else {
    print();
    const rows = results.map((c) => [c.target.name, describe(c.target, c.targetPlacement)]);
    renderTable({ header: ["distribution", "equivalent"], rows }).forEach((l) => print(l));
  }
  return 0;
}

function cmdPercentile(args: Args, print: Print): number {
  const p = registry.percentile(args.value as string, args.source as string, args.position as number);
  print(formatPercent(args.top ? 100 - p : p).slice(0, -1));
  return 0;
}

function cmdList(_args: Args, print: Print): number {
  const rows = Object.entries(registry.available()).map(([name, origin]) => {
    try {
      const d = registry.load(name);
      return [name, origin, distType(d), d.displayName];
    } catch (e) {
      if (!(e instanceof DistributionError)) throw e;
      return [name, origin, "ERROR", e.message];
    }
  });
  renderTable({ header: ["name", "origin", "type", "title"], rows }).forEach((l) => print(l));
  print(`\nUser distributions live in ${userDir()}`);
  return 0;
}

function cmdShow(args: Args, print: Print): number {
  const d = registry.load(args.name as string);
  summaryLines(d).forEach((l) => print(l));
  print();
  renderTable(dataTable(d)).forEach((l) => print(l));
  return 0;
}

function cmdTable(args: Args, print: Print): number {
  const src = registry.load(args.source as string);
  const dst = registry.load(args.target as string);
  const table = mappingTable(src, dst);
  print(`${src.displayName}  →  ${dst.displayName}\n`);
  renderTable(table).forEach((l) => print(l));
  return 0;
}

function cmdValidate(args: Args, print: Print): number {
  const d = loadFile(args.file as string);
  summaryLines(d).forEach((l) => print(l));
  print();
  print("✓ valid");
  return 0;
}

function cmdAdd(args: Args, print: Print): number {
  const dest = registry.install(args.file as string, { name: args.name as string | null, force: args.force as boolean });
  const name = stem(dest);
  print(`Installed ${strRepr(name)} -> ${dest}`);
  print(`Try: rank-anything show ${name}`);
  return 0;
}

function cmdImport(args: Args, print: Print, io: CliIO): number {
  const spec = samplesSpec(args.file as string, {
    column: args.column as string | null,
    name: args.name as string | null,
    title: args.title as string | null,
    unit: args.unit as string | null,
    higherIsBetter: !args.lower_is_better,
  });
  const n = (spec.data as unknown[]).length;
  if (args.add) {
    const dest = registry.install(args.file as string, { spec, force: args.force as boolean });
    print(`Imported ${n} values and installed ${strRepr(spec.name!)} -> ${dest}`);
    print(`Try: rank-anything show ${spec.name}`);
    return 0;
  }
  const text = dumpSpec(spec);
  if (args.output === "-") {
    io.stdout(text);
    return 0;
  }
  const out = (args.output as string | null) || `${spec.name}.json`;
  if (existsSync(out) && !args.force) {
    throw new DistributionError(`${out} already exists (use --force to overwrite, or -o to pick a path)`);
  }
  writeFileSync(out, text);
  print(`Imported ${n} values -> ${out}`);
  print(`Try: rank-anything show ${out}    or install it: rank-anything add ${out}`);
  return 0;
}

function cmdRemove(args: Args, print: Print): number {
  print(`Removed ${registry.uninstall(args.name as string)}`);
  return 0;
}

function cmdPrompt(args: Args, print: Print): number {
  print(buildPrompt(args.topic as string, args.type as PromptType));
  return 0;
}

const HANDLERS: Record<string, (args: Args, print: Print, io: CliIO) => number> = {
  convert: cmdConvert,
  percentile: cmdPercentile,
  list: cmdList,
  show: cmdShow,
  table: cmdTable,
  add: cmdAdd,
  import: cmdImport,
  remove: cmdRemove,
  validate: cmdValidate,
  prompt: cmdPrompt,
};

// --------------------------------------------------------------------------- entry point

export function buildParser(columns = 80): ArgumentParser {
  return new ArgumentParser(
    {
      prog: "rank-anything",
      version: VERSION,
      description:
        "Convert a value in one distribution to its equivalent in another (e.g. your income -> your League of Legends rank).",
      epilog: EPILOG,
      commands: COMMANDS,
    },
    columns,
  );
}

const defaultIO: CliIO = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

/** Run the CLI with `argv` (without the program name). Returns the exit code. */
export function main(argv: readonly string[] = process.argv.slice(2), io: CliIO = defaultIO): number {
  const columns = io.columns ?? (Number(process.env.COLUMNS) || process.stdout.columns || 80);
  const parser = buildParser(columns);
  const print: Print = (line = "") => io.stdout(line + "\n");
  let args: Args | null;
  try {
    args = parser.parse(argv);
  } catch (e) {
    if (!(e instanceof ParserExit)) throw e;
    if (e.stdout) io.stdout(e.stdout);
    if (e.stderr) io.stderr(e.stderr);
    return e.code;
  }
  if (!args) {
    io.stdout(parser.help());
    return 1;
  }
  try {
    return HANDLERS[args.command](args, print, io);
  } catch (e) {
    if (!(e instanceof DistributionError)) throw e;
    io.stderr(`error: ${e.message}\n`);
    return 2;
  }
}

