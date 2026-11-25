// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentChatBootstrapResponse } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";
import { AgentChat } from "./AgentChat";

const state = vi.hoisted(() => ({ agentRef: "cos", companyId: "company-a", userId: "user-a" }));

vi.mock("@/lib/router", () => ({
  useParams: () => ({ agentRef: state.agentRef }),
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a>,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("@/hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: state.userId } }) } }));
vi.mock("@/components/AgentAvatar", () => ({ AgentAvatar: () => null }));
vi.mock("@/components/task-chat/TaskChatThreadView", () => ({
  TaskChatThreadView: ({ items }: { items: Array<{ kind: string; text?: string }> }) => (
    <div data-testid="thread">{items.map((item, index) => item.kind === "message" ? <p key={index}>{item.text}</p> : null)}</div>
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});
