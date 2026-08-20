import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { Express } from "express";
import { createApp } from "../../../src/adapters/inbound/http/app";
import { InMemoryRuleRepository } from "../../../src/adapters/outbound/persistence/memory/InMemoryRuleRepository";

describe("Health HTTP API", () => {
  // No PostgreSQL connection anywhere in this file — createApp is given an
  // InMemoryRuleRepository purely to satisfy its constructor signature. /health
  // must respond without ever touching that repository, proving it is a pure
  // liveness check with no database dependency.
  function buildApp(): Express {
    return createApp(new InMemoryRuleRepository());
  }

  it("GET /health returns 200 with the exact liveness payload", async () => {
    const response = await request(buildApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /health responds without any repository/database access", async () => {
    const repository = new InMemoryRuleRepository();
    const getAllSpy = vi.spyOn(repository, "getAll");
    const app = createApp(repository);

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
