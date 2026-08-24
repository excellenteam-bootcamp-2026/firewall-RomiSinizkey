# AI Conversation Report — Issue #76

## Purpose

This report covers only the current branch's issue. Earlier issues' summaries were removed by
request; their full history remains available via `git log` on `main`, where each was committed
when its PR merged. No secrets, passwords, credentials, or environment-variable values appear
below.

## Current state

- **Branch:** `feature/76-project7-docs`
- **Issue:** #76 — `[Docs] Document and verify Project 7 architecture` — implemented this session,
  not yet committed
- **Project / Phase:** Project 7 — First Queued Firewall Rule (tracking epic #69), child issue 7 of
  7 — **this is Project 7's last child issue**
- **Base commit:** `5840fd3` — merge of PR #82 (`feature/75-rabbitmq-e2e-verification`), confirmed
  identical to `main` and `origin/main` at branch start (no drift, no stacked/unmerged work)

## What was already completed before this branch

- **Issues #70–#75 — all complete, merged, and verified end-to-end.** The full asynchronous
  pipeline exists in code and has been proven working against real infrastructure: Node validates
  and publishes; CloudAMQP routes the message; Python consumes, validates, persists, and acks only
  on success. What had **not** yet happened was making the repository's own documentation say any
  of this — the two READMEs still described the pre-Project-7 world in several places, some of
  them actively incorrect rather than merely incomplete.

## What this branch was intended to implement (Issue #76 scope)

No application behavior change. Document the final Project 7 architecture in both READMEs, verify
every documented claim against the actual current code (not against memory or the original plan),
and correct anything found to be stale.

## Conversation / Reasoning Summary

- **Why this issue started with inspection rather than writing.** Before adding anything, this
  session read every relevant section of both READMEs against the actual current source — not to
  confirm the docs were already fine, but specifically looking for drift. This found real
  problems, not just gaps.

- **What was found stale — and why each one mattered:**
  - Root `README.md`'s `POST /api/firewall/ips` section still documented a synchronous `201`
    response with database-generated rule IDs. This is the single most user-facing piece of
    documentation in the repository for this exact endpoint, and it described behavior that
    stopped being true back in Issue #72.
  - The "Request flow" diagram, "Current persistence status", and the beginner-friendly walkthrough
    all described **every** route going straight from controller → use case → `RuleRepository`,
    with no mention that `/ips` diverges. Left as-is, a reader would have no way to know `/ips` is
    now the exception.
  - `python-rule-service/README.md` was the more serious case: its "What `python -m src.main` does
    today" section stated, in bold, that the entry point "does not construct a
    `SqlAlchemyRuleRepository`, does not call `AddIpUseCase`, and does not insert a database row
    automatically." Every clause of that sentence became false in Issue #74. Its "Run" section
    still said the process "exits 0" after one log line — also false; it's long-lived now. Its
    closing "Node.js vs. Python" section still listed RabbitMQ/CloudAMQP/Node-to-Python publication
    under "Deferred to Project 7 - not designed, not stubbed, not scaffolded" — the exact opposite
    of the repository's actual state after Issues #70-#75.
  - Decision made: correct these in place with an explicit editorial note (rather than silently
    rewriting), so anyone who read the old version and now reads the diff can see exactly what
    changed and why, instead of the correction being invisible.

- **Why the new Project 7 section was written once, in the root README, rather than duplicated in
  both READMEs.** The full architecture diagram, the message contract, and the ACK/reject table
  live in `README.md` as the canonical version. `python-rule-service/README.md`'s new "RabbitMQ
  consumer (Project 7)" section covers only the Python-side component table and points back to the
  root README for the shared diagram/contract — avoiding two copies that could drift apart from
  each other the same way the old docs had already drifted from the code.

- **Why the verification claims in the docs cite specific evidence rather than just asserting
  success.** The new "End-to-end verification procedure" section in the root README doesn't just
  say "this works" — it names the exact log event names (verified directly against
  `rabbitmq_consumer.py`, `create_rules_command_handler.py`, `add_ip_use_case.py`, and
  `__main__.py` via `grep`, not recalled from memory) and the exact Issue #75 result (`202` +
  `operation_id`; CloudAMQP showed 1 consumer and an ack; PostgreSQL row confirmed), matching what
  `AI_CONVERSATION_REPORT.md` already recorded for Issue #75.

## AI Explanations Provided

Architecture concepts discussed and documented across Project 7, in compact form:

- **Exchange vs. Queue** — an exchange (`firewall.commands`, type `direct`) is a routing rule, not
  storage; it decides *where* a published message goes based on its routing key. A queue
  (`romi.firewall.commands`) is what actually holds the message until a consumer acks it. A message
  is never "in" the exchange — it's routed through it into a queue.
