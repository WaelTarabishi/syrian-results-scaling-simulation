import { describe, expect, it } from "vitest";
import {
  findTargetMetadataIssues,
  normalizeAndValidateBaseUrl,
  validateRunIdTarget
} from "./target-validation.js";

describe("benchmark target validation", () => {
  it("accepts deployed and local Edge Worker URLs", () => {
    expect(normalizeAndValidateBaseUrl("edge", "https://example.workers.dev/")).toBe(
      "https://example.workers.dev"
    );
    expect(normalizeAndValidateBaseUrl("edge", "http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787"
    );
  });

  it("rejects known target and URL contradictions", () => {
    expect(() => normalizeAndValidateBaseUrl("edge", "http://127.0.0.1:3001")).toThrow(
      "Traditional local API"
    );
    expect(() => normalizeAndValidateBaseUrl("traditional", "https://example.workers.dev")).toThrow(
      "workers.dev"
    );
  });

  it("rejects a run ID that declares the other target", () => {
    expect(() => validateRunIdTarget("edge", "traditional-local-smoke-1")).toThrow(
      "K6_RUN_ID starts with traditional-"
    );
  });

  it("returns issues without changing preserved result data", () => {
    expect(
      findTargetMetadataIssues("edge", "http://127.0.0.1:3001", "traditional-local-smoke-1")
    ).toHaveLength(2);
  });
});
