import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyGooglePubSub, verifyGoogleCalendar } from "./push-auth.js";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...publicKey.export({format:"jwk"}), kid:"google-fixture",alg:"RS256" };
const audience="https://hooks.example/api/google-push/connection",email="push@project.iam.gserviceaccount.com",mailbox="client-mail@example.com",subscription="projects/project/subscriptions/gmail";
function jwt(patch:Record<string,unknown>={}) {const now=Math.floor(Date.now()/1000);const a=Buffer.from(JSON.stringify({alg:"RS256",kid:key.kid})).toString("base64url"),b=Buffer.from(JSON.stringify({iss:"https://accounts.google.com",sub:"123",aud:audience,email,email_verified:true,iat:now,exp:now+3600,...patch})).toString("base64url");return a+"."+b+"."+sign("RSA-SHA256",Buffer.from(a+"."+b),privateKey).toString("base64url");}
const payload={ subscription,message:{ messageId:"1234",data:Buffer.from(JSON.stringify({emailAddress:mailbox,historyId:"90071992547409931234",body:"untrusted"})).toString("base64") }};
const base={authorization:`Bearer ${jwt()}`,audience,serviceAccountEmail:email,mailboxEmail:mailbox,topicSubscription:subscription,payload};
describe("Google push provider authentication",()=>{
 it("verifies a real RSA signature and retains only a change cursor, with stable duplicate identity",async()=>{
  const v=await verifyGooglePubSub(base,async()=>[key]);expect(v.payload).toEqual({service:"gmail",historyId:"90071992547409931234"});expect(v.idempotencyKey).toBe((await verifyGooglePubSub(base,async()=>[key])).idempotencyKey);expect(JSON.stringify(v)).not.toContain(mailbox);expect(JSON.stringify(v)).not.toContain("untrusted");
 });
 it("rejects wrong audience, wrong identity, unverified email, expired JWT and other subscriptions/mailboxes",async()=>{
  for(const patch of [{aud:"other"},{email:"attacker@example.com"},{email_verified:false},{exp:1},{iat:Date.now()/1000+500},{iss:"attacker"}])await expect(verifyGooglePubSub({...base,authorization:`Bearer ${jwt(patch)}`},async()=>[key])).rejects.toMatchObject({status:401});
  await expect(verifyGooglePubSub({...base,topicSubscription:"other"},async()=>[key])).rejects.toMatchObject({status:401});
  await expect(verifyGooglePubSub({...base,mailboxEmail:"other@example.com"},async()=>[key])).rejects.toMatchObject({status:401});
 });
 it("rejects a tampered signature and missing bearer before fetching signing keys",async()=>{
  let reads=0;const keys=async()=>{reads++;return [key]};await expect(verifyGooglePubSub({...base,authorization:undefined},keys)).rejects.toMatchObject({status:401});expect(reads).toBe(0);
  const parts=jwt().split(".");parts[2]=Buffer.alloc(256).toString("base64url");await expect(verifyGooglePubSub({...base,authorization:"Bearer "+parts.join(".")},keys)).rejects.toMatchObject({status:401});
 });
 it("authenticates Calendar channels, ignores initial sync, rejects expired/foreign resources",()=>{
  const base={secret:"channel-secret",channels:[{id:"channel1",resourceId:"resource1",expiresAt:Date.now()+60000}],headers:{"x-goog-channel-token":"channel-secret","x-goog-channel-id":"channel1","x-goog-message-number":"1","x-goog-resource-state":"exists","x-goog-resource-id":"resource1"}};
  expect(verifyGoogleCalendar(base).payload.service).toBe("calendar");expect(verifyGoogleCalendar({...base,headers:{...base.headers,"x-goog-resource-state":"sync"}}).ignored).toBe(true);
  for(const patch of [{"x-goog-channel-token":"wrong"},{"x-goog-channel-id":"foreign"},{"x-goog-resource-id":"foreign"},{"x-goog-message-number":"invalid"}])expect(()=>verifyGoogleCalendar({...base,headers:{...base.headers,...patch}})).toThrow();
  expect(()=>verifyGoogleCalendar({...base,channels:[{...base.channels[0],expiresAt:1}]})).toThrow();
 });
});
