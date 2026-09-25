/**
 * The main entry point must run without Node: bundle it for the browser and
 * execute it in a bare JavaScript context (no process, require, Buffer...).
 */

import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { expect, test } from "vitest";

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "rankAnything",
    platform: "browser",
    target: "es2020",
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

test.each(["src/index.ts", "src/core.ts"])("%s bundles for the browser and runs without Node globals", async (entry) => {
  const code = await bundle(entry);
  expect(code).not.toMatch(/\bnode:/);
  const sandbox: Record<string, unknown> = {};
  runInNewContext(`${code}\nthis.ra = rankAnything;`, sandbox);
  const ra = sandbox.ra as typeof import("../src/index.ts");
  expect(typeof ra.Registry).toBe("function");
  if (entry === "src/index.ts") {
    const c = ra.convert("120k", "canada-income", "lol-rank");
    expect(ra.describe(c.target, c.targetPlacement)).toBe("Emerald II  (86% of the way through)");
    expect(Object.keys(ra.available())).toContain("valorant-rank");
  }
});

test("bundling the Node entry point for the browser fails (sanity check)", async () => {
  await expect(bundle("src/node.ts")).rejects.toThrow();
});
