import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as core from "../src/core.ts";
import * as ra from "../src/index.ts";
import { BUILTINS_FILE, renderBuiltins } from "../scripts/gen_builtins.ts";
import { VERSION_FILE, renderVersion } from "../scripts/sync_version.ts";
import { approx } from "./helpers.ts";

test("src/builtins.ts is in sync with data/ (run `npm run gen`)", () => {
  expect(readFileSync(BUILTINS_FILE, "utf8")).toBe(renderBuiltins());
});

test("src/version.ts is in sync with package.json (run `node scripts/sync_version.ts`)", () => {
  expect(readFileSync(VERSION_FILE, "utf8")).toBe(renderVersion());
});

test("README API example", () => {
  const c = ra.convert("85k", "canada-income", "lol-rank");
  approx(c.percentile, 81.48, { abs: 0.01 });
  expect(c.targetPlacement.value).toBe("Platinum I");
  approx(c.targetPlacement.position, 0.74, { abs: 0.01 });
  approx(ra.percentile("E6", "meta-level"), 90.5);
  expect(ra.load({ type: "normal", data: { mean: 0, std: 1 } }).toPercentile(0).percentile).toBe(50);
  expect(ra.fromDict({ type: "normal", data: { mean: 0, std: 1 } }).kind).toBe("numeric");
});

describe("in-memory registry (browser use)", () => {
  test("add, shadow, force, remove", () => {
    const reg = new ra.Registry({ builtins: ra.BUILTIN_SPECS });
    const team = reg.add({ name: "team", type: "samples", data: [1, 2, 3, 4] });
    expect(team.name).toBe("team");
    expect(reg.available().team).toBe("user");
    approx(reg.percentile(3, "team"), 62.5);
    expect(() => reg.add({ name: "team", type: "samples", data: [5, 6] })).toThrow(/already exists/);
    reg.add('{"name": "team", "type": "samples", "data": [5, 6]}', { force: true });
    approx(reg.percentile(5.5, "team"), 50);
    // Added distributions shadow built-ins, and are compared against by default.
    reg.add({ type: "percentile", data: { "0": 0, "100": 100 } }, { name: "iq" });
    expect(reg.available().iq).toBe("user");
    approx(reg.percentile(30, "iq"), 30);
    expect(reg.convertMany(3, "team").results.map((c) => c.target.name)).toContain("iq");
    expect(reg.remove("iq")).toBe(true);
    expect(reg.available().iq).toBe("builtin");
    expect(() => reg.add({ type: "nope", data: [] } as unknown as ra.DistributionSpec)).toThrow(ra.DistributionError);
  });

  test("the default registry doesn't see the filesystem", () => {
    expect(() => ra.load("examples/team-salaries.json")).toThrow(/Unknown distribution/);
  });

  test("convertMany", () => {
    const m = ra.convertMany("E5", "meta-level", { targets: ["lol-rank", "iq"] });
    approx(m.placement.percentile, 71.5);
    expect(m.results.map((c) => ra.describe(c.target, c.targetPlacement))).toEqual([
      "Platinum III  (7% of the way through)",
      "108.52 IQ",
    ]);
    const all = ra.convertMany("E5", "meta-level");
    expect(all.results.length).toBe(Object.keys(ra.available()).length - 3); // minus itself and the 2 pseudo
  });

  test("uploaded file text: JSON, CSV and TXT", () => {
    const csv = readFileSync("examples/team-salaries.csv", "utf8");
    const spec = ra.specFromText(csv, "team-salaries.csv");
    expect(spec.type).toBe("samples");
    expect(spec.name).toBe("team-salaries");
    const json = ra.specFromText(readFileSync("examples/team-salaries.json", "utf8"), "whatever.json");
    approx(ra.percentile(97000, spec), ra.percentile(97000, json));
    expect(ra.specFromText('{"type": "normal", "data": {"mean": 1, "std": 2}}', "dir/my-dist.json").name).toBe("my-dist");
    expect(() => ra.specFromText("{nope", "x.json")).toThrow(/x.json: invalid JSON/);
    expect(ra.samplesSpecFromText("3 1 2", "t.txt", { unit: "min", higherIsBetter: false })).toMatchObject({
      name: "t",
      unit: "min",
      higher_is_better: false,
      data: [3, 1, 2],
    });
  });

  test("the core entry point has no built-in data", () => {
    const reg = new core.Registry();
    expect(Object.keys(reg.available())).toEqual(["percentile", "top"]);
    expect("BUILTIN_SPECS" in core).toBe(false);
  });
});

describe("JSON key order", () => {
  // JS objects put integer-like keys first; for labeled data the order is the ranking.
  const text = '{"type": "frequency", "labels_are_categories": true, "data": {"Unranked": 10, "10": 20, "2": 30, "1": 40}}';

  test("parsed specs keep the order of labels", () => {
    const d = ra.fromDict(ra.parseJson(text) as ra.DistributionSpec) as ra.LabeledDistribution;
    expect(d.labels).toEqual(["Unranked", "10", "2", "1"]);
    expect(JSON.parse(text).data && Object.keys(JSON.parse(text).data)).toEqual(["1", "2", "10", "Unranked"]);
  });

  test("dumpSpec and the registry keep it too", () => {
    const spec = ra.parseJson(text) as ra.DistributionSpec;
    expect(ra.dumpSpec(spec)).toContain('"Unranked": 10,\n    "10": 20,\n    "2": 30,\n    "1": 40');
    const reg = new core.Registry();
    reg.add(text, { name: "odd" });
    expect((reg.load("odd") as ra.LabeledDistribution).labels[0]).toBe("Unranked");
  });

  test("keys added after parsing are kept", () => {
    const spec = ra.parseJson('{"type": "samples", "data": [1, 2]}') as Record<string, unknown>;
    spec.name = "late";
    expect(ra.stringifyJson(spec, 0)).toBe('{"type":"samples","data":[1,2],"name":"late"}');
  });

  test("a list of pairs works for plain objects", () => {
    const d = ra.fromDict({ type: "frequency", labels_are_categories: true, data: [["Unranked", 1], ["10", 1], ["2", 1]] });
    expect((d as ra.LabeledDistribution).labels).toEqual(["Unranked", "10", "2"]);
  });
});

test("format helpers for UIs", () => {
  const d = ra.load("lol-rank");
  expect(ra.rankLine(81.48)).toBe("better than 81.5% (top 18.5%)");
  expect(ra.renderTable(ra.mappingTable(ra.load("meta-level"), d))[2]).toBe("E3          14%          Bronze II  (60% of the way through)");
  expect(ra.dataTable(d).rows[0]).toEqual(["Iron IV", "0.38%", "0% – 0.38%", "top 100%"]);
  expect(ra.buildPrompt("x", "normal")).toContain('"normal"');
  expect(ra.rawValue(d, "Diamond II")).toBe("Diamond II");
  expect(ra.rawValue(ra.load("canada-income"), 239970.4)).toBe("239970");
  expect(ra.rawValue(ra.load("marathon-time"), 10630)).toBe("2:57:10");
  expect(ra.rawValue(ra.load("percentile"), 97.6)).toBe("97.6");
});
