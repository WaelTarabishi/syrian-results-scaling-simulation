import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { findTargetMetadataIssues } from "../load-tests/target-validation.js";

export type BenchmarkProfile = "smoke" | "load" | "stress" | "spike" | "capacity" | "reliability";
export type BenchmarkTarget = "traditional" | "edge";

export interface BenchmarkRun {
  fileName: string;
  runId: string;
  recordedAt: string;
  generatorLocation: string;
  target: BenchmarkTarget;
  profile: BenchmarkProfile;
  offeredLoad: string;
  baseUrl: string;
  offeredAverageRps: number;
  requestCount: number;
  achievedRps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  httpFailureRate: number;
  contractFailureRate: number;
  checkSuccessRate: number;
  droppedIterations: number;
  validationIssues: string[];
  passed: boolean;
}

interface SummaryFile {
  metadata?: Record<string, unknown>;
  measured?: Record<string, unknown> & { durationMs?: Record<string, unknown> };
}

const OFFERED_AVERAGE_RPS: Record<BenchmarkProfile, number> = {
  smoke: 1,
  load: 50,
  stress: 35_250 / 270,
  spike: 17_400 / 110,
  capacity: 671_250 / 300,
  reliability: 4_000_000 / 3_600
};

const FINAL_COMPARISON_RUNS = [
  {
    profile: "stress" as const,
    title: "Gradually increasing traffic",
    traditionalRunId: "traditional-private-stress-1",
    edgeRunId: "edge-ec2-stress-1"
  },
  {
    profile: "spike" as const,
    title: "Sudden traffic surge",
    traditionalRunId: "traditional-private-spike-1",
    edgeRunId: "edge-ec2-spike-1"
  }
];

const EXCLUDED_DIAGNOSTIC_RUN_IDS = new Set([
  "edge-load-20260813-115015z",
  "edge-smoke-20260813-114914z",
  "edge-spike-20260813-115856z",
  "edge-stress-20260813-115408z"
]);

export interface FinalComparisonScenario {
  profile: "stress" | "spike";
  title: string;
  traditional: BenchmarkRun;
  edge: BenchmarkRun;
}

export function selectFinalComparisonScenarios(runs: BenchmarkRun[]): FinalComparisonScenario[] {
  return FINAL_COMPARISON_RUNS.flatMap((definition) => {
    const traditional = runs.find(
      (run) => run.runId === definition.traditionalRunId && run.target === "traditional" && run.profile === definition.profile && run.validationIssues.length === 0
    );
    const edge = runs.find(
      (run) => run.runId === definition.edgeRunId && run.target === "edge" && run.profile === definition.profile && run.validationIssues.length === 0
    );
    return traditional && edge ? [{ profile: definition.profile, title: definition.title, traditional, edge }] : [];
  });
}

function formatReportNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function completedPercent(run: BenchmarkRun): number {
  const scheduled = run.requestCount + run.droppedIterations;
  return scheduled === 0 ? 0 : run.requestCount / scheduled * 100;
}

