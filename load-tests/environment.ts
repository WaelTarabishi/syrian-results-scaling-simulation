import {
  normalizeAndValidateBaseUrl,
  validateRunIdTarget,
  type BenchmarkTarget
} from "./target-validation.ts";

function required(name: string): string {
  const value = __ENV[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseMissPercent(value: string | undefined): number {
  const parsed = Number(value ?? "5");
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("K6_MISS_PERCENT must be an integer from 0 to 100");
  }
  return parsed;
}

function parseTarget(value: string): BenchmarkTarget {
  if (value !== "traditional" && value !== "edge") {
    throw new Error("K6_TARGET must be traditional or edge");
  }
  return value;
}

const target = parseTarget(required("K6_TARGET"));
const runId = __ENV.K6_RUN_ID?.trim();
validateRunIdTarget(target, runId);

export const benchmarkEnvironment = {
  target,
  baseUrl: normalizeAndValidateBaseUrl(target, required("K6_BASE_URL")),
  missPercent: parseMissPercent(__ENV.K6_MISS_PERCENT),
  requestTimeout: __ENV.K6_REQUEST_TIMEOUT?.trim() || "10s",
  datasetVersion: __ENV.K6_DATASET_VERSION?.trim() || "synthetic-v1",
  generatorLocation: __ENV.K6_GENERATOR_LOCATION?.trim() || "unspecified",
  runId
} as const;
