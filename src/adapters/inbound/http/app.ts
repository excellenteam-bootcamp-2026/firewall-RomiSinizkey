import express, { Express } from "express";
import { RuleRepository } from "../../../application/ports/RuleRepository";
import { CommandPublisher } from "../../../application/ports/CommandPublisher";
import { createFirewallRouter } from "./controllers/firewallController";
import { createHealthRouter } from "./controllers/healthController";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

export function createApp(repository: RuleRepository, commandPublisher: CommandPublisher): Express {
  const app = express();

  app.use(express.json());
  app.use(requestLogger);

  // Liveness only: mounted outside /api/firewall and independent of `repository`,
  // so it never touches PostgreSQL or any use case.
  app.use("/health", createHealthRouter());

  app.use("/api/firewall", createFirewallRouter(repository, commandPublisher));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
