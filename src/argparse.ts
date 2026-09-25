/**
 * A small command-line parser: subcommands with aliases,
 * short/long options, `--opt=value`, unique long-option prefixes, repeatable
 * options, choices, and required options.
 */

import { parseFloatStrict, strRepr } from "./text.ts";

export interface OptionSpec {
  flags: string[];
  dest: string;
  help?: string;
  action?: "store" | "append" | "store_true";
  required?: boolean;
  choices?: readonly string[];
  type?: "float";
  default?: unknown;
}

export interface PositionalSpec {
  dest: string;
  help?: string;
}

export interface CommandSpec {
  name: string;
  aliases?: string[];
  help: string;
  /** Arguments in definition order (this decides the order of "required" errors). */
  args: Array<({ kind: "option" } & OptionSpec) | ({ kind: "positional" } & PositionalSpec)>;
}

export interface ProgramSpec {
  prog: string;
  version: string;
  description: string;
  epilog: string;
  commands: CommandSpec[];
}

export type Args = Record<string, unknown> & { command: string };

/** Thrown to stop parsing: print `stdout`/`stderr` and exit with `code`. */
export class ParserExit extends Error {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(code: number, stdout = "", stderr = "") {
    super(stderr || stdout);
    this.code = code;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

// ------------------------------------------------------------------ help formatting

/** Split text into wrappable chunks: words, runs of spaces, and hyphenated word parts. */
function chunks(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/( +)/)) {
    if (!piece) continue;
    if (piece.startsWith(" ")) {
      out.push(piece);
      continue;
    }
    let start = 0;
    for (let i = 1; i < piece.length - 2; i++) {
      if (piece[i] !== "-") continue;
      const letter = (c: string | undefined) => c !== undefined && /\p{L}/u.test(c);
      const before = (letter(piece[i - 1]) && letter(piece[i - 2])) || (letter(piece[i - 1]) && piece[i - 2] === "-" && letter(piece[i - 3]));
      const after = letter(piece[i + 1]) && (letter(piece[i + 2]) || (piece[i + 2] === "-" && letter(piece[i + 3])));
      if (before && after) {
        out.push(piece.slice(start, i + 1));
        start = i + 1;
      }
    }
    out.push(piece.slice(start));
  }
  return out;
}

/** Greedily wrap single-spaced text to lines of at most `width` characters. */
export function wrap(text: string, width: number): string[] {
  const rest = chunks(text.replace(/\s+/g, " ").trim()).reverse();
  const lines: string[] = [];
  while (rest.length) {
    if (lines.length && !rest[rest.length - 1].trim()) rest.pop();
    const cur: string[] = [];
    let len = 0;
    while (rest.length && len + rest[rest.length - 1].length <= width) {
      len += rest[rest.length - 1].length;
      cur.push(rest.pop()!);
    }
    if (rest.length && rest[rest.length - 1].length > width && !cur.length) {
      const long = rest.pop()!;
      cur.push(long.slice(0, width));
      rest.push(long.slice(width));
    }
    if (cur.length && !cur[cur.length - 1].trim()) cur.pop();
    if (cur.length) lines.push(cur.join(""));
  }
  return lines;
}

const metavar = (o: OptionSpec) => (o.choices ? `{${o.choices.join(",")}}` : o.dest.toUpperCase());
const takesValue = (o: OptionSpec) => o.action !== "store_true";

function usageParts(args: CommandSpec["args"]): [string[], string[]] {
  const opt = ["[-h]"];
  const pos: string[] = [];
  for (const a of args) {
    if (a.kind === "positional") pos.push(a.dest);
    else {
      const part = takesValue(a) ? `${a.flags[0]} ${metavar(a)}` : a.flags[0];
      opt.push(a.required ? part : `[${part}]`);
    }
  }
  return [opt, pos];
}

function formatUsage(prog: string, opt: string[], pos: string[], width: number): string {
  const prefix = "usage: ";
  const textWidth = width - 2;
  const usage = [prog, ...opt, ...pos].join(" ");
  if (prefix.length + usage.length <= textWidth) return prefix + usage + "\n";
  const indent = " ".repeat(prefix.length + prog.length + 1);
  const getLines = (parts: string[], withPrefix: boolean): string[] => {
    const lines: string[] = [];
    let line: string[] = [];
    let lineLen = withPrefix ? prefix.length - 1 : indent.length - 1;
    for (const part of parts) {
      if (lineLen + 1 + part.length > textWidth && line.length) {
        lines.push(indent + line.join(" "));
        line = [];
        lineLen = indent.length - 1;
      }
      line.push(part);
      lineLen += part.length + 1;
    }
    if (line.length) lines.push(indent + line.join(" "));
    if (withPrefix) lines[0] = lines[0].slice(indent.length);
    return lines;
  };
  const lines = opt.length ? [...getLines([prog, ...opt], true), ...getLines(pos, false)] : getLines([prog, ...pos], true);
  return prefix + lines.join("\n") + "\n";
}

