import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { main } from "../src/cli.ts";

/** Approximate equality: relative tolerance 1e-6 by default, or an absolute one. */
export function approx(actual: unknown, expected: number, opts: { abs?: number; rel?: number } = {}): void {
  const tol = Math.max(opts.abs ?? 1e-12, (opts.rel ?? (opts.abs === undefined ? 1e-6 : 0)) * Math.abs(expected));
  expect(typeof actual).toBe("number");
  if (Math.abs((actual as number) - expected) > tol) expect.fail(`expected ${actual} to be ≈ ${expected} (±${tol})`);
}

export function run(...argv: string[]) {
  let out = "";
  let err = "";
  const code = main(argv, { stdout: (s) => void (out += s), stderr: (s) => void (err += s), columns: 80 });
  return { code, out, err };
}

export function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "rank-anything-test-"));
}
