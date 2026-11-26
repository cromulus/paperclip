import type { RequestHandler } from "express";
import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

let cachedTokenPath: string | undefined;
let cachedToken: string | undefined;

/** A sidecar's PID is invisible to the local process inspector. Authenticate
 * that exact owner with a private proxy credential before trusting its headers.
 * Missing/unreadable secrets fail closed; bearer actors never use this path.
 */
export function authenticatedProxyOwner(req: Pick<IncomingMessage, "headers" | "socket">,
  env: NodeJS.ProcessEnv = process.env): boolean {
  const header = (name: string) => typeof req.headers[name] === "string" ? req.headers[name] : "";
  if (env.PAPERCLIP_DEPLOYMENT_MODE !== "local_trusted"
    || !env.NMC_PROXY_OWNER_SUBJECT || !env.NMC_PROXY_OWNER_EMAIL || !env.NMC_PROXY_OWNER_HOST
    || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
    || header("authorization")
    || header("x-forwarded-user") !== env.NMC_PROXY_OWNER_SUBJECT
    || header("x-forwarded-email").toLowerCase() !== env.NMC_PROXY_OWNER_EMAIL.toLowerCase()
    || header("x-forwarded-host") !== env.NMC_PROXY_OWNER_HOST
    || header("x-forwarded-proto") !== "https"
    || !header("x-forwarded-groups").split(",").map(value => value.trim()).includes("nmc_atelier")) return false;
  const tokenPath = env.NMC_PROXY_OWNER_TOKEN_FILE;
  if (!tokenPath) return false;
  if (cachedTokenPath !== tokenPath) {
    try { cachedToken = readFileSync(tokenPath, "utf8").trim(); cachedTokenPath = tokenPath; }
    catch { return false; }
  }
  const supplied = header("x-nmc-proxy-token");
  if (!cachedToken || cachedToken.length < 32 || !supplied) return false;
  const expectedBytes = Buffer.from(cachedToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

/** Identify the configured local owner only through the trusted loopback SSO proxy.
 * Other actors, unauthenticated native endpoints, and deployments stay unchanged.
 */
export function proxyOwnerMiddleware(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    const header = (name: string) => typeof req.headers[name] === "string" ? req.headers[name] : "";
    const groups = header("x-forwarded-groups").split(",").map(value => value.trim());
    if (env.PAPERCLIP_DEPLOYMENT_MODE === "local_trusted"
      && env.NMC_PROXY_OWNER_SUBJECT && env.NMC_PROXY_OWNER_EMAIL && env.NMC_PROXY_OWNER_HOST
      && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
      && actor?.type === "board" && actor.userId === "local-board"
      && actor.source === "local_implicit" && actor.isInstanceAdmin === true
      && header("x-forwarded-user") === env.NMC_PROXY_OWNER_SUBJECT
      && header("x-forwarded-email").toLowerCase() === env.NMC_PROXY_OWNER_EMAIL.toLowerCase()
      && header("x-forwarded-host") === env.NMC_PROXY_OWNER_HOST
      && header("x-forwarded-proto") === "https"
      && groups.includes("nmc_atelier")) {
      req.actor = { ...actor, source: "session" };
    }
    next();
  };
}
