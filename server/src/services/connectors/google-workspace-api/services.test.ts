import { describe, expect, it } from "vitest";
import { executeGoogleService, GOOGLE_ADDITIONAL_PROVIDERS } from "./services.js";
import { executeGoogleWorkspaceApiTool } from "./client.js";
const scope = (s: string) => `https://www.googleapis.com/auth/${s}`;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function fixture(slug: string, scopes: string[] = []) {
  const calls: { url: string; init: RequestInit }[] = [];
  const input = { binding: { companyId: "a", agentId: "agent" }, connection: { companyId: "a", transport: "rest_api", config: { sourceTemplateKey: slug, connectionMethodKey: "native-api" } }, headers: { Authorization: "Bearer fixture-secret" }, grantedScopes: scopes,
    request: async (url: string, init: RequestInit) => { calls.push({ url, init }); return response({ ok: true }); } };
  return { calls, input, call: (toolName: string, parameters: unknown) => executeGoogleService({ ...input, toolName, parameters }) };
}
describe("separate Google service credentials", () => {
  it("does not give routing, translate or Meet connections Gmail tools", async () => {
    for (const slug of ["google-routes", "google-places", "google-translate", "google-meet"]) {
      const f = fixture(slug, [scope("gmail.readonly")]);
      await expect(f.call("gmail__get_message", { id: "x" })).rejects.toMatchObject({ status: 422 });
      expect(f.calls).toHaveLength(0);
      expect(GOOGLE_ADDITIONAL_PROVIDERS.find(p => p.slug === slug)!.tools.some(t => t.name.startsWith("gmail__"))).toBe(false);
    }
  });
  it("blocks cross-company calls and Meet without its dedicated consent", async () => {
    const f = fixture("google-meet", [scope("gmail.readonly")]);
    await expect(f.call("meet__list_conferences", {})).rejects.toMatchObject({ status: 403 });
    await expect(executeGoogleService({ ...f.input, binding: { companyId: "other", agentId: "agent" }, toolName: "meet__list_conferences", parameters: {} })).rejects.toMatchObject({ status: 404 });
    expect(f.calls).toHaveLength(0);
  });
  it("uses fixed Meet paths, bounded pages, and preserves transcript paging", async () => {
    const f = fixture("google-meet", [scope("meetings.space.readonly")]);
    await f.call("meet__list_transcript_entries", { parent: "conferenceRecords/c1/transcripts/t1", pageSize: 100, pageToken: "page2" });
    expect(f.calls[0].url).toBe("https://meet.googleapis.com/v2/conferenceRecords/c1/transcripts/t1/entries?pageSize=100&pageToken=page2");
    await expect(f.call("meet__list_transcripts", { parent: "conferenceRecords/../outside" })).rejects.toMatchObject({ status: 422 });
    await expect(f.call("meet__list_conferences", { pageSize: 101 })).rejects.toMatchObject({ status: 422 });
    expect(f.calls).toHaveLength(1);
  });
  it("uses only API-key authentication for a traffic-aware route", async () => {
    const f = fixture("google-routes");
    await f.call("routes__compute_route", { origin: "Office", destination: "Client" });
    const c = f.calls[0], h = new Headers(c.init.headers);
    expect(c.url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    expect(h.has("authorization")).toBe(false); expect(h.get("x-goog-api-key")).toBe("fixture-secret");
    expect(h.get("x-goog-fieldmask")).toContain("routes.duration");
    expect(JSON.parse(String(c.init.body))).toMatchObject({ routingPreference: "TRAFFIC_AWARE" });
  });
  it("limits Places fields and bounds text sent to Translate", async () => {
    const places = fixture("google-places"); await places.call("places__search", { query: "client office", pageSize: 5 });
    expect(new Headers(places.calls[0].init.headers).get("x-goog-fieldmask")).not.toContain("*");
    const f = fixture("google-translate");await f.call("translate__translate_text", { text: "Hello", targetLanguage: "fr" });
    expect(f.calls[0].url).toBe("https://translation.googleapis.com/language/translate/v2");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ q: "Hello", target: "fr", format: "text" });
    await expect(f.call("translate__translate_text", { text: "x".repeat(10001), targetLanguage: "fr" })).rejects.toMatchObject({ status: 422 });
  });
  it("never lets a Calendar-only connection dispatch a Gmail request, even with a broader token", async () => {
    const f = fixture("google-calendar", [scope("gmail.readonly")]);
    await expect(executeGoogleWorkspaceApiTool({ ...f.input, connection: { ...f.input.connection, config: { sourceTemplateKey: "google-calendar", connectionMethodKey: "customer-workspace-api" } }, toolName: "gmail__get_message", parameters: { id: "x" } })).rejects.toMatchObject({ status: 404 });
    expect(f.calls).toHaveLength(0);
  });
  it("searches only consented sources and reports partial failures without claiming no results", async () => {
    const f = fixture("google-workspace-search", [scope("drive.readonly")]);
    const v = await f.call("workspace__search", { query: "Client's brief" }) as any;
    expect(f.calls).toHaveLength(1);expect(new URL(f.calls[0].url).pathname).toBe("/drive/v3/files");
    expect(v.complete).toBe(false);expect(v.sources.find((x: any) => x.service === "gmail").status).toBe("not_granted");
    const broken = await executeGoogleService({ ...f.input, request: async () => response({}, 503), toolName: "workspace__search", parameters: { query: "brief", services: ["drive"] } }) as any;
    expect(broken.sources[0].status).toBe("unavailable");expect(broken.complete).toBe(false);
  });
  it("redacts API keys from responses and never echoes provider error bodies", async () => {
    const f = fixture("google-translate");
    const v = await executeGoogleService({ ...f.input, request: async () => response({ text: "fixture-secret" }), toolName: "translate__detect_language", parameters: { text: "Hello" } });
    expect(JSON.stringify(v)).not.toContain("fixture-secret");
    await expect(executeGoogleService({ ...f.input, request: async () => response({ error: "fixture-secret" }, 403), toolName: "translate__detect_language", parameters: { text: "Hello" } })).rejects.not.toHaveProperty("message", expect.stringContaining("fixture-secret"));
  });
});