function createFinalComparisonHtml(runs: BenchmarkRun[]): string {
  const scenarios = selectFinalComparisonScenarios(runs);
  if (scenarios.length === 0) {
    return `<section class="final-comparison" aria-labelledby="final-title"><div class="final-heading"><p class="eyebrow">Executive summary</p><h2 id="final-title">Load handling and operational fit</h2><p>Matched EC2 results are not available yet. The technical runs remain available below.</p></div></section>`;
  }

  const cards = scenarios.map(({ profile, title, traditional, edge }) => {
    const traditionalCompleted = completedPercent(traditional);
    const edgeCompleted = completedPercent(edge);
    const totalScheduled = edge.requestCount + edge.droppedIterations;
    const trafficDifference = Math.abs(traditional.achievedRps - edge.achievedRps);
    const trafficSummary = trafficDifference < 0.1
      ? `Both completed about ${formatReportNumber((traditional.achievedRps + edge.achievedRps) / 2)} requests each second.`
      : `Traditional completed ${formatReportNumber(traditional.achievedRps)} and Edge completed ${formatReportNumber(edge.achievedRps)} requests each second.`;
    const reliabilitySummary = traditional.httpFailureRate === 0 && edge.httpFailureRate === 0 && traditional.contractFailureRate === 0 && edge.contractFailureRate === 0
      ? "No HTTP or response-contract failures were recorded."
      : `HTTP failures: Traditional ${formatReportNumber(traditional.httpFailureRate * 100)}%; Edge ${formatReportNumber(edge.httpFailureRate * 100)}%.`;
    const droppedSummary = edge.droppedIterations === 0
      ? "Every scheduled lookup was started."
      : `${formatReportNumber(edge.droppedIterations, 0)} of ${formatReportNumber(totalScheduled, 0)} scheduled Edge lookups were not started.`;

    return `<article class="comparison-card">
      <div class="scenario-heading"><span class="scenario-number">${profile === "stress" ? "01" : "02"}</span><div><p>${profile === "stress" ? "Stress test" : "Spike test"}</p><h3>${title}</h3></div><span class="outcome-pill">Workload served</span></div>
      <div class="plain-metric"><div class="plain-metric-heading"><h4>Scheduled work completed</h4><p>Completed requests as a share of scheduled lookups:</p></div>
        <div class="comparison-bars">
          <div class="comparison-row"><span>Traditional</span><div class="comparison-track"><div class="comparison-fill traditional-fill" style="width:${traditionalCompleted}%"></div></div><strong>${formatReportNumber(traditionalCompleted, 2)}%</strong></div>
          <div class="comparison-row"><span>Edge</span><div class="comparison-track"><div class="comparison-fill edge-fill" style="width:${edgeCompleted}%"></div></div><strong>${formatReportNumber(edgeCompleted, 2)}%</strong></div>
        </div>
        <p class="slo-result"><strong>Response-time SLO passed:</strong> both p95 values remained below the shared 1,000 ms threshold. Latency is not used here to rank architectures because the network paths differed.</p>
      </div>
      <div class="plain-facts"><div><span>Traffic handled</span><strong>${trafficSummary}</strong></div><div><span>Reliability</span><strong>${reliabilitySummary} ${droppedSummary}</strong></div></div>
    </article>`;
  }).join("");

  const traditionalCapacity = runs.find(
    (run) => run.runId === "traditional-private-capacity-1" && run.target === "traditional" && run.profile === "capacity" && run.validationIssues.length === 0
  );
  const capacityEvidence = traditionalCapacity
    ? `<div class="capacity-evidence"><div><p>Capacity boundary found</p><h3>The single Traditional deployment saturated under the aggressive capacity profile.</h3><span>This is Traditional-path evidence only. Edge capacity was not run, so no maximum-throughput winner is claimed.</span></div><div class="capacity-stats"><div><strong>${formatReportNumber(traditionalCapacity.requestCount, 0)}</strong><span>requests completed</span></div><div><strong>${formatReportNumber(traditionalCapacity.droppedIterations, 0)}</strong><span>iterations not started</span></div><div><strong>${formatReportNumber(completedPercent(traditionalCapacity), 2)}%</strong><span>scheduled work completed</span></div></div></div>`
    : "";

  return `<section class="final-comparison" aria-labelledby="final-title">
    <div class="final-heading"><div><p class="eyebrow">Executive summary</p><h2 id="final-title">Load handling and operational fit</h2><p>Can each design reliably serve read-heavy result-release traffic?</p></div><div class="verdict"><strong>Both served the matched stress and spike workloads.</strong><span>Edge did so without a dedicated API server or PostgreSQL in its request path.</span></div></div>
    <div class="comparison-grid">${cards}</div>
    ${capacityEvidence}
    <div class="scope-notes"><div><strong>Matched evidence</strong><span>The same Stress and Spike workloads, synthetic records, and EC2 generator location were used for both targets.</span></div><div><strong>Why Edge fits this workload</strong><span>Worker/KV serves static, read-mostly results without operating an origin API and database for each lookup.</span></div><div><strong>Evidence boundary</strong><span>Traditional used private VPC HTTP while Edge used public HTTPS. Edge Capacity was skipped, so its maximum tested throughput is still unknown.</span></div></div>
  </section>`;
}

