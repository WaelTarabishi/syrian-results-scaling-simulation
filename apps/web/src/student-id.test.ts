import { describe, expect, it } from "vitest";
import { sanitizeStudentIdDigits, toCanonicalStudentId } from "./student-id";

describe("student ID input", () => {
  it("accepts the numeric portion and adds the canonical prefix", () => {
    expect(toCanonicalStudentId("000001")).toBe("STU-000001");
  });

  it("makes pasted canonical IDs safe for the numeric-only field", () => {
    expect(sanitizeStudentIdDigits("STU-000001")).toBe("000001");
  });

  it("requires exactly six digits before creating a backend ID", () => {
    expect(toCanonicalStudentId("1")).toBeNull();
    expect(sanitizeStudentIdDigits("00000199")).toBe("000001");
  });
});
