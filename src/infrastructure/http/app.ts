import express, { Express } from "express";
import { RuleRepository } from "../../domain/ports/RuleRepository";
import { createFirewallRouter } from "./controllers/firewallController";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp(repository: RuleRepository): Express {
  const app = express();

  app.use(express.json());
  app.use(requestLogger);

  app.use("/api/firewall", createFirewallRouter(repository));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