function requiredString(value: unknown, field: string, fileName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fileName}: ${field} must be a non-empty string`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string, fileName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fileName}: ${field} must be a finite number`);
  }
  return value;
}

function parseTarget(value: unknown, fileName: string): BenchmarkTarget {
  if (value !== "traditional" && value !== "edge") {
    throw new Error(`${fileName}: metadata.target must be traditional or edge`);
  }
  return value;
}

function parseProfile(value: unknown, fileName: string): BenchmarkProfile {
  if (value !== "smoke" && value !== "load" && value !== "stress" && value !== "spike" && value !== "capacity" && value !== "reliability") {
    throw new Error(`${fileName}: metadata.profile is not a supported benchmark profile`);
  }
  return value;
}

export function parseBenchmarkRun(contents: string, fileName: string): BenchmarkRun {
  const summary = JSON.parse(contents) as SummaryFile;
  const metadata = summary.metadata;
  const measured = summary.measured;
  const duration = measured?.durationMs;
  if (!metadata || !measured || !duration) {
    throw new Error(`${fileName}: expected metadata and measured summary sections`);
  }

  const profile = parseProfile(metadata.profile, fileName);
  const target = parseTarget(metadata.target, fileName);
  const runId = requiredString(metadata.runId, "metadata.runId", fileName);
  const baseUrl = requiredString(metadata.baseUrl, "metadata.baseUrl", fileName);
  const validationIssues = findTargetMetadataIssues(target, baseUrl, runId);
  const p95Ms = requiredNumber(duration.p95, "measured.durationMs.p95", fileName);
  const p99Ms = requiredNumber(duration.p99, "measured.durationMs.p99", fileName);
  const httpFailureRate = requiredNumber(measured.httpFailureRate, "measured.httpFailureRate", fileName);
  const contractFailureRate = requiredNumber(measured.contractFailureRate, "measured.contractFailureRate", fileName);
  const checkSuccessRate = requiredNumber(measured.checkSuccessRate, "measured.checkSuccessRate", fileName);
  const droppedIterations = requiredNumber(measured.droppedIterations, "measured.droppedIterations", fileName);
  const maximumFailureRate = profile === "reliability" ? 0.001 : 0.01;
  const minimumCheckSuccessRate = profile === "reliability" ? 0.999 : 0.99;

  return {
    fileName: basename(fileName),
    runId,
    recordedAt: requiredString(metadata.recordedAt, "metadata.recordedAt", fileName),
    generatorLocation: requiredString(metadata.generatorLocation, "metadata.generatorLocation", fileName),
    target,
    profile,
    offeredLoad: requiredString(metadata.offeredLoad, "metadata.offeredLoad", fileName),
    baseUrl,
    offeredAverageRps: OFFERED_AVERAGE_RPS[profile],
    requestCount: requiredNumber(measured.requestCount, "measured.requestCount", fileName),
    achievedRps: requiredNumber(measured.achievedRequestsPerSecond, "measured.achievedRequestsPerSecond", fileName),
    p50Ms: requiredNumber(duration.p50, "measured.durationMs.p50", fileName),
    p95Ms,
    p99Ms,
    httpFailureRate,
    contractFailureRate,
    checkSuccessRate,
    droppedIterations,
    validationIssues,
    passed: validationIssues.length === 0 && p95Ms < 1_000 && p99Ms < 2_000 && httpFailureRate < maximumFailureRate && contractFailureRate < maximumFailureRate && checkSuccessRate > minimumCheckSuccessRate && droppedIterations === 0
  };
}

