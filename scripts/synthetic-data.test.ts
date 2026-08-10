import { describe, expect, it } from "vitest";
import { createSyntheticRecords } from "./synthetic-data.js";

describe("synthetic data generator", () => {
  it("creates 10,000 deterministic, unique, fake records by default", () => {
    const firstRun = createSyntheticRecords();
    const secondRun = createSyntheticRecords();

    expect(firstRun).toHaveLength(10_000);
    expect(secondRun).toEqual(firstRun);
    expect(new Set(firstRun.map((record) => record.studentId))).toHaveLength(10_000);
    expect(firstRun[0]?.studentId).toBe("STU-000001");
    expect(firstRun[9_999]?.studentId).toBe("STU-010000");
    expect(firstRun.every((record) => record.score >= 0 && record.score <= 100)).toBe(true);
  });

  it("keeps grade and pass status consistent with score", () => {
    const records = createSyntheticRecords(100);
    expect(records.every((record) => record.status === (record.score >= 60 ? "pass" : "fail"))).toBe(true);
    expect(records.filter((record) => record.score < 60).every((record) => record.grade === "F")).toBe(true);
  });
});
