import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicMcpManagementRoutes } from "../routes/public-mcp.js";
import type { PublicMcpOAuth } from "../services/public-mcp/oauth.js";
import { proxyOwnerMiddleware } from "../middleware/proxy-owner.js";

const headers = {
  "x-forwarded-user": "owner-subject",
  "x-forwarded-email": "owner@example.com",
  "x-forwarded-host": "paperclip.example.com",
  "x-forwarded-proto": "https",
  "x-forwarded-groups": "another_group,nmc_atelier",
};
function configure() {
  vi.stubEnv("PAPERCLIP_DEPLOYMENT_MODE", "local_trusted");
  vi.stubEnv("NMC_PROXY_OWNER_SUBJECT", headers["x-forwarded-user"]);
  vi.stubEnv("NMC_PROXY_OWNER_EMAIL", headers["x-forwarded-email"]);
  vi.stubEnv("NMC_PROXY_OWNER_HOST", headers["x-forwarded-host"]);
}
function app(actor = { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true }) {
  const listConnections = vi.fn().mockResolvedValue([]);
  const service = { listConnections } as unknown as PublicMcpOAuth;
  const server = express();
  server.use((req, _res, next) => { req.actor = actor as typeof req.actor; next(); });
  server.use("/api", publicMcpManagementRoutes(service));
  return { server, listConnections };
}
afterEach(() => vi.unstubAllEnvs());
describe("SSO owner access to assistant connections", () => {
  it("accepts the configured proxy owner through the real management route", async () => {
    configure();
    const { server, listConnections } = app();
    await request(server).get("/api/mcp/connections").set(headers).expect(200, []);
    expect(listConnections).toHaveBeenCalledExactlyOnceWith("local-board");
  });
  for (const key of Object.keys(headers)) {
    it(`rejects a mismatched ${key}`, async () => {
      configure();
      const { server, listConnections } = app();
      await request(server).get("/api/mcp/connections").set({ ...headers, [key]: "wrong" }).expect(401);
      expect(listConnections).not.toHaveBeenCalled();
    });
  }
  it("keeps ordinary loopback access unauthenticated", async () => {
    configure();
    const { server, listConnections } = app();
    await request(server).get("/api/mcp/connections").expect(401);
    expect(listConnections).not.toHaveBeenCalled();
  });
  it("does not enable the mapping without explicit configuration", async () => {
    configure();
    vi.stubEnv("NMC_PROXY_OWNER_SUBJECT", "");
    const { server } = app();
    await request(server).get("/api/mcp/connections").set(headers).expect(401);
  });
  it("does not elevate agents", async () => {
    configure();
    const { server, listConnections } = app({ type: "agent", userId: "local-board", source: "local_implicit", isInstanceAdmin: true });
    await request(server).get("/api/mcp/connections").set(headers).expect(401);
    expect(listConnections).not.toHaveBeenCalled();
  });
  it("rejects the same headers from a non-loopback source", () => {
    const actor = { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true };
    const req = { actor, headers, socket: { remoteAddress: "192.0.2.1" } };
    const next = vi.fn();
    proxyOwnerMiddleware({ PAPERCLIP_DEPLOYMENT_MODE: "local_trusted", NMC_PROXY_OWNER_SUBJECT: "owner-subject", NMC_PROXY_OWNER_EMAIL: "owner@example.com", NMC_PROXY_OWNER_HOST: "paperclip.example.com" })(req as never, {} as never, next);
    expect(req.actor).toEqual(actor);
    expect(next).toHaveBeenCalledOnce();
  });
});
