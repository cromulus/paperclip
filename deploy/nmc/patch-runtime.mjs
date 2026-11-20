import { readFileSync, writeFileSync } from "node:fs";
const path = "/app/server/dist-runtime/server.mjs";
const source = readFileSync(path, "utf8");
const anchor = "function publicMcpManagementRoutes(oauth, agentOAuth) {\n  const router = Router15();";
if (source.split(anchor).length !== 2 || source.includes("proxyOwnerMiddleware")) {
  throw new Error("Unexpected Paperclip runtime; review this patch for the new version.");
}
writeFileSync(path, 'import { proxyOwnerMiddleware, hostedConnectorGuard } from "/app/nmc-proxy-owner.mjs";\n'
  + source.replace(anchor, anchor + '\n  router.use(["/mcp", "/dot-mcp"], proxyOwnerMiddleware());'));

const queuePath = "/app/server/dist-runtime/chunk-TYL6XQKY.mjs";
const queue = readFileSync(queuePath, "utf8");
const claim = '  function isDeferrableClaimRejection(err) {\n    return err instanceof HttpError && err.status >= 400 && err.status < 500;\n  }';
if (queue.split(claim).length !== 2) throw new Error("Unexpected queue admission handler");
// A sibling routine task can reserve the unique execution slot before its run
// starts. Defer the conflicting candidate so that slot owner can be dispatched.
writeFileSync(queuePath, 'import { isRoutineRecoveryConflict } from "/app/nmc-proxy-owner.mjs";\n'
  + queue.replace(claim, '  function isDeferrableClaimRejection(err) {\n'
    + '    return isRoutineRecoveryConflict(err) || (err instanceof HttpError && err.status >= 400 && err.status < 500);\n  }'));

const toolPath = "/app/server/dist-runtime/chunk-URIDYK22.mjs";
let tools = readFileSync(toolPath, "utf8");
const mcpOrigin = 'function publicMcpConfig(env = process.env, authPublicBaseUrl) {\n  const origin = env.PAPERCLIP_PUBLIC_URL ?? authPublicBaseUrl;';
if (tools.split(mcpOrigin).length !== 2) throw new Error("Unexpected public MCP origin configuration");
tools = tools.replace(mcpOrigin, mcpOrigin.replace('env.PAPERCLIP_PUBLIC_URL ??', 'env.PAPERCLIP_MCP_PUBLIC_URL ?? env.PAPERCLIP_PUBLIC_URL ??'));
const eligibility = 'asRecord25(connection.config).sourceTemplateKey !== "github"';
if (tools.split(eligibility).length !== 4) throw new Error("Unexpected GitHub repository eligibility gates");
tools = tools.replaceAll(eligibility, '!isGitHubRepositoryConnection(connection)');
const configAnchor = 'function paperclipCloudConnectorConfigFromEnv(env = process.env) {';
if (tools.split(configAnchor).length !== 2) throw new Error("Unexpected hosted connector configuration");
tools = tools.replace(configAnchor, configAnchor + '\n  if (env.NMC_DISABLE_HOSTED_CONNECTORS === "true") return null;');
for (const name of ["startPaperclipCloudConnectorEnrollment", "completePaperclipCloudConnectorEnrollment"]) {
  const anchor = `async function ${name}(input) {`;
  if (tools.split(anchor).length !== 2) throw new Error(`Unexpected ${name}`);
  tools = tools.replace(anchor, anchor + '\n  if ((input.env ?? process.env).NMC_DISABLE_HOSTED_CONNECTORS === "true") throw new Error("Paperclip-hosted connectors are disabled by this instance owner");');
}
writeFileSync(toolPath, 'import { isGitHubRepositoryConnection } from "/app/nmc-proxy-owner.mjs";\n' + tools);

const routed = readFileSync(path, "utf8");
const routeAnchor = 'function toolAccessRoutes(db, options = {}) {\n  const router = Router50();';
if (routed.split(routeAnchor).length !== 2) throw new Error("Unexpected tool access routes");
writeFileSync(path, routed.replace(routeAnchor, routeAnchor + '\n  router.use("/tools/oauth/cloud-connector", hostedConnectorGuard());'));
