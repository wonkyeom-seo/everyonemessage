import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof HttpError) {
    reply.status(error.statusCode).send({ error: error.message });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: "입력값을 확인해주세요.",
      issues: error.issues
    });
    return;
  }

  if (typeof error === "object" && error && "statusCode" in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
      reply.status(statusCode).send({ error: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." });
      return;
    }
  }

  reply.status(500).send({ error: "서버 오류가 발생했습니다." });
}
