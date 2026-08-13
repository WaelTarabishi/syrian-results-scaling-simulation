import { describe, expect, it } from "vitest";
import { createBenchmarkReportHtml, parseBenchmarkRun } from "./benchmark-report.js";

function summary(overrides: { profile?: string; droppedIterations?: number } = {}): string {
  return JSON.stringify({
    metadata: {
      runId: "traditional-private-load-1",
      recordedAt: "2026-08-12T12:00:00.000Z",
      target: "traditional",
      profile: overrides.profile ?? "load",
      baseUrl: "http://127.0.0.1:3001",
      offeredLoad: "50 iterations/s for 3m"
    },
    measured: {
      requestCount: 9_000,
      achievedRequestsPerSecond: 50,
      durationMs: { p50: 2, p95: 4, p99: 8 },
      httpFailureRate: 0,
      contractFailureRate: 0,
      checkSuccessRate: 1,
      droppedIterations: overrides.droppedIterations ?? 0
    }
  });
}

describe("benchmark report", () => {
  it("parses the display fields and computes the offered average", () => {
    const run = parseBenchmarkRun(summary(), "traditional-private-load-1.summary.json");
    expect(run.offeredAverageRps).toBe(50);
    expect(run.achievedRps).toBe(50);
    expect(run.passed).toBe(true);
  });

  it("marks runs with dropped iterations for review", () => {
    expect(parseBenchmarkRun(summary({ droppedIterations: 3 }), "run.summary.json").passed).toBe(false);
  });

  it("detects contradictory preserved metadata", () => {
    const data = JSON.parse(summary()) as { metadata: { target: string; runId: string } };
    data.metadata.target = "edge";
    data.metadata.runId = "traditional-local-smoke-1";
    const run = parseBenchmarkRun(JSON.stringify(data), "traditional-local-smoke-1.summary.json");
    expect(run.validationIssues).toHaveLength(2);
    expect(run.passed).toBe(false);
  });

  it("embeds run data safely in the standalone report", () => {
    const run = parseBenchmarkRun(summary(), "traditional-private-load-1.summary.json");
    run.runId = "</script><script>alert('unsafe')</script>";
    const html = createBenchmarkReportHtml([run]);
    expect(html).toContain("Benchmark results");
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>alert");
  });

  it("rejects unsupported profiles", () => {
    expect(() => parseBenchmarkRun(summary({ profile: "unknown" }), "run.summary.json")).toThrow(
      "not a supported benchmark profile"
    );
  });
});
