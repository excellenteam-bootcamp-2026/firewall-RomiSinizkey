import { createApp } from "./app";
import { InMemoryRuleRepository } from "../repositories/InMemoryRuleRepository";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const repository = new InMemoryRuleRepository();
const app = createApp(repository);

app.listen(PORT, () => {
  console.log(`Firewall orchestrator API listening on port ${PORT}`);
});
