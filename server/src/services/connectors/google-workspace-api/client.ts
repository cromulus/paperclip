import { isGoogleWorkspaceToolGranted, googleWorkspaceToolTarget } from "@paperclipai/shared";
import { nativeCatalog, nativeRestFailure as failure, nativeRestPathValue, nativeRestRecord as record,
  nativeRestSender, type NativeCatalogEntry, type NativeRestRequest } from "../../native-rest-client.js";

const ROOTS = {
  gmail: "https://gmail.googleapis.com",
  drive: "https://www.googleapis.com",
  docs: "https://docs.googleapis.com",
  calendar: "https://www.googleapis.com",
} as const;
const METHOD = "customer-workspace-api";
export const GOOGLE_NATIVE_SERVICE_PREFIXES: Record<string, readonly string[]> = {
  gmail: ["gmail__"], "google-calendar": ["calendar__"],
  "google-drive": ["drive__"], "google-docs": ["docs__"],
};
export function googleNativeConnectionAllows(connection: {config?: Record<string, unknown>}, name: string) {
  const slug = String(connection.config?.sourceTemplateKey ?? "");
  return slug === "google-workspace" || Boolean(GOOGLE_NATIVE_SERVICE_PREFIXES[slug]?.some(prefix => name.startsWith(prefix)));
}
const MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.folder",
  "text/plain",
] as const;
const SCHEMAS = {
  empty: { type: "object", additionalProperties: false, properties: {} },
  gmailSearch: { type: "object", additionalProperties: false, properties: {
    query: { type: "string", minLength: 1, maxLength: 2048 }, pageToken: { type: "string", maxLength: 4096 },
    maxResults: { type: "integer", minimum: 1, maximum: 100 },
  }, required: ["query"] },
  idRead: { type: "object", additionalProperties: false, properties: { id: { type: "string", minLength: 1, maxLength: 512 } }, required: ["id"] },
  driveIdRead: { type: "object", additionalProperties: false, properties: { fileId: { type: "string", minLength: 1, maxLength: 512 } }, required: ["fileId"] },
  documentIdRead: { type: "object", additionalProperties: false, properties: { documentId: { type: "string", minLength: 1, maxLength: 512 } }, required: ["documentId"] },
  calendarEventRead: { type: "object", additionalProperties: false, properties: {
    calendarId: { type: "string", minLength: 1, maxLength: 512 }, eventId: { type: "string", minLength: 1, maxLength: 512 },
  }, required: ["calendarId", "eventId"] },
  calendarEventDelete: { type: "object", additionalProperties: false, properties: {
    calendarId: { type: "string", minLength: 1, maxLength: 512 }, eventId: { type: "string", minLength: 1, maxLength: 512 }, etag: { type: "string", minLength: 1, maxLength: 512 },
  }, required: ["calendarId", "eventId", "etag"] },
  listPage: { type: "object", additionalProperties: false, properties: {
    pageToken: { type: "string", maxLength: 4096 }, maxResults: { type: "integer", minimum: 1, maximum: 100 },
  } },
  gmailDraftCreate: { type: "object", additionalProperties: false, properties: {
    to: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", format: "email", maxLength: 254 } },
    cc: { type: "array", maxItems: 20, items: { type: "string", format: "email", maxLength: 254 } },
    bcc: { type: "array", maxItems: 20, items: { type: "string", format: "email", maxLength: 254 } },
    subject: { type: "string", minLength: 1, maxLength: 998 }, bodyText: { type: "string", maxLength: 1048576 },
  }, required: ["to", "subject", "bodyText"] },
  driveSearch: { type: "object", additionalProperties: false, properties: {
    query: { type: "string", minLength: 1, maxLength: 2048 }, pageToken: { type: "string", maxLength: 4096 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 }, orderBy: { type: "string", maxLength: 256 },
  }, required: ["query"] },
  driveCreate: { type: "object", additionalProperties: false, properties: {
    name: { type: "string", minLength: 1, maxLength: 255 }, mimeType: { type: "string", enum: [...MIME_TYPES] },
    parentFolderId: { type: "string", minLength: 1, maxLength: 512 },
  }, required: ["name", "mimeType"] },
  driveCopy: { type: "object", additionalProperties: false, properties: {
    fileId: { type: "string", minLength: 1, maxLength: 512 }, name: { type: "string", minLength: 1, maxLength: 255 },
    parentFolderId: { type: "string", minLength: 1, maxLength: 512 },
  }, required: ["fileId"] },
  driveReadContent: { type: "object", additionalProperties: false, properties: {
    fileId: { type: "string", minLength: 1, maxLength: 512 }, exportMimeType: { type: "string", enum: ["text/plain", "text/csv", "application/pdf"] },
  }, required: ["fileId"] },
  docsUpdate: { type: "object", additionalProperties: false, properties: {
    documentId: { type: "string", minLength: 1, maxLength: 512 }, action: { type: "string", enum: ["insert", "replace"] },
    startIndex: { type: "integer", minimum: 1 }, endIndex: { type: "integer", minimum: 1 },
    tabId: { type: "string", minLength: 1, maxLength: 512 },
    text: { type: "string", maxLength: 100000 }, requiredRevisionId: { type: "string", minLength: 1, maxLength: 512 },
  }, required: ["documentId", "action", "startIndex", "text", "requiredRevisionId"],
  allOf: [{ if: { properties: { action: { const: "replace" } }, required: ["action"] }, then: { required: ["endIndex"] } }] },
  calendarList: { type: "object", additionalProperties: false, properties: {
    pageToken: { type: "string", maxLength: 4096 }, maxResults: { type: "integer", minimum: 1, maximum: 100 },
  } },
  calendarEvents: { type: "object", additionalProperties: false, properties: {
    calendarId: { type: "string", minLength: 1, maxLength: 512 }, pageToken: { type: "string", maxLength: 4096 },
    maxResults: { type: "integer", minimum: 1, maximum: 100 }, query: { type: "string", maxLength: 512 },
    timeMin: { type: "string", format: "date-time" }, timeMax: { type: "string", format: "date-time" },
  }, required: ["calendarId"] },
  eventDate: { type: "object", additionalProperties: false, properties: {
    date: { type: "string", format: "date" }, dateTime: { type: "string", format: "date-time" }, timeZone: { type: "string", maxLength: 128 },
  }, oneOf: [{ required: ["date"] }, { required: ["dateTime"] }] },
  calendarEventCreate: { type: "object", additionalProperties: false, properties: {
    calendarId: { type: "string", minLength: 1, maxLength: 512 }, summary: { type: "string", minLength: 1, maxLength: 1024 },
    description: { type: "string", maxLength: 10000 }, location: { type: "string", maxLength: 2048 },
    start: { $ref: "#/definitions/eventDate" }, end: { $ref: "#/definitions/eventDate" },
  }, required: ["calendarId", "summary", "start", "end"], definitions: { eventDate: { type: "object", additionalProperties: false,
    properties: { date: { type: "string", format: "date" }, dateTime: { type: "string", format: "date-time" }, timeZone: { type: "string", maxLength: 128 } },
    oneOf: [{ required: ["date"] }, { required: ["dateTime"] }] } } },
  calendarEventUpdate: { type: "object", additionalProperties: false, properties: {
    calendarId: { type: "string", minLength: 1, maxLength: 512 }, eventId: { type: "string", minLength: 1, maxLength: 512 }, etag: { type: "string", minLength: 1, maxLength: 512 },
    summary: { type: "string", minLength: 1, maxLength: 1024 }, description: { type: "string", maxLength: 10000 },
    location: { type: "string", maxLength: 2048 }, start: { $ref: "#/definitions/eventDate" }, end: { $ref: "#/definitions/eventDate" },
  }, required: ["calendarId", "eventId", "etag"], minProperties: 4, definitions: { eventDate: { type: "object", additionalProperties: false,
    properties: { date: { type: "string", format: "date" }, dateTime: { type: "string", format: "date-time" }, timeZone: { type: "string", maxLength: 128 } },
    oneOf: [{ required: ["date"] }, { required: ["dateTime"] }] } } },
} as const;

