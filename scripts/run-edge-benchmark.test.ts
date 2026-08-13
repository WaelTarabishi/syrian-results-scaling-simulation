import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Edge benchmark runner", () => {
  it("forces the Edge target and guards the capacity profile", async () => {
    const source = await readFile(new URL("./run-edge-benchmark.ts", import.meta.url), "utf8");
    expect(source).toContain('K6_TARGET: "edge"');
    expect(source).toContain("EDGE_CONFIRM_CAPACITY");
    expect(source).toContain("normalizeAndValidateBaseUrl");
  });
});
