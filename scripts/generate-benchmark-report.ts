import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBenchmarkReportHtml, loadBenchmarkRuns, selectEc2Runs } from "./benchmark-report.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const resultsDirectory = resolve(scriptDirectory, "../results");
const outputPath = resolve(resultsDirectory, "benchmark-report.html");

const allRuns = await loadBenchmarkRuns(resultsDirectory);
const runs = selectEc2Runs(allRuns);
await mkdir(resultsDirectory, { recursive: true });
await writeFile(outputPath, createBenchmarkReportHtml(runs), "utf8");
console.log(`Generated EC2-only benchmark report for ${runs.length} of ${allRuns.length} runs at ${outputPath}`);
