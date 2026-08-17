# Firewall Orchestrator API

NodeJS/Express/TypeScript orchestrator API for managing firewall rules (IPs, domains, ports),
structured with Hexagonal Architecture.


## Structure

- `src/domain` — entities (framework-agnostic core).
- `src/application` — ports, use cases, validation, and error types.
- `src/adapters/inbound/http` — Express HTTP adapter (app, controllers, middleware).
- `src/adapters/outbound/persistence/memory` — the in-memory repository adapter.
- `src/main` — composition root: environment config, logger, and the server entry point.

## Scripts

- `npm run dev` — start the API in watch mode.
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run the compiled server.
- `npm run lint` — type-check without emitting.

## API

See the project spec for full endpoint documentation:

- `POST /api/firewall/ips`
- `POST /api/firewall/domains`
- `POST /api/firewall/ports`
- `DELETE /api/firewall/rules`
- `GET /api/firewall/rules` (optional `?type=ip|domain|port`)
- `PATCH /api/firewall/rules/status`

## How the project works (beginner-friendly walkthrough)

This section explains, in plain language, what actually happens when you run the server and
send it a request. No prior backend experience needed.

### The flow, step by step

1. The developer starts the server using `npm run dev`.
2. `server.ts` creates the in-memory repository.
3. The repository stores firewall rules temporarily in memory (a list living inside the running
   program, not in a file or a database).
4. `createApp` configures the Express application (sets up JSON parsing, logging, routes, and
   error handling).
5. Express waits for HTTP requests.
6. A client such as Postman sends a request to one of the API endpoints (for example,
   `POST /api/firewall/ips`).
7. The controller receives the HTTP request and extracts the input (the URL, the body, the query
   parameters).
8. The controller calls the appropriate use case, passing along the input it extracted.
9. The use case validates the input (Is the IP actually a valid IP? Is the mode either
   `blacklist` or `whitelist`?) and then performs the business operation.
10. The repository adds, retrieves, updates, or deletes the firewall rules in its in-memory list.
11. The controller returns a JSON response to the client, with the right HTTP status code
    (like `200`, `201`, `400`, or `404`).
12. All stored rules are lost when the server restarts, because the storage is in memory only —
    nothing is saved to disk.

### Simple flow diagram

```
Client / Postman
    ↓
Express Route
    ↓
Controller
    ↓
Use Case
    ↓
Validation
    ↓
Repository
    ↓
JSON Response
```

### What each piece actually does

- **Express** — a small, popular library for Node.js that makes it easy to build a web server:
  receive HTTP requests, decide what to do with them, and send back responses.
- **HTTP** — the protocol (the "language") that clients (like Postman, a browser, or a frontend
  app) and servers use to talk to each other over the network. Every request has a method
  (`GET`, `POST`, `DELETE`, `PATCH`), a URL, and optionally a body of data.
- **Controller** — the "front door" of the API. It doesn't contain business logic itself; its only
  job is to read the incoming HTTP request, hand the relevant data to the right use case, and
  turn the use case's result into an HTTP response.
- **Use Case** — a class that represents one specific action the system can do (e.g. "add
  rules," "delete rules"). This is where the actual business rules live, completely independent
  of Express or HTTP.
- **Validation** — the checks that make sure the input makes sense before anything is stored:
  is this really a valid IPv4 address, is the port number in range, is the mode spelled
  correctly. If validation fails, the request is rejected with a clear error message instead of
  silently doing the wrong thing.
- **Repository** — the piece responsible for storing and retrieving data. The use cases talk to
  it through a generic interface, without knowing or caring *how* the data is actually stored.
- **InMemoryRuleRepository** — the specific repository used in this project right now: it keeps
  all the rules in a plain array in memory. Simple and fast, but temporary — everything
  disappears when the server restarts. It could be swapped later for a repository backed by a
  real database, without changing any of the use cases or controllers.
- **Dependency Injection** — instead of a use case creating its own repository internally, the
  repository is created once (in `server.ts`) and "injected" (passed in) wherever it's needed.
  This makes it easy to swap the in-memory repository for a different one later, and easy to
  test each piece on its own.
