/** Look up distributions by name: built-in, user-added, or pseudo. */

import {
  type Conversion,
  type Distribution,
  DistributionError,
  type Placement,
  PiecewiseDistribution,
  type Value,
  convert,
} from "./distributions.ts";
import { parseJson } from "./json.ts";
import { strRepr } from "./text.ts";
import { type DistributionSpec, fromDict } from "./spec.ts";

export type Origin = "builtin" | "user" | "pseudo";

/** Something that resolves to a distribution: a name, a JSON spec, or a distribution. */
export type DistributionRef = string | Distribution | DistributionSpec;

/** Pseudo-distributions usable anywhere a name is accepted. */
export const PSEUDO: Readonly<Record<string, () => Distribution>> = {
  percentile: () =>
    new PiecewiseDistribution("percentile", [[0, 0], [100, 100]], { tail: "clamp", title: "percentile rank", unit: "%" }),
  top: () =>
    new PiecewiseDistribution("top", [[0, 0], [100, 100]], {
      tail: "clamp",
      title: "top-X% rank",
      unit: "%",
      higherIsBetter: false,
    }),
};

export interface RegistryOptions {
  /** Built-in distributions: name -> JSON spec (object or JSON text). */
  builtins?: Readonly<Record<string, string | DistributionSpec>>;
}

/** The result of converting one value into several distributions. */
export interface MultiConversion {
  source: Distribution;
  /** Where the value sits in the source distribution. */
  placement: Placement;
  results: Conversion[];
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A set of distributions that can be looked up by name. The base class keeps
 * user distributions in memory, which suits browsers; `NodeRegistry` (from
 * `rank-anything/node`) keeps them on disk and also accepts file paths.
 */
export class Registry {
  private readonly builtins: Readonly<Record<string, string | DistributionSpec>>;
  private readonly builtinCache = new Map<string, Distribution>();
  private readonly added = new Map<string, DistributionSpec>();

  constructor(options: RegistryOptions = {}) {
    this.builtins = options.builtins ?? {};
  }

  /** Names of user distributions (these shadow built-ins of the same name). */
  protected userNames(): string[] {
    return [...this.added.keys()];
  }

  /** Load a user distribution, or undefined if there is none by that name. */
  protected loadUser(name: string): Distribution | undefined {
    const spec = this.added.get(name);
    return spec && fromDict(spec, name);
  }

  /** Last resort for a reference that isn't a known name (NodeRegistry: file paths). */
  protected loadOther(_ref: string): Distribution | undefined {
    return undefined;
  }

  /** Hint appended to "Unknown distribution" errors when nothing similar exists. */
  protected unknownHint(): string {
    return " Run `rank-anything list` to see options.";
  }

  /** name -> origin ('builtin', 'user', or 'pseudo'), sorted by name. User distributions shadow built-ins. */
  available(): Record<string, Origin> {
    const out: Record<string, Origin> = {};
    for (const n of Object.keys(PSEUDO)) out[n] = "pseudo";
    for (const n of Object.keys(this.builtins)) out[n] = "builtin";
    for (const n of this.userNames()) out[n] = "user";
    const sorted: Record<string, Origin> = {};
    for (const n of Object.keys(out).sort(byName)) sorted[n] = out[n];
    return sorted;
  }

  /** Whether `name` refers to a known distribution. */
  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.available(), name);
  }

  /** The JSON spec of a built-in distribution. */
  builtinSpec(name: string): DistributionSpec | undefined {
    if (!Object.prototype.hasOwnProperty.call(this.builtins, name)) return undefined;
    const spec = this.builtins[name];
    return (typeof spec === "string" ? parseJson(spec) : spec) as DistributionSpec;
  }

  /** Load a distribution by name (user > builtin > pseudo), or from a spec object. */
  load(ref: DistributionRef): Distribution {
    if (typeof ref === "object" && ref !== null) {
      return "toPercentile" in ref ? (ref as Distribution) : fromDict(ref as DistributionSpec);
    }
    ref = String(ref);
    if (this.userNames().includes(ref)) return this.loadUser(ref)!;
    const spec = this.builtinSpec(ref);
    if (spec) {
      let d = this.builtinCache.get(ref);
      if (!d) this.builtinCache.set(ref, (d = fromDict(spec, ref)));
      return d;
    }
    if (Object.prototype.hasOwnProperty.call(PSEUDO, ref)) return PSEUDO[ref]();
    const other = this.loadOther(ref);
    if (other) return other;
    const lower = ref.toLowerCase();
    const close = Object.keys(this.available()).filter((n) => n.toLowerCase().includes(lower));
    const hint = close.length ? ` Did you mean: ${close.join(", ")}?` : this.unknownHint();
    throw new DistributionError(`Unknown distribution ${strRepr(ref)}.${hint}`);
  }

  /**
   * Validate a distribution spec (object or JSON text) and make it available
   * by name. Throws if the name is taken by another added distribution,
   * unless `force` is set. Added distributions shadow built-ins.
   */
  add(spec: DistributionSpec | string, options: { name?: string; force?: boolean } = {}): Distribution {
    const parsed = (typeof spec === "string" ? parseJson(spec) : { ...spec }) as DistributionSpec;
    if (options.name) parsed.name = options.name;
    const dist = fromDict(parsed); // validates
    if (this.added.has(dist.name) && !options.force) {
      throw new DistributionError(`${strRepr(dist.name)} already exists (use force to overwrite)`);
    }
    this.added.set(dist.name, { ...parsed, name: dist.name });
    return dist;
  }

  /** Remove a distribution added with {@link add}. Returns whether it existed. */
  remove(name: string): boolean {
    return this.added.delete(name);
  }

  /** Convert `value` from `source` to `target`. `position` (0..1) picks a point inside a label's band. */
  convert(value: Value, source: DistributionRef, target: DistributionRef, position = 0.5): Conversion {
    return convert(value, this.load(source), this.load(target), position);
  }

  /** Rank percentile (0-100, "better than X%") of `value` in `source`. */
  percentile(value: Value, source: DistributionRef, position = 0.5): number {
    return this.load(source).toPercentile(value, position).percentile;
  }

  /** Every non-pseudo distribution except `source` (what `convert` compares against by default). */
  defaultTargets(source: Distribution | string): string[] {
    const name = typeof source === "string" ? source : source.name;
    return Object.entries(this.available())
      .filter(([n, origin]) => origin !== "pseudo" && n !== name)
      .map(([n]) => n);
  }

  /** Convert `value` into several targets at once (default: every other distribution). */
  convertMany(
    value: Value,
    source: DistributionRef,
    options: { targets?: readonly DistributionRef[]; position?: number } = {},
  ): MultiConversion {
    const position = options.position ?? 0.5;
    const src = this.load(source);
    const targets = options.targets?.length ? options.targets : this.defaultTargets(src);
    const placement = src.toPercentile(value, position);
    const results = targets.map((t) => convert(value, src, this.load(t), position));
    return { source: src, placement, results };
  }
}