describe("Contacts, Sheets and Slides have independent native grants",()=>{
 it("warms People search before querying and does not infer client status",async()=>{
  const f=fixture("google-people",[scope("contacts.readonly")]);await f.call("people__search_contacts",{query:"Alex"});
  expect(f.calls).toHaveLength(2);expect(new URL(f.calls[0].url).searchParams.get("query")).toBe("");expect(new URL(f.calls[1].url).searchParams.get("query")).toBe("Alex");expect(f.calls.every(c=>new URL(c.url).hostname==="people.googleapis.com")).toBe(true);
 });
 it("bounds Sheets reads and preserves literal RAW writes without formula evaluation",async()=>{
  const f=fixture("google-sheets",[scope("spreadsheets")]);await f.call("sheets__update_values",{spreadsheetId:"sheet1",range:"Data!A1:B2",values:[["=IMPORTXML('url')",12],["literal",true]]});
  expect(f.calls[0].init.method).toBe("PUT");expect(new URL(f.calls[0].url).searchParams.get("valueInputOption")).toBe("RAW");
  await expect(f.call("sheets__get_values",{spreadsheetId:"sheet1",range:"A1:A1000000"})).rejects.toMatchObject({status:422});
  await expect(f.call("sheets__update_values",{spreadsheetId:"sheet1",range:"A1:A1",values:[[1,2]]})).rejects.toMatchObject({status:422});expect(f.calls).toHaveLength(1);
 });
 it("denies Sheets writes with read-only consent and pins Slides edits to a revision",async()=>{
  const f=fixture("google-sheets",[scope("spreadsheets.readonly")]);await expect(f.call("sheets__update_values",{spreadsheetId:"s",range:"A1",values:[[1]]})).rejects.toMatchObject({status:403});expect(f.calls).toHaveLength(0);
  const slides=fixture("google-slides",[scope("presentations")]);await slides.call("slides__replace_text",{presentationId:"p1",findText:"{{client}}",replacementText:"Client",requiredRevisionId:"r1"});expect(JSON.parse(String(slides.calls[0].init.body)).writeControl).toEqual({requiredRevisionId:"r1"});
 });
});
