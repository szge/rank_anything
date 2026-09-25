/**
 * Core distribution model.
 *
 * Every distribution is reduced to a monotone mapping between its own values and a
 * *rank percentile* in [0, 100] ("better than X% of the population"). Converting
 * between two distributions is then:
 *
 *     value --(source.toPercentile)--> percentile --(target.fromPercentile)--> value
 *
 * Whenever an exact value is not one of the known points, we linearly interpolate
 * between the nearest known points (numeric distributions) or within a label's
 * band (labeled/tiered distributions).
 */

import { floatRepr, parseFloatStrict, roundHalfEven, strRepr, toFixed, toFixedGrouped, toGeneral } from "./text.ts";
import { normalCdf, normalInvCdf } from "./stats.ts";

/** A value in a distribution: a number, or a label such as "Gold II". */
export type Value = number | string;

/** Raised for malformed distributions or values that can't be placed. */
export class DistributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributionError";
  }
}

/** Where a percentile lands in a particular distribution. */
export class Placement {
  percentile: number;
  value: Value;
  /** For labeled distributions: how far through the label's band (0..1). */
  position: number | null;
  /**
   * True if the requested value/percentile was outside the known range and
   * was pinned to the nearest endpoint (hard bound, e.g. a max score).
   */
  clamped: boolean;
  /**
   * True if it was outside the known range and estimated by extending the
   * distribution's tail beyond the last known points.
   */
  extrapolated: boolean;

  constructor(percentile: number, value: Value, position: number | null = null, clamped = false, extrapolated = false) {
    this.percentile = percentile;
    this.value = value;
    this.position = position;
    this.clamped = clamped;
    this.extrapolated = extrapolated;
  }

