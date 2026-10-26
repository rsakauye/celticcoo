import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFetch, handleInboundEmail } from '../src/index.js';
import { createGuardDb } from '../../../shared/triage/test/guard-db.mjs';

const SECRET = 'test-review-secret-value';
const OWNER = 'owner@example.com';

function pausedGuard(action, reason) {
  return async (sample) => {
    if (sample && sample.phase === 'peek') return { action, reason, alert: false };
    return { action, reason, alert: false };
  };
}

function message() {
  const calls = { forward: [] };
  return {
    from: 'organizer@example.com',
    to: 'hello@celticcoo.ca',
    headers: new Headers({ subject: 'A short note', 'message-id': '<sample-note@example.com>' }),
    raw: new TextEncoder().encode('From: organizer@example.com\r\nTo: hello@celticcoo.ca\r\nSubject: A short note\r\n\r\nHello from Sample Organizer.\r\n'),
    rawSize: 120,
    calls,
    async forward(to) { calls.forward.push(to); },
    async reply() { throw new Error('should not reply'); },
  };
}

function memoryDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.push({ sql, args, op: 'first' });
              if (/dedupe_key/i.test(sql)) return null;
              return null;
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

test('a paused mailbox stores the row, skips AI, and does not forward or file an issue', async () => {
  const db = memoryDb();
  const filed = [];
  let classified = false;
  const inbound = message();
  const result = await handleInboundEmail(inbound, {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    GITHUB_TOKEN: 'github_pat_test_token_value_123456',
  }, {
    guard: pausedGuard('pause', 'manual'),
    classify() { classified = true; throw new Error('AI should not run'); },
    fetch() { filed.push(true); throw new Error('issue should not be filed'); },
  });
  assert.equal(result.forward.status, 'skipped');
  assert.equal(result.forward.error, 'paused');
  assert.equal(classified, false);
  assert.equal(filed.length, 0);
  assert.equal(inbound.calls.forward.length, 0);
  const insert = db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.args.includes('paused:manual'), true);
  assert.equal(insert.args.join('\n').includes('Sample Organizer'), true);
});

test('a held organizer burst is stored for review and does not open an issue', async () => {
  const db = memoryDb();
  const inbound = message();
  let classified = false;
  const result = await handleInboundEmail(inbound, {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    ACK_REPLIES: 'on',
  }, {
    guard: async (sample) => (sample.phase === 'peek'
      ? { action: 'allow', reason: 'open' }
      : { action: 'hold', reason: 'bulk_organizer' }),
    classify() { classified = true; throw new Error('AI should not run'); },
    fetch() { throw new Error('issue should not be filed'); },
    reply() { throw new Error('should not acknowledge'); },
  });
  assert.equal(result.forward.status, 'sent');
  assert.equal(classified, false);
  assert.equal(result.outcome.issueStatus, 'skipped');
  const insert = db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  assert.equal(insert.args.includes('held:bulk_organizer'), true);
});

test('the cutoff switch requires the review secret and does not echo it', async () => {
  const db = createGuardDb();
  const env = { REVIEW_SECRET: SECRET, INTAKE_DB: db };
  const denied = await handleFetch(new Request('https://review.celticcoo.ca/cutoff', {
    headers: { authorization: 'Bearer wrong-secret-value' },
  }), env);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, 'unauthorized');

  const on = await handleFetch(new Request('https://review.celticcoo.ca/cutoff', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ paused: true }),
  }), env);
  assert.equal(on.status, 200);
  const paused = await on.json();
  assert.equal(paused.paused, true);
  assert.equal(paused.latch, 'manual');
  assert.equal(JSON.stringify(paused).includes(SECRET), false);

  const view = await handleFetch(new Request('https://review.celticcoo.ca/cutoff', {
    headers: { authorization: `Bearer ${SECRET}` },
  }), env);
  assert.equal((await view.json()).paused, true);

  const off = await handleFetch(new Request('https://review.celticcoo.ca/cutoff', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ paused: false }),
  }), env);
  assert.equal((await off.json()).paused, false);
});
