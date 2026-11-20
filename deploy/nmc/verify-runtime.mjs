import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { isRoutineRecoveryConflict } from "/app/nmc-proxy-owner.mjs";

const source = readFileSync("/app/server/dist-runtime/chunk-TYL6XQKY.mjs", "utf8");
const match = source.match(/function isDeferrableClaimRejection\(err\) \{[^}]+\}/);
assert.ok(match, "compiled admission handler must exist");
class HttpError extends Error { constructor(status) { super(); this.status = status; } }
const deferred = runInNewContext(`(${match[0]})`, { HttpError, isRoutineRecoveryConflict });
const routineConflict = { cause: { code: "23505", constraint_name: "issues_open_routine_execution_uq" } };
assert.equal(deferred(routineConflict), true);
assert.equal(deferred(new HttpError(409)), true);
assert.equal(deferred(new HttpError(500)), false);
assert.equal(deferred({ cause: { code: "23505", constraint_name: "different_unique_index" } }), false);
assert.equal(deferred(new Error("database offline")), false);

// Exercise the queue's continue/throw contract: retain the blocked candidate,
// admit its existing slot owner, and never hide an unrelated database failure.
const queued = ["blocked-sibling", "slot-owner"];
const claimed = [];
for (const candidate of queued) {
  try {
    if (candidate === "blocked-sibling") throw routineConflict;
    claimed.push(candidate);
  } catch (error) {
    if (!deferred(error)) throw error;
  }
}
assert.deepEqual(claimed, ["slot-owner"]);
assert.deepEqual(queued, ["blocked-sibling", "slot-owner"]);
console.log("Compiled queue admission regression checks passed");

const tools = await import('/app/server/dist-runtime/chunk-URIDYK22.mjs');
const disabled = { NMC_DISABLE_HOSTED_CONNECTORS: 'true' };
assert.equal(tools.paperclipCloudConnectorConfigFromEnv(disabled), null);
let requested = false;
for (const method of ['startPaperclipCloudConnectorEnrollment', 'completePaperclipCloudConnectorEnrollment']) {
  await assert.rejects(() => tools[method]({ env: disabled, request: () => { requested = true; throw new Error('must not call network'); } }), /disabled/);
}
assert.equal(requested, false);
const toolSource = readFileSync('/app/server/dist-runtime/chunk-URIDYK22.mjs', 'utf8');
assert.equal(toolSource.split('!isGitHubRepositoryConnection(connection)').length - 1, 3);
assert.equal(toolSource.includes('asRecord25(connection.config).sourceTemplateKey !== "github"'), false);
console.log('Compiled direct GitHub eligibility and hosted connector guards passed');

const publicOrigin = 'https://paperclip-hooks.nmc-atelier.com';
const browserOrigin = 'https://paperclip.koi-neon.ts.net';
assert.deepEqual(tools.publicMcpConfig({ PAPERCLIP_PUBLIC_URL: browserOrigin,
  PAPERCLIP_MCP_PUBLIC_URL: publicOrigin, PAPERCLIP_MCP_AUTHORIZATION_ORIGIN: browserOrigin }),
  { origin: publicOrigin, resource: publicOrigin + '/mcp/paperclip', authorizationOrigin: browserOrigin });
assert.equal(tools.publicMcpConfig({ PAPERCLIP_PUBLIC_URL: browserOrigin }).origin, browserOrigin);
assert.throws(() => tools.publicMcpConfig({ PAPERCLIP_MCP_PUBLIC_URL: 'http://untrusted.example' }), /HTTPS origin/);
console.log('Compiled split MCP and PocketID browser origin checks passed');