const operation = (name: string, title: string, description: string, inputSchema: unknown, write = false, destructive = false) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: { readOnlyHint: !write && !destructive, destructiveHint: destructive, ...(write || destructive ? { idempotentHint: false } : { idempotentHint: true }), openWorldHint: false },
});

const OPERATIONS = [
  operation("gmail__list_history", "Read Gmail changes after a history cursor", "Read one bounded page of message-added history after a verified Gmail push cursor. A 404 requires a bounded resync.", {type:"object",additionalProperties:false,properties:{startHistoryId:{type:"string",pattern:"^[0-9]{1,30}$"},pageToken:{type:"string",maxLength:4096},maxResults:{type:"integer",minimum:1,maximum:100}},required:["startHistoryId"]}),
  operation("gmail__search_messages", "Search Gmail messages", "Search messages using a bounded Gmail query and return message/thread IDs for follow-up reads.", SCHEMAS.gmailSearch),
  operation("gmail__get_message", "Get a Gmail message", "Read one message by ID.", SCHEMAS.idRead),
  operation("gmail__get_thread", "Get a Gmail thread", "Read one thread by ID.", SCHEMAS.idRead),
  operation("gmail__list_drafts", "List Gmail drafts", "List draft IDs and message summaries.", SCHEMAS.listPage),
  operation("gmail__get_draft", "Get a Gmail draft", "Read a draft by ID.", SCHEMAS.idRead),
  operation("gmail__list_labels", "List Gmail labels", "List mailbox label names and IDs.", SCHEMAS.empty),
  operation("gmail__create_draft", "Create a Gmail draft", "Create an unsent plain-text draft. This tool never sends email.", SCHEMAS.gmailDraftCreate, true),
  operation("drive__search_files", "Search Drive files", "Search Drive metadata with a bounded query and page size.", SCHEMAS.driveSearch),
  operation("drive__get_file_metadata", "Get Drive file metadata", "Read metadata for one Drive file.", SCHEMAS.driveIdRead),
  operation("drive__read_file_content", "Read Drive file content", "Read downloadable file bytes or export a Google Workspace document as text, CSV, or PDF.", SCHEMAS.driveReadContent),
  operation("drive__create_file", "Create a Drive file", "Create an empty document, spreadsheet, presentation, folder, or plain-text file entry.", SCHEMAS.driveCreate, true),
  operation("drive__copy_file", "Copy a Drive file", "Copy a file to the same Drive account, optionally naming it or choosing one parent folder.", SCHEMAS.driveCopy, true),
  operation("docs__read_doc", "Read a Google Doc", "Read a document by ID.", SCHEMAS.documentIdRead),
  operation("docs__update_doc", "Update Google Docs text", "Insert or replace text at document indexes from a recently read revision; other Docs request types are not exposed.", SCHEMAS.docsUpdate, true),
  operation("calendar__list_calendars", "List Google calendars", "List calendars available to the connected user.", SCHEMAS.calendarList),
  operation("calendar__list_events", "List calendar events", "List events in a bounded page, optionally filtered by time range and text.", SCHEMAS.calendarEvents),
  operation("calendar__get_event", "Get a calendar event", "Read one event by calendar and event ID.", SCHEMAS.calendarEventRead),
  operation("calendar__create_event", "Create a calendar event", "Create an event without attendees or guest notifications.", SCHEMAS.calendarEventCreate, true),
  operation("calendar__update_event", "Update a calendar event", "Update selected event fields without replacing unrelated data or notifying guests.", SCHEMAS.calendarEventUpdate, true),
  operation("calendar__delete_event", "Delete a calendar event", "Delete one event. Guest notifications are disabled.", SCHEMAS.calendarEventDelete, false, true),
] as const;

