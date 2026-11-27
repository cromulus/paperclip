import { nativeCatalog, nativeRestFailure as fail, nativeRestRecord as record, nativeRestSender, type NativeRestRequest } from "../../native-rest-client.js";
import { googleWorkspaceApiClient } from "./client.js";

const auth = (scope: string) => `https://www.googleapis.com/auth/${scope}`;
const text = (maxLength = 512) => ({ type: "string", minLength: 1, maxLength });
const page = { pageSize: { type: "integer", minimum: 1, maximum: 100 }, pageToken: text(4096) };
function op(name: string, title: string, properties: Record<string, unknown>, required: string[] = [], write = false) {
  return { name, title, description: title, inputSchema: { type: "object", additionalProperties: false, properties, required },
    annotations: { readOnlyHint: !write, destructiveHint: false, idempotentHint: !write, openWorldHint: false } };
}
const reference = (pattern: string) => ({ ...text(), pattern });
const conference = reference("^conferenceRecords/[A-Za-z0-9_-]+$");
const transcript = reference("^conferenceRecords/[A-Za-z0-9_-]+/transcripts/[A-Za-z0-9_-]+$");
const point = { type: "object", additionalProperties: false, properties: { latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 } }, required: ["latitude", "longitude"] };
const fileId = {...text(),pattern:"^[A-Za-z0-9_-]+$"};
const range = {...text(),pattern:"^(?:[^!\\r\\n]{1,100}!)?[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$"};
const API_KEY_SERVICES = new Set(["google-routes","google-places","google-translate"]);
const CATALOGS = {
  "google-people": nativeCatalog([
    op("people__search_contacts", "Search Google contacts by name/email prefix; contacts do not establish client status", {query:text(256),pageSize:{type:"integer",minimum:1,maximum:30}},["query"]),
  ]),
  "google-sheets": nativeCatalog([
    op("sheets__get_spreadsheet", "Read spreadsheet and sheet metadata", {spreadsheetId:fileId},["spreadsheetId"]),
    op("sheets__get_values", "Read a bounded cell range", {spreadsheetId:fileId,range},["spreadsheetId","range"]),
    op("sheets__update_values", "Write literal values to a bounded cell range; formulas are not evaluated", {spreadsheetId:fileId,range,values:{type:"array",minItems:1,maxItems:100,items:{type:"array",minItems:1,maxItems:50,items:{anyOf:[{type:"string",maxLength:10000},{type:"number"},{type:"boolean"},{type:"null"}]}}}},["spreadsheetId","range","values"],true),
  ]),
  "google-slides": nativeCatalog([
    op("slides__read_presentation", "Read presentation slide text and revision", {presentationId:fileId},["presentationId"]),
    op("slides__create_presentation", "Create an empty Google Slides presentation", {title:text(255)},["title"],true),
    op("slides__replace_text", "Replace template text at a previously read presentation revision", {presentationId:fileId,findText:text(1000),replacementText:{type:"string",maxLength:50000},requiredRevisionId:text()},["presentationId","findText","replacementText","requiredRevisionId"],true),
  ]),
  "google-meet": nativeCatalog([
    op("meet__list_conferences", "List Meet conferences", { ...page, filter: text(2048) }),
    op("meet__get_conference", "Read a Meet conference", { name: conference }, ["name"]),
    op("meet__list_participants", "List Meet participants", { ...page, parent: conference }, ["parent"]),
    op("meet__list_transcripts", "List available Meet transcripts", { ...page, parent: conference }, ["parent"]),
    op("meet__list_transcript_entries", "Read a page of Meet transcript speech entries", { ...page, parent: transcript }, ["parent"]),
    op("meet__list_recordings", "List Meet recording references", { ...page, parent: conference }, ["parent"]),
  ]),
  "google-routes": nativeCatalog([
    op("routes__compute_route", "Calculate a route and traffic-aware travel time", { origin: text(1000), destination: text(1000), travelMode: { type: "string", enum: ["DRIVE", "WALK", "BICYCLE", "TRANSIT"] }, departureTime: { type: "string", format: "date-time" } }, ["origin", "destination"]),
  ]),
  "google-places": nativeCatalog([
    op("places__search", "Search places and business addresses", { query: text(1000), pageSize: { type: "integer", minimum: 1, maximum: 20 }, location: point, radiusMeters: { type: "number", minimum: 1, maximum: 50000 } }, ["query"]),
    op("places__get", "Read place address, website and opening hours", { placeId: { ...text(), pattern: "^[A-Za-z0-9_-]+$" } }, ["placeId"]),
  ]),
  "google-translate": nativeCatalog([
    op("translate__translate_text", "Translate text into a target language", { text: text(10000), targetLanguage: { ...text(20), pattern: "^[A-Za-z-]+$" }, sourceLanguage: { ...text(20), pattern: "^[A-Za-z-]+$" } }, ["text", "targetLanguage"]),
    op("translate__detect_language", "Detect the language of text", { text: text(10000) }, ["text"]),
    op("translate__list_languages", "List supported translation languages", { displayLanguage: { ...text(20), pattern: "^[A-Za-z-]+$" } }),
  ]),
  "google-workspace-search": nativeCatalog([
    op("workspace__search", "Search authorized Gmail, Drive and Calendar with source links; report partial failures", { query: text(1000), services: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string", enum: ["gmail", "drive", "calendar"] } }, maxResults: { type: "integer", minimum: 1, maximum: 30 }, calendarId: text(), timeMin: { type: "string", format: "date-time" }, timeMax: { type: "string", format: "date-time" } }, ["query"]),
  ]),
};
export type GoogleServiceSlug = keyof typeof CATALOGS;
export const GOOGLE_SERVICE_SLUGS = Object.keys(CATALOGS) as GoogleServiceSlug[];
export function googleServiceToolGranted(slug: GoogleServiceSlug, name: string, scopes: readonly string[]) {
  if (!CATALOGS[slug].isToolName(name)) return false;
  if (slug === "google-meet") return scopes.includes(auth("meetings.space.readonly"));
  if (slug === "google-people") return scopes.includes(auth("contacts.readonly"));
  if (slug === "google-sheets") return scopes.includes(auth("spreadsheets")) || (name !== "sheets__update_values" && scopes.includes(auth("spreadsheets.readonly")));
  if (slug === "google-slides") return scopes.includes(auth("presentations")) || (name === "slides__read_presentation" && scopes.includes(auth("presentations.readonly")));
  if (slug === "google-workspace-search") return ["gmail.readonly", "drive.readonly", "calendar.events.readonly", "calendar.events"].some(s => scopes.includes(auth(s)));
  return true; // API-key services have no user OAuth identity or mailbox grant.
}
function sender(headers: Record<string, string>, request: NativeRestRequest, apiKey: boolean, signal?: AbortSignal, deadlineAt?: number) {
  const h = new Headers(headers), key = h.get("x-goog-api-key") ?? h.get("authorization")?.replace(/^Bearer /, "");
  const authorization = apiKey ? `Bearer ${key ?? ""}` : h.get("authorization");
  if (!authorization || !/^Bearer [^\r\n ]+$/.test(authorization)) throw fail(422, "google_credential_missing", "Connect this Google service to restore its credential.");
  return nativeRestSender({ provider: "Google", code: "google_service", authorization,
    signal: signal ?? AbortSignal.timeout(30000), deadlineAt: deadlineAt ?? Date.now() + 30000,
    request: apiKey ? (url, init) => { const outgoing = new Headers(init.headers); outgoing.delete("authorization"); outgoing.set("X-Goog-Api-Key", key!); return request(url, { ...init, headers: outgoing }); } : request,
    deniedMessage: "Google denied this service request. Check its API enablement, credential restrictions, billing and granted permissions." });
}
export async function executeGoogleService(input: {
  binding: { companyId: string; agentId: string | null }; connection: { companyId: string; transport?: string; config: Record<string, unknown> };
  headers: Record<string, string>; request: NativeRestRequest; toolName: string; parameters: unknown;
  grantedScopes?: readonly string[]; signal?: AbortSignal; deadlineAt?: number;
}) {
  const slug = input.connection.config.sourceTemplateKey as GoogleServiceSlug, catalog = CATALOGS[slug];
  if (!input.binding.agentId || input.binding.companyId !== input.connection.companyId || input.connection.transport !== "rest_api" || input.connection.config.connectionMethodKey !== "native-api" || !catalog) throw fail(404, "google_service_not_found", "Connection not found.");
  if (!catalog.validate(input.toolName, input.parameters)) throw fail(422, "google_service_invalid_arguments", "Invalid Google service arguments.");
  const scopes = input.grantedScopes ?? [];
  if (!googleServiceToolGranted(slug, input.toolName, scopes)) throw fail(403, "oauth_insufficient_scope", "This service needs its own Google permission grant.");
  const p = record(input.parameters);
  if (slug === "google-workspace-search") return searchWorkspace(input, p, scopes);
  const { send } = sender(input.headers, input.request, API_KEY_SERVICES.has(slug), input.signal, input.deadlineAt);
  let url: URL, body: unknown, headers: Record<string, string> = {};
  if (slug === "google-people") {
    url = new URL("https://people.googleapis.com/v1/people:searchContacts");
    url.searchParams.set("readMask","names,emailAddresses,organizations,phoneNumbers");
    url.searchParams.set("pageSize",String(p.pageSize??10));
    // Google requires a warmup query for fresh contact-search cache contents.
    url.searchParams.set("query","");await send(url.toString(),{method:"GET"});
    url.searchParams.set("query",String(p.query));
  } else if (slug === "google-sheets") {
    const base=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(p.spreadsheetId))}`;
    if (input.toolName === "sheets__get_spreadsheet") {
      url = new URL(base);url.searchParams.set("fields","spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(properties)");
    } else {
      const cells=String(p.range).split("!").pop()!;
      const [start,end=start]=cells.split(":");
      const pos=(cell:string)=>{const m=cell.match(/^([A-Z]+)([0-9]+)$/)!;return {row:Number(m[2]),col:[...m[1]].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0)}};
      const a=pos(start),b=pos(end),height=b.row-a.row+1,width=b.col-a.col+1;
      if(height<1||width<1||height>1000||width>100)throw fail(422,"google_service_invalid_arguments","Select at most 1000 rows and 100 columns.");
      url=new URL(base+`/values/${encodeURIComponent(String(p.range))}`);
      if(input.toolName === "sheets__update_values") {
        const values=p.values as unknown[][];
        if(values.length>height||values.some(row=>row.length>width))throw fail(422,"google_service_invalid_arguments","Values must fit inside the selected range.");
        url.searchParams.set("valueInputOption","RAW");
        return send(url.toString(),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({range:p.range,majorDimension:"ROWS",values})});
      }
    }
  } else if (slug === "google-slides") {
    url=new URL("https://slides.googleapis.com/v1/presentations"+(p.presentationId?"/"+encodeURIComponent(String(p.presentationId)):""));
    if(input.toolName === "slides__create_presentation")body={title:p.title};
    else if(input.toolName === "slides__replace_text") {
      url.pathname+=":batchUpdate";body={writeControl:{requiredRevisionId:p.requiredRevisionId},requests:[{replaceAllText:{containsText:{text:p.findText,matchCase:true},replaceText:p.replacementText}}]};
    }else url.searchParams.set("fields","presentationId,title,revisionId,slides(objectId,pageElements(objectId,shape(text(textElements(textRun(content))))))");
  } else if (slug === "google-meet") {
    const path = input.toolName === "meet__list_conferences" ? "conferenceRecords" : input.toolName === "meet__get_conference" ? String(p.name)
      : `${p.parent}/${({ meet__list_participants: "participants", meet__list_transcripts: "transcripts", meet__list_transcript_entries: "entries", meet__list_recordings: "recordings" } as Record<string, string>)[input.toolName]}`;
    url = new URL(`https://meet.googleapis.com/v2/${path}`);
    for (const k of ["pageSize", "pageToken", "filter"]) if (p[k] !== undefined) url.searchParams.set(k, String(p[k]));
  } else if (slug === "google-routes") {
    url = new URL("https://routes.googleapis.com/directions/v2:computeRoutes");
    body = { origin: { address: p.origin }, destination: { address: p.destination }, travelMode: p.travelMode ?? "DRIVE", ...((p.travelMode ?? "DRIVE") === "DRIVE" ? { routingPreference: "TRAFFIC_AWARE" } : {}), ...(p.departureTime ? { departureTime: p.departureTime } : {}) };
    headers["X-Goog-FieldMask"] = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description";
  } else if (slug === "google-places") {
    if (input.toolName === "places__get") {
      url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(String(p.placeId))}`);
      headers["X-Goog-FieldMask"] = "id,displayName,formattedAddress,location,websiteUri,regularOpeningHours,googleMapsUri";
    } else {
      if (p.radiusMeters && !p.location) throw fail(422, "google_service_invalid_arguments", "A search radius requires a location.");
      url = new URL("https://places.googleapis.com/v1/places:searchText");
      body = { textQuery: p.query, pageSize: p.pageSize ?? 10, ...(p.location ? { locationBias: { circle: { center: p.location, radius: p.radiusMeters ?? 5000 } } } : {}) };
      headers["X-Goog-FieldMask"] = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,nextPageToken";
    }
  } else {
    const path = input.toolName === "translate__detect_language" ? "/detect" : input.toolName === "translate__list_languages" ? "/languages" : "";
    url = new URL(`https://translation.googleapis.com/language/translate/v2${path}`);
    if (path === "/languages") { if (p.displayLanguage) url.searchParams.set("target", String(p.displayLanguage)); }
    else body = path === "/detect" ? { q: p.text } : { q: p.text, target: p.targetLanguage, format: "text", ...(p.sourceLanguage ? { source: p.sourceLanguage } : {}) };
  }
  return send(url.toString(), { method: body ? "POST" : "GET", headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

async function searchWorkspace(input: Parameters<typeof executeGoogleService>[0], p: Record<string, unknown>, scopes: readonly string[]) {
  const requested = (p.services ?? ["gmail", "drive", "calendar"]) as string[];
  const client = googleWorkspaceApiClient(input.headers, input.request, scopes, input.signal, input.deadlineAt);
  const take = Number(p.maxResults ?? 10), query = String(p.query);
  const tasks = requested.map(async service => {
    const scope = service === "gmail" ? "gmail.readonly" : service === "drive" ? "drive.readonly" : "calendar.events.readonly";
    if (!scopes.includes(auth(scope)) && !(service === "calendar" && scopes.includes(auth("calendar.events")))) return { service, status: "not_granted", results: [] };
    try {
      if (service === "gmail") {
        const v = record(await client.execute("gmail__search_messages", { query, maxResults: take }));
        return { service, status: "ok", nextPageToken: v.nextPageToken, results: (Array.isArray(v.messages) ? v.messages : []).map((x: unknown) => { const m = record(x); return { id: m.id, threadId: m.threadId, url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(m.id))}` }; }) };
      }
      if (service === "drive") {
        const literal = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const v = record(await client.execute("drive__search_files", { query: `trashed = false and fullText contains '${literal}'`, pageSize: take }));
        return { service, status: "ok", nextPageToken: v.nextPageToken, results: v.files ?? [] };
      }
      const v = record(await client.execute("calendar__list_events", { calendarId: p.calendarId ?? "primary", query, maxResults: take, ...(p.timeMin ? { timeMin: p.timeMin } : {}), ...(p.timeMax ? { timeMax: p.timeMax } : {}) }));
      return { service, status: "ok", nextPageToken: v.nextPageToken, results: v.items ?? [] };
    } catch { return { service, status: "unavailable", results: [] }; }
  });
  const sources = await Promise.all(tasks);
  return { query, complete: sources.every(s => s.status === "ok"), sources };
}

export const GOOGLE_ADDITIONAL_PROVIDERS = GOOGLE_SERVICE_SLUGS.map(slug => {
  const catalog = CATALOGS[slug], oauth = !API_KEY_SERVICES.has(slug);
  return { slug, name: slug, tools: catalog.tools,
    isConnection: (c: { transport: string; config?: Record<string, unknown> }) => c.transport === "rest_api" && c.config?.sourceTemplateKey === slug && c.config.connectionMethodKey === "native-api",
    isToolName: catalog.isToolName, risk: catalog.risk, isCurrentEntry: catalog.isCurrentEntry,
    ...(oauth ? { isToolGranted: (name: string, scopes: readonly string[]) => googleServiceToolGranted(slug, name, scopes) } : {}),
    // Setup health never spends Maps/Translate quota or uploads user content.
    probe: async (_c: unknown, headers: Record<string, string>, _r: NativeRestRequest, context?: { grantedScopes?: readonly string[] }) => {
      const credential = new Headers(headers);
      if (!(credential.get("authorization") || credential.get("x-goog-api-key"))) throw fail(422, "google_credential_missing", "Connect this Google service first.");
      if (oauth && !catalog.tools.some(t => googleServiceToolGranted(slug, t.name, context?.grantedScopes ?? []))) throw fail(403, "oauth_insufficient_scope", "Grant this Google service its own OAuth access.");
      return { verified: "configuration_only", providerRequestVerified: false };
    }, execute: executeGoogleService };
});
