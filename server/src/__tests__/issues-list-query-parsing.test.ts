import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, it } from "vitest";
import { issues } from "@paperclipai/db";
import { issueRoutes } from "../routes/issues.js";
import {
  describeEmbeddedPostgres,
  resetCompanyIssueFixtures,
  routeApp,
  seedCompanyWithBoardAccess,
  useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

/**
 * Regression coverage for https://github.com/paperclipai/paperclip/issues/4628.
 * Express's `qs` parser hands the list route either a string or an array for
 * `?status=`, and the route normalizes both shapes.
 */

describeEmbeddedPostgres("issue list status query parsing", () => {
  const ctx = useEmbeddedPostgres("paperclip-issues-list-query-parsing-", {
    resetEach: resetCompanyIssueFixtures,
  });

  async function listStatuses(query: string) {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Status parsing");
    const companyId = company.companyId;
    await ctx.db.insert(issues).values([
      { id: randomUUID(), companyId, title: "Todo", status: "todo", priority: "medium" },
      { id: randomUUID(), companyId, title: "In progress", status: "in_progress", priority: "medium" },
      { id: randomUUID(), companyId, title: "Done", status: "done", priority: "medium" },
    ]);
    const res = await request(routeApp(ctx.db, company.actor, issueRoutes))
      .get(`/api/companies/${companyId}/issues${query}`)
      .expect(200);
    return (res.body as { status: string }[]).map((issue) => issue.status).sort();
  }

  it("accepts a single ?status=todo", async () => {
    expect(await listStatuses("?status=todo")).toEqual(["todo"]);
  });

  it("accepts comma-separated ?status=todo,in_progress", async () => {
    expect(await listStatuses("?status=todo,in_progress")).toEqual(["in_progress", "todo"]);
  });

  it("accepts repeated ?status=todo&status=in_progress", async () => {
    expect(await listStatuses("?status=todo&status=in_progress")).toEqual(["in_progress", "todo"]);
  });

  it("accepts mixed array and CSV ?status=todo,in_progress&status=done", async () => {
    expect(await listStatuses("?status=todo,in_progress&status=done"))
      .toEqual(["done", "in_progress", "todo"]);
  });

  it("returns every status when ?status is absent", async () => {
    expect(await listStatuses("")).toEqual(["done", "in_progress", "todo"]);
  });

  it("serves a compact updatedAt-sorted page with the requested server limit", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Recent compact list");
    const olderId = "00000000-0000-4000-8000-000000000001";
    const newerTieId = "00000000-0000-4000-8000-000000000003";
    const olderTieId = "00000000-0000-4000-8000-000000000002";
    await ctx.db.insert(issues).values([
      { id: olderId, companyId: company.companyId, title: "Older", status: "todo", priority: "critical", updatedAt: new Date("2026-05-01T00:00:00Z") },
      { id: olderTieId, companyId: company.companyId, title: "Tie older id", status: "todo", priority: "low", updatedAt: new Date("2026-05-02T00:00:00Z") },
      { id: newerTieId, companyId: company.companyId, title: "Tie newer id", status: "todo", priority: "low", updatedAt: new Date("2026-05-02T00:00:00Z") },
    ]);

    const response = await request(routeApp(ctx.db, company.actor, issueRoutes))
      .get(`/api/companies/${company.companyId}/issues?view=compact&limit=2&sortField=updatedAt&sortDir=desc`)
      .expect(200);

    expect((response.body as { id: string }[]).map((issue) => issue.id)).toEqual([newerTieId, olderTieId]);
  });
});

describeEmbeddedPostgres("issue list batched hierarchy filters", () => {
  const ctx = useEmbeddedPostgres("paperclip-issues-list-hierarchy-batch-", {
    resetEach: resetCompanyIssueFixtures,
  });

  it("returns only company-scoped children for the requested parents", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batched hierarchy");
    const otherCompany = await seedCompanyWithBoardAccess(ctx.db, "Other hierarchy");
    const parentA = randomUUID();
    const parentB = randomUUID();
    const outsideParent = randomUUID();
    const childA1 = randomUUID();
    const childA2 = randomUUID();
    const childB = randomUUID();
    const outsideChild = randomUUID();
    await ctx.db.insert(issues).values([
      { id: parentA, companyId: company.companyId, title: "Parent A", status: "todo", priority: "medium" },
      { id: parentB, companyId: company.companyId, title: "Parent B", status: "todo", priority: "medium" },
      { id: outsideParent, companyId: otherCompany.companyId, title: "Outside parent", status: "todo", priority: "medium" },
      { id: childA1, companyId: company.companyId, parentId: parentA, title: "Child A1", status: "todo", priority: "medium" },
      { id: childA2, companyId: company.companyId, parentId: parentA, title: "Child A2", status: "todo", priority: "medium" },
      { id: childB, companyId: company.companyId, parentId: parentB, title: "Child B", status: "todo", priority: "medium" },
      { id: outsideChild, companyId: otherCompany.companyId, parentId: outsideParent, title: "Outside child", status: "todo", priority: "medium" },
    ]);

    const path = `/api/companies/${company.companyId}/issues?parentIds=${[parentA, parentB, outsideParent].join(",")}&limit=100`;
    const allChildren = await request(routeApp(ctx.db, company.actor, issueRoutes))
      .get(path)
      .expect(200);
    expect((allChildren.body as { id: string; parentId: string }[])
      .map((row) => [row.parentId, row.id]).sort()).toEqual([
      [parentA, childA1], [parentA, childA2], [parentB, childB],
    ].sort());

    const ancestorBatch = await request(routeApp(ctx.db, company.actor, issueRoutes))
      .get(`/api/companies/${company.companyId}/issues?ids=${[parentA, parentB, outsideParent].join(",")}&limit=100`)
      .expect(200);
    expect((ancestorBatch.body as { id: string }[]).map((row) => row.id).sort()).toEqual([parentA, parentB].sort());

    const onePerParent = await request(routeApp(ctx.db, company.actor, issueRoutes))
      .get(`${path}&onePerParent=true`)
      .expect(200);
    const uniqueParents = new Set((onePerParent.body as { parentId: string }[]).map((row) => row.parentId));
    expect(uniqueParents).toEqual(new Set([parentA, parentB]));
    expect(onePerParent.body).toHaveLength(2);
  });

  it("rejects malformed and oversized parent batches", async () => {
    const company = await seedCompanyWithBoardAccess(ctx.db, "Batched hierarchy validation");
    const app = routeApp(ctx.db, company.actor, issueRoutes);
    await request(app).get(`/api/companies/${company.companyId}/issues?parentIds=not-a-uuid`).expect(400);
    await request(app).get(`/api/companies/${company.companyId}/issues?ids=not-a-uuid`).expect(400);
    const tooMany = Array.from({ length: 101 }, () => randomUUID()).join(",");
    await request(app).get(`/api/companies/${company.companyId}/issues?parentIds=${tooMany}`).expect(400);
    await request(app).get(`/api/companies/${company.companyId}/issues?ids=${tooMany}`).expect(400);
    await request(app).get(`/api/companies/${company.companyId}/issues?onePerParent=true`).expect(400);
  });
});