const contract = nativeCatalog([...OPERATIONS]);
export const GOOGLE_WORKSPACE_API_TOOLS = contract.tools;
export const isGoogleWorkspaceApiToolName = contract.isToolName;
export const googleWorkspaceApiRisk = contract.risk;
export const isCurrentGoogleWorkspaceApiCatalogEntry = (entry: NativeCatalogEntry) => contract.isCurrentEntry(entry);
type Operation = typeof OPERATIONS[number];
const byName = new Map<string, Operation>(OPERATIONS.map((item) => [item.name, item]));

export function isGoogleWorkspaceApiConnection(connection: { transport: string; config?: Record<string, unknown> }) {
  return connection.transport === "rest_api" && (connection.config?.sourceTemplateKey === "google-workspace" || Object.hasOwn(GOOGLE_NATIVE_SERVICE_PREFIXES, String(connection.config?.sourceTemplateKey)))
    && connection.config?.connectionMethodKey === METHOD;
}

function pathValue(value: unknown) {
  return nativeRestPathValue(value, () => failure(422, "google_workspace_arguments_invalid", "Invalid Google Workspace resource ID."));
}
function rawPathValue(value: unknown) {
  pathValue(value);
  return String(value);
}
function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw failure(422, "google_workspace_arguments_invalid", `Enter a valid ${label}.`);
  return value;
}
function safeHeaderText(value: unknown, label: string) {
  const text = requiredText(value, label);
  if (/[\r\n\u0000-\u001f\u007f]/.test(text)) throw failure(422, "google_workspace_arguments_invalid", `Invalid ${label}.`);
  return text;
}
function encodedBody(value: unknown) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 1024 * 1024) throw failure(422, "google_workspace_input_limit", "The request body exceeds the 1 MiB limit.");
  return body;
}
function jsonRequest(method: string, body?: unknown): RequestInit {
  return { method, ...(body === undefined ? {} : { body: encodedBody(body), headers: { "Content-Type": "application/json" } }) };
}
function addParams(url: URL, values: Record<string, unknown>, rename: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(rename[key] ?? key, String(value));
  }
  return url.toString();
}
function mailHeader(value: string, name: string) {
  if (/[\r\n\u0000]/.test(value)) throw failure(422, "google_workspace_arguments_invalid", `Invalid ${name}.`);
  return value;
}
function encodedSubject(subject: string) {
  mailHeader(subject, "email subject");
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}
function createDraftMessage(input: Record<string, unknown>) {
  const to = input.to as string[];
  const cc = (input.cc as string[] | undefined) ?? [];
  const bcc = (input.bcc as string[] | undefined) ?? [];
  const headers = [
    `To: ${to.map((value) => mailHeader(value, "email address")).join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.map((value) => mailHeader(value, "email address")).join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.map((value) => mailHeader(value, "email address")).join(", ")}`] : []),
    `Subject: ${encodedSubject(input.subject as string)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.bodyText as string, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd(),
  ].join("\r\n");
  const raw = Buffer.from(headers, "utf8").toString("base64url");
  return { message: { raw } };
}
function eventResource(input: Record<string, unknown>, partial: boolean) {
  const result: Record<string, unknown> = {};
  for (const key of ["summary", "description", "location", "start", "end"] as const) {
    if (input[key] !== undefined) result[key] = input[key];
  }
  if (!partial && (!result.start || !result.end)) throw failure(422, "google_workspace_arguments_invalid", "Calendar events require a start and end time.");
  return result;
}

export function googleWorkspaceApiClient(headers: Record<string, string>, request: NativeRestRequest,
  grantedScopes: readonly string[], signal: AbortSignal = AbortSignal.timeout(30_000), deadlineAt = Date.now() + 30_000) {
  const authorization = headers.Authorization;
  if (!authorization || !/^Bearer [^\r\n]+$/.test(authorization)) {
    throw failure(422, "google_workspace_credential_missing", "Reconnect Google Workspace to restore access.");
  }
  const { send } = nativeRestSender({ provider: "Google Workspace", code: "google_workspace", authorization, request, signal, deadlineAt,
    deniedMessage: "Google denied access. Check that this API is enabled in your Google Cloud project and that the connected account granted the required permission." });

  async function execute(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const operation = byName.get(toolName);
    const target = googleWorkspaceToolTarget(toolName);
    if (!operation || !target) throw failure(404, "google_workspace_tool_not_found", "Google Workspace action not found.");
    if (!contract.validate(operation.name, input)) throw failure(422, "google_workspace_arguments_invalid", "Invalid Google Workspace action arguments.");
    if (!isGoogleWorkspaceToolGranted(toolName, grantedScopes)) {
      throw failure(403, "google_workspace_scope_denied", "This Google Workspace action is not covered by the connected account’s granted scopes.");
    }
    const url = new URL(ROOTS[target.service as keyof typeof ROOTS] + "/");
    const pathId = (key: string) => pathValue(input[key]);
    let init: RequestInit;
    switch (operation.name) {
      case "gmail__list_history":
        url.pathname = "/gmail/v1/users/me/history";
        return send(addParams(url, {startHistoryId:input.startHistoryId,pageToken:input.pageToken,maxResults:input.maxResults??50,historyTypes:"messageAdded"}), {method:"GET"});
      case "gmail__search_messages":
        url.pathname = "/gmail/v1/users/me/messages";
        init = { method: "GET" };
        return send(addParams(url, { q: requiredText(input.query, "Gmail query"), pageToken: input.pageToken, maxResults: input.maxResults ?? 50 }), init);
      case "gmail__get_message":
        url.pathname = `/gmail/v1/users/me/messages/${pathId("id")}`;
        init = { method: "GET" };
        url.searchParams.set("format", "full");
        return send(url.toString(), init);
      case "gmail__get_thread":
        url.pathname = `/gmail/v1/users/me/threads/${pathId("id")}`;
        init = { method: "GET" };
        url.searchParams.set("format", "full");
        return send(url.toString(), init);
      case "gmail__list_drafts":
        url.pathname = "/gmail/v1/users/me/drafts";
        init = { method: "GET" };
        return send(addParams(url, { pageToken: input.pageToken, maxResults: input.maxResults ?? 50 }), init);
      case "gmail__get_draft":
        url.pathname = `/gmail/v1/users/me/drafts/${pathId("id")}`;
        init = { method: "GET" };
        url.searchParams.set("format", "full");
        return send(url.toString(), init);
      case "gmail__list_labels":
        url.pathname = "/gmail/v1/users/me/labels";
        return send(url.toString(), { method: "GET" });
      case "gmail__create_draft":
        url.pathname = "/gmail/v1/users/me/drafts";
        return send(url.toString(), jsonRequest("POST", createDraftMessage(input)));
      case "drive__search_files":
        url.pathname = "/drive/v3/files";
        return send(addParams(url, { q: requiredText(input.query, "Drive query"), pageToken: input.pageToken,
          pageSize: input.pageSize ?? 50, orderBy: input.orderBy, fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,webViewLink,parents)" }), { method: "GET" });
      case "drive__get_file_metadata":
        url.pathname = `/drive/v3/files/${pathId("fileId")}`;
        return send(addParams(url, { fields: "id,name,mimeType,description,modifiedTime,webViewLink,parents,size,capabilities(canDownload,canCopy)" }), { method: "GET" });
      case "drive__read_file_content": {
        url.pathname = `/drive/v3/files/${pathId("fileId")}${input.exportMimeType ? "/export" : ""}`;
        url.searchParams.set(input.exportMimeType ? "mimeType" : "alt", input.exportMimeType ? String(input.exportMimeType) : "media");
        return send(url.toString(), { method: "GET" });
      }
      case "drive__create_file": {
        url.pathname = "/drive/v3/files";
        url.searchParams.set("fields", "id,name,mimeType,webViewLink,parents");
        const body = { name: requiredText(input.name, "file name"), mimeType: input.mimeType,
          ...(input.parentFolderId ? { parents: [rawPathValue(input.parentFolderId)] } : {}) };
        return send(url.toString(), jsonRequest("POST", body));
      }
      case "drive__copy_file": {
        url.pathname = `/drive/v3/files/${pathId("fileId")}/copy`;
        url.searchParams.set("fields", "id,name,mimeType,webViewLink,parents");
        const body = { ...(input.name ? { name: input.name } : {}), ...(input.parentFolderId ? { parents: [rawPathValue(input.parentFolderId)] } : {}) };
        return send(url.toString(), jsonRequest("POST", body));
      }
      case "docs__read_doc":
        url.pathname = `/v1/documents/${pathId("documentId")}`;
        url.searchParams.set("includeTabsContent", "true");
        return send(url.toString(), { method: "GET" });
      case "docs__update_doc": {
        url.pathname = `/v1/documents/${pathId("documentId")}:batchUpdate`;
        const action = input.action;
        const startIndex = input.startIndex as number;
        if (action === "replace" && (input.endIndex as number) <= startIndex) {
          throw failure(422, "google_workspace_arguments_invalid", "The replacement range end must be greater than its start.");
        }
        const tabId = input.tabId ? { tabId: requiredText(input.tabId, "document tab ID") } : {};
        const requests = action === "replace"
          ? [{ deleteContentRange: { range: { startIndex, endIndex: input.endIndex, ...tabId } } }, { insertText: { location: { index: startIndex, ...tabId }, text: input.text } }]
          : [{ insertText: { location: { index: startIndex, ...tabId }, text: input.text } }];
        return send(url.toString(), jsonRequest("POST", { requests, writeControl: { requiredRevisionId: input.requiredRevisionId } }));
      }
      case "calendar__list_calendars":
        url.pathname = "/calendar/v3/users/me/calendarList";
        return send(addParams(url, { pageToken: input.pageToken, maxResults: input.maxResults ?? 50, fields: "nextPageToken,items(id,summary,primary,accessRole,timeZone)" }), { method: "GET" });
      case "calendar__list_events":
        url.pathname = `/calendar/v3/calendars/${pathId("calendarId")}/events`;
        return send(addParams(url, { pageToken: input.pageToken, maxResults: input.maxResults ?? 50, q: input.query,
          timeMin: input.timeMin, timeMax: input.timeMax, singleEvents: true, orderBy: "startTime",
          fields: "nextPageToken,items(id,status,summary,description,location,start,end,htmlLink,etag,organizer,attendees)" }), { method: "GET" });
      case "calendar__get_event":
        url.pathname = `/calendar/v3/calendars/${pathId("calendarId")}/events/${pathId("eventId")}`;
        return send(url.toString(), { method: "GET" });
      case "calendar__create_event":
        url.pathname = `/calendar/v3/calendars/${pathId("calendarId")}/events`;
        url.searchParams.set("sendUpdates", "none");
        return send(url.toString(), jsonRequest("POST", eventResource(input, false)));
      case "calendar__update_event":
        url.pathname = `/calendar/v3/calendars/${pathId("calendarId")}/events/${pathId("eventId")}`;
        url.searchParams.set("sendUpdates", "none");
        return send(url.toString(), { ...jsonRequest("PATCH", eventResource(input, true)), headers: { "Content-Type": "application/json", "If-Match": safeHeaderText(input.etag, "event revision") } }, {}, {
          412: { conflict: true, message: "This Calendar event changed since it was read. Read it again before updating." },
        });
      case "calendar__delete_event":
        url.pathname = `/calendar/v3/calendars/${pathId("calendarId")}/events/${pathId("eventId")}`;
        url.searchParams.set("sendUpdates", "none");
        return send(url.toString(), { method: "DELETE", headers: { "If-Match": safeHeaderText(input.etag, "event revision") } }, {}, {
          412: { conflict: true, message: "This Calendar event changed since it was read. Read it again before deleting." },
        });
      default:
        throw failure(404, "google_workspace_tool_not_found", "Google Workspace action not found.");
    }
  }

  return { execute };
}

type Binding = { companyId: string; agentId: string | null; runId?: string | null; responsibleUserId?: string | null };
type Connection = { companyId: string; transport?: string; config: Record<string, unknown> };
export async function executeGoogleWorkspaceApiTool(input: {
  binding: Binding; connection: Connection; headers: Record<string, string>; request: NativeRestRequest;
  toolName: string; parameters: unknown; grantedScopes?: readonly string[]; signal?: AbortSignal; deadlineAt?: number;
}) {
  if (!input.binding.agentId || input.connection.companyId !== input.binding.companyId || input.connection.transport !== "rest_api"
    || !isGoogleWorkspaceApiConnection({ ...input.connection, transport: input.connection.transport ?? "" }) || !googleNativeConnectionAllows(input.connection, input.toolName)) {
    throw failure(404, "google_workspace_connection_not_found", "Connection not found.");
  }
  const operation = byName.get(input.toolName);
  if (!operation || !contract.validate(operation.name, input.parameters)) {
    throw failure(422, "google_workspace_arguments_invalid", "Invalid Google Workspace action arguments.");
  }
  if (!input.grantedScopes?.length || !isGoogleWorkspaceToolGranted(operation.name, input.grantedScopes)) {
    throw failure(403, "google_workspace_scope_denied", "This Google Workspace action is not covered by the connected account’s granted scopes.");
  }
  return googleWorkspaceApiClient(input.headers, input.request, input.grantedScopes, input.signal, input.deadlineAt)
    .execute(operation.name, record(input.parameters));
}

export async function probeGoogleWorkspaceApi(connection: { transport: string; config?: Record<string, unknown> }, headers: Record<string, string>, request: NativeRestRequest,
  options?: { grantedScopes?: readonly string[]; signal?: AbortSignal; deadlineAt?: number }) {
  if (!isGoogleWorkspaceApiConnection(connection)) throw failure(404, "google_workspace_connection_not_found", "Connection not found.");
  const scopes = options?.grantedScopes ?? [];
  if (!scopes.length) throw failure(403, "google_workspace_scope_missing", "Reconnect Google Workspace and grant a read scope for a supported service.");
  const client = googleWorkspaceApiClient(headers, request, scopes, options?.signal, options?.deadlineAt);
  if (scopes.includes("https://www.googleapis.com/auth/gmail.readonly") && googleNativeConnectionAllows(connection, "gmail__list_labels")) {
    const response = await client.execute("gmail__list_labels", {});
    const labels = record(response).labels;
    return { service: "gmail", authenticated: true, labelsReturned: Array.isArray(labels) ? labels.length : 0 };
  }
  if (scopes.includes("https://www.googleapis.com/auth/drive.readonly") && googleNativeConnectionAllows(connection, "drive__search_files")) {
    const response = await client.execute("drive__search_files", { query: "trashed = true", pageSize: 1 });
    const files = record(response).files;
    return { service: "drive", authenticated: true, sampleCount: Array.isArray(files) ? files.length : 0 };
  }
  if (scopes.includes("https://www.googleapis.com/auth/calendar.calendarlist.readonly") && googleNativeConnectionAllows(connection, "calendar__list_calendars")) {
    const response = await client.execute("calendar__list_calendars", { maxResults: 1 });
    const items = record(response).items;
    return { service: "calendar", authenticated: true, sampleCount: Array.isArray(items) ? items.length : 0 };
  }
  if (googleNativeConnectionAllows(connection,"docs__read_doc") && (scopes.includes("https://www.googleapis.com/auth/documents.readonly") || scopes.includes("https://www.googleapis.com/auth/documents"))) {
    return { service: "docs", verified: "consent_only", providerRequestVerified: false };
  }
  const grantedOperation = OPERATIONS.find((operation) => googleNativeConnectionAllows(connection, operation.name) && isGoogleWorkspaceToolGranted(operation.name, scopes));
  if (grantedOperation) {
    const service = googleWorkspaceToolTarget(grantedOperation.name)?.service ?? "workspace";
    return { service, verified: "consent_only", providerRequestVerified: false };
  }
  throw failure(422, "google_workspace_scope_missing", "Reconnect Google Workspace and grant a read scope for Gmail, Drive, or Calendar.");
}
