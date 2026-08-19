import "dotenv/config";
import { startServer } from "./startServer";
import { logger } from "./Logger";

startServer().catch((err) => {
  logger.error("[server] failed to start", { err });
  process.exit(1);
});
