import { readFileSync, writeFileSync } from 'node:fs';
// Reuse upstream's PostgreSQL regression fixtures against the actual bundled
// function, so source-only success cannot hide a missed runtime patch.
const testPath = '/app/server/src/services/chat-github-tools.test.ts';
const test = readFileSync(testPath, 'utf8');
const imports = `import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as schema from '@paperclipai/db';
import { and as and16, eq as eq16, sql as sql16 } from 'drizzle-orm';
import { boundRunIssueIdSql } from './run-task-binding.js';
import { chatRunSourceMessageId } from './chat-channels/run-origin.js';
const bundle = readFileSync('/app/server/dist-runtime/chunk-URIDYK22.mjs', 'utf8');
const start = bundle.indexOf('async function githubGuestBotConnectionForSession(db, session) {');
if (start < 0) throw new Error('Missing runtime function');
const end = bundle.indexOf('\\n// ', start);
const githubGuestBotConnectionForSession = runInNewContext('(' + bundle.slice(start, end) + ')', {
  ...schema, and16, eq16, sql16, boundRunIssueIdSql, chatRunSourceMessageId,
});`;
const anchor = 'import { githubGuestBotConnectionForSession } from "./chat-github-tools.js";';
if (test.split(anchor).length !== 2) throw new Error('Upstream test import changed');
writeFileSync(testPath.replace('.test.ts', '.runtime.test.ts'), test.replace(anchor, imports));
