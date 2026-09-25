/**
 * rank-anything without the built-in datasets: the distribution model, the
 * JSON format, importers and formatting helpers. Use this entry point to
 * bring your own data and keep bundles small; `rank-anything` adds the
 * built-in distributions.
 */

export {
  type Band,
  Conversion,
  DURATION_STYLES,
  Distribution,
  DistributionError,
  type DistributionMeta,
  type DurationStyle,
  INTERPOLATIONS,
  type Interpolation,
  LabeledDistribution,
  LogNormalDistribution,
  NormalDistribution,
  NumericDistribution,
  PiecewiseDistribution,
  type PiecewiseOptions,
  Placement,
  TAIL_KINDS,
  Tail,
  type TailKind,
  type TailStatus,
  type Value,
  convert,
  formatDuration,
  formatNumber,
  formatPercent,
  normalizeLabel,
  parseDuration,
  parseNumber,
} from "./distributions.ts";
export { type DistributionSpec, type DistributionType, TYPES, fromDict, specFromText } from "./spec.ts";
export {
  IMPORT_SUFFIXES,
  type SamplesSpecOptions,
  dumpSpec,
  numbersFromFile,
  numbersFromTable,
  numbersFromText,
  samplesSpecFromText,
} from "./importers.ts";
export { parseJson, stringifyJson } from "./json.ts";
export { type DistributionRef, type MultiConversion, type Origin, PSEUDO, Registry, type RegistryOptions } from "./registry.ts";
export {
  STANDARD_PERCENTILES,
  type Table,
  dataTable,
  describe,
  distType,
  mappingTable,
  rankLine,
  rawValue,
  renderTable,
  summaryLines,
} from "./format.ts";
export { PROMPT_TYPES, type PromptType, buildPrompt } from "./prompts.ts";
export { VERSION } from "./version.ts";
