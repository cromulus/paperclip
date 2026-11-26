import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnvironmentService } = vi.hoisted(() => ({
  mockEnvironmentService: {
    getById: vi.fn(),
    listBoundCompanyIds: vi.fn(),
  },
}));

vi.mock("./environments.js", () => ({
  environmentService: () => mockEnvironmentService,
}));

import { agentEnvironmentTestService } from "./agent-environment-test.js";

describe("adapter test environment agent ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockEnvironmentService.getById.mockResolvedValue({
      id: "environment-1",
      driver: "ssh",
      status: "active",
      config: {},
      ownerAgentId: "agent-owner",
    });
    mockEnvironmentService.listBoundCompanyIds.mockResolvedValue([]);
  });

  it("accepts an agent's own environment and rejects another agent", async () => {
    const service = agentEnvironmentTestService({} as never);

    await expect(service.assertAdapterTestEnvironmentForCompany(
      "company-1",
      "environment-1",
      "codex_local",
      "agent-owner",
    )).resolves.toBeUndefined();
    await expect(service.assertAdapterTestEnvironmentForCompany(
      "company-1",
      "environment-1",
      "codex_local",
      "agent-other",
    )).rejects.toMatchObject({
      details: { code: "environment_agent_mismatch" },
    });
  });
});
