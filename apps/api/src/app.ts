import {
  matchesResultIdentity,
  normalizeStudentId,
  type ResultErrorResponse,
  type ResultSuccessResponse
} from "@edge-results/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { ResultRepository } from "./repository.js";

interface ResultQuerystring {
  studentId?: string;
  studentName?: string;
  fatherName?: string;
}

interface BuildAppOptions {
  repository: ResultRepository;
  logger?: boolean;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Querystring: ResultQuerystring }>("/api/result", async (request, reply) => {
    const rawStudentId = request.query.studentId;
    if (typeof rawStudentId !== "string" || normalizeStudentId(rawStudentId).length === 0) {
      const response: ResultErrorResponse = {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "studentId is required"
        }
      };
      return reply.code(400).send(response);
    }

    const result = await options.repository.findByNormalizedStudentId(normalizeStudentId(rawStudentId));
    if (!result || !matchesResultIdentity(result, request.query.studentName, request.query.fatherName)) {
      const response: ResultErrorResponse = {
        success: false,
        error: {
          code: "RESULT_NOT_FOUND",
          message: "No result was found for that student ID"
        }
      };
      return reply.code(404).send(response);
    }

    const response: ResultSuccessResponse = { success: true, data: result };
    return reply.code(200).send(response);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const response: ResultErrorResponse = {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The result service could not complete the request"
      }
    };
    return reply.code(500).send(response);
  });

  return app;
}
