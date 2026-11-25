import { describe, expect, it } from "vitest";
import { publicMcpConfig } from "../services/public-mcp/oauth.js";
import { paperclipCloudConnectorConfigFromEnv } from "../services/paperclip-cloud-connector.js";
import { startPaperclipCloudConnectorEnrollment, completePaperclipCloudConnectorEnrollment } from "../services/paperclip-cloud-connector-enrollment.js";

describe("configured NMC deployment policies survive source builds", () => {
  it("keeps the public MCP origin separate from the private browser origin", () => {
    const result = publicMcpConfig({
      PAPERCLIP_PUBLIC_URL: "https://private.example.test",
      PAPERCLIP_MCP_PUBLIC_URL: "https://mcp.example.test",
      PAPERCLIP_MCP_AUTHORIZATION_ORIGIN: "https://private.example.test",
    });
    expect(result).toEqual({ origin: "https://mcp.example.test", resource: "https://mcp.example.test/mcp/paperclip", authorizationOrigin: "https://private.example.test" });
  });
  it("validates the configured MCP override without silently falling back", () => {
    expect(() => publicMcpConfig({ PAPERCLIP_PUBLIC_URL: "https://private.example.test", PAPERCLIP_MCP_PUBLIC_URL: "http://untrusted.example.test" })).toThrow("HTTPS origin");
  });
  it("honors the owner disabling hosted connectors before loading local identity", async () => {
    const env = { NMC_DISABLE_HOSTED_CONNECTORS: "true" };
    expect(paperclipCloudConnectorConfigFromEnv(env)).toBeNull();
    const request = () => { throw new Error("Unexpected provider request"); };
    await expect(startPaperclipCloudConnectorEnrollment({ origin: "https://private.example.test", env, request })).rejects.toThrow("disabled by this instance owner");
    await expect(completePaperclipCloudConnectorEnrollment({ enrollmentId: "test", approvalCode: "test", state: "test", env, request })).rejects.toThrow("disabled by this instance owner");
  });
});
