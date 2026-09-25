/**
 * Write package.json's version into src/version.ts. The version is a constant
 * rather than read from package.json so the browser bundle can use it. Runs
 * automatically from `npm version`, which commits the result.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "./gen_builtins.ts";

export const VERSION_FILE = join(ROOT, "src", "version.ts");

export function renderVersion(): string {
  const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
  return `export const VERSION = "${version}";\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(VERSION_FILE, renderVersion());
  console.log(`wrote ${VERSION_FILE}`);
}
