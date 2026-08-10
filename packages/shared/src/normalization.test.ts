import { describe, expect, it } from "vitest";
import { normalizePersonName, normalizeStudentId } from "./normalization.js";

describe("normalization", () => {
  it("normalizes student IDs consistently", () => {
    expect(normalizeStudentId("  stu- 000001 \n")).toBe("STU-000001");
    expect(normalizeStudentId("ＳＴＵ-０００００１")).toBe("STU-000001");
  });

  it("normalizes person names while retaining word boundaries", () => {
    expect(normalizePersonName("  Lina\t  Haddad ")).toBe("lina haddad");
  });
});
