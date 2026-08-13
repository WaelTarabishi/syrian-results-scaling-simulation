import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { findTargetMetadataIssues } from "../load-tests/target-validation.js";

export type BenchmarkProfile = "smoke" | "load" | "stress" | "spike" | "capacity";
export type BenchmarkTarget = "traditional" | "edge";

export interface BenchmarkRun {
  fileName: string;
  runId: string;
  recordedAt: string;
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
  capacity: 671_250 / 300
};

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
  if (value !== "smoke" && value !== "load" && value !== "stress" && value !== "spike" && value !== "capacity") {
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

  return {
    fileName: basename(fileName),
    runId,
    recordedAt: requiredString(metadata.recordedAt, "metadata.recordedAt", fileName),
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
    passed: validationIssues.length === 0 && p95Ms < 1_000 && p99Ms < 2_000 && httpFailureRate < 0.01 && contractFailureRate < 0.01 && checkSuccessRate > 0.99 && droppedIterations === 0
  };
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
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Benchmark results</title>
<style>
:root{color-scheme:light;--ink:#0f172a;--muted:#64748b;--line:#dbe2ea;--soft:#f5f8fb;--traditional:#0759c7;--edge:#079d9a;--danger:#cf2e2e;--good:#15803d}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,select{font:inherit}.page{width:min(1500px,calc(100% - 40px));margin:auto;padding:34px 0 48px}header{margin-bottom:26px}h1{margin:0 0 8px;font-size:clamp(2rem,4vw,3.25rem);line-height:.98;letter-spacing:-.045em}.lede{max-width:830px;margin:0;color:var(--muted);line-height:1.55}.filters{display:grid;grid-template-columns:repeat(3,minmax(160px,220px));gap:14px;align-items:end;margin-bottom:12px}label{display:grid;gap:7px;color:#334155;font-size:.78rem;font-weight:700;letter-spacing:.02em}select{min-height:42px;padding:0 38px 0 12px;color:var(--ink);background:#fff;border:1px solid #cbd5e1;border-radius:6px}select:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.match-count{margin:0 0 18px;color:var(--muted);font-size:.9rem}.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));border:1px solid var(--line);border-radius:8px 8px 0 0;overflow:hidden}.metric{min-width:0;padding:18px 14px;border-right:1px solid var(--line);overflow:hidden;text-align:center}.metric:last-child{border-right:0}.metric-label{min-height:34px;color:#334155;font-size:.82rem}.metric-value{display:block;margin-top:4px;font-size:clamp(1.3rem,2.4vw,2rem);font-variant-numeric:tabular-nums;letter-spacing:-.035em}.metric-unit{color:var(--muted);font-size:.75rem}.visuals{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);border:1px solid var(--line);border-top:0}.visual{min-width:0;padding:22px}.visual+.visual{border-left:1px solid var(--line)}.section-title{margin:0;font-size:1rem}.section-note{margin:3px 0 18px;color:var(--muted);font-size:.8rem}.legend{display:flex;gap:16px;margin-bottom:16px;color:#334155;font-size:.75rem}.legend span:before{content:"";display:inline-block;width:9px;height:9px;margin-right:6px;border-radius:2px;background:var(--swatch)}.chart{display:grid;gap:13px}.chart-row{display:grid;grid-template-columns:minmax(115px,180px) minmax(0,1fr);gap:12px;align-items:center}.chart-label{overflow:hidden;color:#334155;font-size:.72rem;text-overflow:ellipsis;white-space:nowrap}.bars{display:grid;gap:4px}.bar-track{position:relative;height:19px;background:var(--soft);border-radius:3px}.bar{height:100%;min-width:2px;border-radius:3px;background:var(--bar-color)}.bar-value{position:absolute;inset:2px auto auto 7px;color:#fff;font-size:.68rem;font-weight:700;font-variant-numeric:tabular-nums;text-shadow:0 1px 1px rgb(0 0 0/25%)}.latency-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.latency-value{padding:7px 8px;border-left:3px solid var(--target-color);overflow:hidden;background:var(--soft);font-size:.7rem;font-variant-numeric:tabular-nums}.latency-value b{display:block;margin-bottom:2px;color:var(--muted);font-size:.62rem;text-transform:uppercase}.runs{border:1px solid var(--line);border-top:0;overflow-x:auto}.runs-heading{display:flex;justify-content:space-between;gap:20px;padding:18px 20px 12px}table{width:100%;border-collapse:collapse;font-size:.76rem;font-variant-numeric:tabular-nums}th,td{padding:10px 12px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}th{color:#475569;background:var(--soft);font-size:.68rem;letter-spacing:.025em;text-transform:uppercase}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){text-align:left}tbody tr:hover{background:#f8fafc}.target-mark{display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;background:var(--target-color)}.status{color:var(--status-color);font-weight:700}.json-link{color:#0759c7;text-underline-offset:2px}.explain{display:grid;grid-template-columns:auto 1fr;gap:14px;margin-top:18px;padding:18px;border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff}.explain-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:#fff;background:#0759c7;font-weight:800}.explain h2{margin:0 0 4px;font-size:.9rem}.explain p{margin:0;color:#334155;font-size:.8rem;line-height:1.55}.empty{padding:40px 20px;color:var(--muted);text-align:center}@media(max-width:980px){.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.metric:nth-child(3){border-right:0}.metric:nth-child(-n+3){border-bottom:1px solid var(--line)}.visuals{grid-template-columns:minmax(0,1fr)}.visual+.visual{border-top:1px solid var(--line);border-left:0}}@media(max-width:680px){.page{width:calc(100% - 24px);padding-top:24px}.filters{grid-template-columns:minmax(0,1fr)}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.metric:nth-child(3){border-right:1px solid var(--line)}.metric:nth-child(2n){border-right:0}.metric:nth-child(-n+4){border-bottom:1px solid var(--line)}.chart-row{grid-template-columns:90px minmax(0,1fr)}.metric{padding-inline:8px}.metric-label{font-size:.72rem}.metric-value{font-size:1.25rem}.metric-unit{font-size:.67rem}}
</style></head><body><main class="page">
<header><h1>Benchmark results</h1><p class="lede">A readable view of the k6 runs comparing the Traditional API/PostgreSQL path with the Edge Worker/KV path. Raw JSON remains the source of truth.</p></header>
<section class="filters" aria-label="Report filters"><label>Target<select id="target-filter"><option value="all">All targets</option><option value="traditional">Traditional</option><option value="edge">Edge</option></select></label><label>Profile<select id="profile-filter"><option value="all">All profiles</option><option value="smoke">Smoke</option><option value="load">Load</option><option value="stress">Stress</option><option value="spike">Spike</option><option value="capacity">Capacity</option></select></label><label>Run<select id="run-filter"><option value="all">All runs</option></select></label></section><p class="match-count" id="match-count"></p>
<div id="excluded-data"></div>
<section class="metrics" aria-label="Selected-run summary"><div class="metric"><div class="metric-label">Offered RPS <span class="aggregate">(average)</span></div><strong class="metric-value" id="offered-rps">—</strong><span class="metric-unit">requests/second</span></div><div class="metric"><div class="metric-label">Achieved RPS <span class="aggregate">(average)</span></div><strong class="metric-value" id="achieved-rps">—</strong><span class="metric-unit">requests/second</span></div><div class="metric"><div class="metric-label">p95 latency <span class="aggregate">(average)</span></div><strong class="metric-value" id="p95">—</strong><span class="metric-unit">milliseconds</span></div><div class="metric"><div class="metric-label">p99 latency <span class="aggregate">(average)</span></div><strong class="metric-value" id="p99">—</strong><span class="metric-unit">milliseconds</span></div><div class="metric"><div class="metric-label">HTTP failure rate <span class="aggregate">(average)</span></div><strong class="metric-value" id="failure-rate">—</strong><span class="metric-unit">of requests</span></div><div class="metric"><div class="metric-label">Dropped iterations <span id="drop-aggregate">(sum)</span></div><strong class="metric-value" id="dropped">—</strong><span class="metric-unit">not started</span></div></section>
<section class="visuals" aria-label="Benchmark charts"><div class="visual"><h2 class="section-title">Throughput comparison</h2><p class="section-note">Six latest matching runs. Offered average versus achieved RPS; closer is better.</p><div class="legend"><span style="--swatch:#94a3b8">Offered</span><span style="--swatch:#0759c7">Achieved</span></div><div class="chart" id="throughput-chart"></div></div><div class="visual"><h2 class="section-title">Latency percentiles</h2><p class="section-note">Six latest matching runs. p50, p95, and p99 in milliseconds; lower is better.</p><div class="legend"><span style="--swatch:var(--traditional)">Traditional</span><span style="--swatch:var(--edge)">Edge</span></div><div class="chart" id="latency-chart"></div></div></section>
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
