import { describe, expect, it } from "vitest";
import { createResultLookupKey } from "./lookup-key.js";

describe("result lookup keys", () => {
  it("creates deterministic keys from normalized student IDs", async () => {
    const first = await createResultLookupKey("synthetic-test-secret", " STU-000001 ");
    const second = await createResultLookupKey("synthetic-test-secret", "stu- 000001");

    expect(first).toBe(second);
    expect(first).toMatch(/^result:v1:[a-f0-9]{64}$/u);
    expect(first).not.toContain("STU-000001");
  });
});
