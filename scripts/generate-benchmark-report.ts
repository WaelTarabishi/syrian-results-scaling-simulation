import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBenchmarkReportHtml, loadBenchmarkRuns } from "./benchmark-report.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const resultsDirectory = resolve(scriptDirectory, "../results");
const outputPath = resolve(resultsDirectory, "benchmark-report.html");

const runs = await loadBenchmarkRuns(resultsDirectory);
await mkdir(resultsDirectory, { recursive: true });
await writeFile(outputPath, createBenchmarkReportHtml(runs), "utf8");
console.log(`Generated benchmark report for ${runs.length} runs at ${outputPath}`);
