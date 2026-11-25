import type { AdapterRuntimeMcpServer } from "./types.js";

/** Exact built-in run-scoped MCP routes advertised by Paperclip today. */
export function isPaperclipMcpCallbackPath(path: string): boolean {
  return path === "/api/mcp/project-tools" ||
    path === "/mcp/runtime-tools" ||
    /^\/mcp\/gateways\/[A-Za-z0-9._-]+$/.test(path);
}

/** Build the exact host-owned auth map for built-in loopback MCP endpoints. */
export function buildPaperclipMcpBridgeRoutes(
  servers: AdapterRuntimeMcpServer[],
): Array<{ path: string; headers: Record<string, string> }> {
  const routes = new Map<string, { path: string; headers: Record<string, string> }>();
  for (const server of servers) {
    let url: URL;
    try {
      url = new URL(server.url);
    } catch {
      continue;
    }
    const loopbackHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());
    const allowedPath = isPaperclipMcpCallbackPath(url.pathname);
    if (url.protocol !== "http:" || !loopbackHost || !allowedPath || url.search || !server.token.trim()) continue;

    const path = url.pathname;
    const route = { path, headers: { authorization: `Bearer ${server.token}` } };
    const prior = routes.get(path);
    if (prior && prior.headers.authorization !== route.headers.authorization) {
      throw new Error("Conflicting credentials for a Paperclip MCP callback path.");
    }
    routes.set(path, route);
  }
  return [...routes.values()];
}
