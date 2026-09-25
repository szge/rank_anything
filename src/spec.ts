/**
 * Build distributions from their JSON description (see README for full details):
 *
 *     {
 *       "name": "lol-rank",
 *       "title": "League of Legends solo queue rank",
 *       "type": "frequency" | "percentile" | "samples" | "normal" | "lognormal",
 *       "data": ...,
 *       "unit": "CAD", "source": "...", "date": "...", "description": "...",
 *       "higher_is_better": true,          // numeric only
 *       "percentile_kind": "below" | "top", // "percentile" type only
 *       "tail": "auto" | "pareto" | "exponential" | "clamp",  // numeric point data only
 *       "interpolation": "linear" | "loglog",                // numeric point data only
 *       "duration": "mm:ss" | "h:mm",   // values are times, e.g. "25:20" (see README)
 *       "aliases": { "SSL": "Supersonic Legend" }  // labeled only
 *     }
 */

import {
  DURATION_STYLES,
  type Distribution,
  type DistributionMeta,
  DistributionError,
  type DurationStyle,
  type Interpolation,
  LabeledDistribution,
  LogNormalDistribution,
  NormalDistribution,
  PiecewiseDistribution,
  type TailKind,
  parseDuration,
  parseNumber,
} from "./distributions.ts";
import { IMPORT_SUFFIXES, samplesSpecFromText, stem, suffix } from "./importers.ts";
import { orderedEntries, parseJson } from "./json.ts";
import { parseFloatStrict, strRepr } from "./text.ts";

export const TYPES = ["frequency", "percentile", "samples", "normal", "lognormal"] as const;
export type DistributionType = (typeof TYPES)[number];
const META_KEYS = ["title", "description", "unit", "source", "date"] as const;

/** The JSON format of a distribution. */
export interface DistributionSpec {
  /** Id used to refer to it, e.g. on the command line. */
  name?: string;
  type: DistributionType;
  /**
   * `frequency` / `percentile`: `{label: number}` (or a list of pairs);
   * `samples`: a list of numbers; `normal`: `{mean, std}`; `lognormal`: `{median, sigma}`.
   */
  data: unknown;
  title?: string;
  description?: string;
  unit?: string;
  source?: string;
  date?: string;
  /** Numeric only: set false when smaller values rank higher (e.g. race times). */
  higher_is_better?: boolean;
  /** `percentile` only: "below" (default) = X% are below the value; "top" = the value is the top X%. */
  percentile_kind?: "below" | "top";
  tail?: TailKind;
  interpolation?: Interpolation;
  duration?: DurationStyle;
  /** Labeled only: extra names for labels, e.g. `{"SSL": "Supersonic Legend"}`. */
  aliases?: Record<string, string>;
  /** Treat numeric-looking keys as labels rather than numbers. */
  labels_are_categories?: boolean;
  [key: string]: unknown;
}

/** Truthiness for flags read from JSON: empty lists and objects are false. */
function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Text of a JSON scalar (booleans as True/False, null as None). */
function pyStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v === null) return "None";
  return String(v);
}

/** A JSON value as a number: numbers, booleans, or numeric strings. */
function toFloat(v: unknown, what: string): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return Number(v);
  if (typeof v === "string") {
    const x = parseFloatStrict(v);
    if (x !== undefined) return x;
  }
  throw new DistributionError(`${what}: expected a number, got ${typeof v === "string" ? strRepr(v) : JSON.stringify(v)}`);
}

/**
 * Accept either an ordered object `{"a": 1}` or a list of pairs
 * `[["a", 1]]` / `[{"label": "a", "value": 1}]`.
 */
function pairs(data: unknown, what: string): Array<[string, unknown]> {
  if (isObject(data)) return orderedEntries(data);
  if (Array.isArray(data)) {
    return data.map((item): [string, unknown] => {
      if (Array.isArray(item) && item.length === 2) return [pyStr(item[0]), item[1]];
      if (isObject(item) && Object.keys(item).length === 2) {
        const label = item.label ?? item.value;
        const key = ["frequency", "percentile", "count", "share"].find((k) => k in item);
        if (label !== undefined && label !== null && key !== undefined && item[key] !== null) {
          return [pyStr(label), item[key]];
        }
      }
      throw new DistributionError(`${what}: can't read entry ${JSON.stringify(item)}`);
    });
  }
  throw new DistributionError(`${what}: 'data' must be an object or a list of pairs`);
}

function allNumeric(keys: string[], parse: (v: string) => number): boolean {
  try {
    keys.forEach(parse);
    return true;
  } catch (e) {
    if (e instanceof DistributionError) return false;
    throw e;
  }
}

