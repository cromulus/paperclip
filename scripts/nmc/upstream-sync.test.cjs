const { test } = require('node:test');
const assert = require('node:assert/strict');
const sync = require('./upstream-sync.cjs');
function fixture({ ahead = 1, exists = false, conflict = false, pr = false } = {}) {
  const calls = [];
  const github = { rest: {
    repos: {
      getCommit: async () => ({ data: { sha: 'a'.repeat(40) } }),
      compareCommits: async () => ({ data: { ahead_by: ahead } }),
      merge: async args => { calls.push(['merge', args]); if (conflict) throw Object.assign(new Error('Merge conflict'), { status: 409 }); },
    },
    git: {
      getRef: async args => {
        if (args.ref !== 'heads/master' && !exists) throw Object.assign(new Error('Missing'), { status: 404 });
        return { data: { object: { sha: 'b'.repeat(40) } } };
      },
      createRef: async args => { calls.push(['branch', args]); },
    },
    pulls: {
      list: async () => ({ data: pr ? [{ html_url: 'https://example.test/pr' }] : [] }),
      create: async args => { calls.push(['pr', args]); return { data: { html_url: 'https://example.test/pr' } }; },
    },
  } };
  return { calls, input: { github, context: { repo: { owner: 'cromulus', repo: 'paperclip' } }, core: { info() {} } } };
}
test('up-to-date fork makes no writes', async () => {
  const f = fixture({ ahead: 0 }); await sync(f.input); assert.deepEqual(f.calls, []);
});
test('missing branch starts at fork master and only opens a draft PR', async () => {
  const f = fixture(); await sync(f.input);
  assert.deepEqual(f.calls.map(x => x[0]), ['branch', 'merge', 'merge', 'pr']);
  assert.equal(f.calls[0][1].sha, 'b'.repeat(40));
  assert.equal(f.calls[2][1].head, 'a'.repeat(40));
  assert.equal(f.calls[3][1].draft, true);
  assert.equal(f.calls[3][1].base, 'master');
  for (const [kind, args] of f.calls) if (kind === 'merge') assert.equal(args.base, 'sync/upstream');
});
test('existing sync PR is updated without a duplicate', async () => {
  const f = fixture({ exists: true, pr: true }); await sync(f.input);
  assert.deepEqual(f.calls.map(x => x[0]), ['merge', 'merge']);
});
test('conflict is visible and cannot open a PR or update master', async () => {
  const f = fixture({ exists: true, conflict: true });
  await assert.rejects(sync(f.input), /Merge conflict/);
  assert.deepEqual(f.calls.map(x => x[0]), ['merge']);
  assert.equal(f.calls[0][1].base, 'sync/upstream');
});
