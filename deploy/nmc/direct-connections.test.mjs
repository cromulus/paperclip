import assert from 'node:assert/strict';
import test from 'node:test';
import { isGitHubRepositoryConnection, hostedConnectorGuard } from './proxy-owner.mjs';
const connection = (url, transport = 'mcp_remote') => ({ transport, config: { url } });
test('recognizes direct GitHub MCP without relabeling its OAuth configuration', () => {
  for (const path of ['/mcp', '/mcp/', '/mcp/insiders', '/mcp/insiders/'])
    assert.equal(isGitHubRepositoryConnection(connection('https://api.githubcopilot.com'+path)), true);
  assert.equal(isGitHubRepositoryConnection({config:{sourceTemplateKey:'github'}}), true);
});
test('rejects unrelated endpoints, embedded credentials, and lookalikes', () => {
  for (const url of [null, 'bad', 'http://api.githubcopilot.com/mcp/', 'https://api.githubcopilot.com.evil.test/mcp/', 'https://user:password@api.githubcopilot.com/mcp/', 'https://api.githubcopilot.com/mcp/?token=secret', 'https://api.githubcopilot.com/mcp/#fragment', 'https://api.githubcopilot.com:444/mcp/', 'https://example.test/mcp/', 'https://api.githubcopilot.com/api'])
    assert.equal(isGitHubRepositoryConnection(connection(url)), false, String(url));
  assert.equal(isGitHubRepositoryConnection(connection('https://api.githubcopilot.com/mcp/', 'http')), false);
  assert.equal(isGitHubRepositoryConnection(null), false);
});
test('hosted enrollment is denied with a useful error before dispatch', () => {
  let status, body, next = false;
  const res = { status(value) { status=value; return this; }, json(value) { body=value; } };
  hostedConnectorGuard({NMC_DISABLE_HOSTED_CONNECTORS:'true'})({}, res, () => { next=true; });
  assert.equal(status,403); assert.equal(body.code,'hosted_connectors_disabled'); assert.equal(next,false);
  hostedConnectorGuard({})({},res,()=>{ next=true; });assert.equal(next,true);
});
