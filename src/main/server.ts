import "dotenv/config";
import "./Logger";
import { createApp } from "../adapters/inbound/http/app";
import { InMemoryRuleRepository } from "../adapters/outbound/persistence/memory/InMemoryRuleRepository";
import { config } from "./env";

const repository = new InMemoryRuleRepository();
const app = createApp(repository);

app.listen(config.port, () => {
  console.log(`Firewall orchestrator API listening on port ${config.port}`);
});
