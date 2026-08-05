import { NextFunction, Request, Response, Router } from "express";
import { RuleRepository } from "../../../domain/ports/RuleRepository";
import { AddRulesUseCase } from "../../../application/use-cases/AddRulesUseCase";
import { RemoveRulesUseCase } from "../../../application/use-cases/RemoveRulesUseCase";
import { GetRulesUseCase } from "../../../application/use-cases/GetRulesUseCase";
import { UpdateRuleStatusUseCase } from "../../../application/use-cases/UpdateRuleStatusUseCase";

export function createFirewallRouter(repository: RuleRepository): Router {
  const router = Router();

  const addRules = new AddRulesUseCase(repository);
  const removeRules = new RemoveRulesUseCase(repository);
  const getRules = new GetRulesUseCase(repository);
  const updateRuleStatus = new UpdateRuleStatusUseCase(repository);

  router.post("/ips", (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = addRules.execute("ip", req.body?.values, req.body?.mode);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/domains", (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = addRules.execute("domain", req.body?.values, req.body?.mode);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post("/ports", (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = addRules.execute("port", req.body?.values, req.body?.mode);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.delete("/rules", (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = removeRules.execute(req.body?.ids);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/rules", (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = getRules.execute(req.query.type);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/rules/status", (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = updateRuleStatus.execute(req.body?.ids, req.body?.active);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
