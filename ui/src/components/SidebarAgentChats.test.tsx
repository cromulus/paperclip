// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { SidebarAgentChats } from "./SidebarAgentChats";
import { queryKeys } from "@/lib/queryKeys";
import { agentChatsApi } from "@/api/agentChats";

const state = vi.hoisted(() => ({
  companyId: "company-a", userId: "user-a", navigate: vi.fn(), closeSidebar: vi.fn(), list: vi.fn(), bootstrap: vi.fn(),
  onIntentAgent: null as ((agent: { id: string }) => void) | null,
}));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: true, setSidebarOpen: state.closeSidebar }) }));
vi.mock("@/lib/router", () => ({ useLocation: () => ({ pathname: "/A/dashboard" }), useNavigate: () => state.navigate }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: state.list } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: () => ({ user: { id: state.userId } }) } }));
vi.mock("@/api/agentChats", () => ({ agentChatsApi: { list: vi.fn(), get: vi.fn(), ensure: vi.fn(), bootstrap: state.bootstrap } }));
vi.mock("@/hooks/useResourceMemberships", () => ({
  useResourceMemberships: () => ({ data: { starredAgentIds: [] } }),
  useResourceMembershipMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("./AgentChatSidebar", () => ({ AgentChatSidebar: ({ agents, onOpenChat, onIntentAgent }: {
  agents: Agent[]; onOpenChat: () => void; onIntentAgent: (agent: Agent) => void;
}) => {
  state.onIntentAgent = agent => onIntentAgent(agent as Agent);
  return <div>
    {agents.map(agent => <button key={agent.id} data-agent-id={agent.id} onMouseEnter={() => onIntentAgent(agent)} onClick={() => state.navigate(`/chats/${agent.urlKey}`)}>{agent.name}</button>)}
    <button aria-label="Chat with an agent" onClick={onOpenChat}>Chat with an agent</button>
  </div>;
} }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const agentIds: Record<string, string> = {
  alice: "10000000-0000-4000-8000-000000000001",
  "never-visited": "10000000-0000-4000-8000-000000000002",
  bob: "20000000-0000-4000-8000-000000000001",
};
const agent = (key: string, companyId: string) => ({ id: agentIds[key] ?? key, companyId, name: key, urlKey: key, role: "engineer", title: "Engineer", icon: null, status: "idle" } as Agent);
async function render() {
  await act(async () => { root.render(<QueryClientProvider client={client}><SidebarAgentChats /></QueryClientProvider>); });
}
async function openPicker() {
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Chat with an agent"]')!.click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.companyId = "company-a";
  state.userId = "user-a";
  state.navigate.mockClear();
  state.closeSidebar.mockClear();
  state.bootstrap.mockReset().mockResolvedValue({ messages: [], agent: { id: "agent" } });
  state.onIntentAgent = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: "user-a" } });
  client.setQueryData(queryKeys.agents.list("company-a"), [agent("alice", "company-a"), agent("never-visited", "company-a")]);
  client.setQueryData(queryKeys.agents.list("company-b"), [agent("bob", "company-b")]);
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

describe("SidebarAgentChats", () => {
  it("does not fetch on initial render and prefetches only the intended agent by canonical ID", async () => {
    await render();
    expect(state.bootstrap).not.toHaveBeenCalled();

    await act(async () => {
      state.onIntentAgent?.(agent("alice", "company-a"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(agentChatsApi.bootstrap).toHaveBeenCalledOnce();
    expect(agentChatsApi.bootstrap).toHaveBeenCalledWith("company-a", agentIds.alice);
    expect(client.getQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", agentIds.alice))).toEqual({ messages: [], agent: { id: "agent" } });
    expect(client.getQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", agentIds["never-visited"]))).toBeUndefined();
  });

  it("reuses a fresh bootstrap already in the current user and company cache", async () => {
    const key = queryKeys.agentChats.bootstrap("company-a", "user-a", agentIds.alice);
    client.setQueryData(key, { messages: ["warm"] }, { updatedAt: Date.now() });
    await render();
    await act(async () => {
      state.onIntentAgent?.(agent("alice", "company-a"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(state.bootstrap).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual({ messages: ["warm"] });
  });

  it("does not prefetch when the signed-in user identity is unknown", async () => {
    state.userId = "";
    client.setQueryData(queryKeys.auth.session, { user: null, session: null });
    await render();
    await act(async () => {
      state.onIntentAgent?.(agent("alice", "company-a"));
      await Promise.resolve();
    });
    expect(state.bootstrap).not.toHaveBeenCalled();
  });

  it("keeps prefetch caches separated by company and user", async () => {
    await render();
    await act(async () => {
      state.onIntentAgent?.(agent("alice", "company-a"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    state.companyId = "company-b";
    state.userId = "user-b";
    client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" } });
    await render();
    await act(async () => {
      state.onIntentAgent?.(agent("bob", "company-b"));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(state.bootstrap.mock.calls).toEqual([
      ["company-a", agentIds.alice],
      ["company-b", agentIds.bob],
    ]);
    expect(client.getQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", agentIds.alice))).toBeDefined();
    expect(client.getQueryData(queryKeys.agentChats.bootstrap("company-b", "user-b", agentIds.bob))).toBeDefined();
    expect(client.getQueryData(queryKeys.agentChats.bootstrap("company-a", "user-b", agentIds.alice))).toBeUndefined();
  });

  it("discards a bootstrap response if the signed-in user changes while it is in flight", async () => {
    let resolveBootstrap!: (value: { messages: string[] }) => void;
    state.bootstrap.mockImplementationOnce(() => new Promise(resolve => { resolveBootstrap = resolve; }));
    await render();
    await act(async () => {
      state.onIntentAgent?.(agent("alice", "company-a"));
      await Promise.resolve();
    });
    expect(state.bootstrap).toHaveBeenCalledOnce();

    client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" } });
    await act(async () => {
      resolveBootstrap({ messages: ["belongs to previous session"] });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(client.getQueryData(queryKeys.agentChats.bootstrap("company-a", "user-a", agentIds.alice))).toBeUndefined();
  });

  it("keeps a chat row clickable when prefetch fails", async () => {
    state.bootstrap.mockRejectedValueOnce(new Error("offline"));
    await render();
    const aliceRow = container.querySelector<HTMLButtonElement>(`[data-agent-id="${agentIds.alice}"]`)!;
    await act(async () => {
      state.onIntentAgent?.(agent("alice", "company-a"));
      aliceRow.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(state.navigate).toHaveBeenCalledWith("/chats/alice");
  });

  it("opens an unvisited agent from the full roster and closes the mobile sidebar", async () => {
    await render();
    await openPicker();
    const options = [...document.querySelectorAll<HTMLElement>("[role=option]")];
    expect(options).toHaveLength(2);
    await act(async () => options.find((item) => item.textContent?.includes("never-visited"))!.click());
    expect(state.navigate).toHaveBeenCalledWith("/chats/never-visited");
    expect(state.closeSidebar).toHaveBeenCalledWith(false);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("drops the open picker across company and user changes", async () => {
    await render();
    await openPicker();
    state.companyId = "company-b";
    await render();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await openPicker();
    const options = [...document.querySelectorAll("[role=option]")];
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("bob");
    await act(async () => {
      client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector("[role=dialog]")).toBeNull();
    state.companyId = "company-a";
    await render();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
