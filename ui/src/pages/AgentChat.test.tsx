// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatBootstrapResponse } from "@paperclipai/shared";
import { agentChatsApi } from "@/api/agentChats";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { AgentChat } from "./AgentChat";
import { shouldRefreshAgentChatForLiveEvent } from "./AgentChatFastPath";

const state = vi.hoisted(() => ({ agentRef: "cos", companyId: "company-a", userId: "user-a", setBreadcrumbs: vi.fn(), navigate: vi.fn(), liveHandler: null as ((event: import("@paperclipai/shared").LiveEvent) => void) | null }));

vi.mock("@/lib/router", () => ({
  useParams: () => ({ agentRef: state.agentRef }),
  useNavigate: () => state.navigate,
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a>,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: state.setBreadcrumbs }) }));
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: state.userId } }) } }));
vi.mock("@/api/agentChats", () => ({ agentChatsApi: { list: vi.fn(), get: vi.fn(), ensure: vi.fn(), bootstrap: vi.fn() } }));
vi.mock("@/api/issues", () => ({ issuesApi: { addComment: vi.fn() } }));
vi.mock("@/context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: (handler: typeof state.liveHandler) => { state.liveHandler = handler; } }));
vi.mock("@/components/AgentAvatar", () => ({ AgentAvatar: () => null }));
vi.mock("@/components/task-chat/TaskChatThreadView", () => ({
  TaskChatThreadView: ({ items, historyControl }: { items: Array<{ kind: string; text?: string }>; historyControl?: React.ReactNode }) => (
    <div data-testid="thread">{historyControl}{items.map((item, index) => item.kind === "message" ? <p key={index}>{item.text}</p> : null)}</div>
  ),
}));
vi.mock("@/components/transcript/useLiveRunTranscripts", () => ({ useLiveRunTranscripts: () => ({ transcriptByRun: new Map() }) }));
vi.mock("@/components/transcript/useNativeRunTranscripts", () => ({ useNativeRunTranscripts: () => ({ transcriptByRun: new Map() }) }));

function bootstrap(agentId: string, message: string): AgentChatBootstrapResponse {
  const now = new Date("2026-11-24T12:00:00Z");
  return {
    agent: { id: agentId, name: agentId === "cos" ? "Chief of Staff" : "Finance Operations", title: null, icon: null, role: "assistant", status: "idle", adapterType: "codex_local" },
    chat: { id: "chat-" + agentId, identifier: null, title: "Chat", status: "in_review", conversationState: "active", conversationSessionGeneration: 0, executionRunId: null, updatedAt: now },
    messages: [{ id: "message-" + agentId, companyId: "company-a", issueId: "chat-" + agentId, authorType: "user", authorAgentId: null, authorUserId: "user-a", body: message, presentation: null, metadata: null, createdAt: now, updatedAt: now }],
    page: { limit: 30, hasOlder: false, olderCursor: null, latestCommentId: "message-" + agentId, latestCommentAt: now },
    sendGuard: { enabled: true, disabledReason: null, resetAllowed: false, pendingInteractionCount: 0 },
    pendingInteractions: [], pendingInteractionsTruncated: false,
    activeRun: null,
    queue: null,
  };
}

let client: QueryClient;
let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><AgentChat /></QueryClientProvider>);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.agentRef = "cos";
  state.companyId = "company-a";
  state.userId = "user-a";
  state.setBreadcrumbs.mockClear();
  state.navigate.mockClear();
  vi.mocked(agentChatsApi.ensure).mockClear();
  vi.mocked(issuesApi.addComment).mockClear();
  vi.mocked(agentChatsApi.bootstrap).mockClear();
  state.liveHandler = null;
  sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(agentChatsApi.bootstrap).mockImplementation(() => new Promise(() => {}));
  client.setQueryData(queryKeys.auth.session, { user: { id: "user-a" } });
  client.setQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", "cos"), bootstrap("cos", "CoS cached note"));
  client.setQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", "finance"), bootstrap("finance", "Finance cached note"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.unstubAllGlobals();
});

