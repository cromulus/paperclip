/** Existing direct GitHub MCP connections retain repository discovery eligibility. */
export function isGitHubRepositoryConnection(connection: { config?: unknown; transport?: string }): boolean {
  const config = connection.config && typeof connection.config === "object" ? connection.config as Record<string, unknown> : {};
  if (config.sourceTemplateKey === "github") return true;
  if (connection.transport !== "mcp_remote" || typeof config.url !== "string") return false;
  try {
    const url = new URL(config.url);
    return url.protocol === "https:" && url.hostname === "api.githubcopilot.com"
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && ["/mcp", "/mcp/", "/mcp/insiders", "/mcp/insiders/"].includes(url.pathname);
  } catch { return false; }
}
