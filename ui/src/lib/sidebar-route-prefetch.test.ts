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
vi.mock("../api/tools", () => ({ toolsApi: { listGallery: calls.gallery } }));

import { prefetchSidebarRoute } from "./sidebar-route-prefetch";

describe("sidebar route intent prefetch", () => {
  let client: QueryClient;
  afterEach(() => {
    client?.clear();
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
    prefetchSidebarRoute("/company/settings", "company-a", client);
    prefetchSidebarRoute("/dashboard", null, client);
    await Promise.resolve();
    expect(calls.agents).not.toHaveBeenCalled();
    expect(calls.projects).not.toHaveBeenCalled();
    expect(calls.dashboard).not.toHaveBeenCalled();
    expect(calls.gallery).not.toHaveBeenCalled();
  });
});
