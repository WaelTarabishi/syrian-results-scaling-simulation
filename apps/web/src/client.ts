import type { ResultResponse, StudentResult } from "@edge-results/shared";

export type Backend = "traditional" | "edge";

export type LookupOutcome =
  | { kind: "success"; result: StudentResult }
  | { kind: "not-found" }
  | { kind: "failure"; message: string };

const endpoints: Record<Backend, string> = {
  traditional: import.meta.env.VITE_TRADITIONAL_API_URL ?? "/traditional/api/result",
  edge: import.meta.env.VITE_EDGE_API_URL ?? "/edge/api/result"
};

function isResultResponse(value: unknown): value is ResultResponse {
  if (typeof value !== "object" || value === null || !("success" in value)) {
    return false;
  }

  const candidate = value as { success?: unknown; data?: unknown; error?: unknown };
  return (
    (candidate.success === true && typeof candidate.data === "object" && candidate.data !== null) ||
    (candidate.success === false && typeof candidate.error === "object" && candidate.error !== null)
  );
}

export async function lookupResult(
  backend: Backend,
  studentId: string,
  signal?: AbortSignal
): Promise<LookupOutcome> {
  const url = new URL(endpoints[backend], window.location.origin);
  url.searchParams.set("studentId", studentId);

  const response = await fetch(url, { signal });
  const body: unknown = await response.json().catch(() => null);

  if (!isResultResponse(body)) {
    return { kind: "failure", message: "The service returned an unexpected response." };
  }

  if (body.success && response.ok) {
    return { kind: "success", result: body.data };
  }

  if (!body.success && body.error.code === "RESULT_NOT_FOUND") {
    return { kind: "not-found" };
  }

  return {
    kind: "failure",
    message: !body.success ? body.error.message : "The result service could not complete the request."
  };
}