- **Binding and routing key** — the binding is the standing rule connecting an exchange to a queue
  ("route anything with routing key X to this queue"); the routing key (`romi.rule.create`) is the
  label a publisher attaches to one specific message so the exchange knows which binding applies.
  Built from `RABBITMQ_ROUTING_PREFIX` specifically so a shared CloudAMQP instance can host
  multiple students' queues without cross-delivery.
- **Producer vs. Consumer** — Node is the producer (`RabbitMqCommandPublisher`, publishes and never
  reads from the queue). Python is the consumer (`RabbitMqCommandConsumer`, reads and acks/rejects,
  never publishes). Each only ever plays one role in this architecture.
- **`amqplib` vs. `aio-pika`** — the same protocol (AMQP 0-9-1), two different language ecosystems'
  clients: `amqplib` (Node, callback/Promise-based, used only inside `RabbitMqCommandPublisher.ts`)
  and `aio-pika` (Python, `asyncio`-native, used only inside `rabbitmq_consumer.py`). Neither type
  from either library is allowed to leak outside its one adapter file.
- **Controller vs. Use Case** — the controller (`firewallController.ts`) is the HTTP-specific
  translation layer: reads `req.body`, calls a use case, writes `res.status(...).json(...)`. The
  use case (`PublishCreateRulesCommandUseCase`, `AddIpUseCase`) is the actual business logic and
  has no idea Express or HTTP exists — the same use case logic would work if called from a CLI or
  a test.
- **Interface/port vs. concrete adapter** — `CommandPublisher` (TypeScript interface) and
  `RuleRepository` (Python ABC) describe *what* must be possible without saying *how*.
  `RabbitMqCommandPublisher`/`SqlAlchemyRuleRepository` are the concrete "how." Application code
  depends only on the port type, which is what let RabbitMQ get added without changing
  `AddRulesUseCase` or any other existing use case.
- **`CommandPublisher`** — the one-method port (`publish(command): Promise<void>`) that hides
  `amqplib` from every layer above `RabbitMqCommandPublisher.ts`. `PublishCreateRulesCommandUseCase`
  depends on this type, never on the concrete adapter.
- **Handler responsibilities** — `CreateRulesCommandHandler` is deliberately thin: it does not
  re-validate anything Pydantic already checked, does not know about RabbitMQ, and does not know
  about `aio_pika`. Its only job is translating one validated command into one or more
  `AddIpUseCase.execute()` calls, plus binding `operation_id` for the duration.
- **ACK semantics** — ack tells the broker "permanently discard this, it's fully handled." Only
  sent after `AddIpUseCase`/`SqlAlchemyRuleRepository` return successfully — never earlier, since
  an early ack followed by a crash would silently lose the command. A handler failure or a
  contract-validation failure both result in `reject(requeue=False)`, deliberately not requeued
  (would otherwise retry a persistent failure forever, with no backoff).
- **Why `__main__.py` wires dependencies but doesn't process each message itself** — it's the
  composition root, the same role `main/startServer.ts` plays on the Node side: `build_consumer()`
  constructs the object graph exactly once, at startup; `run()` starts the consumer and waits for a
  shutdown signal. Per-message work happens entirely inside `RabbitMqCommandConsumer`/
  `CreateRulesCommandHandler` — `__main__.py` never sees an individual message.
- **The Python file-by-file execution flow, restated for the docs:** `RabbitMqCommandConsumer
  ._on_message()` → `_parse()` (JSON + Pydantic, `message_models.py`) →
  `CreateRulesCommandHandler.__call__()` (`create_rules_command_handler.py`) →
  `asyncio.to_thread(AddIpUseCase.execute)` (`add_ip_use_case.py`, unmodified) →
  `SqlAlchemyRuleRepository.add()` (`sqlalchemy_rule_repository.py`, unmodified) → PostgreSQL →
  `message.ack()`. Documented as a diagram in both READMEs now, not just in this report.

## Verbatim Excerpts From This Session

**User, defining the goal, verbatim:**
> Document the final Project 7 architecture accurately and verify that the repository
> documentation matches the actual implementation.

**User, on what counts as done for this issue:**
> Verification:
> Compare the documentation against the actual code.
> If documentation is stale or contradicts implementation, correct it.

**User, scope boundary, verbatim:**
> Do not modify Node or Python application behavior.
> Do not add new dependencies.
> Do not start Project 8 or any later work.

## What was actually documented

**Modified files (both pre-existing, tracked; no new file created):**