describe("lightweight Agent Chat route", () => {
  it("ensures a standing chat on explicit attachments click, then opens Details without sending or waking", async () => {
    const withoutChat = bootstrap("cos", "");
    withoutChat.chat = null;
    client.setQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", "cos"), withoutChat);
    const ensured = {
      id: "ensured-chat",
      identifier: "PAP-42",
      title: "Chief of Staff conversation",
      status: "open",
      conversationState: "idle",
      conversationSessionGeneration: 0,
      executionRunId: null,
      updatedAt: new Date("2026-11-24T12:00:00Z"),
    };
    let resolveEnsure!: (issue: typeof ensured) => void;
    vi.mocked(agentChatsApi.ensure).mockImplementationOnce(() => new Promise(resolve => { resolveEnsure = resolve as (issue: typeof ensured) => void; }));
    await render();

    const textarea = container.querySelector("textarea")!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(textarea, "Keep this draft while I open attachments");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const attachmentsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open attachments and task tools"]',
    )!;
    await act(async () => {
      attachmentsButton.click();
      attachmentsButton.click();
    });

    expect(agentChatsApi.ensure).toHaveBeenCalledOnce();
    expect(agentChatsApi.ensure).toHaveBeenCalledWith("company-a", "cos");
    expect(textarea.value).toBe("Keep this draft while I open attachments");
    await act(async () => {
      resolveEnsure(ensured);
      await Promise.resolve();
    });
    expect(state.navigate).toHaveBeenCalledWith("/issues/ensured-chat");
    expect(textarea.value).toBe("Keep this draft while I open attachments");
    expect(issuesApi.addComment).not.toHaveBeenCalled();
    expect(agentChatsApi.ensure).toHaveBeenCalledOnce();
  });

  it("keeps the draft and stays on chat when ensuring Details fails", async () => {
    const withoutChat = bootstrap("cos", "");
    withoutChat.chat = null;
    client.setQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", "cos"), withoutChat);
    vi.mocked(agentChatsApi.ensure).mockRejectedValueOnce(new Error("Chat could not be created"));
    await render();
    const textarea = container.querySelector("textarea")!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(textarea, "Keep this draft after an error");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open attachments and task tools"]')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(agentChatsApi.ensure).toHaveBeenCalledOnce();
    expect(issuesApi.addComment).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Keep this draft after an error");
    expect(container.textContent).toContain("Chat could not be created");
  });

  it("refreshes the bootstrap for new comments and run lifecycle, scoped to this chat", () => {
    const event = (type: string, payload: Record<string, unknown>) => ({
      id: 1, companyId: "company-a", type, createdAt: "2026-11-24T12:00:00Z", payload,
    }) as import("@paperclipai/shared").LiveEvent;
    expect(shouldRefreshAgentChatForLiveEvent(event("activity.logged", {
      entityType: "issue", entityId: "chat-cos", action: "issue.comment_added",
    }), "chat-cos")).toBe(true);
    expect(shouldRefreshAgentChatForLiveEvent(event("heartbeat.run.queued", { issueId: "chat-cos" }), "chat-cos")).toBe(true);
    expect(shouldRefreshAgentChatForLiveEvent(event("heartbeat.run.status", { issueId: "other-chat" }), "chat-cos")).toBe(false);
    expect(shouldRefreshAgentChatForLiveEvent(event("heartbeat.run.log", { issueId: "chat-cos" }), "chat-cos")).toBe(false);
    expect(shouldRefreshAgentChatForLiveEvent(event("activity.logged", {
      entityType: "issue", entityId: "other-chat", action: "issue.comment_added",
    }), "chat-cos")).toBe(false);
    expect(shouldRefreshAgentChatForLiveEvent(event("activity.logged", {
      entityType: "issue", entityId: "chat-cos", action: "issue.comment_added",
    }), null)).toBe(false);
  });

  it("invalidates only the current conversation bootstrap on a matching live comment", async () => {
    await render();
    const key = queryKeys.agentChats.bootstrap("company-a", "user-a", "cos");
    await act(async () => {
      state.liveHandler?.({ id: 2, companyId: "company-a", type: "activity.logged", createdAt: "2026-11-24T12:00:00Z", payload: {
        entityType: "issue", entityId: "chat-cos", action: "issue.comment_added",
      } });
      await Promise.resolve();
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.agentChats.bootstrap("company-a", "user-a", "finance"))?.isInvalidated).toBe(false);
  });

  it("hides the older-history control when a previous page exhausted its cursor", async () => {
    const noOlder = bootstrap("cos", "CoS cached note");
    noOlder.page.olderCursor = "last-item-but-no-older-page";
    client.setQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", "cos"), noOlder);
    await render();
    expect(container.textContent).not.toContain("Load earlier messages");
  });

  it("paints the warm target conversation immediately and switches without carrying prior-agent text", async () => {
    await render();
    expect(container.querySelector('[data-testid="agent-chat-title"]')?.textContent).toBe("Chief of Staff");
    expect(container.textContent).toContain("CoS cached note");
    expect(container.textContent).not.toContain("Finance cached note");
    expect(state.setBreadcrumbs).toHaveBeenLastCalledWith([{ label: "Chief of Staff" }]);

    state.agentRef = "finance";
    await render();
    expect(container.querySelector('[data-testid="agent-chat-title"]')?.textContent).toBe("Finance Operations");
    expect(container.textContent).toContain("Finance cached note");
    expect(container.textContent).not.toContain("CoS cached note");
    expect(container.querySelector('[data-testid="agent-chat-fast-path"]')).not.toBeNull();
    expect(state.setBreadcrumbs).toHaveBeenLastCalledWith([{ label: "Finance Operations" }]);
  });

  it("does not reuse conversation cache across user or company scopes", async () => {
    state.userId = "user-b";
    client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" } });
    await render();
    expect(container.textContent).not.toContain("CoS cached note");
    expect(container.textContent).not.toContain("Finance cached note");
    expect(container.textContent).toContain("Opening conversation");

    state.userId = "user-a";
    state.companyId = "company-b";
    client.setQueryData(queryKeys.auth.session, { user: { id: "user-a" } });
    await render();
    expect(container.textContent).not.toContain("CoS cached note");
    expect(container.textContent).not.toContain("Finance cached note");
  });

  it("keeps a cold route bootstrap key stable when the agent directory resolves later", async () => {
    client.removeQueries({ queryKey: queryKeys.agentChats.bootstrap("company-a", "user-a", "cos") });
    await render();
    expect(agentChatsApi.bootstrap).toHaveBeenCalledOnce();
    expect(agentChatsApi.bootstrap).toHaveBeenCalledWith("company-a", "cos");

    client.setQueryData(queryKeys.agents.list("company-a"), [{
      id: "canonical-cos-id", companyId: "company-a", name: "Chief of Staff", urlKey: "cos",
      role: "assistant", title: null, icon: null, status: "idle",
    } as never]);
    await render();

    expect(agentChatsApi.bootstrap).toHaveBeenCalledOnce();
  });

  it("resolves the same route slug against the new company and user scope", async () => {
    const makeAgent = (id: string, companyId: string) => ({
      id, companyId, name: "Chief of Staff", urlKey: "cos", role: "assistant", title: null, icon: null, status: "idle",
    });
    client.setQueryData(queryKeys.agents.list("company-a"), [makeAgent("company-a-cos-id", "company-a") as never]);
    client.removeQueries({ queryKey: queryKeys.agentChats.bootstrap("company-a", "user-a", "company-a-cos-id") });
    await render();
    expect(agentChatsApi.bootstrap).toHaveBeenCalledWith("company-a", "company-a-cos-id");

    state.companyId = "company-b";
    state.userId = "user-b";
    client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" } });
    client.setQueryData(queryKeys.agents.list("company-b"), [makeAgent("company-b-cos-id", "company-b") as never]);
    client.removeQueries({ queryKey: queryKeys.agentChats.bootstrap("company-b", "user-b", "company-b-cos-id") });
    await render();

    expect(agentChatsApi.bootstrap).toHaveBeenNthCalledWith(1, "company-a", "company-a-cos-id");
    expect(agentChatsApi.bootstrap).toHaveBeenNthCalledWith(2, "company-b", "company-b-cos-id");
  });

  it("locks the composer during guard verification and preserves the reviewed draft", async () => {
    let resolveGuard!: (value: AgentChatBootstrapResponse) => void;
    await render();
    vi.mocked(agentChatsApi.bootstrap).mockImplementationOnce(() => new Promise(resolve => { resolveGuard = resolve; }));

    const textarea = container.querySelector("textarea")!;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      valueSetter.call(textarea, "Please review this change");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea.value).toBe("Please review this change");

    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(textarea.disabled).toBe(true);

    const accepted = { ...bootstrap("cos", "CoS cached note").messages[0], id: "accepted-message", body: "Please review this change" };
    vi.mocked(issuesApi.addComment).mockResolvedValue(accepted as never);
    await act(async () => {
      resolveGuard(bootstrap("cos", "CoS cached note"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe("");
    expect(issuesApi.addComment).toHaveBeenCalledOnce();
  });
});