  get topPercent(): number {
    return 100 - this.percentile;
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Index of the first element >= x in sorted `xs`. */
export function bisectLeft(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index after the last element <= x in sorted `xs`. */
export function bisectRight(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < xs[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Piecewise-linear interpolation of `x` over sorted `xs`.
 *
 * `xs` must be non-decreasing and `x` within [xs[0], xs[-1]]. Flat runs
 * (repeated xs) resolve to the midpoint of their ys.
 */
function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  const lo = bisectLeft(xs, x);
  const hi = bisectRight(xs, x);
  if (lo !== hi) return (ys[lo] + ys[hi - 1]) / 2; // x matches one or more known points exactly
  if (lo === 0) return ys[0];
  if (lo >= xs.length) return ys[ys.length - 1];
  const [x0, x1, y0, y1] = [xs[lo - 1], xs[lo], ys[lo - 1], ys[lo]];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Descriptive fields shared by every distribution. */
export interface DistributionMeta {
  title?: string;
  description?: string;
  unit?: string;
  source?: string;
  date?: string;
  higherIsBetter?: boolean;
  /**
   * Numeric only: values are durations in seconds, entered/shown as clock
   * times. "mm:ss" or "h:mm" says how a two-part time like "3:31" is read.
   */
  duration?: DurationStyle | "";
}

export abstract class Distribution {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly unit: string;
  readonly source: string;
  readonly date: string;
  readonly higherIsBetter: boolean;
  readonly duration: DurationStyle | "";
  abstract readonly kind: "numeric" | "labeled";

  constructor(name: string, meta: DistributionMeta = {}) {
    this.name = name;
    this.title = meta.title ?? "";
    this.description = meta.description ?? "";
    this.unit = meta.unit ?? "";
    this.source = meta.source ?? "";
    this.date = meta.date ?? "";
    this.higherIsBetter = meta.higherIsBetter ?? true;
    this.duration = meta.duration ?? "";
  }

  /** Rank percentile of `value`. `position` (0..1) picks a point inside a label's band. */
  abstract toPercentile(value: Value, position?: number): Placement;

  /** The value at rank percentile `percentile` (0..100). */
  abstract fromPercentile(percentile: number): Placement;

  parseValue(raw: Value): Value {
    return raw;
  }

  formatValue(value: Value): string {
    return String(value);
  }

  get displayName(): string {
    return this.title || this.name;
  }
}

// --------------------------------------------------------------------------- numeric

const SUFFIXES: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** Parse numbers like `85000`, `85,000`, `$85k`, `1.2M`, `-3.5`. */
export function parseNumber(raw: string | number): number {
  if (typeof raw === "number") return raw;
  let s = raw.trim().toLowerCase().replace(/,/g, "").replace(/_/g, "");
  s = s.replace(/^(?:[a-z]{0,2}[$€£¥₹₩])\s*/, ""); // currency: $, C$, US$, €...
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([kmb])?\s*%?$/.exec(s);
  if (!m) throw new DistributionError(`Could not parse a number from ${strRepr(String(raw))}`);
  return Number(m[1]) * (SUFFIXES[m[2] ?? ""] ?? 1);
}

export const DURATION_STYLES = ["mm:ss", "h:mm"] as const;
export type DurationStyle = (typeof DURATION_STYLES)[number];

/**
 * Parse a duration to seconds: '1:02:03', '25:20' (mm:ss, or h:mm when
 * `style` is 'h:mm'), '3h31m', '25m20s', or a plain number of minutes.
 */
export function parseDuration(raw: string | number, style: DurationStyle = "mm:ss"): number {
  if (typeof raw === "number") return raw * 60;
  const s = raw.trim().toLowerCase().replace(/ /g, "");
  if (s.includes(":")) {
    const nums = s.split(":").map(parseFloatStrict);
    if (nums.some((n) => n === undefined) || (nums.length !== 2 && nums.length !== 3)) {
      throw new DistributionError(`Could not parse a time from ${strRepr(raw)}`);
    }
    const [a, b, c] = nums as number[];
    const [h, m, sec] = nums.length === 3 ? [a, b, c] : style === "h:mm" ? [a, b, 0] : [0, a, b];
    return h * 3600 + m * 60 + sec;
  }
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
  if (m && (m[1] || m[2] || m[3])) {
    const [h, mi, sec] = [m[1], m[2], m[3]].map((g) => (g ? Number(g) : 0));
    return h * 3600 + mi * 60 + sec;
  }
  return parseNumber(s) * 60; // bare number = minutes
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return floatRepr(seconds);
  const total = roundHalfEven(seconds);
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = abs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${sign}${h}:${pad(m)}:${pad(sec)}` : `${sign}${m}:${pad(sec)}`;
}

/**
 * Readable percent that keeps ~2 significant digits of the distance to
 * 0%/100%, so far tails stay distinguishable (99.9988%, 0.0012%).
 */
export function formatPercent(p: number): string {
  const tail = Math.min(p, 100 - p);
  let digits: number;
  if (tail >= 1) digits = 1;
  else if (tail > 0) digits = Math.min(12, 1 - Math.floor(Math.log10(tail)));
  else digits = 0;
  let text = toFixed(p, digits);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text + "%";
}

/** A number the way the CLI shows it: `85,000`, `12.5`, `0.1235`. */
export function formatNumber(x: number): string {
  if (Math.abs(x) >= 1000) return toFixedGrouped(x, 0);
  if (!Number.isFinite(x)) return floatRepr(x);
  if (x === Math.trunc(x)) return toFixed(x, 0);
  if (Math.abs(x) < 1) return toGeneral(x, 4);
  return toFixedGrouped(x, 2).replace(/0+$/, "").replace(/\.$/, "");
}

export type TailStatus = "" | "clamped" | "extrapolated";

/**
 * Base for distributions over numbers. Subclasses provide `cdf`/`ppf` in
 * terms of "% of population with a *smaller* value" (0..100).
 */
export abstract class NumericDistribution extends Distribution {
  readonly kind = "numeric" as const;

  /** % of the population below `x`, plus whether `x` was clamped or extrapolated. */
  abstract cdf(x: number): [number, TailStatus];

  /** Inverse of {@link cdf}. */
  abstract ppf(p: number): [number, TailStatus];

  override parseValue(raw: Value): number {
    if (this.duration) {
      // Text is human input ("25:20", or "25" = minutes); numbers are
      // already in the stored unit, seconds.
      if (typeof raw === "number") return raw;
      return parseDuration(raw, this.duration);
    }
    return parseNumber(raw);
  }

  override formatValue(value: Value): string {
    const x = Number(value);
    if (this.duration) return formatDuration(x);
    if (this.unit === "%") return formatPercent(x);
    const s = formatNumber(x);
    return this.unit ? `${s} ${this.unit}`.trim() : s;
  }

  toPercentile(value: Value, _position = 0.5): Placement {
    const x = this.parseValue(value);
    const [p, status] = this.cdf(x);
    const rank = this.higherIsBetter ? p : 100 - p;
    return new Placement(rank, x, null, status === "clamped", status === "extrapolated");
  }

  fromPercentile(percentile: number): Placement {
    const p = this.higherIsBetter ? percentile : 100 - percentile;
    const [x, status] = this.ppf(p);
    return new Placement(percentile, x, null, status === "clamped", status === "extrapolated");
  }
}

export const TAIL_KINDS = ["auto", "pareto", "exponential", "clamp"] as const;
export type TailKind = (typeof TAIL_KINDS)[number];
export const INTERPOLATIONS = ["linear", "loglog"] as const;
export type Interpolation = (typeof INTERPOLATIONS)[number];

/**
 * Extends a piecewise distribution past its last known point.
 *
 * Fitted to the two outermost known points, in terms of the population share
 * beyond x (`mass`: the % above x for the upper tail, below x for the lower):
 *
 * - `pareto`: mass shrinks as a power of x (`mass ∝ x^-a` upward, `x^a`
 *   toward 0). Used when values are positive, which suits skewed data like
 *   incomes, wealth or follower counts.
 * - `exponential`: mass shrinks exponentially with distance, for data that
 *   can be zero or negative.
 *
 * Endpoints at 0% / 100% are hard bounds (e.g. a max score), so there is no
 * tail there and values beyond are clamped instead.
 */
export class Tail {
  readonly kind: "pareto" | "exponential";
  readonly rate: number;
  readonly x0: number;
  readonly m0: number;
  readonly upper: boolean;

  /** (x0, m0) is the outermost point, (x1, m1) the next one in. */
  constructor(x0: number, m0: number, x1: number, m1: number, kind: "pareto" | "exponential", upper: boolean) {
    this.x0 = x0;
    this.m0 = m0;
    this.upper = upper;
    const ratio = Math.log(m1 / m0); // > 0: mass grows moving inward
    this.kind = kind;
    this.rate = kind === "pareto" ? ratio / Math.abs(Math.log(x0 / x1)) : ratio / Math.abs(x0 - x1);
  }

  mass(x: number): number {
    if (this.kind === "pareto") {
      if (x <= 0) return 0;
      return this.m0 * (x / this.x0) ** (this.upper ? -this.rate : this.rate);
    }
    const d = this.upper ? x - this.x0 : this.x0 - x;
    return this.m0 * Math.exp(-this.rate * d);
  }

  value(mass: number): number {
    if (mass <= 0) return this.upper ? Infinity : this.kind === "pareto" ? 0 : -Infinity;
    const k = Math.log(mass / this.m0) / this.rate; // <= 0 in the tail
    if (this.kind === "pareto") return this.x0 * Math.exp(this.upper ? -k : k);
    return this.upper ? this.x0 - k : this.x0 + k;
  }
}

export interface PiecewiseOptions extends DistributionMeta {
  tail?: TailKind;
  interpolation?: Interpolation;
}

/**
 * Numeric distribution defined by known (value, cdf-percentile) points.
 * Values between points are linearly interpolated; values beyond the
 * outermost points follow a fitted tail (see {@link Tail}).
 */
export class PiecewiseDistribution extends NumericDistribution {
  readonly xs: readonly number[];
  readonly ps: readonly number[];
  readonly tail: TailKind;
  readonly interpolation: Interpolation;
  readonly upperTail: Tail | null;
  readonly lowerTail: Tail | null;
  /** Segments interpolated as a power law instead of a straight line. */
  private readonly power: boolean[];

  constructor(name: string, points: ReadonlyArray<readonly [number, number]>, options: PiecewiseOptions = {}) {
    const { tail = "auto", interpolation = "linear", ...meta } = options;
    super(name, meta);
    if (!(INTERPOLATIONS as readonly string[]).includes(interpolation)) {
      throw new DistributionError(`${name}: 'interpolation' must be one of ${INTERPOLATIONS.join(", ")}`);
    }
    this.interpolation = interpolation;
    if (points.length < 2) throw new DistributionError(`${name}: need at least 2 points to interpolate`);
    if (!(TAIL_KINDS as readonly string[]).includes(tail)) {
      throw new DistributionError(`${name}: 'tail' must be one of ${TAIL_KINDS.join(", ")}`);
    }
    const pts = points.map(([x, p]) => [Number(x), Number(p)] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const xs = pts.map(([x]) => x);
    const ps = pts.map(([, p]) => p);
    for (let i = 1; i < ps.length; i++) {
      if (ps[i] < ps[i - 1]) {
        throw new DistributionError(
          `${name}: percentiles must increase with value (got ${floatRepr(ps[i - 1])} then ${floatRepr(ps[i])})`,
        );
      }
    }
    if (ps[0] < 0 || ps[ps.length - 1] > 100) throw new DistributionError(`${name}: percentiles must be within 0..100`);
    if (ps[0] === ps[ps.length - 1]) throw new DistributionError(`${name}: all points have the same percentile`);
    this.xs = xs;
    this.ps = ps;
    this.tail = tail;
    this.power = xs.slice(1).map((_, i) => interpolation === "loglog" && this.powerOk(i));
    this.upperTail = this.fitTail(true);
    this.lowerTail = this.fitTail(false);
  }

  /**
   * `loglog` applies to upper-half segments with positive values and a
   * shrinking, non-zero share above (the Pareto-like part of the data).
   */
  private powerOk(i: number): boolean {
    const [x0, x1, p0, p1] = [this.xs[i], this.xs[i + 1], this.ps[i], this.ps[i + 1]];
    return p0 >= 50 && x0 > 0 && x1 > x0 && 100 - p1 > 0 && p1 > p0;
  }

  /** Share above x follows m0 * (x/x0)^-a through segment i's endpoints. */
  private powerCdf(i: number, x: number): number {
    const [x0, x1, m0, m1] = [this.xs[i], this.xs[i + 1], 100 - this.ps[i], 100 - this.ps[i + 1]];
    const a = Math.log(m0 / m1) / Math.log(x1 / x0);
    return 100 - m0 * (x / x0) ** -a;
  }

  private powerPpf(i: number, p: number): number {
    const [x0, x1, m0, m1] = [this.xs[i], this.xs[i + 1], 100 - this.ps[i], 100 - this.ps[i + 1]];
    const a = Math.log(m0 / m1) / Math.log(x1 / x0);
    return x0 * ((100 - p) / m0) ** (-1 / a);
  }

  private fitTail(upper: boolean): Tail | null {
    if (this.tail === "clamp") return null;
    let pts: Array<[number, number]> = this.xs.map((x, i) => [x, this.ps[i]]);
    if (upper) pts = pts.reverse().map(([x, p]) => [x, 100 - p]);
    const [x0, m0] = pts[0];
    if (m0 <= 0) return null; // endpoint at 0%/100%: a hard bound
    // Next point inward with strictly more mass and a different value.
    const inner = pts.slice(1).find(([x, m]) => m > m0 && x !== x0);
    if (!inner) return null;
    let kind = this.tail;
    if (kind === "auto") kind = x0 > 0 && inner[0] > 0 ? "pareto" : "exponential";
    if (kind === "pareto" && (x0 <= 0 || inner[0] <= 0)) {
      throw new DistributionError(`${this.name}: a pareto tail needs positive values`);
    }
    return new Tail(x0, m0, inner[0], inner[1], kind as "pareto" | "exponential", upper);
  }

  cdf(x: number): [number, TailStatus] {
    const { xs, ps } = this;
    if (x < xs[0]) {
      if (this.lowerTail) return [this.lowerTail.mass(x), "extrapolated"];
      return [ps[0], "clamped"];
    }
    if (x > xs[xs.length - 1]) {
      if (this.upperTail) return [100 - this.upperTail.mass(x), "extrapolated"];
      return [ps[ps.length - 1], "clamped"];
    }
    const i = bisectLeft(xs, x) - 1;
    if (i >= 0 && i < this.power.length && this.power[i] && xs[i] < x) return [this.powerCdf(i, x), ""];
    return [interp(x, xs, ps), ""];
  }

  ppf(p: number): [number, TailStatus] {
    const { xs, ps } = this;
    if (p < ps[0]) {
      if (this.lowerTail && p > 0) return [this.lowerTail.value(p), "extrapolated"];
      return [xs[0], "clamped"];
    }
    if (p > ps[ps.length - 1]) {
      if (this.upperTail && p < 100) return [this.upperTail.value(100 - p), "extrapolated"];
      return [xs[xs.length - 1], "clamped"];
    }
    const i = bisectLeft(ps, p) - 1;
    if (i >= 0 && i < this.power.length && this.power[i] && ps[i] < p) return [this.powerPpf(i, p), ""];
    return [interp(p, ps, xs), ""];
  }

  /**
   * Empirical distribution: the i-th smallest of n samples sits at the
   * midpoint of its 1/n share, (i + 0.5) / n. This leaves room below the
   * smallest and above the largest sample for the tails.
   */
  static fromSamples(name: string, samples: readonly number[], options: PiecewiseOptions = {}): PiecewiseDistribution {
    const xs = samples.map(Number).sort((a, b) => a - b);
    if (xs.length < 2) throw new DistributionError(`${name}: need at least 2 samples`);
    return PiecewiseDistribution.fromWeighted(name, xs.map((x) => [x, 1] as const), options);
  }

  /** Histogram of numeric values -> each value sits at the midpoint of its cumulative share of the population. */
  static fromWeighted(
    name: string,
    weights: ReadonlyArray<readonly [number, number]>,
    options: PiecewiseOptions = {},
  ): PiecewiseDistribution {
    const merged = new Map<number, number>();
    for (const [v, w] of weights) merged.set(Number(v), (merged.get(Number(v)) ?? 0) + Number(w));
    const items = [...merged.entries()].sort((a, b) => a[0] - b[0]);
    const total = items.reduce((s, [, w]) => s + w, 0);
    if (!(total > 0) || items.some(([, w]) => w < 0)) {
      throw new DistributionError(`${name}: frequencies must be non-negative, sum > 0`);
    }
    const pts: Array<[number, number]> = [];
    let cum = 0;
    for (const [v, w] of items) {
      pts.push([v, (100 * (cum + w / 2)) / total]);
      cum += w;
    }
    return new PiecewiseDistribution(name, pts, options);
  }
}

const EPS = 1e-15;

export class NormalDistribution extends NumericDistribution {
  readonly mean: number;
  readonly std: number;

  constructor(name: string, mean: number, std: number, meta: DistributionMeta = {}) {
    super(name, meta);
    if (!(std > 0)) throw new DistributionError(`${name}: std must be positive`);
    this.mean = Number(mean);
    this.std = Number(std);
  }

  cdf(x: number): [number, TailStatus] {
    return [100 * normalCdf(x, this.mean, this.std), ""];
  }

  ppf(p: number): [number, TailStatus] {
    const q = p / 100;
    const status = q <= EPS || q >= 1 - EPS ? "clamped" : "";
    return [normalInvCdf(clamp(q, EPS, 1 - EPS), this.mean, this.std), status];
  }
}

/** Log-normal, parameterised by its median and sigma (std of ln(x)). */
export class LogNormalDistribution extends NumericDistribution {
  readonly median: number;
  readonly sigma: number;

  constructor(name: string, median: number, sigma: number, meta: DistributionMeta = {}) {
    super(name, meta);
    if (!(median > 0) || !(sigma > 0)) throw new DistributionError(`${name}: median and sigma must be positive`);
    this.median = Number(median);
    this.sigma = Number(sigma);
  }

  cdf(x: number): [number, TailStatus] {
    if (x <= 0) return [0, x < 0 ? "clamped" : ""];
    return [100 * normalCdf(Math.log(x), Math.log(this.median), this.sigma), ""];
  }

  ppf(p: number): [number, TailStatus] {
    const q = p / 100;
    const status = q <= EPS || q >= 1 - EPS ? "clamped" : "";
    return [Math.exp(normalInvCdf(clamp(q, EPS, 1 - EPS), Math.log(this.median), this.sigma)), status];
  }
}

// --------------------------------------------------------------------------- labeled

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5" };

function labelTokens(label: string): string[] {
  const tokens = String(label).toLowerCase().match(/[a-z]+|[0-9]+/g) ?? [];
  return tokens.map((t, i) => (i > 0 && Object.prototype.hasOwnProperty.call(ROMAN, t) ? ROMAN[t] : t));
}

const isAlpha = (t: string) => /^[a-z]/.test(t);
const isDigit = (t: string) => /^[0-9]/.test(t);

/** Case/spacing-insensitive key; 'Gold II' == 'gold 2' == 'GOLD-2'. */
export function normalizeLabel(label: string): string {
  return labelTokens(label).join("");
}

/** 'plat 2' matches 'Platinum II': each query token prefixes a label token. */
function tokenPrefixMatch(query: string[], label: string[]): boolean {
  return query.length > 0 && query.length <= label.length && query.every((q, i) => label[i].startsWith(q));
}

export interface Band {
  label: string;
  /** Rank percentile where this label starts. */
  lo: number;
  /** Rank percentile where this label ends. */
  hi: number;
}

/**
 * Ordered categories (ranks, levels, grades), worst -> best. Each label
 * covers a band of rank percentiles; positions inside a band interpolate.
 */
export class LabeledDistribution extends Distribution {
  readonly kind = "labeled" as const;
  readonly bands: readonly Band[];
  private readonly index = new Map<string, number>();
  private readonly tokens: string[][];
  private readonly acronyms: string[];
  private readonly aliases = new Map<string, number>();

  constructor(name: string, bands: readonly Band[], options: DistributionMeta & { aliases?: Record<string, string> | null } = {}) {
    const { aliases, ...meta } = options;
    super(name, meta);
    if (!bands.length) throw new DistributionError(`${name}: no labels given`);
    this.bands = bands.map((b) => ({ ...b }));
    this.tokens = this.bands.map((b) => labelTokens(b.label));
    // "Grand Champion 2" -> "gc2": initials of the words plus any numbers,
    // for labels with at least two words.
    this.acronyms = this.tokens.map((toks) =>
      toks.filter(isAlpha).length >= 2
        ? toks.filter(isAlpha).map((t) => t[0]).join("") + toks.filter(isDigit).join("")
        : "",
    );
    this.bands.forEach((b, i) => {
      if (b.hi < b.lo) throw new DistributionError(`${name}: label ${strRepr(b.label)} has negative width`);
      const key = normalizeLabel(b.label);
      if (this.index.has(key)) throw new DistributionError(`${name}: duplicate label ${strRepr(b.label)}`);
      this.index.set(key, i);
    });
    // Extra names people use for a label, e.g. {"SSL": "Supersonic Legend"}.
    for (const [alias, target] of Object.entries(aliases ?? {})) {
      const key = normalizeLabel(alias);
      const targetKey = normalizeLabel(String(target));
      const idx = this.index.get(targetKey);
      if (idx === undefined) {
        throw new DistributionError(`${name}: alias ${strRepr(alias)} points to unknown label ${strRepr(String(target))}`);
      }
      if (this.index.has(key)) throw new DistributionError(`${name}: alias ${strRepr(alias)} clashes with a label`);
      this.aliases.set(key, idx);
    }
  }

  /** Labels (worst -> best) with the share of population in each. */
  static fromFrequencies(
    name: string,
    freqs: ReadonlyArray<readonly [string, number]>,
    options: DistributionMeta & { aliases?: Record<string, string> | null } = {},
  ): LabeledDistribution {
    const total = freqs.reduce((s, [, f]) => s + Number(f), 0);
    if (!(total > 0) || freqs.some(([, f]) => Number(f) < 0)) {
      throw new DistributionError(`${name}: frequencies must be non-negative, sum > 0`);
    }
    const bands: Band[] = [];
    let cum = 0;
    for (const [label, f] of freqs) {
      const lo = (100 * cum) / total;
      cum += Number(f);
      bands.push({ label: String(label), lo, hi: (100 * cum) / total });
    }
    bands[bands.length - 1].hi = 100; // guard against float drift
    return new LabeledDistribution(name, bands, options);
  }

  /**
   * Labels with the rank percentile at which each one *starts* (i.e. % of
   * population below it). Each band ends where the next starts.
   */
  static fromStarts(
    name: string,
    starts: ReadonlyArray<readonly [string, number]>,
    options: DistributionMeta & { aliases?: Record<string, string> | null } = {},
  ): LabeledDistribution {
    const items = starts.map(([l, p]) => [String(l), Number(p)] as const).sort((a, b) => a[1] - b[1]);
    if (items.some(([, p]) => !(p >= 0 && p <= 100))) {
      throw new DistributionError(`${name}: percentiles must be within 0..100`);
    }
    const bands = items.map(([label, p], i) => ({ label, lo: p, hi: i + 1 < items.length ? items[i + 1][1] : 100 }));
    return new LabeledDistribution(name, bands, options);
  }

  get labels(): string[] {
    return this.bands.map((b) => b.label);
  }

  private prefixMatches(label: string): number[] {
    const query = labelTokens(label);
    const key = query.join("");
    const keys = [...this.index.keys()];
    const out: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      const acr = this.acronyms[i];
      if ((key && (keys[i].startsWith(key) || (acr && acr.startsWith(key)))) || tokenPrefixMatch(query, this.tokens[i])) {
        out.push(i);
      }
    }
    return out;
  }

  /** The band for `label`: exact (case/spacing-insensitive), alias, acronym or unique prefix. */
  find(label: string): Band {
    const key = normalizeLabel(label);
    const exact = this.index.get(key) ?? this.aliases.get(key);
    if (exact !== undefined) return this.bands[exact];
    const matches = this.prefixMatches(label).map((i) => this.bands[i]);
    if (matches.length === 1) return matches[0];
    const hint = matches.length
      ? ` Did you mean one of: ${matches.slice(0, 8).map((b) => b.label).join(", ")}?`
      : ` Known labels: ${this.labels.join(", ")}`;
    throw new DistributionError(`${this.name}: unknown label ${strRepr(label)}.${hint}`);
  }

  /**
   * Like {@link find}, but a prefix matching several *adjacent* labels
   * (e.g. 'gold' -> Gold IV..Gold I) returns their combined band.
   */
  findSpan(label: string): Band {
    const key = normalizeLabel(label);
    if (!this.index.has(key) && !this.aliases.has(key)) {
      const idx = this.prefixMatches(label);
      if (idx.length > 1 && idx.every((v, i) => v === idx[0] + i)) {
        const first = this.bands[idx[0]];
        const last = this.bands[idx[idx.length - 1]];
        return { label: `${first.label} – ${last.label}`, lo: first.lo, hi: last.hi };
      }
    }
    return this.find(label);
  }

  override parseValue(raw: Value): string {
    return this.findSpan(String(raw)).label;
  }

  override formatValue(value: Value): string {
    return String(value);
  }

  toPercentile(value: Value, position = 0.5): Placement {
    if (!(position >= 0 && position <= 1)) throw new DistributionError("position must be between 0 and 1");
    const b = this.findSpan(String(value));
    return new Placement(b.lo + position * (b.hi - b.lo), b.label, position);
  }

  fromPercentile(percentile: number): Placement {
    const clamped = !(percentile >= 0 && percentile <= 100);
    const p = clamp(percentile, 0, 100);
    // Last band whose start is <= p (ties at a boundary go to the better label).
    let idx = Math.max(0, bisectRight(this.bands.map((b) => b.lo), p) - 1);
    // Skip empty bands sitting exactly at p.
    while (idx > 0 && this.bands[idx].hi === this.bands[idx].lo && p <= this.bands[idx].lo) idx--;
    const b = this.bands[idx];
    const width = b.hi - b.lo;
    const pos = width > 0 ? (p - b.lo) / width : 0.5;
    return new Placement(percentile, b.label, clamp(pos, 0, 1), clamped);
  }
}

// --------------------------------------------------------------------------- convert

export class Conversion {
  readonly source: Distribution;
  readonly target: Distribution;
  readonly sourcePlacement: Placement;
  readonly targetPlacement: Placement;

  constructor(source: Distribution, target: Distribution, sourcePlacement: Placement, targetPlacement: Placement) {
    this.source = source;
    this.target = target;
    this.sourcePlacement = sourcePlacement;
    this.targetPlacement = targetPlacement;
  }

  get percentile(): number {
    return this.sourcePlacement.percentile;
  }
}

/** Map `value` in `source` to the equivalent value in `target`. */
export function convert(value: Value, source: Distribution, target: Distribution, position = 0.5): Conversion {
  const sp = source.toPercentile(value, position);
  const tp = target.fromPercentile(sp.percentile);
  return new Conversion(source, target, sp, tp);
}
