import { describe, expect, it } from "vitest";
import type { Issue } from "@paperclipai/shared";
import { includeIssueHierarchyContext, loadIssueHierarchyAncestors, loadIssueHierarchyChildren } from "./issue-hierarchy-context";

const task = (id: string, parentId: string | null = null) => ({ id, parentId, companyId: "company" } as Issue);

describe("task hierarchy context", () => {
  it("retains ancestors and descendants without promoting siblings or orphans", () => {
    const match = task("human", "agent-parent");
    const context = [task("agent-parent", "grandparent"), task("grandparent"), task("agent-child", "human"), task("grandchild", "agent-child"), task("unrelated"), task("orphan", "missing"), task("sibling", "agent-parent")];
    expect(includeIssueHierarchyContext([match], context).map((issue) => issue.id)).toEqual([
      "human", "agent-parent", "grandparent", "agent-child", "grandchild",
    ]);
    expect(includeIssueHierarchyContext([], context)).toEqual([]);
  });
  it("deduplicates matches and terminates cycles", () => {
    const match = task("human", "parent");
    expect(includeIssueHierarchyContext([match], [match, task("parent", "human")]).map((issue) => issue.id)).toEqual(["human", "parent"]);
  });
});

describe("bounded hierarchy reads", () => {
  it("loads ancestor IDs breadth-wise in server-bounded batches and keeps company scope", async () => {
    const parentIds = Array.from({ length: 125 }, (_, index) => `parent-${index}`);
    const calls: string[][] = [];
    const result = await loadIssueHierarchyAncestors("company", parentIds, 150, async (ids) => {
      calls.push(ids);
      return ids.slice(0, 1).map((id) => task(id, "grandparent"));
    });
    expect(calls.map((ids) => ids.length)).toEqual([100, 25, 1]);
    expect(result.map((issue) => issue.id)).toHaveLength(3);
    expect(result.map((issue) => issue.id)).toEqual(["parent-0", "parent-100", "grandparent"]);
    expect(await loadIssueHierarchyAncestors("company", ["foreign"], 5,
      async () => [{ ...task("foreign"), companyId: "other" }])).toEqual([]);
  });

  it("loads a full level of child context with one request and shares overlapping subtrees", async () => {
    const root = task("root");
    const child = task("child", "root");
    const calls: Array<{ parentIds: string[]; limit: number; onePerParent: boolean }> = [];
    const read = async (parentIds: string[], limit: number, onePerParent = false) => {
      calls.push({ parentIds, limit, onePerParent });
      const rows = parentIds.flatMap((id) => id === "root" ? [child] : id === "child"
        ? Array.from({ length: 500 }, (_, index) => task(`nested-${index}`, "child")) : []);
      const limited = onePerParent
        ? parentIds.flatMap((id) => rows.filter((row) => row.parentId === id).slice(0, 1))
        : rows;
      return limited.slice(0, limit);
    };
    const first = await loadIssueHierarchyChildren("company", [root], [], 5, read);
    expect(first.issues).toHaveLength(5);
    expect(first.hasMore).toBe(true);
    expect(calls).toEqual([
      { parentIds: ["root"], limit: 5, onePerParent: false },
      { parentIds: ["child"], limit: 4, onePerParent: false },
    ]);
    calls.length = 0;
    expect((await loadIssueHierarchyChildren("company", [root], [], 10, read)).issues).toHaveLength(10);
    expect(calls).toEqual([
      { parentIds: ["root"], limit: 10, onePerParent: false },
      { parentIds: ["child"], limit: 9, onePerParent: false },
    ]);
  });
  it("batches collapsed-parent probes and rejects foreign-company rows", async () => {
    const calls: Array<{ parentIds: string[]; limit: number; onePerParent: boolean }> = [];
    const rows = await loadIssueHierarchyChildren("company", [task("root"), task("other-root")], ["root", "other-root"], 5,
      async (parentIds, limit, onePerParent = false) => {
        calls.push({ parentIds, limit, onePerParent });
        return parentIds.map((id) => task(`${id}-child`, id));
      });
    expect(rows.issues.map((issue) => issue.id)).toEqual(["root-child", "other-root-child"]);
    expect(calls).toEqual([{ parentIds: ["root", "other-root"], limit: 2, onePerParent: true }]);
    expect(await loadIssueHierarchyChildren("company", [task("root")], [], 1,
      async () => [{ ...task("foreign", "root"), companyId: "other" }])).toEqual({ issues: [], hasMore: true });
  });

  it("batches parent candidates instead of issuing one list call per task", async () => {
    const roots = Array.from({ length: 40 }, (_, index) => task(`root-${index}`));
    const calls: string[][] = [];
    const result = await loadIssueHierarchyChildren("company", roots, [], 100, async (parentIds) => {
      calls.push(parentIds);
      return [];
    });
    expect(result).toEqual({ issues: [], hasMore: false });
    expect(calls).toEqual([roots.map((issue) => issue.id)]);
  });

  it("chunks expanded and collapsed parent batches at the server limit", async () => {
    const roots = Array.from({ length: 125 }, (_, index) => task(`root-${index}`));
    const expandedCalls: string[][] = [];
    await loadIssueHierarchyChildren("company", roots, [], 200, async (parentIds) => {
      expandedCalls.push(parentIds);
      return [];
    });
    expect(expandedCalls.map((ids) => ids.length)).toEqual([100, 25]);
    expect(expandedCalls.flat()).toEqual(roots.map((issue) => issue.id));

    const collapsedCalls: Array<{ ids: string[]; onePerParent?: boolean }> = [];
    await loadIssueHierarchyChildren("company", roots, roots.map((issue) => issue.id), 200, async (parentIds, _limit, onePerParent) => {
      collapsedCalls.push({ ids: parentIds, onePerParent });
      return [];
    });
    expect(collapsedCalls.map(({ ids, onePerParent }) => [ids.length, onePerParent])).toEqual([[100, true], [25, true]]);
    expect(collapsedCalls.flatMap(({ ids }) => ids)).toEqual(roots.map((issue) => issue.id));
  });

  it("chunks a deep frontier while preserving the row budget", async () => {
    const roots = Array.from({ length: 125 }, (_, index) => task(`root-${index}`));
    const children = roots.map((root) => task(`child-${root.id}`, root.id));
    const parentBatches: string[][] = [];
    const result = await loadIssueHierarchyChildren("company", roots, [], 150, async (parentIds) => {
      parentBatches.push(parentIds);
      if (parentIds[0]?.startsWith("root-")) return children.filter((child) => parentIds.includes(child.parentId!));
      return [];
    });
    expect(parentBatches.map((ids) => ids.length)).toEqual([100, 25, 100, 25]);
    expect(result.issues).toHaveLength(125);
    expect(result.hasMore).toBe(false);
  });
});
