/**
 * Number and string formatting helpers: fixed-point with round-half-even,
 * `%g`-style general format, shortest float text, quoted strings for error
 * messages, and strict number parsing.
 */

function nonFinite(x: number): string {
  return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
}

/** Exact decimal expansion of |x| (valid for |x| < 1e21 and not too tiny). */
function exactDigits(x: number): [string, string] {
  const [ip, fp = ""] = Math.abs(x).toFixed(100).split(".");
  return [ip, fp];
}

/** Fixed-point with `digits` decimals, rounding exact ties to even. */
export function toFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return nonFinite(x);
  let s = x.toFixed(digits);
  if (Math.abs(x) < 1e21) {
    // JS rounds exact ties away from zero; we round them to even.
    const [ip, fp] = exactDigits(x);
    if (/^50*$/.test(fp.slice(digits))) {
      const kept = digits > 0 ? `${ip}.${fp.slice(0, digits)}` : ip;
      if (Number(kept[kept.length - 1]) % 2 === 0) s = (x < 0 ? "-" : "") + kept;
    }
  }
  if ((x < 0 || Object.is(x, -0)) && !s.startsWith("-")) s = "-" + s;
  return s;
}

/** Insert thousands separators into the integer part of a formatted number. */
export function groupThousands(s: string): string {
  const m = /^(-?)(\d+)(.*)$/.exec(s);
  if (!m) return s;
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + m[3];
}

/** Fixed-point with thousands separators: 1234.5 -> "1,234.5". */
export function toFixedGrouped(x: number, digits: number): string {
  return groupThousands(toFixed(x, digits));
}

function stripZeros(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function pyExponent(exp: number): string {
  return (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
}

/** General format: fixed or exponent notation, `precision` significant digits, no trailing zeros. */
export function toGeneral(x: number, precision: number): string {
  if (!Number.isFinite(x)) return nonFinite(x);
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  const p = Math.max(precision, 1);
  const [mantissa, e] = x.toExponential(p - 1).split("e");
  const exp = Number(e);
  if (exp >= -4 && exp < p) return stripZeros(toFixed(x, p - 1 - exp));
  return `${stripZeros(mantissa)}e${pyExponent(exp)}`;
}

/** Shortest round-trip text for a float, always with a decimal point or exponent ("50.0", "1e-05"). */
export function floatRepr(x: number): string {
  if (!Number.isFinite(x)) return nonFinite(x);
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [mantissa, e] = x.toExponential().split("e");
  const exp = Number(e);
  if (exp >= -4 && exp < 16) {
    const s = String(x); // JS only switches to exponents below 1e-6
    return s.includes(".") ? s : s + ".0";
  }
  return `${mantissa}e${pyExponent(exp)}`;
}

/** Nearest integer, ties to even. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** `s` in quotes for messages: 'text', or "text" when it contains a single quote. */
export function strRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += "\\x" + code.toString(16).padStart(2, "0");
    else out += ch;
  }
  return quote + out + quote;
}

/**
 * A decimal literal (surrounding whitespace allowed),
 * or inf/infinity/nan. Returns undefined when `s` isn't one.
 */
export function parseFloatStrict(s: string): number | undefined {
  const t = s.trim().toLowerCase();
  const m = /^([+-]?)(inf|infinity|nan)$/.exec(t);
  if (m) return m[2] === "nan" ? NaN : m[1] === "-" ? -Infinity : Infinity;
  if (!/^[+-]?(\d+(_\d+)*\.?(\d+(_\d+)*)?|\.\d+(_\d+)*)(e[+-]?\d+(_\d+)*)?$/.test(t)) return undefined;
  return Number(t.replace(/_/g, ""));
}

/** Number of characters (code points, not UTF-16 units). */
export function textWidth(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
