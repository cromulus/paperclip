import { loadIssueHierarchyAncestors, loadIssueHierarchyChildren } from "../lib/issue-hierarchy-context";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";

export function useIssueHierarchyContext(companyId: string | null, matches: Issue[], collapsedParents: string[], enabled: boolean, rowBudget: number) {
  const parents = [...new Set(matches.map((issue) => issue.parentId).filter((id): id is string => Boolean(id)))];
  const ancestorQueries = useQuery<Issue[]>({
    queryKey: [...queryKeys.issues.list(companyId ?? "__unscoped__"), "hierarchy-ancestors", [...parents].sort(), rowBudget],
    enabled: enabled && Boolean(companyId),
    staleTime: 30_000,
    placeholderData: (previous) => previous ? previous.filter((issue) => issue.companyId === companyId) : undefined,
    queryFn: ({ signal }) => loadIssueHierarchyAncestors(companyId!, parents, rowBudget,
      (ids) => issuesApi.list(companyId!, { ids, limit: ids.length, includeRoutineExecutions: true }, { signal })),
  });
  const children = useQuery<Awaited<ReturnType<typeof loadIssueHierarchyChildren>>>({
    queryKey: [...queryKeys.issues.list(companyId ?? "__unscoped__"), "hierarchy-children", matches.map((issue) => issue.id), collapsedParents, rowBudget],
    enabled: enabled && Boolean(companyId) && matches.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous ? {
      ...previous, issues: previous.issues.filter((issue) => issue.companyId === companyId),
    } : undefined,
    queryFn: ({ signal }) => loadIssueHierarchyChildren(companyId!, matches, collapsedParents, rowBudget,
      (parentIds, limit, onePerParent) => issuesApi.list(companyId!, {
        parentIds,
        limit,
        onePerParent,
        includeRoutineExecutions: true,
      }, { signal })),
  });
  return {
    issues: [...(ancestorQueries.data ?? []), ...(children.data?.issues ?? [])],
    hasMore: children.data?.hasMore ?? false,
    isFetching: children.isFetching,
    error: ancestorQueries.error ?? children.error,
  };
}
