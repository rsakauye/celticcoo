import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleScheduled } from '../src/index.js';
import { daysAgo, monthsAgo, runRetention } from '../src/retention.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-26T12:00:00.000Z');

function countDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.push({ sql, args, op: 'first' });
              if (/submission_failures/i.test(sql)) return { n: 2 };
              if (/inbound_emails/i.test(sql)) return { n: 4 };
              return { n: 3 };
            },
            async run() {
              calls.push({ sql, args, op: 'run' });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('retention logs counts and does not delete unless the flag is on', async () => {
  const dry = countDb();
  const logs = [];
  const counted = await runRetention(dry, {}, NOW, (line) => logs.push(line));
  assert.equal(counted.mode, 'dry_run');
  assert.deepEqual(counted.counts, { submissions: 3, inbound_emails: 4, submission_failures: 2 });
  assert.equal(dry.calls.some((call) => call.op === 'run'), false);
  assert.equal(dry.calls[0].args[0], monthsAgo(NOW, 12));
  assert.equal(dry.calls[2].args[0], daysAgo(NOW, 90));
  assert.match(logs[0], /"mode":"dry_run"/);
  assert.doesNotMatch(logs[0], /@|403-/);

  const live = countDb();
  const deleted = await runRetention(live, { RETENTION_PURGE: 'on' }, NOW, () => {});
  assert.equal(deleted.mode, 'delete');
  assert.equal(live.calls.filter((call) => call.op === 'run').length, 3);
  assert.match(live.calls.find((call) => call.op === 'run').sql, /DELETE FROM submissions/);

  const almost = countDb();
  const stillDry = await runRetention(almost, { RETENTION_PURGE: 'yes' }, NOW, () => {});
  assert.equal(stillDry.mode, 'dry_run');
  assert.equal(almost.calls.some((call) => call.op === 'run'), false);
});

test('the scheduled handler stays in dry-run and the doc names the 30 day request', async () => {
  const db = countDb();
  const logs = [];
  const result = await handleScheduled({ INTAKE_DB: db }, { now: () => NOW, log: (line) => logs.push(line) });
  assert.equal(result.mode, 'dry_run');
  assert.equal(db.calls.some((call) => /DELETE/i.test(call.sql)), false);
  const doc = readFileSync(join(here, '../../../docs/retention.md'), 'utf8');
  assert.match(doc, /within 30 days/);
  assert.match(doc, /RETENTION_PURGE/);
  assert.match(doc, /ROW_ID/);
  assert.doesNotMatch(doc, /gmail\.com/i);
  assert.doesNotMatch(doc, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});
