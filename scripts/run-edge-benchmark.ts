import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizeAndValidateBaseUrl, validateRunIdTarget } from "../load-tests/target-validation.js";

type EdgeProfile = "smoke" | "load" | "stress" | "spike" | "capacity" | "reliability";

const supportedProfiles = new Set<EdgeProfile>(["smoke", "load", "stress", "spike", "capacity", "reliability"]);
const requestedProfile = process.argv[2];
if (!requestedProfile || !supportedProfiles.has(requestedProfile as EdgeProfile)) {
  throw new Error("Usage: tsx scripts/run-edge-benchmark.ts <smoke|load|stress|spike|capacity|reliability>");
}
const profile = requestedProfile as EdgeProfile;

const baseUrlValue = process.env.EDGE_BASE_URL?.trim() || process.env.K6_BASE_URL?.trim();
if (!baseUrlValue) {
  throw new Error("Set EDGE_BASE_URL to the deployed Worker base URL before running an Edge benchmark");
}
const baseUrl = normalizeAndValidateBaseUrl("edge", baseUrlValue);

if (profile === "capacity" && process.env.EDGE_CONFIRM_CAPACITY !== "edge-capacity") {
  throw new Error(
    "Capacity can offer up to 5,000 RPS and approximately 671,250 iterations. Set EDGE_CONFIRM_CAPACITY=edge-capacity after confirming the account quota and test authorization."
  );
}

if (profile === "reliability" && process.env.EDGE_CONFIRM_RELIABILITY !== "edge-4m-hour") {
  throw new Error(
    "Reliability schedules 4,000,000 measured requests over one hour plus 50 warm-up requests. Set EDGE_CONFIRM_RELIABILITY=edge-4m-hour only after enabling Workers Paid, confirming at least 4,000,050 Worker requests and KV reads remain, and verifying EC2 generator capacity."
  );
}

const now = new Date();
const timestamp = now
  .toISOString()
  .replace(/\.\d{3}Z$/u, "Z")
  .replace(/[-:]/gu, "")
  .replace("T", "-")
  .replace("Z", "z");
const runId = process.env.K6_RUN_ID?.trim() || `edge-${profile}-${timestamp}`;
validateRunIdTarget("edge", runId);

const fixturePath = resolve("load-tests/generated/student-lookups.json");
await access(fixturePath).catch(() => {
  throw new Error("Missing k6 fixture. Run npm run data:generate and npm run k6:fixture first");
});

console.log(`Running Edge ${profile} benchmark`);
console.log(`target=edge baseUrl=${baseUrl} runId=${runId}`);

const k6Executable = process.platform === "win32" ? "k6.exe" : "k6";
const child = spawn(k6Executable, ["run", `load-tests/${profile}.ts`], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    K6_TARGET: "edge",
    K6_BASE_URL: baseUrl,
    K6_RUN_ID: runId
  },
  stdio: "inherit"
});

const exitCode = await new Promise<number>((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolveExit(code ?? 1));
});
process.exitCode = exitCode;
