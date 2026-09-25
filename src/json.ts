/**
 * JSON that keeps object key order.
 *
 * JavaScript objects list integer-like keys ("1", "200") first, in numeric
 * order, whatever order the JSON had. For a labeled `frequency` distribution
 * the order of `data` *is* the ranking, so `parseJson` records each object's
 * original key order under a hidden symbol, and `orderedEntries` /
 * `stringifyJson` use it.
 */

export const KEY_ORDER: unique symbol = Symbol.for("rank-anything.keyOrder");

type Ordered = { [KEY_ORDER]?: string[] };

/** Entries of `obj` in their original JSON order (insertion order if it wasn't parsed). */
export function orderedEntries(obj: object): Array<[string, unknown]> {
  const order = (obj as Ordered)[KEY_ORDER];
  const rec = obj as Record<string, unknown>;
  if (!order) return Object.entries(rec);
  // Recorded keys in their original order, then any added since.
  const keys = order.filter((k) => Object.prototype.hasOwnProperty.call(rec, k));
  for (const k of Object.keys(rec)) if (!order.includes(k)) keys.push(k);
  return keys.map((k) => [k, rec[k]]);
}

/** An object whose keys keep the given order when written with {@link stringifyJson}. */
export function orderedObject(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const order: string[] = [];
  for (const [k, v] of entries) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) order.push(k);
    Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  Object.defineProperty(obj, KEY_ORDER, { value: order, enumerable: false });
  return obj;
}

/** Like `JSON.parse`, but objects remember their key order (see {@link orderedEntries}). */
export function parseJson(text: string): unknown {
  JSON.parse(text); // validates, and gives the standard error message
  let i = 0;
  const ws = /[ \t\n\r]*/y;
  const str = /"(?:[^"\\]|\\.)*"/y;
  const num = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  function skip(): void {
    ws.lastIndex = i;
    ws.exec(text);
    i = ws.lastIndex;
  }

  function token(re: RegExp): string {
    re.lastIndex = i;
    const m = re.exec(text)!;
    i = re.lastIndex;
    return m[0];
  }

  function value(): unknown {
    skip();
    const c = text[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      const order: string[] = [];
      skip();
      if (text[i] === "}") i++;
      else {
        for (;;) {
          skip();
          const key = JSON.parse(token(str)) as string;
          skip();
          i++; // ':'
          const v = value();
          if (!Object.prototype.hasOwnProperty.call(obj, key)) order.push(key);
          Object.defineProperty(obj, key, { value: v, enumerable: true, writable: true, configurable: true });
          skip();
          if (text[i++] === "}") break; // else ','
        }
      }
      Object.defineProperty(obj, KEY_ORDER, { value: order, enumerable: false });
      return obj;
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      skip();
      if (text[i] === "]") i++;
      else {
        for (;;) {
          arr.push(value());
          skip();
          if (text[i++] === "]") break;
        }
      }
      return arr;
    }
    if (c === '"') return JSON.parse(token(str));
    if (text.startsWith("true", i)) return (i += 4), true;
    if (text.startsWith("false", i)) return (i += 5), false;
    if (text.startsWith("null", i)) return (i += 4), null;
    return Number(token(num));
  }

  return value();
}

/**
 * `JSON.stringify(value, null, indent)` that keeps key order recorded by
 * {@link parseJson}. `inline` lists keys of the top-level object whose array
 * values stay on one line (`[1, 2, 3]`).
 */
export function stringifyJson(value: unknown, indent = 2, inline: readonly string[] = []): string {
  const pad = (level: number) => (indent ? "\n" + " ".repeat(indent * level) : "");
  const sep = indent ? ": " : ":";

  function write(v: unknown, level: number, flat: boolean): string | undefined {
    if (v === null) return "null";
    if (typeof v === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v !== "object") return undefined;
    if (typeof (v as { toJSON?: unknown }).toJSON === "function") {
      return write((v as { toJSON: () => unknown }).toJSON(), level, flat);
    }
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      const items = v.map((x) => write(x, level + 1, flat) ?? "null");
      if (flat) return `[${items.join(", ")}]`;
      return `[${items.map((x) => pad(level + 1) + x).join(",")}${pad(level)}]`;
    }
    const parts: string[] = [];
    for (const [k, x] of orderedEntries(v)) {
      const s = write(x, level + 1, flat || (level === 0 && inline.includes(k)));
      if (s !== undefined) parts.push(`${pad(level + 1)}${JSON.stringify(k)}${sep}${s}`);
    }
    if (!parts.length) return "{}";
    return `{${parts.join(",")}${pad(level)}}`;
  }

  return write(value, 0, false) ?? "null";
}
