import { describe, expect, it, vi } from "vitest";
import { createEnvironmentSchema, updateEnvironmentSchema } from "@paperclipai/shared";
import { assertEnvironmentSelectionForCompany } from "./environment-selection.js";

describe("agent-bound environment selection", () => {
  it("accepts owner binding only when creating an environment", () => {
    expect(createEnvironmentSchema.safeParse({
      name: "Systems SSH",
      driver: "ssh",
      ownerAgentId: "11111111-1111-4111-8111-111111111111",
    }).success).toBe(true);
    expect(updateEnvironmentSchema.safeParse({
      ownerAgentId: "11111111-1111-4111-8111-111111111111",
    }).success).toBe(false);
  });

  it("denies an environment owned by another agent", async () => {
    const environments = {
      getById: vi.fn(async () => ({
        id: "environment-1",
        driver: "ssh",
        status: "active",
        config: {},
        ownerAgentId: "agent-owner",
      })),
    };

    await expect(assertEnvironmentSelectionForCompany(
      environments,
      "company-1",
      "environment-1",
      { allowedDrivers: ["ssh"], agentId: "agent-other" },
    )).rejects.toMatchObject({
      details: { code: "environment_agent_mismatch" },
    });
  });

  it("allows the owning agent and preserves unbound environment behavior", async () => {
    const getById = vi.fn()
      .mockResolvedValueOnce({ id: "environment-1", driver: "ssh", status: "active", config: {}, ownerAgentId: "agent-owner" })
      .mockResolvedValueOnce({ id: "environment-2", driver: "local", status: "active", config: {}, ownerAgentId: null });
    const environments = { getById };

    await expect(assertEnvironmentSelectionForCompany(
      environments,
      "company-1",
      "environment-1",
      { allowedDrivers: ["ssh"], agentId: "agent-owner" },
    )).resolves.toBeUndefined();
    await expect(assertEnvironmentSelectionForCompany(
      environments,
      "company-1",
      "environment-2",
      { allowedDrivers: ["local"], agentId: "agent-other" },
    )).resolves.toBeUndefined();
  });
});