/** Build a {@link Distribution} from its JSON spec, validating it. */
export function fromDict(spec: DistributionSpec | Record<string, unknown>, defaultName = "custom"): Distribution {
  if (!isObject(spec)) throw new DistributionError("distribution JSON must be an object");
  const name = spec.name ? pyStr(spec.name) : defaultName;
  const dtype = spec.type;
  if (!(TYPES as readonly unknown[]).includes(dtype)) {
    const got = typeof dtype === "string" ? strRepr(dtype) : dtype === undefined ? "None" : JSON.stringify(dtype);
    throw new DistributionError(`${name}: 'type' must be one of ${TYPES.join(", ")} (got ${got})`);
  }
  const meta: DistributionMeta = {};
  for (const k of META_KEYS) if (spec[k] !== undefined && spec[k] !== null) meta[k] = pyStr(spec[k]);
  meta.higherIsBetter = truthy(spec.higher_is_better ?? true);
  const duration = spec.duration;
  if (duration !== undefined && duration !== null) {
    if (!(DURATION_STYLES as readonly unknown[]).includes(duration)) {
      throw new DistributionError(`${name}: 'duration' must be one of ${DURATION_STYLES.join(", ")}`);
    }
    meta.duration = duration as DurationStyle;
  }
  // Numeric keys/values: clock times for duration distributions, else numbers.
  const num = (v: unknown): number => {
    if (typeof v !== "string" && typeof v !== "number") {
      if (typeof v === "boolean") return Number(v);
      throw new DistributionError(`${name}: can't read ${JSON.stringify(v)} as a number`);
    }
    return meta.duration ? parseDuration(v, meta.duration) : parseNumber(v);
  };
  const data = spec.data;
  // How to extend numeric point data past its outermost known values.
  const tail = {
    tail: pyStr(spec.tail ?? "auto") as TailKind,
    interpolation: pyStr(spec.interpolation ?? "linear") as Interpolation,
  };

  if (dtype === "samples") {
    if (!Array.isArray(data)) throw new DistributionError(`${name}: 'samples' data must be a list of numbers`);
    return PiecewiseDistribution.fromSamples(name, data.map(num), { ...tail, ...meta });
  }

  if (dtype === "normal" || dtype === "lognormal") {
    const params = isObject(data) ? data : spec;
    const [a, b] = dtype === "normal" ? ["mean", "std"] : ["median", "sigma"];
    if (params[a] === undefined || params[b] === undefined) {
      throw new DistributionError(`${name}: '${dtype}' data needs '${a}' and '${b}'`);
    }
    const [x, y] = [toFloat(params[a], name), toFloat(params[b], name)];
    return dtype === "normal" ? new NormalDistribution(name, x, y, meta) : new LogNormalDistribution(name, x, y, meta);
  }

  const entries = pairs(data, name);
  if (!entries.length) throw new DistributionError(`${name}: 'data' is empty`);
  let nums = entries.map(([k, v]): [string, number] => [k, toFloat(v, `${name}: ${strRepr(k)}`)]);
  const numericKeys = allNumeric(nums.map(([k]) => k), num) && !truthy(spec.labels_are_categories);
  const aliases = spec.aliases;
  if (aliases !== undefined && aliases !== null && !isObject(aliases)) {
    throw new DistributionError(`${name}: 'aliases' must be an object`);
  }
  const labeledMeta = () => {
    const { higherIsBetter: _h, duration: _d, ...rest } = meta;
    return { ...rest, aliases: aliases as Record<string, string> | undefined };
  };

  if (dtype === "frequency") {
    if (numericKeys) return PiecewiseDistribution.fromWeighted(name, nums.map(([k, f]) => [num(k), f]), { ...tail, ...meta });
    return LabeledDistribution.fromFrequencies(name, nums, labeledMeta());
  }

  // dtype === "percentile"
  const kind = spec.percentile_kind ?? "below";
  if (kind !== "below" && kind !== "top") throw new DistributionError(`${name}: percentile_kind must be 'below' or 'top'`);
  if (kind === "top") nums = nums.map(([k, p]) => [k, 100 - p]);
  if (numericKeys) return new PiecewiseDistribution(name, nums.map(([k, p]) => [num(k), p]), { ...tail, ...meta });
  return LabeledDistribution.fromStarts(name, nums, labeledMeta());
}

/**
 * The spec for a file's contents: parsed JSON, or a `samples` spec built from
 * a .csv/.tsv/.txt file of numbers (chosen by `filename`'s extension). A JSON
 * spec without a name is named after the file. Works in browsers, e.g. on
 * the text of an uploaded file.
 */
export function specFromText(text: string, filename: string): DistributionSpec {
  if (IMPORT_SUFFIXES.includes(suffix(filename))) return samplesSpecFromText(text, filename);
  let spec: unknown;
  try {
    spec = parseJson(text.startsWith("﻿") ? text.slice(1) : text);
  } catch (e) {
    throw new DistributionError(`${filename}: invalid JSON (${(e as Error).message})`);
  }
  if (isObject(spec) && !("name" in spec)) spec.name = stem(filename);
  return spec as DistributionSpec;
}

