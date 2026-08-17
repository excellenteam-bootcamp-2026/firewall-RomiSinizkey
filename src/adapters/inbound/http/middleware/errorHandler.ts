import { NextFunction, Request, Response } from "express";
import { AppError } from "../../../../application/errors/AppError";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Resource not found." });
}

function isMalformedJsonError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    "status" in err &&
    (err as { status?: unknown }).status === 400 &&
    "type" in err &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ status: "error", code: err.code, message: err.message });
    return;
  }

  if (isMalformedJsonError(err)) {
    res.status(400).json({
      status: "error",
      code: "INVALID_JSON",
      message: "Request body contains malformed JSON.",
    });
    return;
  }

  console.error(err);
  res.status(500).json({ status: "error", code: "INTERNAL_ERROR", message: "An unexpected error occurred." });
}
