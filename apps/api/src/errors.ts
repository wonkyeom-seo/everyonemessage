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

  reply.status(500).send({ error: "서버 오류가 발생했습니다." });
}
