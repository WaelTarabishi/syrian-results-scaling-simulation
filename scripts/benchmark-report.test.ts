import { describe, expect, it } from "vitest";
import { createBenchmarkReportHtml, parseBenchmarkRun, selectEc2Runs, selectFinalComparisonScenarios } from "./benchmark-report.js";

function summary(overrides: { profile?: string; droppedIterations?: number } = {}): string {
  return JSON.stringify({
    metadata: {
      runId: "traditional-private-load-1",
      recordedAt: "2026-08-12T12:00:00.000Z",
      generatorLocation: "ec2-us-east-1",
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

  it("selects runs using EC2 generator metadata rather than the run name", () => {
    const ec2Run = parseBenchmarkRun(summary(), "traditional-private-load-1.summary.json");
    const localRun = { ...ec2Run, runId: "traditional-ec2-load-1", generatorLocation: "local-windows" };
    expect(selectEc2Runs([ec2Run, localRun]).map((run) => run.runId)).toEqual(["traditional-private-load-1"]);
  });

  it("excludes superseded timestamped Edge attempts from the presentation", () => {
    const run = parseBenchmarkRun(summary({ profile: "stress" }), "run.summary.json");
    const supersededIds = [
      "edge-load-20260813-115015z",
      "edge-smoke-20260813-114914z",
      "edge-spike-20260813-115856z",
      "edge-stress-20260813-115408z"
    ];
    const superseded = supersededIds.map((runId) => ({ ...run, runId, target: "edge" as const }));
    const final = { ...run, runId: "edge-ec2-stress-1", target: "edge" as const };
    expect(selectEc2Runs([...superseded, final]).map((item) => item.runId)).toEqual(["edge-ec2-stress-1"]);
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
    expect(html).toContain("Result-release load benchmark");
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("</script><script>alert");
  });

  it("uses only the named matched EC2 runs in the final comparison", () => {
    const baseRun = parseBenchmarkRun(summary({ profile: "stress" }), "run.summary.json");
    const runs = [
      { ...baseRun, runId: "traditional-private-stress-1", target: "traditional" as const },
      { ...baseRun, runId: "edge-ec2-stress-1", target: "edge" as const, p95Ms: 130 },
      { ...baseRun, runId: "edge-stress-old", target: "edge" as const, p95Ms: 999 }
    ];
    const comparisons = selectFinalComparisonScenarios(runs);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.edge.runId).toBe("edge-ec2-stress-1");
  });

  it("frames the executive summary around load handling rather than speed", () => {
    const baseRun = parseBenchmarkRun(summary({ profile: "stress" }), "run.summary.json");
    const html = createBenchmarkReportHtml([
      { ...baseRun, runId: "traditional-private-stress-1", target: "traditional" },
      { ...baseRun, runId: "edge-ec2-stress-1", target: "edge", p95Ms: 130 }
    ]);
    expect(html).toContain("Load handling and operational fit");
    expect(html).toContain("Scheduled work completed");
    expect(html).toContain("without a dedicated API server or PostgreSQL");
    expect(html).toContain("Latency is not used here to rank architectures");
    expect(html).not.toContain("lower response time");
    expect(html).not.toContain("returned responses much faster");
  });

  it("labels Traditional capacity evidence without claiming an Edge capacity result", () => {
    const baseRun = parseBenchmarkRun(summary({ profile: "stress" }), "run.summary.json");
    const capacityRun = parseBenchmarkRun(summary({ profile: "capacity", droppedIterations: 159_182 }), "capacity.summary.json");
    capacityRun.requestCount = 512_067;
    const html = createBenchmarkReportHtml([
      { ...baseRun, runId: "traditional-private-stress-1", target: "traditional" },
      { ...baseRun, runId: "edge-ec2-stress-1", target: "edge" },
      { ...capacityRun, runId: "traditional-private-capacity-1", target: "traditional", profile: "capacity" }
    ]);
    expect(html).toContain("The single Traditional deployment saturated");
    expect(html).toContain("Edge capacity was not run");
    expect(html).toContain("76.29%");
  });

  it("rejects unsupported profiles", () => {
    expect(() => parseBenchmarkRun(summary({ profile: "unknown" }), "run.summary.json")).toThrow(
      "not a supported benchmark profile"
    );
  });
});