interface HelpItem {
  invocation: string;
  help?: string;
  indent: number;
}

/** Column where help text starts; shared across all sections of a parser. */
function helpPosition(items: HelpItem[], width: number): number {
  const maxHelpPosition = Math.min(24, Math.max(width - 2 - 20, 4));
  return Math.min(Math.max(...items.map((it) => it.invocation.length)) + 2 + 2, maxHelpPosition);
}

function formatSection(title: string, items: HelpItem[], position: number, width: number): string {
  const helpWidth = Math.max(width - 2 - position, 11);
  let out = `${title}:\n`;
  for (const it of items) {
    const actionWidth = position - it.indent - 2;
    const pad = " ".repeat(it.indent);
    if (!it.help) {
      out += pad + it.invocation + "\n";
      continue;
    }
    const lines = wrap(it.help, helpWidth);
    if (it.invocation.length <= actionWidth) {
      out += pad + it.invocation.padEnd(actionWidth) + "  " + lines[0] + "\n";
    } else {
      out += pad + it.invocation + "\n" + " ".repeat(position) + lines[0] + "\n";
    }
    for (const l of lines.slice(1)) out += " ".repeat(position) + l + "\n";
  }
  return out;
}

function optionInvocation(o: OptionSpec): string {
  return takesValue(o) ? o.flags.map((f) => `${f} ${metavar(o)}`).join(", ") : o.flags.join(", ");
}

const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

/**
 * Match `tok` against `flags`: an exact
 * flag, `--flag=value`, a unique `--prefix`, or `-fVALUE`. Returns the flag
 * and any attached value; "unknown" for an unrecognised option; undefined
 * when the token is a positional argument (including negative numbers).
 */
function matchOption(tok: string, flags: readonly string[], fail: (msg: string) => never): [string, string | undefined] | "unknown" | undefined {
  if (!tok.startsWith("-") || tok.length === 1) return undefined;
  if (flags.includes(tok)) return [tok, undefined];
  const eq = tok.indexOf("=");
  if (eq > 0 && flags.includes(tok.slice(0, eq))) return [tok.slice(0, eq), tok.slice(eq + 1)];
  if (tok.startsWith("--")) {
    const [prefix, explicit] = eq > 0 ? [tok.slice(0, eq), tok.slice(eq + 1)] : [tok, undefined];
    const matches = flags.filter((f) => f.startsWith("--") && f.startsWith(prefix));
    if (matches.length > 1) fail(`ambiguous option: ${prefix} could match ${matches.join(", ")}`);
    if (matches.length === 1) return [matches[0], explicit];
  } else if (tok[1] !== "-" && flags.includes(tok.slice(0, 2))) {
    return [tok.slice(0, 2), tok.slice(2)];
  }
  if (NEGATIVE_NUMBER.test(tok) || tok.includes(" ")) return undefined;
  return "unknown";
}

// ------------------------------------------------------------------ parser

export class ArgumentParser {
  readonly spec: ProgramSpec;
  /** Terminal width (help is wrapped to this minus 2). */
  readonly width: number;

  constructor(spec: ProgramSpec, width = 80) {
    this.spec = spec;
    this.width = width;
  }

  usage(): string {
    return formatUsage(this.spec.prog, ["[-h]", "[--version]"], ["COMMAND ..."], this.width);
  }

  help(): string {
    const commands: HelpItem[] = [
      { invocation: "COMMAND", indent: 2 },
      ...this.spec.commands.map((c) => ({
        invocation: c.aliases?.length ? `${c.name} (${c.aliases.join(", ")})` : c.name,
        help: c.help,
        indent: 4,
      })),
    ];
    const options: HelpItem[] = [
      { invocation: "-h, --help", help: "show this help message and exit", indent: 2 },
      { invocation: "--version", help: "show program's version number and exit", indent: 2 },
    ];
    const pos = helpPosition([...commands, ...options], this.width);
    return [
      this.usage(),
      this.spec.description + "\n",
      formatSection("positional arguments", commands, pos, this.width),
      formatSection("options", options, pos, this.width),
      this.spec.epilog.replace(/\n+$/, "") + "\n",
    ].join("\n");
  }

  commandUsage(cmd: CommandSpec): string {
    const [opt, pos] = usageParts(cmd.args);
    return formatUsage(`${this.spec.prog} ${cmd.name}`, opt, pos, this.width);
  }

