import { GOOGLE_ADDITIONAL_PROVIDERS } from "./connectors/google-workspace-api/services.js";
import { isGoogleWorkspaceToolGranted } from "@paperclipai/shared";
import { GOOGLE_NATIVE_SERVICE_PREFIXES, GOOGLE_WORKSPACE_API_TOOLS, googleWorkspaceApiRisk, isCurrentGoogleWorkspaceApiCatalogEntry, isGoogleWorkspaceApiToolName, isGoogleWorkspaceApiConnection, executeGoogleWorkspaceApiTool, probeGoogleWorkspaceApi } from "./connectors/google-workspace-api/client.js";
import { DAYTONA_TOOLS, daytonaClient, daytonaRisk, executeDaytonaTool, isCurrentDaytonaCatalogEntry, isDaytonaConnection, isDaytonaToolName } from "./daytona.js";
import type { NativeCatalogEntry, NativeRestRequest } from "./native-rest-client.js";
import { UNIKRAFT_DEFAULT_METRO, UNIKRAFT_TOOLS, executeUnikraftTool, isCurrentUnikraftCatalogEntry, isUnikraftConnection,
  isUnikraftToolName, unikraftClient, unikraftRisk } from "./connectors/unikraft/client.js";

type ConnectionShape = { transport: string; config?: Record<string, unknown> };
const methodConfig = (connection: ConnectionShape) => {
  const value = connection.config?.methodConfig;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

/** A provider whose action catalog is generated from its published HTTP API
 * and executed by a Paperclip bridge rather than a remote MCP server. Shared
 * connection code consumes this contract instead of naming providers. */
export type NativeProviderCatalog = {
  slug: string;
  name: string;
  tools: typeof DAYTONA_TOOLS;
  isConnection(connection: ConnectionShape): boolean;
  isToolName(name: string): boolean;
  isToolGranted?(name: string, scopes: readonly string[]): boolean;
  risk(name: string): "read" | "write" | "destructive";
  isCurrentEntry(entry: NativeCatalogEntry): boolean;
  probe(connection: ConnectionShape, headers: Record<string, string>, request: NativeRestRequest, context?: { grantedScopes?: readonly string[] }): Promise<unknown>;
  execute(input: Parameters<typeof executeDaytonaTool>[0] & { grantedScopes?: readonly string[] }): Promise<unknown>;
};

export const NATIVE_PROVIDER_CATALOGS: readonly NativeProviderCatalog[] = [
  ...GOOGLE_ADDITIONAL_PROVIDERS,
  ...Object.entries(GOOGLE_NATIVE_SERVICE_PREFIXES).map(([slug, prefixes]): NativeProviderCatalog => ({
    slug, name: `Google ${slug} API`, tools: GOOGLE_WORKSPACE_API_TOOLS.filter(tool => prefixes.some(prefix => tool.name.startsWith(prefix))),
    isConnection: connection => connection.transport === "rest_api" && connection.config?.sourceTemplateKey === slug && connection.config.connectionMethodKey === "customer-workspace-api",
    isToolName: name => prefixes.some(prefix => name.startsWith(prefix)) && isGoogleWorkspaceApiToolName(name),
    isToolGranted: isGoogleWorkspaceToolGranted, risk: googleWorkspaceApiRisk, isCurrentEntry: isCurrentGoogleWorkspaceApiCatalogEntry,
    probe: (connection, headers, request, context) => probeGoogleWorkspaceApi(connection, headers, request, context), execute: executeGoogleWorkspaceApiTool,
  })),
  {
    slug: "google-workspace", name: "Google Workspace APIs", tools: GOOGLE_WORKSPACE_API_TOOLS,
    isConnection: connection => connection.config?.sourceTemplateKey === "google-workspace" && isGoogleWorkspaceApiConnection(connection), isToolName: isGoogleWorkspaceApiToolName,
    isToolGranted: isGoogleWorkspaceToolGranted,
    risk: googleWorkspaceApiRisk, isCurrentEntry: isCurrentGoogleWorkspaceApiCatalogEntry,
    probe: (connection, headers, request, context) => probeGoogleWorkspaceApi(connection, headers, request, context),
    execute: executeGoogleWorkspaceApiTool,
  },
  {
    slug: "daytona", name: "Daytona", tools: DAYTONA_TOOLS,
    isConnection: isDaytonaConnection, isToolName: isDaytonaToolName, risk: daytonaRisk, isCurrentEntry: isCurrentDaytonaCatalogEntry,
    probe: (connection, headers, request) => daytonaClient(headers, request, methodConfig(connection).organizationId).probe(),
    execute: executeDaytonaTool,
  },
  {
    slug: "unikraft", name: "Unikraft", tools: UNIKRAFT_TOOLS,
    isConnection: isUnikraftConnection, isToolName: isUnikraftToolName, risk: unikraftRisk, isCurrentEntry: isCurrentUnikraftCatalogEntry,
    probe: (connection, headers, request) => unikraftClient(headers, request, methodConfig(connection).metro ?? UNIKRAFT_DEFAULT_METRO).probe(),
    execute: executeUnikraftTool,
  },
];

export const NATIVE_PROVIDER_SLUGS: readonly string[] = NATIVE_PROVIDER_CATALOGS.map(provider => provider.slug);

export function nativeProviderCatalogFor(connection: ConnectionShape): NativeProviderCatalog | null {
  return NATIVE_PROVIDER_CATALOGS.find(provider => provider.isConnection(connection)) ?? null;
}

export function nativeProviderCatalogForSlug(slug: unknown): NativeProviderCatalog | null {
  return NATIVE_PROVIDER_CATALOGS.find(provider => provider.slug === slug) ?? null;
}
