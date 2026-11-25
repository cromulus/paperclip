import type { QueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { agentChatsApi } from "@/api/agentChats";
import { queryKeys } from "@/lib/queryKeys";

function cachedSessionUserId(queryClient: QueryClient): string | null {
  const session = queryClient.getQueryData<{ user?: { id?: string | null } | null; session?: { userId?: string | null } | null }>(queryKeys.auth.session);
  return session?.user?.id ?? session?.session?.userId ?? null;
}

/** Prefetch only an explicitly intended, company-scoped teammate chat. */
export function prefetchAgentChatBootstrap(
  queryClient: QueryClient,
  companyId: string | null,
  userId: string | null | undefined,
  agent: Agent,
): void {
  if (!companyId || !userId || !agent.id || agent.companyId !== companyId) return;
  void import("@/pages/AgentChat").catch(() => undefined);
  void queryClient.prefetchQuery({
    queryKey: queryKeys.agentChats.bootstrap(companyId, userId, agent.id),
    queryFn: async () => {
      if (cachedSessionUserId(queryClient) !== userId) throw new Error("Account changed before chat prefetch.");
      const result = await agentChatsApi.bootstrap(companyId, agent.id);
      if (cachedSessionUserId(queryClient) !== userId) throw new Error("Account changed during chat prefetch.");
      return result;
    },
    staleTime: 30_000,
  }).catch(() => undefined);
}
