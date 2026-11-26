import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const calls = vi.hoisted(() => ({
  agents: vi.fn(async (_companyId: string) => [{ id: "agent" }]),
  org: vi.fn(async (_companyId: string) => ({ agents: [] })),
  projects: vi.fn(async (_companyId: string, _options: { includeArchived: boolean }) => []),
  dashboard: vi.fn(async (_companyId: string) => ({ summary: true })),
  gallery: vi.fn(async (_companyId: string) => ({ apps: [] })),
}));

vi.mock("../api/agents", () => ({ agentsApi: { list: calls.agents, org: calls.org } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: calls.projects } }));
vi.mock("../api/dashboard", () => ({ dashboardApi: { summary: calls.dashboard } }));
vi.mock("../api/tools", async () => {
  const actual = await vi.importActual<typeof import("../api/tools")>("../api/tools");
  return { ...actual, toolsApi: { ...actual.toolsApi, listGallery: calls.gallery } };
});

import { prefetchSidebarRoute } from "./sidebar-route-prefetch";
import { queryKeys } from "./queryKeys";

describe("sidebar route intent prefetch", () => {
  let client: QueryClient;
  afterEach(() => {
    client?.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prefetches only the selected destination's company-scoped data once", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    prefetchSidebarRoute("/issues", "company-a", client);
    await vi.waitFor(() => expect(calls.projects).toHaveBeenCalledTimes(1));

    expect(calls.agents).toHaveBeenCalledOnce();
    expect(calls.agents).toHaveBeenCalledWith("company-a");
    expect(calls.projects).toHaveBeenCalledWith("company-a", { includeArchived: true });
    expect(calls.dashboard).not.toHaveBeenCalled();
    expect(calls.gallery).not.toHaveBeenCalled();
    expect(client.getQueryData(["agents", "company-a"])).toEqual([{ id: "agent" }]);
  });

  it("does not fetch data for unsupported routes or without a selected company", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    prefetchSidebarRoute("/company/settings", "company-a", client);
    prefetchSidebarRoute("/dashboard", null, client);
    prefetchSidebarRoute("/apps", null, client);
    await Promise.resolve();
    expect(calls.agents).not.toHaveBeenCalled();
    expect(calls.projects).not.toHaveBeenCalled();
    expect(calls.dashboard).not.toHaveBeenCalled();
    expect(calls.gallery).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("prefetches all Apps landing metadata in parallel under the destination query keys", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://paperclip.test").pathname;
      const body = path.endsWith("/tools/applications") ? { applications: [] }
        : path.endsWith("/tools/connections") ? { connections: [] }
          : path.endsWith("/chat-endpoints") ? [] : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetcher);
    prefetchSidebarRoute("/apps", "company-a", client);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));

    expect(calls.gallery).toHaveBeenCalledWith("company-a");
    expect(calls.gallery).toHaveBeenCalledOnce();
    const paths = fetcher.mock.calls.map(([input]) => new URL(String(input), "http://paperclip.test").pathname);
    expect(paths).toContain("/api/companies/company-a/tools/applications");
    expect(paths).toContain("/api/companies/company-a/tools/connections");
    expect(paths).toContain("/api/companies/company-a/chat-endpoints");
    expect(client.getQueryData(queryKeys.apps.gallery("company-a"))).toEqual({ apps: [] });
    expect(client.getQueryData(queryKeys.tools.applications("company-a"))).toEqual({ applications: [] });
    expect(client.getQueryData(queryKeys.tools.connections("company-a"))).toEqual({ connections: [] });
    expect(client.getQueryData(queryKeys.chatEndpoints.list("company-a"))).toEqual([]);
  });
});
