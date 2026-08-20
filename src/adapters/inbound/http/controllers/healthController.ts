import { Request, Response, Router } from "express";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  return router;
}
