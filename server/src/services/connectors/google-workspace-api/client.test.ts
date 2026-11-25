import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_WORKSPACE_API_TOOLS,
  executeGoogleWorkspaceApiTool,
  googleWorkspaceApiClient,
  googleWorkspaceApiRisk,
  isCurrentGoogleWorkspaceApiCatalogEntry,
  isGoogleWorkspaceApiConnection,
  isGoogleWorkspaceApiToolName,
  probeGoogleWorkspaceApi,
} from "./client.js";
import type { NativeRestRequest } from "../../native-rest-client.js";

const auth = "Bearer workspace-fixture-secret";
const scopes = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  driveFile: "https://www.googleapis.com/auth/drive.file",
  docsRead: "https://www.googleapis.com/auth/documents.readonly",
  docsWrite: "https://www.googleapis.com/auth/documents",
  calendarList: "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  calendarRead: "https://www.googleapis.com/auth/calendar.events.readonly",
  calendarWrite: "https://www.googleapis.com/auth/calendar.events",
};
const googleConnection = { companyId: "company-a", transport: "rest_api", config: { sourceTemplateKey: "google-workspace", connectionMethodKey: "customer-workspace-api" } };

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}
function requestRecorder(response: Response | (() => Promise<Response>) = jsonResponse({ ok: true })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request: NativeRestRequest = async (url, init) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  return { calls, request };
}
function call(toolName: string, parameters: unknown, grantedScopes: readonly string[], request: NativeRestRequest) {
  return executeGoogleWorkspaceApiTool({
    binding: { companyId: "company-a", agentId: "agent-a" }, connection: googleConnection,
    headers: { Authorization: auth }, request, toolName, parameters, grantedScopes,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Google Workspace native REST catalog", () => {
  it("publishes only the 20 typed, registered Gmail, Drive, Docs, and Calendar operations", () => {
    expect(GOOGLE_WORKSPACE_API_TOOLS).toHaveLength(20);
    expect(GOOGLE_WORKSPACE_API_TOOLS.map(tool => tool.name)).toEqual(expect.arrayContaining([
      "gmail__search_messages", "gmail__get_message", "gmail__get_thread", "gmail__list_drafts", "gmail__get_draft", "gmail__list_labels", "gmail__create_draft",
      "drive__search_files", "drive__get_file_metadata", "drive__read_file_content", "drive__create_file", "drive__copy_file",
      "docs__read_doc", "docs__update_doc", "calendar__list_calendars", "calendar__list_events", "calendar__get_event",
      "calendar__create_event", "calendar__update_event", "calendar__delete_event",
    ]));
    expect(isGoogleWorkspaceApiToolName("gmail__send_message")).toBe(false);
    expect(isGoogleWorkspaceApiToolName("calendar__respond_to_event")).toBe(false);
    expect(googleWorkspaceApiRisk("gmail__create_draft")).toBe("write");
    expect(googleWorkspaceApiRisk("docs__update_doc")).toBe("write");
    expect(googleWorkspaceApiRisk("calendar__delete_event")).toBe("destructive");
    const listing = GOOGLE_WORKSPACE_API_TOOLS.find(tool => tool.name === "gmail__search_messages")!;
    expect(isCurrentGoogleWorkspaceApiCatalogEntry({ toolName: listing.name, versionHash: "wrong", schemaHash: null, riskLevel: "read" })).toBe(false);
  });

  it("requires the reviewed native connection identity", () => {
    expect(isGoogleWorkspaceApiConnection(googleConnection)).toBe(true);
    expect(isGoogleWorkspaceApiConnection({ ...googleConnection, transport: "mcp_remote" })).toBe(false);
    expect(isGoogleWorkspaceApiConnection({ transport: "rest_api", config: { sourceTemplateKey: "another" } })).toBe(false);
    expect(isGoogleWorkspaceApiConnection({ transport: "rest_api", config: { sourceTemplateKey: "google-workspace", connectionMethodKey: "paperclip-workspace" } })).toBe(false);
  });

  it("encodes Gmail search on the fixed Google API host and does not expose caller headers", async () => {
    const p = requestRecorder(jsonResponse({ messages: [{ id: "m1", threadId: "t1" }] }));
    await expect(call("gmail__search_messages", { query: "from:alice@example.com is:unread", maxResults: 10 }, [scopes.gmailRead], p.request))
      .resolves.toEqual({ messages: [{ id: "m1", threadId: "t1" }] });
    const sent = p.calls[0]!;
    expect(new URL(sent.url).origin).toBe("https://gmail.googleapis.com");
    expect(new URL(sent.url).pathname).toBe("/gmail/v1/users/me/messages");
    expect(new URL(sent.url).searchParams.get("q")).toBe("from:alice@example.com is:unread");
    expect(sent.init.method).toBe("GET");
    expect(new Headers(sent.init.headers).get("authorization")).toBe(auth);
    expect(Object.keys(sent.init.headers as Record<string, string>)).toEqual(["authorization"]);
  });

  it("fails closed on missing grants, unregistered names, extra fields, and traversal IDs before networking", async () => {
    const p = requestRecorder();
    await expect(call("gmail__search_messages", { query: "in:anywhere", url: "https://attacker.invalid" }, [scopes.gmailRead], p.request)).rejects.toMatchObject({ status: 422 });
    await expect(call("gmail__search_messages", { query: "in:anywhere" }, [], p.request)).rejects.toMatchObject({ status: 403 });
    await expect(call("drive__delete_file", { fileId: "x" }, [scopes.driveFile], p.request)).rejects.toMatchObject({ status: 422 });
    await expect(call("drive__get_file_metadata", { fileId: "../outside" }, [scopes.driveRead], p.request)).rejects.toMatchObject({ status: 422 });
    expect(p.calls).toHaveLength(0);
  });

  it("makes provider 403s actionable without telling users to reauthorize on API enablement errors", async () => {
    const p = requestRecorder(jsonResponse({ error: { status: "PERMISSION_DENIED", message: "Service disabled" } }, 403));
    await expect(call("gmail__list_labels", {}, [scopes.gmailRead], p.request)).rejects.toMatchObject({
      status: 403,
      message: "Google denied access. Check that this API is enabled in your Google Cloud project and that the connected account granted the required permission.",
    });
  });

  it("creates an unsent RFC 2822 draft and never calls Gmail send", async () => {
    const p = requestRecorder(jsonResponse({ id: "draft-1", message: { id: "message-1" } }));
    await call("gmail__create_draft", { to: ["alex@example.com"], subject: "Quarterly plan ✓", bodyText: "A draft only." }, [scopes.gmailCompose], p.request);
    expect(p.calls).toHaveLength(1);
    const sent = p.calls[0]!;
    expect(sent.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/drafts");
    expect(sent.init.method).toBe("POST");
    const raw = JSON.parse(String(sent.init.body)).message.raw;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: alex@example.com");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain(Buffer.from("A draft only.").toString("base64"));
    expect(sent.url).not.toContain("send");
  });

  it("uses bounded Drive search and creates metadata-only files with one selected parent", async () => {
    const search = requestRecorder(jsonResponse({ files: [] }));
    await call("drive__search_files", { query: "name contains 'brief'", pageSize: 5 }, [scopes.driveRead], search.request);
    const searchUrl = new URL(search.calls[0]!.url);
    expect(searchUrl.origin).toBe("https://www.googleapis.com");
    expect(searchUrl.pathname).toBe("/drive/v3/files");
    expect(searchUrl.searchParams.get("pageSize")).toBe("5");
    expect(searchUrl.searchParams.get("fields")).toContain("nextPageToken");

    const create = requestRecorder(jsonResponse({ id: "doc-1" }));
    await call("drive__create_file", { name: "Brief", mimeType: "application/vnd.google-apps.document", parentFolderId: "folder-1" }, [scopes.driveFile], create.request);
    const createBody = JSON.parse(String(create.calls[0]!.init.body));
    expect(create.calls[0]!.url).toBe("https://www.googleapis.com/drive/v3/files?fields=id%2Cname%2CmimeType%2CwebViewLink%2Cparents");
    expect(createBody).toEqual({ name: "Brief", mimeType: "application/vnd.google-apps.document", parents: ["folder-1"] });
  });

  it("pins Docs replacement to the supplied document revision", async () => {
    const p = requestRecorder(jsonResponse({ documentId: "doc-1", replies: [] }));
    await call("docs__update_doc", { documentId: "doc-1", action: "replace", startIndex: 5, endIndex: 12, text: "new text", requiredRevisionId: "revision-7" }, [scopes.docsWrite], p.request);
    expect(p.calls[0]!.url).toBe("https://docs.googleapis.com/v1/documents/doc-1:batchUpdate");
    const body = JSON.parse(String(p.calls[0]!.init.body));
    expect(body.writeControl).toEqual({ requiredRevisionId: "revision-7" });
    expect(body.requests).toEqual([
      { deleteContentRange: { range: { startIndex: 5, endIndex: 12 } } },
      { insertText: { location: { index: 5 }, text: "new text" } },
    ]);
    await expect(call("docs__update_doc", { documentId: "doc-1", action: "replace", startIndex: 12, endIndex: 4, text: "x", requiredRevisionId: "rev" }, [scopes.docsWrite], p.request)).rejects.toMatchObject({ status: 422 });
  });

  it("paginates Calendar reads and keeps update/delete scoped with ETags and guest notifications off", async () => {
    const read = requestRecorder(jsonResponse({ items: [] }));
    await call("calendar__list_events", { calendarId: "primary", timeMin: "2026-11-24T00:00:00Z", maxResults: 10 }, [scopes.calendarRead], read.request);
    const readUrl = new URL(read.calls[0]!.url);
    expect(readUrl.origin).toBe("https://www.googleapis.com");
    expect(readUrl.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(readUrl.searchParams.get("singleEvents")).toBe("true");
    expect(readUrl.searchParams.get("maxResults")).toBe("10");

    const update = requestRecorder(jsonResponse({ id: "event-1" }));
    await call("calendar__update_event", { calendarId: "primary", eventId: "event-1", etag: "etag-v3", summary: "Revised" }, [scopes.calendarWrite], update.request);
    expect(update.calls[0]!.init.method).toBe("PATCH");
    expect(new URL(update.calls[0]!.url).searchParams.get("sendUpdates")).toBe("none");
    expect(new Headers(update.calls[0]!.init.headers).get("If-Match")).toBe("etag-v3");
    expect(JSON.parse(String(update.calls[0]!.init.body))).toEqual({ summary: "Revised" });

    const deletion = requestRecorder(new Response(null, { status: 204 }));
    await call("calendar__delete_event", { calendarId: "primary", eventId: "event-1", etag: "etag-v3" }, [scopes.calendarWrite], deletion.request);
    expect(deletion.calls[0]!.init.method).toBe("DELETE");
    expect(new URL(deletion.calls[0]!.url).searchParams.get("sendUpdates")).toBe("none");
    expect(new Headers(deletion.calls[0]!.init.headers).get("If-Match")).toBe("etag-v3");
  });

  it("does not retry ambiguous writes and redacts credentials from provider JSON", async () => {
    const failed = requestRecorder(async () => { throw new Error(auth); });
    await expect(call("gmail__create_draft", { to: ["a@example.com"], subject: "x", bodyText: "y" }, [scopes.gmailCompose], failed.request))
      .rejects.toMatchObject({ status: 502 });
    expect(failed.calls).toHaveLength(1);

    const p = requestRecorder(jsonResponse({ error: `invalid token ${auth.slice(7)}` }));
    const result = await call("gmail__list_labels", {}, [scopes.gmailRead], p.request);
    expect(JSON.stringify(result)).not.toContain(auth.slice(7));
    expect(JSON.stringify(result)).toContain("[REDACTED]");
  });

  it("bounds stalled requests and verifies consent-only scopes without inventing a health call", async () => {
    const stalled = googleWorkspaceApiClient({ Authorization: auth }, async () => new Promise<Response>(() => {}), [scopes.gmailRead], AbortSignal.timeout(5), Date.now() + 50);
    await expect(stalled.execute("gmail__list_labels", {})).rejects.toMatchObject({ status: 504 });

    const p = requestRecorder();
    await expect(probeGoogleWorkspaceApi(googleConnection, { Authorization: auth }, p.request))
      .rejects.toMatchObject({ status: 403 });
    await expect(probeGoogleWorkspaceApi(googleConnection, { Authorization: auth }, p.request, { grantedScopes: [scopes.docsRead] }))
      .resolves.toEqual({ service: "docs", verified: "consent_only", providerRequestVerified: false });
    await expect(probeGoogleWorkspaceApi(googleConnection, { Authorization: auth }, p.request, { grantedScopes: [scopes.gmailCompose] }))
      .resolves.toEqual({ service: "gmail", verified: "consent_only", providerRequestVerified: false });
    await expect(probeGoogleWorkspaceApi(googleConnection, { Authorization: auth }, p.request, { grantedScopes: [scopes.driveFile] }))
      .resolves.toEqual({ service: "drive", verified: "consent_only", providerRequestVerified: false });
    expect(p.calls).toHaveLength(0);
  });
});
