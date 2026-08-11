import { createBenchmarkOptions } from "./config.ts";
import { createSummaryHandler } from "./summary.ts";
import { measuredLookup, warmupLookup } from "./workload.ts";

export const options = createBenchmarkOptions("spike");
export { measuredLookup, warmupLookup };
export const handleSummary = createSummaryHandler("spike");
