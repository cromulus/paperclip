import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcpRuntimeOptions } from "acpx/runtime";
import type { AdapterRuntimeMcpServer } from "./types.js";
import {
  buildPaperclipMcpBridgeRoutes,
  routePaperclipMcpServersThroughCallbackBridge,
} from "./acpx-engine/execute.js";
import {
  startAdapterExecutionTargetPaperclipBridge,
  type AdapterSandboxExecutionTarget,
} from "./execution-target.js";
import { isPaperclipMcpCallbackPath } from "./paperclip-mcp-callback-bridge.js";
import { runChildProcess } from "./server-utils.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function localSandboxTarget(remoteCwd: string): AdapterSandboxExecutionTarget {
  let counter = 0;
  return {
    kind: "remote",
    transport: "sandbox",
    providerKey: "native-mcp-test",
    remoteCwd,
    timeoutMs: 30_000,
    runner: {
      execute: async (input) => {
        counter += 1;
        return runChildProcess(`native-mcp-bridge-${counter}`, input.command, input.args ?? [], {
          cwd: input.cwd ?? process.cwd(),
          env: input.env ?? {},
          stdin: input.stdin,
          timeoutSec: Math.max(1, Math.ceil((input.timeoutMs ?? 30_000) / 1000)),
          graceSec: 5,
          onLog: input.onLog ?? (async () => {}),
        });
      },
    },
  };
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected an ephemeral TCP port.");
  return address.port;
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.once("error", reject);
    req.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("Paperclip native MCP callback bridge integration", () => {
  it("recognizes only the advertised built-in MCP route paths", () => {
    expect(isPaperclipMcpCallbackPath("/api/mcp/project-tools")).toBe(true);
    expect(isPaperclipMcpCallbackPath("/mcp/runtime-tools")).toBe(true);
    expect(isPaperclipMcpCallbackPath("/mcp/gateways/gw_doktor")).toBe(true);
    expect(isPaperclipMcpCallbackPath("/api/mcp/runtime-tools")).toBe(false);
    expect(isPaperclipMcpCallbackPath("/api/mcp/gateways/gw_doktor")).toBe(false);
    expect(isPaperclipMcpCallbackPath("/mcp/gateways/gw_doktor/extra")).toBe(false);
  });

  it("relays JSON-RPC through the per-run token and forwards only captured MCP credentials", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "paperclip-native-mcp-bridge-"));
    tempDirs.push(tempDir);
    await mkdir(path.join(tempDir, "workspace"), { recursive: true });
    const calls: Array<{ path: string; auth: string | undefined; runId: string | undefined; body: Record<string, unknown> | null }> = [];
    const mcpServer = createServer(async (req, res) => {
      const body = req.method === "GET" ? null : await readJson(req);
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      calls.push({
        path: pathname,
        auth: req.headers.authorization,
        runId: typeof req.headers["x-paperclip-run-id"] === "string" ? req.headers["x-paperclip-run-id"] : undefined,
        body,
      });
      if (req.headers.authorization !== "Bearer trusted-native-mcp-token") {
        json(res, 401, { error: "wrong native token" });
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST" });
        res.end();
        return;
      }
      if (body?.method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }
      const id = body?.id;
      if (body?.method === "initialize") {
        json(res, 200, { jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "paperclip-test", version: "1" } } });
      } else if (body?.method === "tools/list") {
        json(res, 200, { jsonrpc: "2.0", id, result: { tools: [{ name: "connections_search", inputSchema: { type: "object" } }] } });
      } else if (body?.method === "tools/call") {
        json(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ok" }] } });
      } else {
        json(res, 400, { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: "Method not found" } });
      }
    });
    const mcpPort = await listen(mcpServer);
    const serverDescriptor: AdapterRuntimeMcpServer = {
      name: "Paperclip runtime tools",
      url: `http://127.0.0.1:${mcpPort}/mcp/runtime-tools`,
      token: "trusted-native-mcp-token",
      connectionId: "runtime-tools",
    };
    const routes = buildPaperclipMcpBridgeRoutes([serverDescriptor]);
    const target = localSandboxTarget(path.join(tempDir, "workspace"));
    const bridge = await startAdapterExecutionTargetPaperclipBridge({
      runId: "run-native-mcp-acceptance",
      target,
      runtimeRootDir: path.join(tempDir, "runtime"),
      adapterKey: "codex",
      hostApiToken: "host-api-token-must-not-be-used-for-mcp",
      hostApiUrl: `http://127.0.0.1:${mcpPort}`,
      mcpRoutes: routes,
    });

    try {
      expect(bridge).not.toBeNull();
      const originalServers: NonNullable<AcpRuntimeOptions["mcpServers"]> = [{
        type: "http",
        name: serverDescriptor.name,
        url: serverDescriptor.url,
        headers: [{ name: "Authorization", value: `Bearer ${serverDescriptor.token}` }],
      }];
      const remoteConfig = routePaperclipMcpServersThroughCallbackBridge(originalServers, bridge);
      const routedServer = remoteConfig[0] as { url: string; headers?: Array<{ name: string; value: string }> } | undefined;
      if (!routedServer) throw new Error("Expected the runtime MCP server to remain configured.");
      expect(routedServer.url).toBe(`${bridge!.env.PAPERCLIP_API_URL}/mcp/runtime-tools`);
      expect(JSON.stringify(remoteConfig)).not.toContain(serverDescriptor.token);
      expect(JSON.stringify(remoteConfig)).not.toContain("host-api-token-must-not-be-used-for-mcp");
      expect(routedServer.headers).toEqual([{ name: "Authorization", value: `Bearer ${bridge!.env.PAPERCLIP_API_KEY}` }]);

      const endpoint = routedServer.url;
      const headers = {
        authorization: `Bearer ${bridge!.env.PAPERCLIP_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
      };
      const sendRpc = async (method: string, id?: number) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(method === "initialize" ? { params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test-client", version: "1" } } } : {}) }),
        });
        return { response, body: response.status === 202 ? "" : await response.json() };
      };

      const initialized = await sendRpc("initialize", 1);
      expect(initialized.response.status).toBe(200);
      expect(initialized.body).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "paperclip-test" } } });
      const listed = await sendRpc("tools/list", 2);
      expect(listed.response.status).toBe(200);
      expect(listed.body).toMatchObject({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "connections_search" }] } });
      const called = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "connections_search", arguments: {} } }),
      });
      expect(called.status).toBe(200);
      expect(await called.json()).toMatchObject({ jsonrpc: "2.0", id: 3, result: { content: [{ text: "ok" }] } });
      const notified = await sendRpc("notifications/initialized");
      expect(notified.response.status).toBe(202);
      expect(notified.body).toBe("");

      expect(calls).toHaveLength(4);
      expect(calls.every((call) => call.path === "/mcp/runtime-tools" && call.auth === "Bearer trusted-native-mcp-token" && call.runId === "run-native-mcp-acceptance")).toBe(true);

      const wrongAuth = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, authorization: "Bearer attacker-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
      });
      expect(wrongAuth.status).toBe(401);
      const beforeDenied = calls.length;
      const staleRuntimeAlias = await fetch(`${bridge!.env.PAPERCLIP_API_URL}/api/mcp/runtime-tools`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
      });
      expect(staleRuntimeAlias.status).toBe(403);
      const unassignedMcpRoute = await fetch(`${bridge!.env.PAPERCLIP_API_URL}/api/mcp/project-tools`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }),
      });
      expect(unassignedMcpRoute.status).toBe(403);
      const getAttempt = await fetch(endpoint, { headers: { authorization: headers.authorization } });
      expect(getAttempt.status).toBe(403);
      expect(calls).toHaveLength(beforeDenied);
    } finally {
      await bridge?.stop();
      await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
    }
  });
});
