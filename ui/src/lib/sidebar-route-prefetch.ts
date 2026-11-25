import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

const PREFETCH_STALE_TIME = 30_000;

/**
 * Warm only the page the user has expressed intent to open. The destination
 * module and the small set of data shared with that page are scoped to the
 * currently selected company; no route or tenant is prefetched speculatively.
 */
export function prefetchSidebarRoute(
  to: string,
  companyId: string | null,
  queryClient: QueryClient,
): void {
  const path = to.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") || "/";
  const tasks: Promise<unknown>[] = [];

  switch (path) {
    case "/dashboard":
      tasks.push(import("../pages/Dashboard"));
      if (companyId) {
        tasks.push(queryClient.prefetchQuery({
          queryKey: queryKeys.dashboard(companyId),
          queryFn: async () => (await import("../api/dashboard")).dashboardApi.summary(companyId),
          staleTime: PREFETCH_STALE_TIME,
        }));
        tasks.push(prefetchAgents(companyId, queryClient));
      }
      break;
    case "/issues":
      tasks.push(import("../pages/Issues"));
      if (companyId) {
        tasks.push(prefetchAgents(companyId, queryClient));
        tasks.push(queryClient.prefetchQuery({
          queryKey: queryKeys.projects.list(companyId, { includeArchived: true }),
          queryFn: async () => (await import("../api/projects")).projectsApi.list(companyId, { includeArchived: true }),
          staleTime: PREFETCH_STALE_TIME,
        }));
      }
      break;
    case "/agents":
    case "/org":
      tasks.push(import("../pages/Agents"));
      if (companyId) {
        tasks.push(prefetchAgents(companyId, queryClient));
        tasks.push(queryClient.prefetchQuery({
          queryKey: queryKeys.org(companyId),
          queryFn: async () => (await import("../api/agents")).agentsApi.org(companyId),
          staleTime: PREFETCH_STALE_TIME,
        }));
      }
      break;
    case "/apps":
      tasks.push(import("../pages/apps/Browse"));
      if (companyId) {
        tasks.push(queryClient.prefetchQuery({
          queryKey: queryKeys.apps.gallery(companyId),
          queryFn: async () => (await import("../api/tools")).toolsApi.listGallery(companyId),
          staleTime: PREFETCH_STALE_TIME,
        }));
      }
      break;
    case "/search":
      tasks.push(import("../pages/Search"));
      break;
    case "/inbox":
      tasks.push(import("../pages/Inbox"));
      break;
    case "/projects":
      tasks.push(import("../pages/Projects"));
      break;
    case "/workspaces":
      tasks.push(import("../pages/Workspaces"));
      break;
    case "/routines":
      tasks.push(import("../pages/Routines"));
      break;
    case "/goals":
      tasks.push(import("../pages/Goals"));
      break;
    case "/artifacts":
      tasks.push(import("../pages/Artifacts"));
      break;
    case "/skills":
      tasks.push(import("../pages/CompanySkills"));
      break;
    case "/timeline":
      tasks.push(import("../pages/audit/AuditHub"));
      break;
    case "/activity":
      tasks.push(import("../pages/audit/CompanyActivity"));
      break;
    case "/costs":
      tasks.push(import("../pages/audit/AuditHub"));
      break;
    default:
      return;
  }

  // Prefetch failures are cached by QueryClient and retried by the destination
  // page. An intent hint must never interfere with navigation itself.
  void Promise.allSettled(tasks);
}

function prefetchAgents(companyId: string, queryClient: QueryClient) {
  return queryClient.prefetchQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: async () => (await import("../api/agents")).agentsApi.list(companyId),
    staleTime: PREFETCH_STALE_TIME,
  });
}
