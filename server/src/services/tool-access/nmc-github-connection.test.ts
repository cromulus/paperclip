import { describe, expect, it } from "vitest";
import { isGitHubRepositoryConnection } from "./nmc-github-connection.js";

describe("direct GitHub repository connections", () => {
  it("retains catalog connections", () => {
    expect(isGitHubRepositoryConnection({ config: { sourceTemplateKey: "github" } })).toBe(true);
  });
  it.each(["/mcp", "/mcp/", "/mcp/insiders", "/mcp/insiders/"])("recognizes the official endpoint %s", path => {
    expect(isGitHubRepositoryConnection({ transport: "mcp_remote", config: { url: `https://api.githubcopilot.com${path}` } })).toBe(true);
  });
  it.each(["http://api.githubcopilot.com/mcp", "https://api.githubcopilot.com.evil.test/mcp", "https://evil.test/mcp", "https://user@api.githubcopilot.com/mcp", "https://api.githubcopilot.com:8443/mcp", "https://api.githubcopilot.com/mcp?redirect=x", "https://api.githubcopilot.com/mcp#fragment", "https://api.githubcopilot.com/mcp/other", "invalid"])("rejects an untrusted endpoint %s", url => {
    expect(isGitHubRepositoryConnection({ transport: "mcp_remote", config: { url } })).toBe(false);
  });
  it("requires remote MCP transport", () => {
    expect(isGitHubRepositoryConnection({ transport: "http", config: { url: "https://api.githubcopilot.com/mcp" } })).toBe(false);
  });
});
