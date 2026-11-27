import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { type Db, toolConnections, routineTriggers, routines, companies } from "@paperclipai/db";
import { z } from "zod";
import { badRequest, forbidden, notFound, unauthorized } from "../../../errors.js";
import { nativeRestRecord as record, nativeRestSender } from "../../native-rest-client.js";
import { secretService } from "../../secrets.js";
import { routineService } from "../../routines.js";
import { toolAccessService } from "../../tool-access.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "../../delivery-work-notifications.js";
import { verifyGoogleCalendar, verifyGooglePubSub } from "./push-auth.js";
import { parseWebhookPublicBaseUrl } from "../../../chat-webhook-public-url.js";

export const googlePushSetupSchema = z.object({
  enabled: z.boolean().default(true), triggerId: z.string().uuid(),
  calendarId: z.string().min(1).max(512).optional(),
  topicName: z.string().regex(/^projects\/[a-z][a-z0-9-]{4,62}\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/).optional(),
  subscription: z.string().regex(/^projects\/[a-z][a-z0-9-]{4,62}\/subscriptions\/[A-Za-z][A-Za-z0-9._~+%-]{2,254}$/).optional(),
  serviceAccountEmail: z.string().email().endsWith(".iam.gserviceaccount.com").optional(),
  mailboxEmail: z.string().email().optional(),
}).strict();
type Settings = z.infer<typeof googlePushSetupSchema>;
type Channel = { id: string; resourceId?: string; expiresAt: number };
type State = Settings & { revision: string; status: string; nextAt?: number; expiration?: number; channels?: Channel[]; historyId?: string; grantId?: string; attempts?: number };
const stateOf = (connection: { config: Record<string, unknown> }) => record(connection.config.googlePush) as unknown as State;
export function googlePushCallback(origin: string, connectionId: string) { return `${origin}/api/google-push/${encodeURIComponent(connectionId)}`; }
export function googlePushService(db: Db, options: { publicBaseUrl?: string; credentials?: (id: string, companyId: string) => Promise<{ headers: Record<string, string>; grantId: string }>; request?: typeof fetch } = {}) {
  const secret = secretService(db), access = options.credentials ? null : toolAccessService(db);
  const credentials = options.credentials ?? ((id, companyId) => access!.googlePushCredentials(companyId, id));
  const request = options.request ?? fetch;
  let nextAt: number | null = null;
  function origin() { const value = parseWebhookPublicBaseUrl(options.publicBaseUrl ?? process.env.PAPERCLIP_WEBHOOK_PUBLIC_URL); if (!value) throw badRequest("Configure the public HTTPS webhook origin before enabling Google notifications.");return value; }
  async function connection(id: string, companyId?: string) {
    const [c] = await db.select().from(toolConnections).where(and(eq(toolConnections.id,id), ...(companyId ? [eq(toolConnections.companyId,companyId)] : [])));
    if (!c || !["gmail","google-calendar"].includes(String(c.config.sourceTemplateKey)) || c.config.connectionMethodKey !== "customer-workspace-api" || c.transport !== "rest_api") throw notFound("Separate Gmail or Calendar API connection not found");
    return c;
  }
  async function trigger(c: typeof toolConnections.$inferSelect, id: string) {
    const [t]=await db.select().from(routineTriggers).where(and(eq(routineTriggers.id,id),eq(routineTriggers.companyId,c.companyId),eq(routineTriggers.kind,"webhook"),eq(routineTriggers.archived,false)));
    if(!t || t.signingMode !== "bearer" || !t.publicId || !t.secretId) throw badRequest("Choose a bearer-authenticated webhook routine in this company.");
    const [r]=await db.select().from(routines).where(and(eq(routines.id,t.routineId),eq(routines.companyId,c.companyId)));
    if(!r || r.status !== "active" || !t.enabled) throw badRequest("The notification routine must be active.");
    return t;
  }
  async function triggerSecret(t: typeof routineTriggers.$inferSelect) {
    return secret.resolveSecretValue(t.companyId,t.secretId!,"latest",{ consumerType:"routine",consumerId:t.routineId,actorType:"system",actorId:null,configPath:`webhookSecret:${t.secretId}` });
  }
  async function save(id: string, revision: string, patch: Partial<State>) {
    await db.transaction(async tx=>{const [c]=await tx.select().from(toolConnections).where(eq(toolConnections.id,id)).for("update");if(!c || stateOf(c).revision !== revision) return;
      await notifyDeliveryWork(tx,DELIVERY_QUEUES.googlePush);
      await tx.update(toolConnections).set({config:{...c.config,googlePush:{...stateOf(c),...patch}},updatedAt:new Date()}).where(eq(toolConnections.id,id));
    });
  }
  async function configure(companyId: string,id: string,input: Settings) {
    origin();const c=await connection(id,companyId);const t=await trigger(c,input.triggerId);
    if(c.credentialPolicy === "per_user") throw badRequest("Notifications currently require an organization-owned service connection.");
    if(c.config.sourceTemplateKey === "gmail" && (!input.topicName || !input.subscription || !input.serviceAccountEmail || !input.mailboxEmail)) throw badRequest("Gmail notifications require a Pub/Sub topic, subscription, push service account and mailbox.");
    const state:State={...input,revision:randomUUID(),status:input.enabled?"awaiting_authorization":"disabled",...(input.enabled?{nextAt:Date.now()}:{}), channels:stateOf(c).channels ?? []};
    await db.transaction(async tx=>{const [fresh]=await tx.select().from(toolConnections).where(and(eq(toolConnections.id,id),eq(toolConnections.companyId,companyId))).for("update");if(!fresh)throw notFound("Connection not found");state.channels=stateOf(fresh).channels??[];await notifyDeliveryWork(tx,DELIVERY_QUEUES.googlePush);await tx.update(toolConnections).set({config:{...fresh.config,googlePush:state},updatedAt:new Date()}).where(and(eq(toolConnections.id,id),eq(toolConnections.companyId,companyId)));});
    return {enabled:state.enabled,status:state.status,callbackUrl:googlePushCallback(origin(),id),triggerId:t.id};
  }
  async function renew(c: typeof toolConnections.$inferSelect, signal: AbortSignal) {
    const s=stateOf(c);if(!s.enabled || !s.nextAt || s.nextAt>Date.now()) return;
    if(c.status !== "active" || !c.enabled){await save(c.id,s.revision,{status:"awaiting_authorization",nextAt:undefined});return;}
    const [company]=await db.select({status:companies.status}).from(companies).where(eq(companies.id,c.companyId));if(company?.status !== "active")return;
    let claimed=false;
    await db.transaction(async tx=>{const [fresh]=await tx.select().from(toolConnections).where(eq(toolConnections.id,c.id)).for("update");const live=fresh&&stateOf(fresh);if(!fresh||live.revision!==s.revision||!live.nextAt||live.nextAt>Date.now())return;
      if(live.status==="renewing"){await tx.update(toolConnections).set({config:{...fresh.config,googlePush:{...live,status:"needs_attention",nextAt:undefined}}}).where(eq(toolConnections.id,c.id));return;}
      // A dead controller leaves an explicit uncertain subscription, never an automatic second Calendar channel.
      await tx.update(toolConnections).set({config:{...fresh.config,googlePush:{...live,status:"renewing",nextAt:Date.now()+120000}},updatedAt:new Date()}).where(eq(toolConnections.id,c.id));claimed=true;});
    if(!claimed)return;
    try {
      const grant=await credentials(c.id,c.companyId), t=await trigger(c,s.triggerId), token=await triggerSecret(t);
      const authorization=new Headers(grant.headers).get("authorization");if(!authorization)throw forbidden("Google permission is unavailable");
      const {send}=nativeRestSender({provider:"Google notifications",code:"google_push",authorization,request:(url,init)=>request(url,init),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),deadlineAt:Date.now()+30000,deniedMessage:"Reconnect this Google service and verify its notification settings."});
      if(c.config.sourceTemplateKey === "gmail"){
        const result=record(await send("https://gmail.googleapis.com/gmail/v1/users/me/watch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({topicName:s.topicName})}));
        const expiration=Number(result.expiration);if(!Number.isFinite(expiration)||expiration<Date.now()+60000)throw badRequest("Google returned an invalid watch expiration");
        await save(c.id,s.revision,{status:"watching",attempts:0,expiration,nextAt:Math.min(Date.now()+86400000,expiration-3600000),historyId:String(result.historyId),grantId:grant.grantId});
      }else{
        const channel:Channel={id:randomUUID(),expiresAt:Date.now()+604800000};
        const channels=[...(s.channels??[]).filter(ch=>ch.expiresAt>Date.now()),channel].slice(-3);
        await save(c.id,s.revision,{channels,grantId:grant.grantId});
        const result=record(await send(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(s.calendarId??"primary")}/events/watch`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:channel.id,type:"web_hook",address:googlePushCallback(origin(),c.id),token,params:{ttl:"604800"}})}));
        const expiration=Number(result.expiration);if(result.id!==channel.id||typeof result.resourceId!=="string"||!Number.isFinite(expiration)||expiration<Date.now()+60000)throw badRequest("Google returned an invalid Calendar channel");
        Object.assign(channel,{resourceId:result.resourceId,expiresAt:expiration});
        await save(c.id,s.revision,{status:"watching",attempts:0,channels,expiration,nextAt:expiration-3600000,grantId:grant.grantId});
      }
    }catch{
      const attempts=(s.attempts??0)+1;
      // Gmail watch updates the same mailbox subscription and is safe to retry.
      // An uncertain Calendar create may already have registered a channel.
      const retry=c.config.sourceTemplateKey === "gmail" && attempts <= 6;
      await save(c.id,s.revision,{status:retry?"retrying":"needs_attention",attempts,nextAt:retry?Date.now()+Math.min(3600000,30000*2**(attempts-1)):undefined});
    }
  }
  async function sweep(signal:AbortSignal){
    const rows=await db.select().from(toolConnections).where(sql`${toolConnections.config}->'googlePush'->>'enabled' = 'true'`);
    for(const c of rows){if(signal.aborted)break;await renew(c,signal);}
    const [row]=await db.execute<{next_at:string|null}>(sql`select min(case when tc.config->'googlePush'->>'nextAt' ~ '^[0-9]{1,15}$' then (tc.config->'googlePush'->>'nextAt')::bigint end)::text as next_at from tool_connections tc join companies c on c.id=tc.company_id where tc.enabled and tc.status='active' and c.status='active' and tc.config->'googlePush'->>'enabled'='true'`);
    nextAt=row?.next_at?Number(row.next_at):null;
  }
  async function accept(id:string,headers:Record<string,string|undefined>,payload:unknown){
    const c=await connection(id),s=stateOf(c);if(!c.enabled||c.status!=="active"||!s.enabled)throw unauthorized();
    const [company]=await db.select({status:companies.status}).from(companies).where(eq(companies.id,c.companyId));if(company?.status!=="active")throw unauthorized();
    // Every callback rechecks the active organization grant; revoked consent cannot wake an agent.
    const t=await trigger(c,s.triggerId),token=await triggerSecret(t);
    const event=c.config.sourceTemplateKey==="gmail"?await verifyGooglePubSub({authorization:headers.authorization,audience:googlePushCallback(origin(),id),serviceAccountEmail:s.serviceAccountEmail!,mailboxEmail:s.mailboxEmail!,topicSubscription:s.subscription!,payload}):verifyGoogleCalendar({headers,secret:token,channels:s.channels??[]});
    const grant=await credentials(c.id,c.companyId);if(s.grantId && grant.grantId!==s.grantId)throw unauthorized();
    if("ignored" in event && event.ignored)return {ignored:true};
    return routineService(db).firePublicTrigger(t.publicId!,{authorizationHeader:`Bearer ${token}`,payload:{...event.payload,connectionId:c.id,...(c.config.sourceTemplateKey==="google-calendar"?{calendarId:s.calendarId??"primary"}:{})},idempotencyKey:event.idempotencyKey});
  }
  return {configure,sweep,accept,nextRunAt:()=>nextAt};
}
