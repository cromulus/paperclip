// Only the private loopback OAuth2 Proxy may identify the existing local owner.
export function proxyOwnerMiddleware(env = process.env) {
  return (req, _res, next) => {
    const actor = req.actor;
    const header = (name) => typeof req.headers[name] === "string" ? req.headers[name] : "";
    const groups = header("x-forwarded-groups").split(",").map((value) => value.trim());
    if (env.PAPERCLIP_DEPLOYMENT_MODE === "local_trusted"
      && env.NMC_PROXY_OWNER_SUBJECT && env.NMC_PROXY_OWNER_EMAIL && env.NMC_PROXY_OWNER_HOST
      && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)
      && actor?.type === "board" && actor.userId === "local-board"
      && actor.source === "local_implicit" && actor.isInstanceAdmin === true
      && header("x-forwarded-user") === env.NMC_PROXY_OWNER_SUBJECT
      && header("x-forwarded-email").toLowerCase() === env.NMC_PROXY_OWNER_EMAIL.toLowerCase()
      && header("x-forwarded-host") === env.NMC_PROXY_OWNER_HOST
      && header("x-forwarded-proto") === "https"
      && groups.includes("nmc_atelier")) {
      // The management service requires an authenticated user; membership and
      // consent checks still run against the existing owner's database record.
      req.actor = { ...actor, source: "session" };
    }
    next();
  };
}

export function isRoutineRecoveryConflict(error) {
  for (let depth = 0; error && depth < 5; depth++, error = error.cause) {
    if (error.code === "23505" && error.constraint_name === "issues_open_routine_execution_uq") return true;
  }
  return false;
}

// Custom remote MCP connections retain their own OAuth discovery/refresh.
// Repository access still uses Paperclip's existing grant and audience checks.
export function isGitHubRepositoryConnection(connection) {
  if (connection?.config?.sourceTemplateKey === "github") return true;
  if (connection?.transport !== "mcp_remote") return false;
  try {
    const url = new URL(connection.config?.url);
    return url.protocol === "https:" && url.hostname === "api.githubcopilot.com"
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && ["/mcp", "/mcp/", "/mcp/insiders", "/mcp/insiders/"].includes(url.pathname);
  } catch { return false; }
}

export function hostedConnectorGuard(env = process.env) {
  return (_req, res, next) => {
    if (env.NMC_DISABLE_HOSTED_CONNECTORS !== "true") return next();
    return res.status(403).json({
      error: "Paperclip-hosted connectors are disabled. Use an existing direct provider or MCP connection.",
      code: "hosted_connectors_disabled",
    });
  };
}
