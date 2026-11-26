import express from "express";
import request from "supertest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { authenticatedProxyOwner, proxyOwnerMiddleware } from "../middleware/proxy-owner.js";
import { HTTP_LOG_REDACT_PATHS } from "../middleware/http-log-redaction.js";

const dir = mkdtempSync(join(tmpdir(), "paperclip-proxy-test-"));
const secret = "test-only-private-sidecar-credential-123456789";
writeFileSync(join(dir, "token"), secret, { mode: 0o600 });
afterAll(() => rmSync(dir, { recursive: true }));
afterEach(() => vi.unstubAllEnvs());
const headers = {
  "x-forwarded-user": "owner", "x-forwarded-email": "owner@example.test",
  "x-forwarded-host": "paperclip.example.test", "x-forwarded-proto": "https",
  "x-forwarded-groups": "nmc_atelier", "x-nmc-proxy-token": secret,
};
function configure() {
  for (const [key, value] of Object.entries({
    PAPERCLIP_DEPLOYMENT_MODE: "local_trusted", NMC_PROXY_OWNER_SUBJECT: "owner",
    NMC_PROXY_OWNER_EMAIL: "owner@example.test", NMC_PROXY_OWNER_HOST: "paperclip.example.test",
    NMC_PROXY_OWNER_TOKEN_FILE: join(dir, "token"),
  })) vi.stubEnv(key, value);
}
function app() {
  configure();
  const server = express();
  server.use(actorMiddleware({} as Db, { deploymentMode: "local_trusted",
    localAgentProcessBoundary: { classify: async () => "agent_run", grantsImplicitBoard: async () => false },
  }));
  server.use(proxyOwnerMiddleware());
  server.get("/whoami", (req, res) => res.json(req.actor));
  return server;
}
describe("authenticated owner in a separate proxy PID namespace", () => {
  it("authenticates the configured owner despite an uninspectable process", async () => {
    const res = await request(app()).get("/whoami").set(headers).expect(200);
    expect(res.body).toMatchObject({ type: "board", source: "session", userId: "local-board" });
  });
  for (const key of Object.keys(headers)) {
    it(`does not trust a mismatched ${key}`, async () => {
      const res = await request(app()).get("/whoami").set({ ...headers, [key]: "wrong" });
      expect(res.body.type).toBe("none");
    });
    it(`requires ${key}`, async () => {
      const missing = { ...headers };
      delete missing[key as keyof typeof missing];
      const res = await request(app()).get("/whoami").set(missing);
      expect(res.body.type).toBe("none");
    });
  }
  it("rejects an unauthenticated sidecar", async () => {
    expect((await request(app()).get("/whoami")).body.type).toBe("none");
  });
  it("does not replace bearer authentication", () => {
    configure();
    expect(authenticatedProxyOwner({ headers: { ...headers, authorization: "Bearer agent-token" }, socket: { remoteAddress: "127.0.0.1" } } as never)).toBe(false);
  });
  it("requires a loopback peer", () => {
    configure();
    expect(authenticatedProxyOwner({ headers, socket: { remoteAddress: "192.0.2.1" } } as never)).toBe(false);
  });
  it("does not enable this in authenticated mode", () => {
    configure(); vi.stubEnv("PAPERCLIP_DEPLOYMENT_MODE", "authenticated");
    expect(authenticatedProxyOwner({ headers, socket: { remoteAddress: "127.0.0.1" } } as never)).toBe(false);
  });
  it("fails closed when the secret file is unavailable", () => {
    configure(); vi.stubEnv("NMC_PROXY_OWNER_TOKEN_FILE", join(dir, "missing"));
    expect(authenticatedProxyOwner({ headers, socket: { remoteAddress: "127.0.0.1" } } as never)).toBe(false);
  });
  it("redacts the proxy credential from HTTP logs", () => {
    expect(HTTP_LOG_REDACT_PATHS).toContain('req.headers["x-nmc-proxy-token"]');
  });
});
