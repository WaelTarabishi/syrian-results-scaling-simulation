import type { Options, Scenario } from "k6/options";
import { benchmarkEnvironment } from "./environment.ts";

export type BenchmarkProfile = "smoke" | "load" | "stress" | "spike" | "capacity" | "reliability";

export interface BenchmarkProfileDetails {
  measuredDurationSeconds: number;
  offeredLoad: string;
}

const WARMUP_DURATION = "10s";
const MEASURED_START = "12s";

const measuredScenarios: Record<BenchmarkProfile, Scenario> = {
  smoke: {
    executor: "constant-arrival-rate",
    rate: 1,
    timeUnit: "1s",
    duration: "10s",
    preAllocatedVUs: 1,
    maxVUs: 2
  },
  load: {
    executor: "constant-arrival-rate",
    rate: 50,
    timeUnit: "1s",
    duration: "3m",
    preAllocatedVUs: 25,
    maxVUs: 100
  },
  stress: {
    executor: "ramping-arrival-rate",
    startRate: 25,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 500,
    stages: [
      { duration: "1m", target: 50 },
      { duration: "1m", target: 100 },
      { duration: "1m", target: 200 },
      { duration: "1m", target: 300 },
      { duration: "30s", target: 0 }
    ]
  },
  spike: {
    executor: "ramping-arrival-rate",
    startRate: 20,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 600,
    stages: [
      { duration: "30s", target: 20 },
      { duration: "5s", target: 400 },
      { duration: "30s", target: 400 },
      { duration: "15s", target: 20 },
      { duration: "30s", target: 20 }
    ]
  },
  capacity: {
    executor: "ramping-arrival-rate",
    startRate: 500,
    timeUnit: "1s",
    preAllocatedVUs: 500,
    maxVUs: 3_000,
    stages: [
      { duration: "45s", target: 500 },
      { duration: "45s", target: 1_000 },
      { duration: "45s", target: 2_000 },
      { duration: "45s", target: 3_000 },
      { duration: "45s", target: 4_000 },
      { duration: "45s", target: 5_000 },
      { duration: "30s", target: 0 }
    ]
  },
  reliability: {
    executor: "constant-arrival-rate",
    rate: 10_000,
    timeUnit: "9s",
    duration: "1h",
    preAllocatedVUs: 250,
    maxVUs: 2_000
  }
};

export const benchmarkProfileDetails: Record<BenchmarkProfile, BenchmarkProfileDetails> = {
  smoke: { measuredDurationSeconds: 10, offeredLoad: "1 iteration/s for 10s" },
  load: { measuredDurationSeconds: 180, offeredLoad: "50 iterations/s for 3m" },
  stress: { measuredDurationSeconds: 270, offeredLoad: "25 to 300 iterations/s over 4m30s" },
  spike: { measuredDurationSeconds: 110, offeredLoad: "20 to 400 iterations/s with a 30s peak" },
  capacity: {
    measuredDurationSeconds: 300,
    offeredLoad: "500 to 5,000 iterations/s in 45s stages, followed by a 30s recovery"
  },
  reliability: {
    measuredDurationSeconds: 3_600,
    offeredLoad: "4,000,000 iterations over 1h (1,111.11 iterations/s average)"
  }
};

export function createBenchmarkOptions(profile: BenchmarkProfile): Options {
  const reliabilityThresholds = profile === "reliability"
    ? {
        "http_req_failed{phase:measured}": ["rate<0.001"],
        "checks{phase:measured}": ["rate>0.999"],
        "lookup_contract_failures{phase:measured}": ["rate<0.001"]
      }
    : {
        "http_req_failed{phase:measured}": ["rate<0.01"],
        "checks{phase:measured}": ["rate>0.99"],
        "lookup_contract_failures{phase:measured}": ["rate<0.01"]
      };
  return {
    discardResponseBodies: false,
    summaryTrendStats: ["avg", "min", "p(50)", "p(95)", "p(99)", "max"],
    tags: {
      profile,
      target: benchmarkEnvironment.target
    },
    scenarios: {
      warmup: {
        executor: "constant-arrival-rate",
        exec: "warmupLookup",
        rate: 5,
        timeUnit: "1s",
        duration: WARMUP_DURATION,
        preAllocatedVUs: 5,
        maxVUs: 10,
        gracefulStop: "2s",
        tags: { phase: "warmup" }
      },
      measured: {
        ...measuredScenarios[profile],
        exec: "measuredLookup",
        startTime: MEASURED_START,
        gracefulStop: "10s",
        tags: { phase: "measured" }
      }
    },
    thresholds: {
      "http_req_duration{phase:measured}": ["p(95)<1000", "p(99)<2000"],
      ...reliabilityThresholds,
      "lookup_hits{phase:measured}": ["count>=0"],
      "lookup_misses{phase:measured}": ["count>=0"],
      "http_reqs{phase:measured}": ["count>0"],
      dropped_iterations: ["count==0"]
    }
  };
}
