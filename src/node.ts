/**
 * rank-anything for Node: everything in the main entry point, plus loading
 * distributions from files and a user directory of installed distributions
 * (what the CLI uses).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { BUILTIN_SPECS } from "./builtins.ts";
import { type Conversion, type Distribution, DistributionError, type Value } from "./distributions.ts";
import { IMPORT_SUFFIXES, type SamplesSpecOptions, dumpSpec, numbersFromFile, samplesSpecFromText, stem } from "./importers.ts";
import { type DistributionRef, type MultiConversion, type Origin, Registry } from "./registry.ts";
import { strRepr } from "./text.ts";
import { type DistributionSpec, fromDict, specFromText } from "./spec.ts";

export * from "./index.ts";

/** Where `rank-anything add` installs distributions: `$RANK_ANYTHING_HOME/distributions`, default `~/.rank_anything/distributions`. */
export function userDir(): string {
  const env = process.env.RANK_ANYTHING_HOME;
  return join(env ? env : join(homedir(), ".rank_anything"), "distributions");
}

function readText(path: string): string {
  if (!existsSync(path) || !statSync(path).isFile()) throw new DistributionError(`No such file: ${path}`);
  return readFileSync(path, "utf8");
}

/** Numbers from a .csv/.tsv/.txt file. */
export function readNumbers(path: string, column?: string | null): number[] {
  return numbersFromFile(readText(path), path, column);
}

/** Build a `samples` JSON spec from a .csv/.tsv/.txt file of numbers. */
export function samplesSpec(path: string, options: SamplesSpecOptions = {}): DistributionSpec {
  return samplesSpecFromText(readText(path), path, options);
}

/** The JSON spec for a file: parsed JSON, or a `samples` spec built from a .csv/.tsv/.txt file of numbers. */
export function readSpec(path: string): DistributionSpec {
  return specFromText(readText(path), path);
}

/** Load a .json distribution, or a .csv/.tsv/.txt file of numbers. */
export function loadFile(path: string): Distribution {
  return fromDict(readSpec(path), stem(path));
}

/** A registry whose user distributions are JSON files in {@link userDir}, and which also loads file paths. */
export class NodeRegistry extends Registry {
  private userFiles(): Map<string, string> {
    const dir = userDir();
    const out = new Map<string, string>();
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".json")) out.set(f.slice(0, -5), join(dir, f));
    return out;
  }

  protected override userNames(): string[] {
    return [...this.userFiles().keys()];
  }

  protected override loadUser(name: string): Distribution | undefined {
    const path = this.userFiles().get(name);
    return path === undefined ? undefined : loadFile(path);
  }

  protected override loadOther(ref: string): Distribution | undefined {
    const lower = ref.toLowerCase();
    if ([".json", ...IMPORT_SUFFIXES].some((s) => lower.endsWith(s)) || ref.includes("/") || ref.includes(sep)) {
      return loadFile(ref);
    }
    return undefined;
  }

  /**
   * Validate a distribution file (or an already-built `spec`) and save it as
   * JSON in the user directory, so it can be used by name. Returns the path.
   */
  install(path: string, options: { name?: string | null; force?: boolean; spec?: DistributionSpec } = {}): string {
    const spec = options.spec ? { ...options.spec } : readSpec(path);
    if (options.name) spec.name = options.name;
    const dist = fromDict(spec, stem(path)); // validates
    if (/[\\/]/.test(dist.name) || dist.name === "." || dist.name === "..") {
      throw new DistributionError(`${dist.name}: a name can't contain path separators`);
    }
    const dest = join(userDir(), `${dist.name}.json`);
    if (existsSync(dest) && !options.force) throw new DistributionError(`${dest} already exists (use --force to overwrite)`);
    mkdirSync(userDir(), { recursive: true });
    writeFileSync(dest, dumpSpec(spec));
    return dest;
  }

  /** Delete an installed user distribution. Returns the removed file's path. */
  uninstall(name: string): string {
    const path = join(userDir(), `${name}.json`);
    if (!existsSync(path)) {
      throw new DistributionError(`No user distribution named ${strRepr(name)} (built-ins can't be removed)`);
    }
    unlinkSync(path);
    return path;
  }
}

/** The default Node registry: built-ins, installed user distributions, and file paths. */
export const registry: NodeRegistry = new NodeRegistry({ builtins: BUILTIN_SPECS });

/** Load a distribution by name (user > builtin > pseudo), JSON spec, or file path. */
export function load(ref: DistributionRef): Distribution {
  return registry.load(ref);
}

/** name -> origin ('builtin', 'user', or 'pseudo'). User files shadow builtins. */
export function available(): Record<string, Origin> {
  return registry.available();
}

/** Convert `value` from `source` to `target` (names, file paths, specs or Distribution objects). */
export function convert(value: Value, source: DistributionRef, target: DistributionRef, position = 0.5): Conversion {
  return registry.convert(value, source, target, position);
}

/** Rank percentile (0-100, "better than X%") of `value` in `source`. */
export function percentile(value: Value, source: DistributionRef, position = 0.5): number {
  return registry.percentile(value, source, position);
}

/** Convert `value` into several targets at once (default: every other distribution). */
export function convertMany(
  value: Value,
  source: DistributionRef,
  options: { targets?: readonly DistributionRef[]; position?: number } = {},
): MultiConversion {
  return registry.convertMany(value, source, options);
}

/** Install a distribution file into the user directory. See {@link NodeRegistry.install}. */
export function install(path: string, options: { name?: string | null; force?: boolean; spec?: DistributionSpec } = {}): string {
  return registry.install(path, options);
}
