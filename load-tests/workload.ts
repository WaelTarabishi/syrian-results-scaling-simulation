import { check } from "k6";
import execution from "k6/execution";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";
import { studentLookups, type StudentLookup } from "./data.ts";
import { benchmarkEnvironment } from "./environment.ts";

type TestPhase = "warmup" | "measured";

interface ResponseShape {
  success?: boolean;
  data?: { studentId?: string };
  error?: { code?: string };
}

const contractFailures = new Rate("lookup_contract_failures");
const lookupHits = new Counter("lookup_hits");
const lookupMisses = new Counter("lookup_misses");
const expectedStatuses = http.expectedStatuses(200, 404);

function selectLookup(iteration: number): StudentLookup {
  const index = (iteration * 7_919) % studentLookups.length;
  return studentLookups[index]!;
}

function isExpectedMiss(iteration: number): boolean {
  return (iteration * 37 + 17) % 100 < benchmarkEnvironment.missPercent;
}

function buildUrl(record: StudentLookup, miss: boolean): string {
  const studentId = miss ? `STU-9${record.studentId.slice(4)}` : record.studentId;
  const query = [
    `studentId=${encodeURIComponent(studentId)}`,
    `studentName=${encodeURIComponent(record.studentName)}`,
    `fatherName=${encodeURIComponent(record.fatherName)}`
  ].join("&");
  return `${benchmarkEnvironment.baseUrl}/api/result?${query}`;
}

function parseResponseBody(body: string | ArrayBuffer | null): ResponseShape | null {
  if (typeof body !== "string") {
    return null;
  }
  try {
    return JSON.parse(body) as ResponseShape;
  } catch {
    return null;
  }
}

function executeLookup(phase: TestPhase): void {
  const iteration = execution.scenario.iterationInTest;
  const record = selectLookup(iteration);
  const miss = isExpectedMiss(iteration);
  const tags = {
    phase,
    target: benchmarkEnvironment.target,
    expected_outcome: miss ? "not_found" : "found"
  };

  const response = http.get(buildUrl(record, miss), {
    headers: { accept: "application/json" },
    responseCallback: expectedStatuses,
    responseType: "text",
    tags: { ...tags, name: "GET /api/result" },
    timeout: benchmarkEnvironment.requestTimeout
  });
  const body = parseResponseBody(response.body);
  const statusMatches = response.status === (miss ? 404 : 200);
  const contractMatches = miss
    ? body?.success === false && body.error?.code === "RESULT_NOT_FOUND"
    : body?.success === true && body.data?.studentId === record.studentId;

  check(
    { statusMatches, contractMatches },
    {
      "status matches expected outcome": (result) => result.statusMatches,
      "response matches shared contract": (result) => result.contractMatches
    },
    tags
  );
  contractFailures.add(!statusMatches || !contractMatches, tags);
  (miss ? lookupMisses : lookupHits).add(1, tags);
}

export function warmupLookup(): void {
  executeLookup("warmup");
}

export function measuredLookup(): void {
  executeLookup("measured");
}
