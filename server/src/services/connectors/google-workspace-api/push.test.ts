import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, companies, companySecrets, toolApplications, toolConnections, routines, routineTriggers } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../../__tests__/helpers/embedded-postgres.js";
const mocks=vi.hoisted(()=>({fire:vi.fn(async(_publicId: string,_input: {idempotencyKey?:string;payload?:unknown})=>({accepted:true})),secret:vi.fn(async()=>"fixture-webhook-secret")}));
vi.mock("../../secrets.js",()=>({secretService:()=>({resolveSecretValue:mocks.secret})}));
vi.mock("../../routines.js",()=>({routineService:()=>({firePublicTrigger:mocks.fire})}));
vi.mock("../../tool-access.js",()=>({toolAccessService:()=>{throw Error("Credentials must be explicitly supplied in this fixture")}}));
import { googlePushService } from "./push.js";
const supported=await getEmbeddedPostgresTestSupport();
describe.skipIf(!supported.supported)("Google push durable watches",()=>{
 let pg:Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>,db:ReturnType<typeof createDb>;
 beforeAll(async()=>{pg=await startEmbeddedPostgresTestDatabase("google-push-test-");db=createDb(pg.connectionString)},30000);
 afterAll(async()=>{await pg?.cleanup()},30000);
 async function fixture(slug="google-calendar"){
  const [company]=await db.insert(companies).values({name:"Google push fixture",issuePrefix:"G"+randomUUID().replaceAll("-","").slice(0,10).toUpperCase()}).returning();
  const [app]=await db.insert(toolApplications).values({companyId:company.id,name:"Google push fixture",type:"rest_api"}).returning();
  const [c]=await db.insert(toolConnections).values({companyId:company.id,applicationId:app.id,name:"Fixture",uid:randomUUID(),transport:"rest_api",status:"active",authKind:"oauth",enabled:true,config:{sourceTemplateKey:slug,connectionMethodKey:"customer-workspace-api"}}).returning();
  const [r]=await db.insert(routines).values({companyId:company.id,title:"Process Google notification"}).returning();
  const [secret]=await db.insert(companySecrets).values({companyId:company.id,key:randomUUID(),name:"Fixture secret"}).returning();
  const [t]=await db.insert(routineTriggers).values({companyId:company.id,routineId:r.id,kind:"webhook",signingMode:"bearer",publicId:randomUUID(),secretId:secret.id}).returning();
  let count=0;const request=vi.fn(async(_url:string,init?:RequestInit)=>{count++;const b=JSON.parse(String(init?.body));return Response.json(slug==="gmail"?{historyId:"123",expiration:String(Date.now()+604800000)}:{id:b.id,resourceId:"resource-1",expiration:String(Date.now()+604800000)});});
  const options={publicBaseUrl:"https://hooks.example",credentials:async()=>({headers:{Authorization:"Bearer fixture-oauth"},grantId:"grant-1"}),request:request as typeof fetch};
  const service=googlePushService(db,options),settings={triggerId:t.id,enabled:true,...(slug==="gmail"?{topicName:"projects/project/topics/gmail",subscription:"projects/project/subscriptions/gmail",serviceAccountEmail:"push@project.iam.gserviceaccount.com",mailboxEmail:"client@example.com"}:{calendarId:"primary"})};
  return {company,c,t,service,settings,options,request,count:()=>count,state:async()=>{const [v]=await db.select().from(toolConnections).where(eq(toolConnections.id,c.id));return v.config.googlePush as any}};
 }
 it("persists a watch, reconstructs its renewal deadline after restart, and stays quiet until due",async()=>{
  const f=await fixture();await f.service.configure(f.company.id,f.c.id,f.settings);await f.service.sweep(new AbortController().signal);
  const s=await f.state();expect(s.status).toBe("watching");expect(s.channels[0].resourceId).toBe("resource-1");expect(s.nextAt).toBeGreaterThan(Date.now());expect(f.count()).toBe(1);
  const restarted=googlePushService(db,f.options);await restarted.sweep(new AbortController().signal);expect(f.count()).toBe(1);expect(restarted.nextRunAt()).toBeGreaterThan(Date.now());
  await new Promise(r=>setTimeout(r,25));expect(f.count()).toBe(1);
 });
 it("accepts Calendar metadata once authenticated and gives duplicates the same receipt identity",async()=>{
  const f=await fixture();await f.service.configure(f.company.id,f.c.id,f.settings);await f.service.sweep(new AbortController().signal);const s=await f.state();mocks.fire.mockClear();
  const headers={"x-goog-channel-token":"fixture-webhook-secret","x-goog-channel-id":s.channels[0].id,"x-goog-resource-id":"resource-1","x-goog-resource-state":"exists","x-goog-message-number":"7"};
  await f.service.accept(f.c.id,headers,undefined);await f.service.accept(f.c.id,headers,{untrusted:"not forwarded"});
  expect(mocks.fire.mock.calls[0][1].idempotencyKey).toBe(mocks.fire.mock.calls[1][1].idempotencyKey);
  expect(JSON.stringify(mocks.fire.mock.calls[0][1].payload)).not.toContain("untrusted");
  await expect(f.service.accept(f.c.id,{...headers,"x-goog-channel-token":"wrong"},undefined)).rejects.toMatchObject({status:401});
  await db.update(toolConnections).set({enabled:false}).where(eq(toolConnections.id,f.c.id));await expect(f.service.accept(f.c.id,headers,undefined)).rejects.toMatchObject({status:401});
 });
 it("does not renew twice when two controllers race",async()=>{
  const f=await fixture();await f.service.configure(f.company.id,f.c.id,f.settings);
  await Promise.all([f.service.sweep(new AbortController().signal),googlePushService(db,f.options).sweep(new AbortController().signal)]);expect(f.count()).toBe(1);
 });
 it("keeps a draft quiet until consent and refuses a trigger from another company",async()=>{
  const f=await fixture(),other=await fixture();await expect(f.service.configure(f.company.id,f.c.id,{...f.settings,triggerId:other.t.id})).rejects.toMatchObject({status:400});
  await db.update(toolConnections).set({status:"draft"}).where(eq(toolConnections.id,f.c.id));await f.service.configure(f.company.id,f.c.id,f.settings);await f.service.sweep(new AbortController().signal);expect(f.count()).toBe(0);expect((await f.state()).status).toBe("awaiting_authorization");expect((await f.state()).nextAt).toBeUndefined();
 });
 it("preserves uncertainty after a Calendar transport failure and schedules bounded Gmail retries",async()=>{
  for(const slug of ["google-calendar","gmail"]){const f=await fixture(slug);const service=googlePushService(db,{...f.options,request:async()=>{throw Error("fixture-oauth private provider failure")}});await service.configure(f.company.id,f.c.id,f.settings);await service.sweep(new AbortController().signal);const s=await f.state();expect(s.status).toBe(slug==="gmail"?"retrying":"needs_attention");expect(JSON.stringify(s)).not.toContain("private provider failure");expect(Boolean(s.nextAt)).toBe(slug==="gmail");}
 });
});
