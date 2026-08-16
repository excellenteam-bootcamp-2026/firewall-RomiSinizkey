import "dotenv/config";
import { createApp } from "./app";
import { InMemoryRuleRepository } from "../repositories/InMemoryRuleRepository";
import { config } from "../../main/env";

const repository = new InMemoryRuleRepository();
const app = createApp(repository);

app.listen(config.port, () => {
  console.log(`Firewall orchestrator API listening on port ${config.port}`);
});
