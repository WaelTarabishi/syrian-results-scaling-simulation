import type { StudentResult } from "@edge-results/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { ResultRepository } from "./repository.js";

const result: StudentResult = {
  studentId: "STU-000001",
  studentName: "Lina Haddad",
  fatherName: "Omar Haddad",
  academicYear: "2025-2026",
  score: 87.5,
  grade: "B+",
  status: "pass"
};

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createRepository(value: StudentResult | null): ResultRepository {
  return { findByNormalizedStudentId: vi.fn().mockResolvedValue(value) };
}

describe("GET /api/result", () => {
  it("normalizes the student ID and returns the shared success shape", async () => {
    const repository = createRepository(result);
    const app = buildApp({ repository });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/result?studentId=%20stu-%20000001%20" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, data: result });
    expect(repository.findByNormalizedStudentId).toHaveBeenCalledWith("STU-000001");
  });

  it("rejects a missing student ID with the shared error shape", async () => {
    const app = buildApp({ repository: createRepository(null) });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/result" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "INVALID_REQUEST", message: "studentId is required" }
    });
  });

  it("returns a stable not-found response", async () => {
    const app = buildApp({ repository: createRepository(null) });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/result?studentId=STU-999999" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "RESULT_NOT_FOUND", message: "No result was found for that student ID" }
    });
  });

  it("verifies optional normalized identity fields without changing ID-only lookups", async () => {
    const repository = createRepository(result);
    const app = buildApp({ repository });
    apps.push(app);

    const match = await app.inject({
      method: "GET",
      url: "/api/result?studentId=STU-000001&studentName=%20lina%20%20HADDAD&fatherName=omar%20haddad"
    });
    const mismatch = await app.inject({
      method: "GET",
      url: "/api/result?studentId=STU-000001&studentName=Wrong%20Name&fatherName=Omar%20Haddad"
    });

    expect(match.statusCode).toBe(200);
    expect(match.json()).toEqual({ success: true, data: result });
    expect(mismatch.statusCode).toBe(404);
    expect(mismatch.json()).toEqual({
      success: false,
      error: { code: "RESULT_NOT_FOUND", message: "No result was found for that student ID" }
    });
  });
});
