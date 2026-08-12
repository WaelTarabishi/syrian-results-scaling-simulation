import { createBenchmarkOptions } from "./config.ts";
import { createSummaryHandler } from "./summary.ts";
import { measuredLookup, warmupLookup } from "./workload.ts";

export const options = createBenchmarkOptions("capacity");
export { measuredLookup, warmupLookup };
export const handleSummary = createSummaryHandler("capacity");
