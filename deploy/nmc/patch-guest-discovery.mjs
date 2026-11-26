import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Backport paperclipai/paperclip#17340 into the pinned release bundle.
// Build from the checked-in source; refuse to patch a different base release.
const sourcePath = '/app/server/src/services/chat-github-tools.ts';
const original = readFileSync(sourcePath, 'utf8');
assert.equal(createHash('sha256').update(original).digest('hex'),
  '028c3410a90cf665dedada3f3319ed636f0f06cf0d2d842ed4f526f1887010b0');
const patched = readFileSync('/tmp/nmc-chat-github-tools.ts', 'utf8');
const declaration = 'export async function githubGuestBotConnectionForSession(';
assert.equal(patched.split(declaration).length, 2);
const fn = patched.slice(patched.indexOf(declaration)).replace('export async', 'async');
assert.ok(fn.includes('if (!(await guestSource()).length) return null;'));
const compiled = transformSync(fn, {
  loader: 'ts', target: 'node24', format: 'esm',
  define: { and: 'and16', eq: 'eq16', sql: 'sql16' },
}).code.trimEnd();
const bundlePath = '/app/server/dist-runtime/chunk-URIDYK22.mjs';
const bundle = readFileSync(bundlePath, 'utf8');
const marker = 'async function githubGuestBotConnectionForSession(db, session) {';
assert.equal(bundle.split(marker).length, 2);
const start = bundle.indexOf(marker);
const end = bundle.indexOf('\n// ', start);
assert.ok(end > start);
const old = bundle.slice(start, end);
assert.ok(old.includes('const [source] = await db.select({'));
assert.ok(!old.includes('guestSource'));
assert.ok(old.endsWith('}\n'));
writeFileSync(bundlePath, bundle.slice(0, start) + compiled + '\n' + bundle.slice(end));
writeFileSync(sourcePath, patched);
console.log('Applied upstream guest-discovery fix to source and executed runtime bundle');
