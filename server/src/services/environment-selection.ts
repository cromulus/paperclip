import { forbidden, unprocessable } from "../errors.js";

export async function assertEnvironmentSelectionForCompany(
  environmentsSvc: {
    getById(environmentId: string): Promise<{
      id: string;
      driver: string;
      ownerAgentId?: string | null;
      status?: string | null;
      config: Record<string, unknown> | null;
    } | null>;
  },
  _companyId: string,
  environmentId: string | null | undefined,
  options?: {
    allowedDrivers?: string[];
    allowedSandboxProviders?: string[];
    agentId?: string | null;
  },
) {
  if (environmentId === undefined || environmentId === null) return;
  const environment = await environmentsSvc.getById(environmentId);
  if (!environment) {
    throw unprocessable("Environment not found.");
  }
  if (environment.status === "archived") {
    throw unprocessable("Environment is archived.");
  }
  if (environment.ownerAgentId && environment.ownerAgentId !== options?.agentId) {
    throw forbidden("The selected environment is bound to another agent.", {
      code: "environment_agent_mismatch",
    });
  }
  if (options?.allowedDrivers && !options.allowedDrivers.includes(environment.driver)) {
    throw unprocessable(
      `Environment driver "${environment.driver}" is not allowed here. Allowed drivers: ${options.allowedDrivers.join(", ")}`,
    );
  }
  if (environment.driver === "sandbox") {
    const config = environment.config && typeof environment.config === "object"
      ? environment.config as Record<string, unknown>
      : {};
    const provider = typeof config.provider === "string" ? config.provider : "";
    if (provider === "fake") {
      throw unprocessable(
        `Environment sandbox provider "${provider}" is not allowed here. The built-in fake provider is probe-only and cannot execute runs.`,
      );
    }
    if (
      options?.allowedSandboxProviders
      && options.allowedSandboxProviders.length > 0
      && !options.allowedSandboxProviders.includes(provider)
    ) {
      throw unprocessable(
        `Environment sandbox provider "${provider || "unknown"}" is not allowed here. Allowed providers: ${options.allowedSandboxProviders.join(", ")}`,
      );
    }
  }
}