- **`README.md`** — corrected the stale `POST /api/firewall/ips` section (`201`→`202` +
  `operation_id`, no DB IDs returned); added callouts to the "Request flow" diagram, "Current
  persistence status", "Installation and running", and the beginner walkthrough noting `/ips` is
  the one exception; added the routing-key construction detail to the existing env-var table;
  added Project 7's completion status to "Current limitations / roadmap"; and added the new
  **"Project 7: asynchronous command flow"** section — architecture diagram, a responsibility table
  for all 11 components the issue asked for, the exact message contract, the ACK/reject table,
  required env vars for both services, how to run both services, the E2E verification procedure,
  the recorded Issue #75 result, and the four explicitly-required known limitations.
- **`python-rule-service/README.md`** — corrected the intro paragraph, the "Structure" tree (added
  `adapters/inbound/rabbitmq/` and its three new test files), the "Run" section (no longer "exits
  0"), the "Purpose" subsection, the "What each layer owns" table (new `adapters/inbound/rabbitmq`
  row), the "Add IP trace" step 1, the "What `python -m src.main` does today" section (previously
  actively false, now corrected with an explicit note), and the "Node.js vs. Python - what moved,
  what didn't" closing section; added the new **"RabbitMQ consumer (Project 7)"** section (the
  Python-side component table, ACK/reject behavior, and the Issue #75 verification record) — this
  points back to the root README for the shared diagram/message contract rather than duplicating
  them.

## Stale documentation found (and corrected)

| Location | Was | Now |
|---|---|---|
| `README.md`, `/ips` endpoint doc | `201` + DB-generated rule IDs | `202` + `operation_id`, cross-referenced to the new Project 7 section |
| `README.md`, Request flow / persistence / walkthrough | Described every route uniformly | Explicit `/ips`-is-the-exception callouts added |
| `python-rule-service/README.md`, "What `python -m src.main` does today" | Stated it does *not* construct the repository, call `AddIpUseCase`, or insert rows | Corrected: it does all three, via `build_consumer()`, as of Issue #74 |
| `python-rule-service/README.md`, "Run" | Stated the process "exits 0" | Corrected: long-lived, stays running until `Ctrl+C`/SIGTERM |
| `python-rule-service/README.md`, "Node.js vs. Python" | Listed RabbitMQ/CloudAMQP/Node-to-Python publication under "Deferred to Project 7 - not designed, not stubbed, not scaffolded" | Corrected: implemented, live, and verified end-to-end |

## Final documented architecture (summary)

```
POST /api/firewall/ips -> Node.js (validate, generate operation_id, publish)
  -> CommandPublisher -> RabbitMqCommandPublisher -> amqplib
  -> CloudAMQP: exchange firewall.commands, routing key romi.rule.create, queue romi.firewall.commands
  -> Python: RabbitMqCommandConsumer (aio-pika) -> Pydantic CreateRulesCommand validation
  -> CreateRulesCommandHandler -> AddIpUseCase -> SqlAlchemyRuleRepository -> PostgreSQL
  -> ack (only after success)
```
Fully documented in `README.md`'s "Project 7: asynchronous command flow" and
`python-rule-service/README.md`'s "RabbitMQ consumer (Project 7)", cross-referencing each other
rather than duplicating.

## Tests / checks run and their results

```
npm run lint   → passed (tsc --noEmit, no errors)
npm test       → 217 passed, 17 skipped, 0 failed
                 (first run showed 1 failure - the same pre-existing cold-import CPU-contention
                 flake in Logger.test.ts's Singleton test seen earlier this session, documented in
                 vitest.config.mts's own comments; passed clean on immediate re-run, confirming it
                 wasn't caused by this session's doc-only changes)

python -m pytest -q   → 119 passed, 5 skipped, 0 failed   (unchanged from before this branch)
```

`git diff --stat -- src/ tests/ python-rule-service/src/ python-rule-service/tests/` is empty —
confirmed directly, not assumed: **zero application or test code changed this session.** Only
`README.md` and `python-rule-service/README.md` were modified.

## Known limitations / remaining work

- This issue only updates the two READMEs. `AI_CONVERSATION_REPORT.md`'s own historical entries
  for earlier issues were not rewritten to match (by design — this file's own stated convention is
  that it covers only the current branch's issue at any given time, with history preserved via
  `git log` once each issue merges).
- Project 7's own known limitations (no retry/backoff, no requeue strategy, no idempotency,
  `/domains`/`/ports` remain synchronous) are now documented in both READMEs, not just in this
  report — but remain genuinely unimplemented, as intended, and are out of this issue's scope to
  fix.

## Explicit note

Node.js and Python application behavior were not modified in any way — confirmed via an empty
`git diff` on every `src/`/`tests/` path in both services. No new dependency was added. **Project 8
(or any work beyond Project 7) has not started.** This is Project 7's last planned child issue;
once this is committed and merged, epic #69 has no open child issues remaining.

Nothing was staged, committed, or pushed this session.
