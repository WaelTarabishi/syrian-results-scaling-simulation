export type BenchmarkTarget = "traditional" | "edge";

const TARGET_PREFIX = /^(traditional|edge)-/u;

function authorityFromBaseUrl(baseUrl: string): string {
  const match = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/iu.exec(baseUrl);
  if (!match?.[1]) {
    throw new Error("K6_BASE_URL must use http or https");
  }
  return match[1].toLocaleLowerCase("en-US");
}

export function normalizeAndValidateBaseUrl(target: BenchmarkTarget, value: string): string {
  const baseUrl = value.trim().replace(/\/+$/u, "");
  const authority = authorityFromBaseUrl(baseUrl);

  if (target === "edge" && /^(localhost|127\.0\.0\.1|\[::1\]):3001$/u.test(authority)) {
    throw new Error("K6_TARGET=edge cannot use the Traditional local API on port 3001");
  }
  if (target === "traditional" && /^(localhost|127\.0\.0\.1|\[::1\]):8787$/u.test(authority)) {
    throw new Error("K6_TARGET=traditional cannot use the local Worker on port 8787");
  }
  if (target === "traditional" && /(^|\.)workers\.dev(?::\d+)?$/u.test(authority)) {
    throw new Error("K6_TARGET=traditional cannot use a workers.dev endpoint");
  }

  return baseUrl;
}

export function validateRunIdTarget(target: BenchmarkTarget, runId: string | undefined): void {
  if (!runId) return;
  const declaredTarget = TARGET_PREFIX.exec(runId)?.[1];
  if (declaredTarget && declaredTarget !== target) {
    throw new Error(`K6_RUN_ID starts with ${declaredTarget}- but K6_TARGET is ${target}`);
  }
}

export function findTargetMetadataIssues(
  target: BenchmarkTarget,
  baseUrl: string,
  runId: string
): string[] {
  const issues: string[] = [];
  try {
    normalizeAndValidateBaseUrl(target, baseUrl);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Invalid target and base URL combination");
  }
  try {
    validateRunIdTarget(target, runId);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Invalid target and run ID combination");
  }
  return issues;
}
