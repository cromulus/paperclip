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

const state = vi.hoisted(() => ({ agentRef: "cos", companyId: "company-a", userId: "user-a", liveHandler: null as ((event: import("@paperclipai/shared").LiveEvent) => void) | null }));

vi.mock("@/lib/router", () => ({
  useParams: () => ({ agentRef: state.agentRef }),
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a>,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
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

    state.agentRef = "finance";
    await render();
    expect(container.querySelector('[data-testid="agent-chat-title"]')?.textContent).toBe("Finance Operations");
    expect(container.textContent).toContain("Finance cached note");
    expect(container.textContent).not.toContain("CoS cached note");
    expect(container.querySelector('[data-testid="agent-chat-fast-path"]')).not.toBeNull();
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
