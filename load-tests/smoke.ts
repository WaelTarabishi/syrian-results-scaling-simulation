import { createBenchmarkOptions } from "./config.ts";
import { createSummaryHandler } from "./summary.ts";
import { measuredLookup, warmupLookup } from "./workload.ts";

export const options = createBenchmarkOptions("smoke");
export { measuredLookup, warmupLookup };
export const handleSummary = createSummaryHandler("smoke");
