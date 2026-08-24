import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Express } from "express";
import { createApp } from "../../../src/adapters/inbound/http/app";
import { InMemoryRuleRepository } from "../../../src/adapters/outbound/persistence/memory/InMemoryRuleRepository";
import { CommandPublisher } from "../../../src/application/ports/CommandPublisher";

// No PostgreSQL or RabbitMQ connection anywhere in this file — createApp is
// given an InMemoryRuleRepository and this no-op publisher purely to satisfy
// its constructor signature. /health must respond without ever touching
// either, proving it is a pure liveness check with no external dependency.
function createNoopCommandPublisher(): CommandPublisher {
  return { publish: vi.fn() };
}

describe("Health HTTP API", () => {
  function buildApp(): Express {
    return createApp(new InMemoryRuleRepository(), createNoopCommandPublisher());
  }

  it("GET /health returns 200 with the exact liveness payload", async () => {
    const response = await request(buildApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /health responds without any repository/database access", async () => {
    const repository = new InMemoryRuleRepository();
    const getAllSpy = vi.spyOn(repository, "getAll");
    const app = createApp(repository, createNoopCommandPublisher());

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(getAllSpy).not.toHaveBeenCalled();
  });

  it("existing unknown routes still return 404 NOT_FOUND alongside the new /health route", async () => {
    const response = await request(buildApp()).get("/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      status: "error",
      code: "NOT_FOUND",
      message: "Resource not found.",
    });
  });
});
