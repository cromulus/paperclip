import type { AgentChatBootstrapResponse, Issue } from "@paperclipai/shared";
import { api } from "./client";
export type AgentChatBootstrap = AgentChatBootstrapResponse;

export const agentChatsApi = {
  list: (companyId: string) => api.get<Issue[]>(`/companies/${companyId}/chats`),
  get: (companyId: string, agentRef: string) =>
    api.get<Issue | null>(
      `/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`,
    ),
  ensure: (companyId: string, agentRef: string) =>
    api.post<Issue>(
      `/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`,
      {},
    ),
  bootstrap: (companyId: string, agentRef: string, options?: { limit?: number; before?: string }) => {
    const params = new URLSearchParams();
    params.set("limit", String(options?.limit ?? 30));
    if (options?.before) params.set("before", options.before);
    return api.get<AgentChatBootstrap>(
      `/companies/${companyId}/chats/${encodeURIComponent(agentRef)}/bootstrap?${params.toString()}`,
    );
  },
};
