/**
 * rank-anything: convert a value in one distribution to its equivalent in another.
 *
 * Browser-safe: no Node APIs, and the built-in datasets are embedded.
 *
 * ```ts
 * import { convert } from "rank-anything";
 * const c = convert("85k", "canada-income", "lol-rank");
 * c.targetPlacement.value; // 'Platinum I'
 * ```
 */

import { BUILTIN_SPECS } from "./builtins.ts";
import type { Conversion, Distribution, Value } from "./distributions.ts";
import { type DistributionRef, type MultiConversion, type Origin, Registry } from "./registry.ts";

export * from "./core.ts";
export { BUILTIN_SPECS };

/** The default registry: built-in distributions plus any you {@link Registry.add}. */
export const registry: Registry = new Registry({ builtins: BUILTIN_SPECS });

/** Load a distribution by name (e.g. `"lol-rank"`), or from a JSON spec object. */
export function load(ref: DistributionRef): Distribution {
  return registry.load(ref);
}

/** name -> origin ('builtin', 'user', or 'pseudo') of every available distribution. */
export function available(): Record<string, Origin> {
  return registry.available();
}

/**
 * Convert `value` from `source` to `target`. Both may be names
 * (`"lol-rank"`), JSON specs, or Distribution objects.
 *
 * `convert(90, "percentile", "lol-rank").targetPlacement.value` → `'Emerald III'`
 */
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
