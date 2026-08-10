import { createResultLookupKey, normalizePersonName, type KvStudentResult, type StudentResult } from "@edge-results/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest, type Env, type KvNamespace } from "./index.js";

const secret = "synthetic-worker-test-secret";
const result: StudentResult = {
  studentId: "STU-000001",
  studentName: "Lina Haddad",
  fatherName: "Fadi Haddad",
  academicYear: "2025-2026",
  score: 45,
  grade: "F",
  status: "fail"
};

class MemoryKv implements KvNamespace {
  public readonly values = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
}

let kv: MemoryKv;
let env: Env;

beforeEach(async () => {
  kv = new MemoryKv();
  env = { RESULTS_KV: kv, LOOKUP_KEY_SECRET: secret };
  const stored: KvStudentResult = {
    data: result,
    studentNameNormalized: normalizePersonName(result.studentName),
    fatherNameNormalized: normalizePersonName(result.fatherName)
  };
  kv.values.set(await createResultLookupKey(secret, result.studentId), JSON.stringify(stored));
});

async function lookup(query: string): Promise<{ status: number; body: unknown }> {
  const response = await handleRequest(new Request(`https://worker.test/api/result?${query}`), env);
  return { status: response.status, body: await response.json() };
}

const notFoundBody = {
  success: false,
  error: { code: "RESULT_NOT_FOUND", message: "No result was found for that student ID" }
};

describe("Cloudflare Worker result lookup", () => {
  it("returns a successful lookup using the traditional response structure", async () => {
    const response = await lookup("studentId=STU-000001&studentName=Lina%20Haddad&fatherName=Fadi%20Haddad");

    expect(response).toEqual({ status: 200, body: { success: true, data: result } });
  });

  it("rejects an incorrect student name", async () => {
    const response = await lookup("studentId=STU-000001&studentName=Maya%20Haddad&fatherName=Fadi%20Haddad");

    expect(response).toEqual({ status: 404, body: notFoundBody });
  });

  it("rejects an incorrect father name", async () => {
    const response = await lookup("studentId=STU-000001&studentName=Lina%20Haddad&fatherName=Omar%20Haddad");

    expect(response).toEqual({ status: 404, body: notFoundBody });
  });

  it("returns not found for an unknown student ID", async () => {
    const response = await lookup("studentId=STU-999999&studentName=Lina%20Haddad&fatherName=Fadi%20Haddad");

    expect(response).toEqual({ status: 404, body: notFoundBody });
  });

  it("normalizes whitespace in all lookup fields", async () => {
    const response = await lookup(
      "studentId=%20stu-%20000001%20&studentName=%20Lina%20%20%20Haddad%20&fatherName=%20Fadi%09Haddad%20"
    );

    expect(response).toEqual({ status: 200, body: { success: true, data: result } });
  });

  it("normalizes case in all lookup fields", async () => {
    const response = await lookup("studentId=stu-000001&studentName=lINA%20hADDAD&fatherName=fADI%20hADDAD");

    expect(response).toEqual({ status: 200, body: { success: true, data: result } });
  });
});
