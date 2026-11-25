import type { Issue } from "@paperclipai/shared";

const PARENT_ID_BATCH_SIZE = 100;

function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += PARENT_ID_BATCH_SIZE) {
    chunks.push(ids.slice(offset, offset + PARENT_ID_BATCH_SIZE));
  }
  return chunks;
}

/** Read each ancestor level in bounded ID batches instead of one GET per row. */
export async function loadIssueHierarchyAncestors(
  companyId: string,
  parentIds: string[],
  rowBudget: number,
  readIssues: (ids: string[]) => Promise<Issue[]>,
): Promise<Issue[]> {
  const context: Issue[] = [];
  const requested = new Set<string>();
  const included = new Set<string>();
  let frontier = [...new Set(parentIds.filter(Boolean))];
  let rounds = 0;
  const maxRounds = Math.min(16, Math.max(1, rowBudget));

  while (frontier.length > 0 && context.length < rowBudget && rounds < maxRounds) {
    rounds += 1;
    const current = [...new Set(frontier.filter((id) => !requested.has(id)))];
    frontier = [];
    for (const id of current) requested.add(id);
    const rows = (await Promise.all(chunkIds(current).map((ids) => readIssues(ids)))).flat();
    for (const issue of rows) {
      if (issue.companyId !== companyId || included.has(issue.id)) continue;
      included.add(issue.id);
      context.push(issue);
      if (issue.parentId && !requested.has(issue.parentId)) frontier.push(issue.parentId);
      if (context.length >= rowBudget) break;
    }
  }

  return context;
}

/** Context never promotes an unrelated or orphaned automated task to a result. */
export function includeIssueHierarchyContext(matches: Issue[], context: Issue[]): Issue[] {
  const byId = new Map([...context, ...matches].map((issue) => [issue.id, issue]));
  const result = new Map(matches.map((issue) => [issue.id, issue]));
  for (const match of matches) {
    const visited = new Set([match.id]);
    let parentId = match.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      result.set(parent.id, parent);
      parentId = parent.parentId;
    }
  }
  // Descendants are rooted at matches, not at contextual ancestors.
  const descendantIds = new Set(matches.map((issue) => issue.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const issue of context) {
      if (!descendantIds.has(issue.id) && issue.parentId && descendantIds.has(issue.parentId)) {
        descendantIds.add(issue.id);
        result.set(issue.id, issue);
        changed = true;
      }
    }
  }
  return [...result.values()];
}

/** Fetch each parent once and stop at the collection's current rendering budget. */
export async function loadIssueHierarchyChildren(
  companyId: string,
  matches: Issue[],
  collapsedParents: string[],
  rowBudget: number,
  readChildren: (parentIds: string[], limit: number, onePerParent?: boolean) => Promise<Issue[]>,
): Promise<{ issues: Issue[]; hasMore: boolean }> {
  const context: Issue[] = [];
  let frontier = matches;
  const visitedParents = new Set<string>();
  const fetched = new Set<string>();
  let batchRounds = 0;
  let hasMore = false;
  const maxBatchRounds = Math.min(16, Math.max(1, rowBudget));
  while (frontier.length > 0 && context.length < rowBudget && batchRounds < maxBatchRounds) {
    batchRounds += 1;
    const parents = frontier.filter((issue) => !visitedParents.has(issue.id));
    frontier = [];
    if (parents.length === 0) break;
    for (const parent of parents) visitedParents.add(parent.id);

    const collapsedParentIds = parents
      .filter((parent) => collapsedParents.includes(parent.id))
      .map((parent) => parent.id);
    const expandedParentIds = parents
      .filter((parent) => !collapsedParents.includes(parent.id))
      .map((parent) => parent.id);
    const remaining = Math.max(1, rowBudget - context.length);

    const [expandedBatches, collapsedBatches] = await Promise.all([
      Promise.all(chunkIds(expandedParentIds).map((parentIds) => readChildren(parentIds, remaining))),
      Promise.all(chunkIds(collapsedParentIds).map((parentIds) => readChildren(parentIds, parentIds.length, true))),
    ]);
    const expandedRows = expandedBatches.flat();
    const collapsedRows = collapsedBatches.flat();
    if (expandedRows.length >= remaining) hasMore = true;

    const allowedCollapsedRows = new Map<string, Issue>();
    for (const child of collapsedRows) {
      if (child.parentId && !allowedCollapsedRows.has(child.parentId)) {
        allowedCollapsedRows.set(child.parentId, child);
      }
    }
    const rows = [
      ...expandedRows,
      ...allowedCollapsedRows.values(),
    ];
    for (const child of rows) {
      if (child.companyId !== companyId || fetched.has(child.id)) continue;
      fetched.add(child.id);
      context.push(child);
      if (child.parentId && !collapsedParentIds.includes(child.parentId)) frontier.push(child);
      if (context.length >= rowBudget) {
        hasMore = hasMore || frontier.length > 0 || expandedRows.length >= remaining;
        break;
      }
    }
  }
  return { issues: context, hasMore: hasMore || frontier.length > 0 };
}