  commandHelp(cmd: CommandSpec): string {
    const positionals: HelpItem[] = [];
    const options: HelpItem[] = [{ invocation: "-h, --help", help: "show this help message and exit", indent: 2 }];
    for (const a of cmd.args) {
      if (a.kind === "positional") positionals.push({ invocation: a.dest, help: a.help, indent: 2 });
      else options.push({ invocation: optionInvocation(a), help: a.help, indent: 2 });
    }
    const pos = helpPosition([...positionals, ...options], this.width);
    const parts = [this.commandUsage(cmd)];
    if (positionals.length) parts.push(formatSection("positional arguments", positionals, pos, this.width));
    parts.push(formatSection("options", options, pos, this.width));
    return parts.join("\n");
  }

  private error(usage: string, prog: string, message: string): never {
    throw new ParserExit(2, "", `${usage}${prog}: error: ${message}\n`);
  }

  /** Parse `argv`. Returns null when no command was given. Throws {@link ParserExit} for help, version and usage errors. */
  parse(argv: readonly string[]): Args | null {
    const fail = (message: string): never => this.error(this.usage(), this.spec.prog, message);
    const extras: string[] = [];
    let i = 0;
    for (; i < argv.length; i++) {
      const m = matchOption(argv[i], ["-h", "--help", "--version"], fail);
      if (m === undefined) break;
      if (m === "unknown") extras.push(argv[i]);
      else if (m[0] === "--version") throw new ParserExit(0, `${this.spec.prog} ${this.spec.version}\n`);
      else throw new ParserExit(0, this.help());
    }
    if (i >= argv.length) {
      if (extras.length) fail(`unrecognized arguments: ${extras.join(" ")}`);
      return null;
    }
    const name = argv[i];
    const cmd = this.spec.commands.find((c) => c.name === name || c.aliases?.includes(name));
    if (!cmd) {
      const choices = this.spec.commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]).map(strRepr).join(", ");
      return fail(`argument COMMAND: invalid choice: ${strRepr(name)} (choose from ${choices})`);
    }
    const args = this.parseCommand(cmd, argv.slice(i + 1), extras);
    if (extras.length) fail(`unrecognized arguments: ${extras.join(" ")}`);
    return args;
  }

  private parseCommand(cmd: CommandSpec, argv: readonly string[], extras: string[]): Args {
    const fail = (message: string): never => this.error(this.commandUsage(cmd), `${this.spec.prog} ${cmd.name}`, message);
    const options = cmd.args.filter((a) => a.kind === "option") as OptionSpec[];
    const byFlag = new Map<string, OptionSpec | "help">([["-h", "help"], ["--help", "help"]]);
    for (const o of options) for (const f of o.flags) byFlag.set(f, o);
    const flags = [...byFlag.keys()];
    const label = (o: OptionSpec) => o.flags.join("/");

    const result: Args = { command: cmd.name };
    for (const o of options) result[o.dest] = o.default ?? (o.action === "store_true" ? false : null);
    const seen = new Set<string>();
    const positionals: string[] = [];

    for (let i = 0; i < argv.length; i++) {
      const tok = argv[i];
      if (tok === "--") {
        positionals.push(...argv.slice(i + 1));
        break;
      }
      const m = matchOption(tok, flags, fail);
      if (m === undefined) {
        positionals.push(tok);
        continue;
      }
      if (m === "unknown") {
        extras.push(tok);
        continue;
      }
      const opt = byFlag.get(m[0])!;
      let raw = m[1];
      if (opt === "help") throw new ParserExit(0, this.commandHelp(cmd));
      seen.add(opt.dest);
      if (!takesValue(opt)) {
        if (raw !== undefined) fail(`argument ${label(opt)}: ignored explicit argument ${strRepr(raw)}`);
        result[opt.dest] = true;
        continue;
      }
      if (raw === undefined) {
        const next = argv[i + 1];
        if (next === undefined || next === "--" || matchOption(next, flags, fail) !== undefined) {
          fail(`argument ${label(opt)}: expected one argument`);
        }
        raw = argv[++i];
      }
      let value: unknown = raw;
      if (opt.type === "float") {
        value = parseFloatStrict(raw);
        if (value === undefined) fail(`argument ${label(opt)}: invalid float value: ${strRepr(raw)}`);
      }
      if (opt.choices && !opt.choices.includes(raw)) {
        fail(`argument ${label(opt)}: invalid choice: ${strRepr(raw)} (choose from ${opt.choices.map(strRepr).join(", ")})`);
      }
      result[opt.dest] = opt.action === "append" ? [...((result[opt.dest] as unknown[] | null) ?? []), value] : value;
    }

    const missing: string[] = [];
    let p = 0;
    for (const a of cmd.args) {
      if (a.kind === "positional") {
        if (p < positionals.length) result[a.dest] = positionals[p++];
        else missing.push(a.dest);
      } else if (a.required && !seen.has(a.dest)) {
        missing.push(label(a));
      }
    }
    if (missing.length) fail(`the following arguments are required: ${missing.join(", ")}`);
    extras.push(...positionals.slice(p));
    return result;
  }
}
