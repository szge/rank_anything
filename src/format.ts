/** Human-readable descriptions and tables of distributions and conversions (as the CLI prints them). */

import {
  type Distribution,
  LabeledDistribution,
  LogNormalDistribution,
  NormalDistribution,
  PiecewiseDistribution,
  type Placement,
  convert,
  formatDuration,
  formatNumber,
  formatPercent,
} from "./distributions.ts";
import { textWidth, toFixed } from "./text.ts";

export const STANDARD_PERCENTILES = [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9] as const;

/** A table: column headings plus rows of cells. */
export interface Table {
  header: string[];
  rows: string[][];
}

/** "Platinum II  (86% of the way through)", "85,000 CAD  [beyond known data, extrapolated]". */
export function describe(dist: Distribution, pl: Placement, showPosition = true): string {
  let text = dist.formatValue(pl.value);
  if (showPosition && dist instanceof LabeledDistribution && pl.position !== null) {
    text += `  (${toFixed(pl.position * 100, 0)}% of the way through)`;
  }
  if (pl.clamped) text += "  [outside known range, clamped]";
  else if (pl.extrapolated) text += "  [beyond known data, extrapolated]";
  return text;
}

/**
 * A value as plain text for scripts: labels as they are, times as clock
 * times, percentiles and other numbers without units or thousands separators
 * ("Diamond II", "3:31:46", "97.6", "67400").
 */
export function rawValue(dist: Distribution, value: Placement["value"]): string {
  if (dist instanceof LabeledDistribution) return String(value);
  const x = Number(value);
  if (dist.duration) return formatDuration(x);
  if (dist.unit === "%") return formatPercent(x).slice(0, -1);
  return formatNumber(x).replace(/,/g, "");
}

/** "better than 81.5% (top 18.5%)" */
export function rankLine(p: number): string {
  return `better than ${formatPercent(p)} (top ${formatPercent(100 - p)})`;
}

export function distType(d: Distribution): "labeled" | "normal" | "lognormal" | "numeric" {
  if (d instanceof LabeledDistribution) return "labeled";
  if (d instanceof NormalDistribution) return "normal";
  if (d instanceof LogNormalDistribution) return "lognormal";
  return "numeric";
}

/** Plain-text table with a dashed rule under the header, as lines. */
export function renderTable({ header, rows }: Table): string[] {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((r) => textWidth(String(r[i])))));
  const ljust = (s: string, w: number) => s + " ".repeat(Math.max(0, w - textWidth(s)));
  const line = (r: string[]) => r.map((c, i) => ljust(String(c), widths[i])).join("  ").trimEnd();
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)];
}

/** Metadata lines: title, name/type, description, unit, source, date. */
export function summaryLines(d: Distribution): string[] {
  const out = [d.displayName, `  name: ${d.name}   type: ${distType(d)}`];
  for (const key of ["description", "unit", "source", "date"] as const) if (d[key]) out.push(`  ${key}: ${d[key]}`);
  if (!(d instanceof LabeledDistribution) && !d.higherIsBetter) out.push("  lower values rank higher");
  return out;
}

/** A distribution's data: its bands, its known points, or values at standard percentiles. */
export function dataTable(d: Distribution): Table {
  if (d instanceof LabeledDistribution) {
    return {
      header: ["label", "share", "better than", "label & above"],
      rows: d.bands.map((b) => [
        b.label,
        formatPercent(b.hi - b.lo),
        `${formatPercent(b.lo)} – ${formatPercent(b.hi)}`,
        `top ${formatPercent(100 - b.lo)}`,
      ]),
    };
  }
  if (d instanceof PiecewiseDistribution && d.xs.length <= 40) {
    return {
      header: ["value", "better than"],
      rows: d.xs.map((x, i) => [d.formatValue(x), formatPercent(d.higherIsBetter ? d.ps[i] : 100 - d.ps[i])]),
    };
  }
  return {
    header: ["better than", "value"],
    rows: STANDARD_PERCENTILES.map((p) => [formatPercent(p), d.formatValue(d.fromPercentile(p).value)]),
  };
}

/** Every label of `src` (or standard percentiles, for numeric `src`) mapped onto `dst`. */
export function mappingTable(src: Distribution, dst: Distribution): Table {
  const rows: string[][] = [];
  if (src instanceof LabeledDistribution) {
    for (const b of src.bands) {
      const c = convert(b.label, src, dst);
      rows.push([b.label, formatPercent(c.percentile), describe(dst, c.targetPlacement)]);
    }
  } else {
    for (const p of STANDARD_PERCENTILES) {
      const v = src.fromPercentile(p).value;
      const c = convert(v, src, dst);
      rows.push([src.formatValue(v), formatPercent(c.percentile), describe(dst, c.targetPlacement)]);
    }
  }
  return { header: [src.name, "better than", dst.name], rows };
}
