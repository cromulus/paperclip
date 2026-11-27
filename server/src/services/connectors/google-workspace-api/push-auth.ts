import { createPublicKey, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";
import { unauthorized, badRequest } from "../../../errors.js";
import { nativeRestRecord as record } from "../../native-rest-client.js";
let cached: { expires: number; keys: Record<string, unknown>[] } | undefined;
let pending: Promise<Record<string, unknown>[]> | undefined;
async function signingKeys() {
  if (cached && cached.expires > Date.now()) return cached.keys;
  pending ??= (async () => {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/certs", { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw unauthorized();
    const body = await r.text();if (body.length > 65536) throw unauthorized();
    const keys = record(JSON.parse(body)).keys;
    if (!Array.isArray(keys) || keys.length > 20) throw unauthorized();
    const ttl = Math.min(3600, Number(r.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 300));
    cached = { expires: Date.now() + ttl * 1000, keys: keys.map(record) };return cached.keys;
  })();
  try { return await pending; } finally { pending = undefined; }
}
export async function verifyGooglePubSub(input: { authorization?: string; audience: string; serviceAccountEmail: string; mailboxEmail: string; topicSubscription: string; payload: unknown }, keys = signingKeys) {
  try {
    const raw = input.authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    if (!raw || raw.length > 16384) throw unauthorized();
    const parts = raw.split(".");if(parts.length !== 3) throw unauthorized();
    const header = record(JSON.parse(Buffer.from(parts[0],"base64url").toString())), claims = record(JSON.parse(Buffer.from(parts[1],"base64url").toString()));
    const now = Date.now()/1000;
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !["accounts.google.com","https://accounts.google.com"].includes(String(claims.iss)) || claims.aud !== input.audience || claims.email !== input.serviceAccountEmail || claims.email_verified !== true || typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now+60 || claims.exp-claims.iat > 7200) throw unauthorized();
    const key = (await keys()).find(k=>k.kid === header.kid && k.kty === "RSA" && (k.alg === undefined || k.alg === "RS256"));
    if (!key || !verify("RSA-SHA256", Buffer.from(parts[0]+"."+parts[1]),createPublicKey({key:key as JsonWebKey,format:"jwk"}),Buffer.from(parts[2],"base64url"))) throw unauthorized();
    const envelope = record(input.payload), message = record(envelope.message);
    if (envelope.subscription !== input.topicSubscription || typeof message.messageId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(message.messageId) || typeof message.data !== "string" || message.data.length > 16384) throw unauthorized();
    const data = record(JSON.parse(Buffer.from(message.data,"base64").toString()));
    if (String(data.emailAddress).toLowerCase() !== input.mailboxEmail.toLowerCase() || typeof data.historyId !== "string" || !/^\d{1,30}$/.test(data.historyId)) throw unauthorized();
    return { payload: { service: "gmail", historyId: data.historyId }, idempotencyKey: `google-gmail:${input.topicSubscription}:${message.messageId}` };
  } catch { throw unauthorized(); }
}
export function verifyGoogleCalendar(input: { headers: Record<string, string | undefined>; secret: string; channels: { id: string; resourceId?: string; expiresAt: number }[] }) {
  const h = input.headers, supplied=Buffer.from(h["x-goog-channel-token"] ?? ""), expected=Buffer.from(input.secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) throw unauthorized();
  const channel=input.channels.find(c=>c.id === h["x-goog-channel-id"] && c.expiresAt > Date.now());
  if(!channel || !/^\d{1,30}$/.test(h["x-goog-message-number"] ?? "")) throw unauthorized();
  const state=h["x-goog-resource-state"];
  if(!["sync","exists","not_exists"].includes(state ?? "")) throw badRequest("Unsupported Calendar notification state");
  if(state !== "sync" && (!channel.resourceId || channel.resourceId !== h["x-goog-resource-id"])) throw unauthorized();
  return { ignored: state === "sync", payload: { service:"calendar", channelId:channel.id, resourceId:channel.resourceId, resourceState:state }, idempotencyKey:`google-calendar:${channel.id}:${h["x-goog-message-number"]}` };
}
