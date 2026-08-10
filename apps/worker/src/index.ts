import {
  createResultLookupKey,
  matchesNormalizedIdentity,
  normalizeStudentId,
  type KvStudentResult,
  type ResultErrorResponse,
  type ResultSuccessResponse
} from "@edge-results/shared";

export interface KvNamespace {
  get(key: string): Promise<string | null>;
}

export interface Env {
  RESULTS_KV: KvNamespace;
  LOOKUP_KEY_SECRET: string;
}

function jsonResponse(body: ResultSuccessResponse | ResultErrorResponse, status: number): Response {
  return Response.json(body, { status });
}

function notFound(): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code: "RESULT_NOT_FOUND",
        message: "No result was found for that student ID"
      }
    },
    404
  );
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const rawStudentId = url.searchParams.get("studentId");

  if (rawStudentId === null || normalizeStudentId(rawStudentId).length === 0) {
    return jsonResponse(
      {
        success: false,
        error: { code: "INVALID_REQUEST", message: "studentId is required" }
      },
      400
    );
  }

  try {
    const key = await createResultLookupKey(env.LOOKUP_KEY_SECRET, rawStudentId);
    const stored = await env.RESULTS_KV.get(key);
    if (stored === null) {
      return notFound();
    }

    const record = JSON.parse(stored) as KvStudentResult;
    const studentName = url.searchParams.get("studentName") ?? undefined;
    const fatherName = url.searchParams.get("fatherName") ?? undefined;
    if (
      !matchesNormalizedIdentity(
        record.studentNameNormalized,
        record.fatherNameNormalized,
        studentName,
        fatherName
      )
    ) {
      return notFound();
    }

    const response: ResultSuccessResponse = { success: true, data: record.data };
    return jsonResponse(response, 200);
  } catch {
    return jsonResponse(
      {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "The result service could not complete the request"
        }
      },
      500
    );
  }
}

export default {
  fetch: handleRequest
};
