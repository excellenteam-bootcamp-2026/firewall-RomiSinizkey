import { NextFunction, Request, Response, Router } from "express";
import { RuleRepository } from "../../../../application/ports/RuleRepository";
import { AddRulesUseCase } from "../../../../application/use-cases/AddRulesUseCase";
import { RemoveRulesUseCase } from "../../../../application/use-cases/RemoveRulesUseCase";
import { GetRulesUseCase } from "../../../../application/use-cases/GetRulesUseCase";
import { UpdateRuleStatusUseCase } from "../../../../application/use-cases/UpdateRuleStatusUseCase";

export function createFirewallRouter(repository: RuleRepository): Router {
  const router = Router();

  const addRules = new AddRulesUseCase(repository);
  const removeRules = new RemoveRulesUseCase(repository);
  const getRules = new GetRulesUseCase(repository);
  const updateRuleStatus = new UpdateRuleStatusUseCase(repository);

  router.post("/ips", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await addRules.execute("ip", req.body?.values, req.body?.mode);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/domains", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await addRules.execute("domain", req.body?.values, req.body?.mode);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/ports", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await addRules.execute("port", req.body?.values, req.body?.mode);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/rules", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await removeRules.execute(req.body?.ids);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/rules", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await getRules.execute(req.query.type);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/rules/status", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await updateRuleStatus.execute(req.body?.ids, req.body?.active);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
