import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { Express } from "express";
import { createApp } from "../../../src/infrastructure/http/app";
import { InMemoryRuleRepository } from "../../../src/infrastructure/repositories/InMemoryRuleRepository";

describe("Firewall HTTP API", () => {
  let repository: InMemoryRuleRepository;
  let app: Express;

  beforeEach(() => {
    repository = new InMemoryRuleRepository();
    app = createApp(repository);
  });

  describe("success paths", () => {
    it("POST /api/firewall/ips returns 201 and the created ip rule", async () => {
      const response = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["1.2.3.4"], mode: "blacklist" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        type: "ip",
        mode: "blacklist",
        status: "success",
        values: [{ id: expect.any(Number), value: "1.2.3.4", active: true }],
      });
    });

    it("POST /api/firewall/domains returns 201 and the created domain rule", async () => {
      const response = await request(app)
        .post("/api/firewall/domains")
        .send({ values: ["example.com"], mode: "whitelist" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        type: "domain",
        mode: "whitelist",
        status: "success",
        values: [{ id: expect.any(Number), value: "example.com", active: true }],
      });
    });

    it("POST /api/firewall/ports returns 201 and the created port rule", async () => {
      const response = await request(app)
        .post("/api/firewall/ports")
        .send({ values: [8080], mode: "blacklist" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        type: "port",
        mode: "blacklist",
        status: "success",
        values: [{ id: expect.any(Number), value: 8080, active: true }],
      });
    });

    it("GET /api/firewall/rules returns 200 with all rules grouped by type and mode", async () => {
      await request(app).post("/api/firewall/ips").send({ values: ["1.2.3.4"], mode: "blacklist" });
      await request(app).post("/api/firewall/ips").send({ values: ["5.6.7.8"], mode: "whitelist" });
      await request(app)
        .post("/api/firewall/domains")
        .send({ values: ["example.com"], mode: "blacklist" });

      const response = await request(app).get("/api/firewall/rules");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ips: {
          blacklist: [
            { id: expect.any(Number), type: "ip", mode: "blacklist", value: "1.2.3.4", active: true },
          ],
          whitelist: [
            { id: expect.any(Number), type: "ip", mode: "whitelist", value: "5.6.7.8", active: true },
          ],
        },
        domains: {
          blacklist: [
            {
              id: expect.any(Number),
              type: "domain",
              mode: "blacklist",
              value: "example.com",
              active: true,
            },
          ],
          whitelist: [],
        },
        ports: { blacklist: [], whitelist: [] },
      });
    });

    it("GET /api/firewall/rules?type=ip returns 200 with only the ips top-level key", async () => {
      await request(app).post("/api/firewall/ips").send({ values: ["1.2.3.4"], mode: "blacklist" });
      await request(app)
        .post("/api/firewall/domains")
        .send({ values: ["example.com"], mode: "blacklist" });

      const response = await request(app).get("/api/firewall/rules").query({ type: "ip" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ips: {
          blacklist: [
            { id: expect.any(Number), type: "ip", mode: "blacklist", value: "1.2.3.4", active: true },
          ],
          whitelist: [],
        },
      });
      expect(response.body).not.toHaveProperty("domains");
      expect(response.body).not.toHaveProperty("ports");
    });

    it("DELETE /api/firewall/rules removes the rule and a follow-up GET confirms deletion", async () => {
      const created = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["1.2.3.4"], mode: "blacklist" });
      const id = created.body.values[0].id;

      const deleteResponse = await request(app).delete("/api/firewall/rules").send({ ids: [id] });

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body).toEqual({
        removed: [{ id, type: "ip", mode: "blacklist", value: "1.2.3.4", active: true }],
        status: "success",
      });

      const getResponse = await request(app).get("/api/firewall/rules");
      expect(getResponse.body.ips.blacklist).toEqual([]);
    });

    it("PATCH /api/firewall/rules/status updates active and a follow-up GET confirms persistence", async () => {
      const created = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["1.2.3.4"], mode: "blacklist" });
      const id = created.body.values[0].id;

      const patchResponse = await request(app)
        .patch("/api/firewall/rules/status")
        .send({ ids: [id], active: false });

      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body).toEqual({
        updated: [{ id, type: "ip", mode: "blacklist", value: "1.2.3.4", active: false }],
        status: "success",
      });

      const getResponse = await request(app).get("/api/firewall/rules");
      expect(getResponse.body.ips.blacklist[0].active).toBe(false);
    });

    it("a rule created by one request is visible to a later request on the same app/repository instance", async () => {
      await request(app).post("/api/firewall/ips").send({ values: ["1.2.3.4"], mode: "blacklist" });

      const getResponse = await request(app).get("/api/firewall/rules");

      expect(getResponse.body.ips.blacklist).toHaveLength(1);
      expect(getResponse.body.ips.blacklist[0].value).toBe("1.2.3.4");
    });
  });

  describe("representative error paths", () => {
    it("POST /api/firewall/ips with an invalid IP returns 400 INVALID_IP", async () => {
      const response = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["999.999.999.999"], mode: "blacklist" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_IP",
        message: expect.any(String),
      });
    });

    it("POST /api/firewall/domains with an invalid domain returns 400 INVALID_DOMAIN", async () => {
      const response = await request(app)
        .post("/api/firewall/domains")
        .send({ values: ["https://example.com"], mode: "blacklist" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_DOMAIN",
        message: expect.any(String),
      });
    });

    it("POST /api/firewall/ports with an invalid port returns 400 INVALID_PORT", async () => {
      const response = await request(app)
        .post("/api/firewall/ports")
        .send({ values: [70000], mode: "blacklist" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_PORT",
        message: expect.any(String),
      });
    });

    it("POST /api/firewall/ips with an empty values array returns 400 INVALID_VALUES", async () => {
      const response = await request(app)
        .post("/api/firewall/ips")
        .send({ values: [], mode: "blacklist" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_VALUES",
        message: expect.any(String),
      });
    });

    it("POST /api/firewall/ips with an invalid mode returns 400 INVALID_MODE", async () => {
      const response = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["1.2.3.4"], mode: "allow" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_MODE",
        message: expect.any(String),
      });
    });

    it("GET /api/firewall/rules with an invalid query type returns 400 INVALID_TYPE", async () => {
      const response = await request(app).get("/api/firewall/rules").query({ type: "bogus" });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_TYPE",
        message: expect.any(String),
      });
    });

    it("DELETE /api/firewall/rules with a missing ID returns 404 RULE_NOT_FOUND", async () => {
      const response = await request(app).delete("/api/firewall/rules").send({ ids: [9999] });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        status: "error",
        code: "RULE_NOT_FOUND",
        message: expect.any(String),
      });
    });

    it("PATCH /api/firewall/rules/status with a missing ID returns 404 RULE_NOT_FOUND", async () => {
      const response = await request(app)
        .patch("/api/firewall/rules/status")
        .send({ ids: [9999], active: true });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        status: "error",
        code: "RULE_NOT_FOUND",
        message: expect.any(String),
      });
    });

    it("DELETE with one existing and one missing ID returns 404 and does not partially delete", async () => {
      const created = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["1.2.3.4"], mode: "blacklist" });
      const id = created.body.values[0].id;

      const deleteResponse = await request(app)
        .delete("/api/firewall/rules")
        .send({ ids: [id, 9999] });

      expect(deleteResponse.status).toBe(404);
      expect(deleteResponse.body).toEqual({
        status: "error",
        code: "RULE_NOT_FOUND",
        message: expect.any(String),
      });

      const getResponse = await request(app).get("/api/firewall/rules");
      expect(getResponse.body.ips.blacklist).toEqual([
        { id, type: "ip", mode: "blacklist", value: "1.2.3.4", active: true },
      ]);
    });

    it("PATCH with one existing and one missing ID returns 404 and does not partially update", async () => {
      const created = await request(app)
        .post("/api/firewall/ips")
        .send({ values: ["1.2.3.4"], mode: "blacklist" });
      const id = created.body.values[0].id;

      const patchResponse = await request(app)
        .patch("/api/firewall/rules/status")
        .send({ ids: [id, 9999], active: false });

      expect(patchResponse.status).toBe(404);
      expect(patchResponse.body).toEqual({
        status: "error",
        code: "RULE_NOT_FOUND",
        message: expect.any(String),
      });

      const getResponse = await request(app).get("/api/firewall/rules");
      expect(getResponse.body.ips.blacklist[0].active).toBe(true);
    });

    // Characterization test: the supplied course specification documents the six
    // firewall endpoints and the {status, code, message} error shape, but it does
    // not define what an entirely unknown route should return. This test records
    // the app's current notFoundHandler behavior — it is not verifying against a
    // documented contract.
    it("characterization: an unknown route returns 404 NOT_FOUND", async () => {
      const response = await request(app).get("/api/firewall/nonexistent");

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        status: "error",
        code: "NOT_FOUND",
        message: "Resource not found.",
      });
    });

    it("malformed JSON returns 400 INVALID_JSON, not 500", async () => {
      const response = await request(app)
        .post("/api/firewall/ips")
        .set("Content-Type", "application/json")
        .send('{"values": ["1.2.3.4"], "mode": ');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        status: "error",
        code: "INVALID_JSON",
        message: expect.any(String),
      });
    });
  });
});
