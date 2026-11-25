import assert from "node:assert/strict";
import { test } from "node:test";
import { proxyOwnerMiddleware, isRoutineRecoveryConflict } from "./proxy-owner.mjs";

const env = {
  PAPERCLIP_DEPLOYMENT_MODE: "local_trusted",
  NMC_PROXY_OWNER_SUBJECT: "owner-subject",
  NMC_PROXY_OWNER_EMAIL: "owner@example.com",
  NMC_PROXY_OWNER_HOST: "paperclip.example.com",
};
function request() {
  return {
    socket: { remoteAddress: "127.0.0.1" },
    actor: { type: "board", userId: "local-board", source: "local_implicit", isInstanceAdmin: true },
    headers: {
      "x-forwarded-user": "owner-subject", "x-forwarded-email": "owner@example.com",
      "x-forwarded-host": "paperclip.example.com", "x-forwarded-proto": "https",
      "x-forwarded-groups": "another_group,nmc_atelier",
    },
  };
}
test("authenticated proxy owner retains identity and reaches native consent checks", () => {
  const req = request();
  let continued = false;
  proxyOwnerMiddleware(env)(req, {}, () => { continued = true; });
  assert.equal(req.actor.source, "session");
  assert.equal(req.actor.userId, "local-board");
  assert.ok(continued);
});
for (const [name, change] of Object.entries({
  missing_headers: (r) => { r.headers = {}; },
  remote_source: (r) => { r.socket.remoteAddress = "100.1.2.3"; },
  wrong_subject: (r) => { r.headers["x-forwarded-user"] = "someone-else"; },
  wrong_email: (r) => { r.headers["x-forwarded-email"] = "someone@example.com"; },
  wrong_group: (r) => { r.headers["x-forwarded-groups"] = "not_nmc_atelier"; },
  wrong_host: (r) => { r.headers["x-forwarded-host"] = "evil.example.com"; },
  wrong_protocol: (r) => { r.headers["x-forwarded-proto"] = "http"; },
  different_user: (r) => { r.actor.userId = "other-board"; },
  agent: (r) => { r.actor.type = "agent"; },
  bearer_actor: (r) => { r.actor.source = "mcp_oauth"; },
  non_admin: (r) => { r.actor.isInstanceAdmin = false; },
})) {
  test(`rejects ${name}`, () => {
    const req = request(); change(req);
    const before = { ...req.actor };
    proxyOwnerMiddleware(env)(req, {}, () => {});
    assert.deepEqual(req.actor, before);
  });
}
test("requires explicit owner configuration and local mode", () => {
  for (const invalid of [{}, { ...env, PAPERCLIP_DEPLOYMENT_MODE: "authenticated" }]) {
    const req = request(); proxyOwnerMiddleware(invalid)(req, {}, () => {});
    assert.equal(req.actor.source, "local_implicit");
  }
});

test("only the known routine conflict can defer a queue claim", () => {
  assert.ok(isRoutineRecoveryConflict({ cause: { code: "23505", constraint_name: "issues_open_routine_execution_uq" } }));
  for (const error of [null, new Error("connection refused"), { code: "23505", constraint_name: "another_index" }, { code: "08006", constraint_name: "issues_open_routine_execution_uq" }]) {
    assert.equal(isRoutineRecoveryConflict(error), false);
  }
});
