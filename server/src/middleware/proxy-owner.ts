import type { RequestHandler } from "express";

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
