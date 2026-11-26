import type { DashboardIssueActivityDay, DashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (companyId: string) => api.get<DashboardSummary>(`/companies/${companyId}/dashboard`),
  issueActivity: (companyId: string) =>
    api.get<DashboardIssueActivityDay[]>(`/companies/${companyId}/dashboard/issue-activity`),
};
