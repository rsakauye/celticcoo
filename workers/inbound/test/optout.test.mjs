import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeAcknowledge } from '../src/ack.js';
import { handleFetch, handleInboundEmail } from '../src/index.js';
import { isOptOutMessage, recordOptOut } from '../src/optout.js';
import { sendApprovedReply } from '../src/review.js';
import { reviewLinks } from '../src/token.js';

const here = dirname(fileURLToPath(import.meta.url));
const OWNER = 'owner@example.com';
const SENDER = 'ada@example.com';
const OTHER = 'jordan@example.com';
const SECRET = 'test-review-secret-value';
const NOW = new Date('2026-10-26T12:00:00.000Z');
const ROW_ID = '11111111-2222-4333-8444-555555555555';

function mailDb() {
  const optOuts = new Map();
  const calls = [];
  return {
    calls,
    optOuts,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.push({ sql, args, op: 'first' });
              if (/mail_opt_outs/i.test(sql)) {
                const row = optOuts.get(String(args[0] || '').toLowerCase());
                return row ? { email: row.email } : null;
              }
              return null;
            },
            async run() {
              calls.push({ sql, args, op: 'run' });
              if (/INSERT OR IGNORE INTO mail_opt_outs/i.test(sql)) {
                const [email, createdAt, source] = args;
                const key = String(email).toLowerCase();
                if (!optOuts.has(key)) optOuts.set(key, { email: key, created_at: createdAt, source });
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function mime({ subject, text, from = `Ada <${SENDER}>`, to = 'hello@celticcoo.ca', replyTo = '' }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Date: Mon, 26 Oct 2026 12:00:00 +0000',
    'Message-ID: <opt-out@example.com>',
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (replyTo) lines.push(`Reply-To: ${replyTo}`);
  lines.push('', text || '');
  return lines.join('\r\n');
}

function fake({ subject, text, to = 'hello@celticcoo.ca', from = SENDER, replyTo = '', messageId = '<opt-out@example.com>' }) {
  const raw = mime({ subject, text, to, from: `Ada <${from}>`, replyTo });
  const headers = new Headers({
    subject,
    date: 'Mon, 26 Oct 2026 12:00:00 +0000',
    'message-id': messageId,
  });
  const calls = { forward: [], reply: [] };
  return {
    from,
    to,
    headers,
    raw,
    rawSize: raw.length,
    calls,
    async forward(destination) { calls.forward.push(destination); },
    async reply(value) { calls.reply.push(value); },
  };
}

test('only a message that is stop or unsubscribe is an opt-out', () => {
  for (const text of ['stop', 'STOP!!', 'Unsubscribe.', 'please stop', 'stop emailing me', 'remove me', 'opt out', 'optout', 'stop all']) {
    assert.equal(isOptOutMessage('Re: your note', text), true, text);
  }
  assert.equal(isOptOutMessage('Unsubscribe', ''), true);
  assert.equal(isOptOutMessage('Question', "How do I unsubscribe from the Coo's Letter?"), false);
  assert.equal(isOptOutMessage('Hello', 'Please stop by the hall on Friday.'), false);
  assert.equal(isOptOutMessage('Newsletter', 'I want to unsubscribe from the letter because I moved.'), false);
});

test('a stop reply is recorded once and blocks later non-transactional mail', async () => {
  const db = mailDb();
  const logs = [];
  const replies = [];
  const stop = fake({ subject: 'Re: your booking', text: 'Unsubscribe.' });
  const stopped = await handleInboundEmail(stop, {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    ACK_REPLIES: 'on',
  }, {
    now: () => NOW,
    log(line) { logs.push(line); },
    reply: async () => { replies.push('reply'); },
  });
  assert.equal(stopped.outcome.errorCode, 'opt_out');
  assert.equal(stop.calls.forward.length, 1);
  assert.equal(stop.calls.reply.length, 0);
  assert.equal(replies.length, 0);
  assert.equal(db.optOuts.get(SENDER).created_at, NOW.toISOString());
  assert.equal(db.optOuts.get(SENDER).source, 'reply');
  const insert = db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.args.includes('pending_approval'), false);
  assert.equal(logs.some((line) => line.includes(SENDER) || line.includes('Unsubscribe')), false);

  const again = await recordOptOut(db, `Ada <${SENDER}>`, '2026-11-01T00:00:00.000Z');
  assert.equal(again, true);
  assert.equal(db.optOuts.get(SENDER).created_at, NOW.toISOString());

  const follow = fake({
    subject: 'Piper for a wedding',
    text: 'We would like to hire a piper for a wedding next spring.',
    messageId: '<later@example.com>',
  });
  follow.headers.set('message-id', '<later@example.com>');
  await handleInboundEmail(follow, {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    ACK_REPLIES: 'on',
    CLARIFY_DRAFTS: 'drafts',
  }, {
    now: () => new Date('2026-10-27T12:00:00.000Z'),
    log() {},
    reply: async () => { replies.push('later'); },
  });
  assert.equal(replies.length, 0);
  const laterInsert = db.calls.filter((call) => /INSERT INTO inbound_emails/i.test(call.sql)).at(-1);
  assert.equal(laterInsert.args.includes('pending_approval'), false);
  const ack = await maybeAcknowledge(follow, { ACK_REPLIES: 'on', INTAKE_DB: db }, {
    reply: async () => { replies.push('direct'); },
  });
  assert.equal(ack.error, 'opt_out');
  assert.equal(replies.length, 0);

  const sent = [];
  await assert.rejects(
    () => sendApprovedReply({ INTAKE_DB: db }, {
      to: SENDER,
      subject: 'Booking',
      text: 'Hello,\n\nWhich event is this about?\n',
    }, { send: async (mail) => sent.push(mail) }),
    (err) => err.code === 'opt_out',
  );
  assert.equal(sent.length, 0);

  const question = fake({
    subject: 'Question',
    text: "How do I unsubscribe from the Coo's Letter?",
    from: OTHER,
    messageId: '<question@example.com>',
  });
  question.headers.set('message-id', '<question@example.com>');
  await handleInboundEmail(question, { FORWARD_TO: OWNER, INTAKE_DB: db, ACK_REPLIES: 'on' }, {
    now: () => NOW,
    log() {},
    reply: async () => { replies.push('question'); },
  });
  assert.equal(db.optOuts.has(OTHER), false);
});

test('a stop sent to bookings@ records the address and does not start triage', async () => {
  const db = mailDb();
  const stop = fake({
    to: 'bookings@celticcoo.ca',
    subject: 'Re: booking',
    text: 'please stop',
    replyTo: `Jordan <${OTHER}>`,
  });
  const result = await handleInboundEmail(stop, { FORWARD_TO: OWNER, INTAKE_DB: db }, {
    now: () => NOW,
    log() {},
    fetch: async () => { throw new Error('should not file'); },
  });
  assert.equal(result.outcome.skipped, 'opt_out');
  assert.equal(stop.calls.forward.length, 1);
  assert.equal(db.optOuts.has(SENDER), true);
  assert.equal(db.optOuts.has(OTHER), true);
  assert.equal(db.calls.some((call) => /INSERT INTO inbound_emails/i.test(call.sql)), false);

  const ordinary = fake({
    to: 'bookings+desk@celticcoo.ca',
    subject: 'Please list a supper',
    text: 'Please list a Burns supper on 25 January 2027 in Calgary.',
    messageId: '<list@example.com>',
  });
  const ignored = await handleInboundEmail(ordinary, { FORWARD_TO: OWNER, INTAKE_DB: db }, {
    now: () => NOW,
    log() {},
  });
  assert.equal(ignored.outcome.skipped, 'not_hello');
  assert.equal(db.calls.some((call) => /INSERT INTO inbound_emails/i.test(call.sql)), false);
});

function approvalDb({ mode }) {
  const state = {
    id: ROW_ID,
    subject: 'Booking',
    reply_to: SENDER,
    envelope_from: SENDER,
    category: 'booking_inquiry',
    clarify_status: 'pending_approval',
    clarify_draft: 'Hello,\n\nWhich event is this about?\n',
    clarify_reasons: 'missing_event',
    clarify_lock: '',
    error_code: '',
  };
  let checks = 0;
  return {
    state,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/mail_opt_outs/i.test(sql)) {
                checks += 1;
                if (mode === 'missing') throw new Error('no such table');
                if (mode === 'race' && checks === 1) return null;
                if (mode === 'clear') return null;
                return { email: SENDER };
              }
              if (/WHERE id = \?/i.test(sql)) return state.id === args[0] ? { ...state } : null;
              return null;
            },
            async run() {
              if (/error_code = 'opt_out'/i.test(sql)) {
                const [id, lock] = args;
                if (state.id === id && state.clarify_lock === lock) {
                  state.clarify_status = 'discarded';
                  state.clarify_lock = '';
                  state.error_code = 'opt_out';
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/SET clarify_status = 'discarded'/i.test(sql)) {
                const [id] = args;
                if (state.id === id && state.clarify_lock === '' && state.clarify_status === 'pending_approval') {
                  state.clarify_status = 'discarded';
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/SET clarify_status = 'approved', clarify_lock = \?/i.test(sql)) {
                const [lock, id, stale] = args;
                const open = state.clarify_lock === '' || state.clarify_lock < stale;
                if (state.id === id && state.clarify_draft && state.clarify_status === 'pending_approval' && open) {
                  state.clarify_status = 'approved';
                  state.clarify_lock = lock;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

async function postApproval(db) {
  const env = {
    INTAKE_DB: db,
    REVIEW_SECRET: SECRET,
    REVIEW_BASE_URL: 'https://review.celticcoo.ca',
  };
  const links = await reviewLinks(env, ROW_ID, NOW);
  const sent = [];
  const response = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), env, {
    now: () => NOW,
    send: async (mail) => sent.push(mail),
  });
  return { response, html: await response.text(), sent, env };
}

test('an approved booking reply is not sent after a stop, and the page omits the address', async () => {
  const blocked = await postApproval(approvalDb({ mode: 'opted_out' }));
  assert.equal(blocked.response.status, 200);
  assert.match(blocked.html, /asked to stop/);
  assert.doesNotMatch(blocked.html, /ada@example.com/);
  assert.equal(blocked.sent.length, 0);
  assert.equal(blocked.env.INTAKE_DB.state.clarify_status, 'discarded');

  const raced = await postApproval(approvalDb({ mode: 'race' }));
  assert.equal(raced.response.status, 200);
  assert.match(raced.html, /asked to stop/);
  assert.doesNotMatch(raced.html, /ada@example.com/);
  assert.equal(raced.sent.length, 0);
  assert.equal(raced.env.INTAKE_DB.state.clarify_status, 'discarded');
  assert.equal(raced.env.INTAKE_DB.state.error_code, 'opt_out');

  const unknown = await postApproval(approvalDb({ mode: 'missing' }));
  assert.equal(unknown.response.status, 503);
  assert.match(unknown.html, /Nothing was sent/);
  assert.doesNotMatch(unknown.html, /ada@example.com/);
  assert.equal(unknown.sent.length, 0);
  assert.equal(unknown.env.INTAKE_DB.state.clarify_status, 'pending_approval');
});

test('the breach checklist stays generic and the owner booking notice is separate', () => {
  const checklist = readFileSync(join(here, '../../../docs/breach-checklist.md'), 'utf8');
  assert.match(checklist, /real risk of significant harm/);
  assert.match(checklist, /PIPA s\.34\.1, the same federal test/);
  assert.match(checklist, /Office of the Information and Privacy Commissioner/);
  assert.match(checklist, /Where PIPEDA applies/);
  assert.match(checklist, /direct notice to the affected people/);
  assert.match(checklist, /kill switch/);
  assert.match(checklist, /Decision log/);
  assert.match(checklist, /either way/);
  assert.match(checklist, /every breach, even small ones, is kept for 24 months/);
  assert.doesNotMatch(checklist, /@[a-z0-9.-]+\.[a-z]{2,}/i);
  assert.doesNotMatch(checklist, /gmail\.com/i);
  assert.doesNotMatch(checklist, /\b\d{3}[-.)]\d{3}[-.]\d{4}\b/);
  const booking = readFileSync(join(here, '../../../site/src/lib/booking.js'), 'utf8');
  assert.doesNotMatch(booking, /mail_opt_outs|optOutStatus|isOptedOut/);
  const migration = readFileSync(join(here, '../../../site/migrations/0004_mail_opt_outs.sql'), 'utf8');
  assert.match(migration, /60 days/);
  assert.doesNotMatch(migration, /@[a-z0-9.-]+\.[a-z]{2,}/i);
});
