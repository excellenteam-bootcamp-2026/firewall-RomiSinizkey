import type { Server } from "http";
import { createApp } from "../adapters/inbound/http/app";
import { DrizzleRuleRepository } from "../adapters/outbound/persistence/postgres/DrizzleRuleRepository";
import { postgresConnection } from "../adapters/outbound/persistence/postgres/connection";
import { RabbitMqCommandPublisher } from "../adapters/outbound/rabbitmq/RabbitMqCommandPublisher";
import { config } from "./env";
import { logger } from "./Logger";

export interface StartedServer {
  httpServer: Server;
  shutdown: (signal?: string) => Promise<void>;
  signalHandlers: { SIGINT: () => void; SIGTERM: () => void };
}

export async function startServer(): Promise<StartedServer> {
  const db = await postgresConnection.connect();
  const repository = new DrizzleRuleRepository(db);

  const commandPublisher = new RabbitMqCommandPublisher({
    url: config.rabbitmq.url,
    exchange: config.rabbitmq.exchange,
    routingPrefix: config.rabbitmq.routingPrefix,
  });
  await commandPublisher.connect();

  const app = createApp(repository, commandPublisher);

  const httpServer = app.listen(config.port, () => {
    logger.info(`Firewall orchestrator API listening on port ${config.port}`);
  });

  let isShuttingDown = false;

  async function shutdown(signal?: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    if (signal) {
      logger.info(`[server] received ${signal}, shutting down gracefully`);
    }

    let closeError: unknown;
    try {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      closeError = err;
    } finally {
      // Always attempt to close both the RabbitMQ channel/connection and the
      // PostgreSQL pool, even if the HTTP server failed to close cleanly — a
      // failed close() must not leak either resource.
      await commandPublisher.close();
      await postgresConnection.shutdown();
    }

    if (closeError) {
      throw closeError;
    }

    logger.info("[server] shutdown complete");
  }

  const onSigint = (): void => {
    void shutdown("SIGINT").catch((err) => logger.error("[server] shutdown error", { err }));
  };
  const onSigterm = (): void => {
    void shutdown("SIGTERM").catch((err) => logger.error("[server] shutdown error", { err }));
  };

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  return { httpServer, shutdown, signalHandlers: { SIGINT: onSigint, SIGTERM: onSigterm } };
}
