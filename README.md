# Firewall Orchestrator API

NodeJS/Express/TypeScript orchestrator API for managing firewall rules (IPs, domains, ports),
structured with Hexagonal Architecture.

## Structure

- `src/domain` — entities and ports (framework-agnostic core).
- `src/application` — use cases, validation, and error types.
- `src/infrastructure` — Express HTTP adapter and the in-memory repository adapter.

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
