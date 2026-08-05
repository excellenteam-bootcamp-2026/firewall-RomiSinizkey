import { NextFunction, Request, Response } from "express";
import { AppError } from "../../../application/errors/AppError";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ status: "error", code: "NOT_FOUND", message: "Resource not found." });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ status: "error", code: err.code, message: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ status: "error", code: "INTERNAL_ERROR", message: "An unexpected error occurred." });
}
