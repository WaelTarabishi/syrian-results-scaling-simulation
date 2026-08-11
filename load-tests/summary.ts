import { benchmarkEnvironment } from "./environment.ts";
import { benchmarkProfileDetails, type BenchmarkProfile } from "./config.ts";
import { studentLookups } from "./data.ts";

interface SummaryMetric {
  values?: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}

interface SummaryData {
  metrics: Record<string, SummaryMetric>;
  [key: string]: unknown;
}

function values(data: SummaryData, metric: string): Record<string, number> {
  return data.metrics[metric]?.values ?? {};
}

function safeRunId(profile: BenchmarkProfile): string {
  const requested = benchmarkEnvironment.runId || `${profile}-${benchmarkEnvironment.target}-latest`;
  return requested.replace(/[^a-zA-Z0-9._-]/gu, "-");
}

export function createSummaryHandler(profile: BenchmarkProfile) {
  return (data: SummaryData): Record<string, string> => {
    const phase = "phase:measured";
    const duration = values(data, `http_req_duration{${phase}}`);
    const failures = values(data, `http_req_failed{${phase}}`);
    const requests = values(data, `http_reqs{${phase}}`);
    const drops = values(data, `dropped_iterations{${phase}}`);
    const checks = values(data, `checks{${phase}}`);
    const contractFailures = values(data, `lookup_contract_failures{${phase}}`);
    const hits = values(data, `lookup_hits{${phase}}`);
    const misses = values(data, `lookup_misses{${phase}}`);
    const runId = safeRunId(profile);
    const profileDetails = benchmarkProfileDetails[profile];
    const metadata = {
      runId,
      recordedAt: new Date().toISOString(),
      profile,
      target: benchmarkEnvironment.target,
      baseUrl: benchmarkEnvironment.baseUrl,
      datasetVersion: benchmarkEnvironment.datasetVersion,
      datasetRecords: studentLookups.length,
      expectedMissPercent: benchmarkEnvironment.missPercent,
      generatorLocation: benchmarkEnvironment.generatorLocation,
      offeredLoad: profileDetails.offeredLoad,
      measuredDurationSeconds: profileDetails.measuredDurationSeconds,
      warmupExcludedFromReportedMetrics: true
    };
    const measured = {
      requestCount: requests.count ?? 0,
      achievedRequestsPerSecond: (requests.count ?? 0) / profileDetails.measuredDurationSeconds,
      durationMs: {
        average: duration.avg ?? 0,
        p50: duration["p(50)"] ?? 0,
        p95: duration["p(95)"] ?? 0,
        p99: duration["p(99)"] ?? 0,
        maximum: duration.max ?? 0
      },
      httpFailureRate: failures.rate ?? 0,
      contractFailureRate: contractFailures.rate ?? 0,
      checkSuccessRate: checks.rate ?? 0,
      droppedIterations: drops.count ?? 0,
      expectedHits: hits.count ?? 0,
      expectedMisses: misses.count ?? 0
    };
    const report = { metadata, measured, rawSummary: data };
    const consoleSummary = [
      `\n${runId}`,
      `target=${metadata.target} profile=${profile} measured_requests=${measured.requestCount}`,
      `achieved_rps=${measured.achievedRequestsPerSecond.toFixed(2)} p50=${measured.durationMs.p50.toFixed(2)}ms p95=${measured.durationMs.p95.toFixed(2)}ms p99=${measured.durationMs.p99.toFixed(2)}ms`,
      `http_failures=${(measured.httpFailureRate * 100).toFixed(2)}% contract_failures=${(measured.contractFailureRate * 100).toFixed(2)}% dropped=${measured.droppedIterations}`,
      `summary=results/${runId}.summary.json\n`
    ].join("\n");

    return {
      stdout: consoleSummary,
      [`results/${runId}.summary.json`]: JSON.stringify(report, null, 2)
    };
  };
}