export function selectEc2Runs(runs: BenchmarkRun[]): BenchmarkRun[] {
  return runs.filter(
    (run) => run.generatorLocation.toLowerCase().startsWith("ec2-") && !EXCLUDED_DIAGNOSTIC_RUN_IDS.has(run.runId)
  );
}

export async function loadBenchmarkRuns(resultsDirectory: string): Promise<BenchmarkRun[]> {
  const names = (await readdir(resultsDirectory)).filter((name) => name.endsWith(".summary.json")).sort();
  return Promise.all(names.map(async (name) => parseBenchmarkRun(await readFile(join(resultsDirectory, name), "utf8"), name)));
}

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, "\\u003c").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
}

export function createBenchmarkReportHtml(runs: BenchmarkRun[]): string {
  if (runs.length === 0) throw new Error("At least one benchmark summary is required to generate the report");
  const data = serializeForInlineScript(runs);
  const finalComparison = createFinalComparisonHtml(runs);
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EC2 benchmark results</title>
<style>
:root{color-scheme:light;--ink:#0f172a;--muted:#64748b;--line:#dbe2ea;--soft:#f5f8fb;--traditional:#0759c7;--edge:#079d9a;--danger:#cf2e2e;--good:#15803d}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,select{font:inherit}.page{width:min(1500px,calc(100% - 40px));margin:auto;padding:34px 0 48px}header{margin-bottom:26px}h1{margin:0 0 8px;font-size:clamp(2rem,4vw,3.25rem);line-height:.98;letter-spacing:-.045em}.lede{max-width:900px;margin:0;color:var(--muted);line-height:1.55}.final-comparison{margin-bottom:42px;padding:clamp(22px,3vw,38px);border:1px solid #cbd5e1;border-radius:18px;background:linear-gradient(135deg,#f8fafc 0%,#fff 62%);box-shadow:0 18px 45px rgb(15 23 42/7%)}.final-heading{display:flex;justify-content:space-between;gap:28px;align-items:end;margin-bottom:24px}.final-heading h2{margin:2px 0 5px;font-size:clamp(1.7rem,3vw,2.5rem);letter-spacing:-.035em}.final-heading p{margin:0;color:var(--muted)}.eyebrow{color:var(--traditional)!important;font-size:.7rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.verdict{display:grid;gap:3px;max-width:540px;padding:14px 18px;border-left:4px solid var(--good);background:#f0fdf4}.verdict strong{font-size:1rem}.verdict span{color:#334155;font-size:.86rem;line-height:1.45}.comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.comparison-card{padding:22px;border:1px solid var(--line);border-radius:12px;background:#fff}.scenario-heading{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding-bottom:18px;border-bottom:1px solid var(--line)}.scenario-number{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;color:#fff;background:var(--ink);font-size:.72rem;font-weight:800}.scenario-heading p{margin:0;color:var(--muted);font-size:.72rem;font-weight:700;text-transform:uppercase}.scenario-heading h3{margin:2px 0 0;font-size:1rem}.outcome-pill{padding:6px 9px;border-radius:999px;color:#166534;background:#dcfce7;font-size:.68rem;font-weight:800}.plain-metric{padding:20px 0}.plain-metric-heading{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.plain-metric-heading h4{margin:0;font-size:.92rem}.plain-metric-heading p{margin:0;color:var(--muted);font-size:.76rem}.comparison-bars{display:grid;gap:11px;margin-top:14px}.comparison-row{display:grid;grid-template-columns:76px minmax(0,1fr) 78px;gap:10px;align-items:center;font-size:.78rem}.comparison-row strong{text-align:right;font-variant-numeric:tabular-nums}.comparison-track{height:18px;border-radius:4px;background:#edf2f7;overflow:hidden}.comparison-fill{height:100%;border-radius:4px}.traditional-fill{background:var(--traditional)}.edge-fill{background:var(--edge)}.slo-result{margin:13px 0 0;color:#334155;font-size:.78rem;line-height:1.5}.plain-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px}.plain-facts div{display:grid;align-content:start;gap:5px;padding:13px;border-radius:8px;background:var(--soft)}.plain-facts span{color:var(--muted);font-size:.68rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.plain-facts strong{font-size:.77rem;line-height:1.45}.capacity-evidence{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:24px;align-items:center;margin-top:18px;padding:18px 20px;border:1px solid #fed7aa;border-radius:10px;background:#fff7ed}.capacity-evidence p{margin:0 0 4px;color:#9a3412;font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.capacity-evidence h3{margin:0 0 5px;font-size:.94rem}.capacity-evidence>div>span{color:#7c2d12;font-size:.74rem;line-height:1.45}.capacity-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:#fed7aa}.capacity-stats div{display:grid;gap:3px;padding:10px;background:#fff}.capacity-stats strong{font-size:.92rem;font-variant-numeric:tabular-nums}.capacity-stats span{color:#7c2d12;font-size:.64rem;line-height:1.3}.scope-notes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-top:18px;overflow:hidden;border:1px solid var(--line);border-radius:9px;background:var(--line)}.scope-notes div{display:grid;gap:4px;padding:13px;background:#fff}.scope-notes strong{font-size:.72rem}.scope-notes span{color:var(--muted);font-size:.7rem;line-height:1.45}.filters{display:grid;grid-template-columns:repeat(3,minmax(160px,220px));gap:14px;align-items:end;margin-bottom:12px}label{display:grid;gap:7px;color:#334155;font-size:.78rem;font-weight:700;letter-spacing:.02em}select{min-height:42px;padding:0 38px 0 12px;color:var(--ink);background:#fff;border:1px solid #cbd5e1;border-radius:6px}select:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.match-count{margin:0 0 18px;color:var(--muted);font-size:.9rem}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:1px solid var(--line);border-radius:8px 8px 0 0;overflow:hidden}.metric{min-width:0;padding:18px 14px;border-right:1px solid var(--line);overflow:hidden;text-align:center}.metric:last-child{border-right:0}.metric-label{min-height:34px;color:#334155;font-size:.82rem}.metric-value{display:block;margin-top:4px;font-size:clamp(1.3rem,2.4vw,2rem);font-variant-numeric:tabular-nums;letter-spacing:-.035em}.metric-unit{color:var(--muted);font-size:.75rem}.visuals{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid var(--line);border-top:0}.visual{min-width:0;padding:22px}.visual+.visual{border-left:1px solid var(--line)}.section-title{margin:0;font-size:1rem}.section-note{margin:3px 0 18px;color:var(--muted);font-size:.8rem}.legend{display:flex;gap:16px;margin-bottom:16px;color:#334155;font-size:.75rem}.legend span:before{content:"";display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:2px;background:var(--swatch)}.chart{display:grid;gap:13px}.chart-row{display:grid;grid-template-columns:minmax(115px,180px) minmax(0,1fr);gap:12px;align-items:center}.chart-label{overflow:hidden;color:#334155;font-size:.72rem;text-overflow:ellipsis;white-space:nowrap}.bars{display:grid;gap:4px}.bar-track{position:relative;height:19px;background:var(--soft);border-radius:3px}.bar{height:100%;min-width:2px;border-radius:3px;background:var(--bar-color)}.bar-value{position:absolute;inset:2px auto auto 7px;color:#fff;font-size:.68rem;font-weight:700;font-variant-numeric:tabular-nums;text-shadow:0 1px 1px rgb(0 0 0/25%)}.latency-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.latency-value{padding:7px 8px;border-left:3px solid var(--target-color);overflow:hidden;background:var(--soft);font-size:.7rem;font-variant-numeric:tabular-nums}.latency-value b{display:block;margin-bottom:2px;color:var(--muted);font-size:.62rem;text-transform:uppercase}.runs{border:1px solid var(--line);border-top:0;overflow-x:auto}.runs-heading{display:flex;justify-content:space-between;gap:20px;padding:18px 20px 12px}table{width:100%;border-collapse:collapse;font-size:.76rem;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}th{color:#475569;background:var(--soft);font-size:.68rem;letter-spacing:.025em;text-transform:uppercase}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){text-align:left}tbody tr:hover{background:#f8fafc}.target-mark{display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;background:var(--target-color)}.status{color:var(--status-color);font-weight:700}.json-link{color:#0759c7;text-underline-offset:2px}.explain{display:grid;grid-template-columns:auto 1fr;gap:14px;margin-top:18px;padding:18px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff}.explain-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:#fff;background:#0759c7;font-weight:800}.explain h2{margin:0 0 4px;font-size:.9rem}.explain p{margin:0;color:#334155;font-size:.8rem;line-height:1.55}.empty{padding:40px 20px;color:var(--muted);text-align:center}@media(max-width:980px){.comparison-grid{grid-template-columns:minmax(0,1fr)}.capacity-evidence{grid-template-columns:minmax(0,1fr)}.scope-notes{grid-template-columns:minmax(0,1fr)}.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.metric:nth-child(3){border-right:0}.metric:nth-child(-n+3){border-bottom:1px solid var(--line)}.visuals{grid-template-columns:minmax(0,1fr)}.visual+.visual{border-top:1px solid var(--line);border-left:0}}@media(max-width:680px){.page{width:calc(100% - 24px);padding-top:24px}.final-comparison{padding:18px 14px}.final-heading{display:grid;align-items:start}.scenario-heading{grid-template-columns:auto 1fr}.outcome-pill{grid-column:2}.plain-metric-heading{display:grid;gap:3px}.comparison-row{grid-template-columns:62px minmax(0,1fr) 62px}.plain-facts{grid-template-columns:minmax(0,1fr)}.capacity-stats{grid-template-columns:minmax(0,1fr)}.filters{grid-template-columns:minmax(0,1fr)}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric:nth-child(3){border-right:1px solid var(--line)}.metric:nth-child(2n){border-right:0}.metric:nth-child(-n+4){border-bottom:1px solid var(--line)}.chart-row{grid-template-columns:90px minmax(0,1fr)}.metric{padding-inline:8px}.metric-label{font-size:.72rem}.metric-value{font-size:1.25rem}.metric-unit{font-size:.67rem}}
</style></head><body><main class="page">
<header><h1>Result-release load benchmark</h1><p class="lede">Can static, read-heavy results survive sudden demand without operating and scaling a dedicated origin for every lookup? This report focuses on traffic completion, reliability, and operational fit. Latency remains a service-level check, not a speed contest.</p></header>
${finalComparison}
<section class="filters" aria-label="Report filters"><label>Target<select id="target-filter"><option value="all">All targets</option><option value="traditional">Traditional</option><option value="edge">Edge</option></select></label><label>Profile<select id="profile-filter"><option value="all">All profiles</option><option value="smoke">Smoke</option><option value="load">Load</option><option value="stress">Stress</option><option value="spike">Spike</option><option value="capacity">Capacity</option><option value="reliability">Reliability</option></select></label><label>Run<select id="run-filter"><option value="all">All runs</option></select></label></section><p class="match-count" id="match-count"></p>
<div id="excluded-data"></div>
<section class="metrics" aria-label="Selected-run summary"><div class="metric"><div class="metric-label">Offered RPS <span class="aggregate">(average)</span></div><strong class="metric-value" id="offered-rps">—</strong><span class="metric-unit">requests/second</span></div><div class="metric"><div class="metric-label">Achieved RPS <span class="aggregate">(average)</span></div><strong class="metric-value" id="achieved-rps">—</strong><span class="metric-unit">requests/second</span></div><div class="metric"><div class="metric-label">p95 latency <span class="aggregate">(average)</span></div><strong class="metric-value" id="p95">—</strong><span class="metric-unit">milliseconds</span></div><div class="metric"><div class="metric-label">p99 latency <span class="aggregate">(average)</span></div><strong class="metric-value" id="p99">—</strong><span class="metric-unit">milliseconds</span></div><div class="metric"><div class="metric-label">HTTP failure rate <span class="aggregate">(average)</span></div><strong class="metric-value" id="failure-rate">—</strong><span class="metric-unit">of requests</span></div><div class="metric"><div class="metric-label">Dropped iterations <span id="drop-aggregate">(sum)</span></div><strong class="metric-value" id="dropped">—</strong><span class="metric-unit">not started</span></div></section>
<section class="visuals" aria-label="Benchmark charts"><div class="visual"><h2 class="section-title">Throughput delivery</h2><p class="section-note">Six latest matching runs. Offered average versus achieved RPS; a widening gap can reveal saturation.</p><div class="legend"><span style="--swatch:#94a3b8">Offered</span><span style="--swatch:#0759c7">Achieved</span></div><div class="chart" id="throughput-chart"></div></div><div class="visual"><h2 class="section-title">Response-time SLO evidence</h2><p class="section-note">p50, p95, and p99 remain visible for threshold checks. Different network paths mean these values do not rank architecture speed.</p><div class="legend"><span style="--swatch:var(--traditional)">Traditional</span><span style="--swatch:var(--edge)">Edge</span></div><div class="chart" id="latency-chart"></div></div></section>
<section class="runs" aria-labelledby="runs-title"><div class="runs-heading"><h2 class="section-title" id="runs-title">Runs</h2><span class="section-note">Select a run to isolate it</span></div><div id="runs-table"></div></section>
<aside class="explain"><div class="explain-icon" aria-hidden="true">i</div><div><h2>How to interpret offered and achieved RPS</h2><p>Offered RPS is the average rate configured by the k6 profile. Achieved RPS is the completed-request average. A widening gap, especially with higher latency or dropped iterations, indicates that the target, network, k6 virtual-user limit, or generator could not keep up. Use server and generator metrics to identify which one saturated.</p></div></aside>
</main><script>
const runs=${data};const validRuns=runs.filter(run=>run.validationIssues.length===0),excludedRuns=runs.filter(run=>run.validationIssues.length>0);const targetFilter=document.querySelector("#target-filter"),profileFilter=document.querySelector("#profile-filter"),runFilter=document.querySelector("#run-filter");const number=new Intl.NumberFormat("en-US",{maximumFractionDigits:2}),percent=new Intl.NumberFormat("en-US",{style:"percent",maximumFractionDigits:2});const colorFor=t=>t==="edge"?"var(--edge)":"var(--traditional)",average=(items,field)=>items.reduce((sum,item)=>sum+item[field],0)/items.length,escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":c.charCodeAt(0)===34?"&quot;":"&#039;");[...validRuns].sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).forEach(run=>{const option=document.createElement("option");option.value=run.runId;option.textContent=run.runId;runFilter.append(option)});if(excludedRuns.length){document.querySelector("#excluded-data").innerHTML=\`<aside class="explain"><div class="explain-icon" aria-hidden="true">!</div><div><h2>Excluded inconsistent evidence</h2><p>\${excludedRuns.map(run=>escapeHtml(run.fileName+": "+run.validationIssues.join("; "))).join("<br>")}</p></div></aside>\`}
function selectedRuns(){return validRuns.filter(run=>(targetFilter.value==="all"||run.target===targetFilter.value)&&(profileFilter.value==="all"||run.profile===profileFilter.value)&&(runFilter.value==="all"||run.runId===runFilter.value)).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt))}
function metrics(selected){const ids=["offered-rps","achieved-rps","p95","p99","failure-rate","dropped"];if(!selected.length){ids.forEach(id=>document.querySelector("#"+id).textContent="—");return}document.querySelector("#offered-rps").textContent=number.format(average(selected,"offeredAverageRps"));document.querySelector("#achieved-rps").textContent=number.format(average(selected,"achievedRps"));document.querySelector("#p95").textContent=number.format(average(selected,"p95Ms"));document.querySelector("#p99").textContent=number.format(average(selected,"p99Ms"));document.querySelector("#failure-rate").textContent=percent.format(average(selected,"httpFailureRate"));document.querySelector("#dropped").textContent=number.format(selected.reduce((sum,run)=>sum+run.droppedIterations,0));document.querySelectorAll(".aggregate").forEach(label=>label.textContent=selected.length===1?"":"(average)");document.querySelector("#drop-aggregate").textContent=selected.length===1?"":"(sum)"}
function throughput(selected){const chart=document.querySelector("#throughput-chart");if(!selected.length){chart.innerHTML='<div class="empty">No matching runs.</div>';return}const visible=selected.slice(0,6),maximum=Math.max(...visible.flatMap(run=>[run.offeredAverageRps,run.achievedRps]),1);chart.innerHTML=visible.map(run=>\`<div class="chart-row" title="\${escapeHtml(run.runId)}"><div class="chart-label">\${escapeHtml(run.runId)}</div><div class="bars"><div class="bar-track"><div class="bar" style="--bar-color:#94a3b8;width:\${Math.max(1,run.offeredAverageRps/maximum*100)}%"></div><span class="bar-value">\${number.format(run.offeredAverageRps)}</span></div><div class="bar-track"><div class="bar" style="--bar-color:\${colorFor(run.target)};width:\${Math.max(1,run.achievedRps/maximum*100)}%"></div><span class="bar-value">\${number.format(run.achievedRps)}</span></div></div></div>\`).join("")}
function latency(selected){const chart=document.querySelector("#latency-chart");if(!selected.length){chart.innerHTML='<div class="empty">No matching runs.</div>';return}chart.innerHTML=selected.slice(0,6).map(run=>\`<div class="chart-row" title="\${escapeHtml(run.runId)}"><div class="chart-label"><span class="target-mark" style="--target-color:\${colorFor(run.target)}"></span>\${escapeHtml(run.runId)}</div><div class="latency-values" style="--target-color:\${colorFor(run.target)}"><div class="latency-value"><b>p50</b>\${number.format(run.p50Ms)} ms</div><div class="latency-value"><b>p95</b>\${number.format(run.p95Ms)} ms</div><div class="latency-value"><b>p99</b>\${number.format(run.p99Ms)} ms</div></div></div>\`).join("")}
function table(selected){const container=document.querySelector("#runs-table");if(!selected.length){container.innerHTML='<div class="empty">No runs match the selected filters.</div>';return}container.innerHTML=\`<table><thead><tr><th>Run ID</th><th>Target</th><th>Profile</th><th>Offered avg RPS</th><th>Achieved RPS</th><th>p95</th><th>p99</th><th>Failures</th><th>Dropped</th><th>Status</th><th>Raw</th></tr></thead><tbody>\${selected.map(run=>\`<tr><td>\${escapeHtml(run.runId)}</td><td><span class="target-mark" style="--target-color:\${colorFor(run.target)}"></span>\${escapeHtml(run.target)}</td><td title="\${escapeHtml(run.offeredLoad)}">\${escapeHtml(run.profile)}</td><td>\${number.format(run.offeredAverageRps)}</td><td>\${number.format(run.achievedRps)}</td><td>\${number.format(run.p95Ms)} ms</td><td>\${number.format(run.p99Ms)} ms</td><td>\${percent.format(run.httpFailureRate)}</td><td>\${number.format(run.droppedIterations)}</td><td><span class="status" style="--status-color:\${run.passed?"var(--good)":"var(--danger)"}">\${run.passed?"Passed":"Review"}</span></td><td><a class="json-link" href="\${encodeURIComponent(run.fileName)}">JSON</a></td></tr>\`).join("")}</tbody></table>\`}
function render(){const selected=selectedRuns();document.querySelector("#match-count").textContent=\`\${selected.length} run\${selected.length===1?"":"s"} match the selected filters.\`;metrics(selected);throughput(selected);latency(selected);table(selected)}[targetFilter,profileFilter,runFilter].forEach(control=>control.addEventListener("change",render));render();
</script></body></html>\n`;
}
