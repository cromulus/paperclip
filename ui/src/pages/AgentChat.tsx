import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { agentChatsApi } from "@/api/agentChats";
import { authApi } from "@/api/auth";
import { useCompany } from "@/context/CompanyContext";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { recordAgentChatVisit } from "@/lib/recent-agent-chats";
import { queryKeys } from "@/lib/queryKeys";
import { useParams } from "@/lib/router";
import { agentRouteRef } from "@/lib/utils";
import { AgentChatFastPath } from "./AgentChatFastPath";

export function AgentChat() {
  const { agentRef = "" } = useParams<{ agentRef: string }>();
  const { selectedCompanyId } = useCompany();
  const { enabled, loaded } = useAgentChatEnabled();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const cachedAgents = selectedCompanyId
    ? client.getQueryData<Agent[]>(queryKeys.agents.list(selectedCompanyId)) ?? []
    : [];
  const cachedAgent = cachedAgents.find(agent =>
    agent.id === agentRef || agentRouteRef(agent) === agentRef,
  );
  const bootstrapAgentRef = cachedAgent?.id ?? agentRef;
  const bootstrapKey = useMemo(
    () => queryKeys.agentChats.bootstrap(selectedCompanyId, userId, bootstrapAgentRef),
    [selectedCompanyId, userId, bootstrapAgentRef],
  );
  const bootstrap = useQuery({
    queryKey: bootstrapKey,
    queryFn: () => agentChatsApi.bootstrap(selectedCompanyId!, bootstrapAgentRef),
    enabled: enabled && !!selectedCompanyId && !!userId && session.isSuccess,
    staleTime: 30_000,
    refetchInterval: query => query.state.data?.activeRun ? 2_000 : false,
  });

  useEffect(() => {
    const result = bootstrap.data;
    if (!result || !selectedCompanyId || !userId) return;
    const canonicalKey = queryKeys.agentChats.bootstrap(selectedCompanyId, userId, result.agent.id);
    if (result.agent.id !== bootstrapAgentRef) client.setQueryData(canonicalKey, result);
    recordAgentChatVisit(selectedCompanyId, userId, result.agent.id, result.chat?.id ?? null);
  }, [bootstrap.data, bootstrapAgentRef, client, selectedCompanyId, userId]);

  if (!loaded || session.isPending) {
    return <p role="status" className="text-sm text-muted-foreground">Loading conversation…</p>;
  }
  if (!enabled) {
    return <p className="text-sm text-muted-foreground">Agent Chat is disabled. Enable it in Experimental settings. Existing history remains available through task links.</p>;
  }
  if (!selectedCompanyId || !userId) {
    return <p role="status" className="text-sm text-muted-foreground">Loading your conversation…</p>;
  }
  if (bootstrap.data) {
    return (
      <AgentChatFastPath
        key={selectedCompanyId + ":" + userId + ":" + bootstrap.data.agent.id}
        bootstrap={bootstrap.data}
        companyId={selectedCompanyId}
        userId={userId}
        queryKey={bootstrapKey}
        isFetching={bootstrap.isFetching}
        refetchBootstrap={() => bootstrap.refetch()}
      />
    );
  }
  if (bootstrap.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm text-destructive">
        <p>{bootstrap.error instanceof Error ? bootstrap.error.message : "Couldn’t load this conversation."}</p>
        <button type="button" className="underline underline-offset-2" onClick={() => void bootstrap.refetch()}>Try again</button>
      </div>
    );
  }
  return <p role="status" className="text-sm text-muted-foreground">Opening conversation…</p>;
}
