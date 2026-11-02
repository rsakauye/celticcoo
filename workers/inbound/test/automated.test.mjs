import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { automatedReason, isAutomated, maybeAcknowledge } from '../src/ack.js';
import { handleInboundEmail } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const OWNER = 'owner@example.com';
const GMAIL = 'ada.morgan@gmail.com';
const NOW = new Date('2026-10-25T14:35:00.000Z');

function headers(extra = {}) {
  return new Headers(extra);
}

function message({ from = 'ada@example.com', ...headerFields } = {}) {
  return {
    from,
    headers: headers(headerFields),
  };
}

test('automated sender signals are recognized and a gmail writer is not', () => {
  const gmail = {
    from: GMAIL,
    headers: headers({
      from: `Ada Morgan <${GMAIL}>`,
      'reply-to': GMAIL,
      'auto-submitted': 'no',
    }),
  };
  assert.equal(automatedReason(gmail), '');
  assert.equal(isAutomated(gmail), false);

  const displayOnly = {
    from: GMAIL,
    headers: headers({ from: `No Reply <${GMAIL}>` }),
  };
  assert.equal(automatedReason(displayOnly), '');

  const domainOnly = {
    from: 'ada@noreply.example.com',
    headers: headers({ from: 'Ada <ada@noreply.example.com>' }),
  };
  assert.equal(automatedReason(domainOnly), '');

  assert.equal(automatedReason(message({
    from: 'news@example.com',
    'list-unsubscribe': '<mailto:unsub@example.com>',
  })), 'list_unsubscribe');
  assert.equal(automatedReason(message({
    from: 'news@example.com',
    'list-id': '<week.example.com>',
  })), 'list_id');
  assert.equal(automatedReason(message({
    from: 'news@example.com',
    'auto-submitted': 'auto-generated',
  })), 'auto_submitted');
  assert.equal(automatedReason(message({
    from: 'news@example.com',
    'auto-submitted': 'auto-replied',
  })), 'auto_submitted');
  assert.equal(automatedReason(message({
    from: GMAIL,
    'auto-submitted': 'no',
  })), '');
  assert.equal(automatedReason(message({
    from: 'news@example.com',
    precedence: 'Bulk',
  })), 'precedence');
  assert.equal(automatedReason(message({
    from: 'news@example.com',
    precedence: 'list',
  })), 'precedence');
  assert.equal(automatedReason(message({
    from: 'news@example.com',
    precedence: 'junk',
  })), 'precedence');
  assert.equal(automatedReason(message({
    from: GMAIL,
    precedence: 'normal',
  })), '');

  for (const from of [
    'noreply@example.com',
    'No Reply <no-reply@example.com>',
    'no_reply@example.com',
    'donotreply@example.com',
    'Do Not Reply <do-not-reply@example.com>',
    'mailer-daemon@example.com',
    'postmaster@example.com',
  ]) {
    assert.equal(automatedReason(message({ from })), 'sender', from);
  }

  const envelopeBounce = {
    from: 'bounce@example.net',
    headers: headers({ from: 'Notifier <noreply@example.com>' }),
  };
  assert.equal(automatedReason(envelopeBounce), 'sender');

  const parsedFrom = automatedReason(
    { from: 'bounce@example.net', headers: headers() },
    { fromHeader: 'Notifier <donotreply@example.com>' },
  );
  assert.equal(parsedFrom, 'sender');

  const replyTo = {
    from: GMAIL,
    headers: headers({ 'reply-to': 'do-not-reply@example.com' }),
  };
  assert.equal(automatedReason(replyTo), 'sender');

  assert.equal(automatedReason({ from: '', headers: headers() }), 'sender');

  const combined = automatedReason(message({
    from: 'noreply@example.com',
    'list-unsubscribe': '<mailto:unsub@example.com>',
    'list-id': '<week.example.com>',
    'auto-submitted': 'auto-generated',
    precedence: 'bulk',
  }));
  assert.equal(combined, 'list_unsubscribe,list_id,auto_submitted,precedence,sender');
  assert.equal(combined.includes('unsub@example.com'), false);
  assert.equal(combined.includes('noreply@example.com'), false);

  const bangs = '!'.repeat(20000);
  const started = Date.now();
  const noisy = automatedReason({
    from: GMAIL,
    headers: headers({ from: `${bangs} Ada Morgan <${GMAIL}>` }),
  });
  const hidden = automatedReason({
    from: 'bounce@example.net',
    headers: headers({ from: `${bangs}<noreply@example.com>` }),
  });
  assert.ok(Date.now() - started < 1000);
  assert.equal(noisy, '');
  assert.equal(hidden, 'sender');
});

test('an acknowledgement skips mail that carries a list-unsubscribe header', async () => {
  const bulk = message({
    from: 'news@example.com',
    'list-unsubscribe': '<mailto:unsub@example.com>',
  });
  const skipped = await maybeAcknowledge(bulk, { ACK_REPLIES: 'on' }, {
    reply: async () => { throw new Error('no reply to bulk mail'); },
  });
  assert.equal(skipped.status, 'skipped');
});

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

function mime({ from, subject, text }) {
  return [
    `From: ${from}`,
    'To: hello@celticcoo.ca',
    `Subject: ${subject}`,
    'Date: Sat, 25 Oct 2026 14:35:00 +0000',
    'Message-ID: <automated-test@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');
}

function inbound({ from, fromHeader, subject, text, headerFields = {}, messageId = '<automated-test@example.com>' }) {
  const raw = mime({
    from: fromHeader || from,
    subject,
    text,
  });
  return {
    from,
    to: 'hello@celticcoo.ca',
    headers: headers({
      subject,
      from: fromHeader || from,
      date: 'Sat, 25 Oct 2026 14:35:00 +0000',
      'message-id': messageId,
      ...headerFields,
    }),
    raw,
    rawSize: raw.length,
    calls: { forward: [] },
    async forward(to) { this.calls.forward.push(to); },
    async reply() { throw new Error('reply should not run'); },
  };
}

const vague = 'Hello there, I am writing with a general question about your pages and I hope you can point me the right way.';
const booking = 'We would like to hire a piper for a wedding next spring. The old note mentioned noreply@example.com and that address is not mine.';

function insertOf(db) {
  return db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql) && call.op === 'run');
}

test('bulk mail is stored and forwarded without a draft, and a gmail note still gets one', async () => {
  const other = {
    category: 'other',
    confidence: 0,
    summary: 'Other message.',
    event: {},
    classifier: 'ai',
    reason: 'ai_ok',
  };
  const sent = [];
  const logs = [];
  const bulkDb = memoryDb();
  const bulk = inbound({
    from: 'bounce@example.net',
    fromHeader: 'Weekly notes <news@example.com>',
    subject: 'Your week with the list',
    text: vague,
    headerFields: {
      'list-unsubscribe': '<mailto:unsub@example.com>',
      'list-id': '<week.example.com>',
    },
  });
  const bulkResult = await handleInboundEmail(bulk, {
    FORWARD_TO: OWNER,
    INTAKE_DB: bulkDb,
    CLARIFY_DRAFTS: 'drafts',
    ACK_REPLIES: 'on',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, {
    now: () => NOW,
    log: (line) => logs.push(line),
    classify: async () => other,
    reply: async () => { throw new Error('no ack for bulk mail'); },
  });
  assert.equal(bulk.calls.forward.length, 1);
  assert.equal(bulkResult.forward.status, 'sent');
  const bulkInsert = insertOf(bulkDb);
  assert.equal(bulkInsert.args.length, (bulkInsert.sql.match(/\?/g) || []).length);
  assert.equal(bulkInsert.args.includes('pending_approval'), false);
  assert.equal(bulkInsert.args.includes('list_unsubscribe,list_id'), true);
  assert.equal(bulkInsert.args.includes('unsub@example.com'), false);
  assert.equal(sent.length, 0);
  const outcome = JSON.parse(logs.find((line) => line.includes('"inbound email"')));
  assert.equal(outcome.draft_skip, 'list_unsubscribe,list_id');
  assert.equal(outcome.draft_skip.includes('@'), false);

  sent.length = 0;
  const gmailDb = memoryDb();
  const gmail = inbound({
    from: GMAIL,
    fromHeader: `Ada Morgan <${GMAIL}>`,
    subject: 'A question',
    text: vague,
    messageId: '<gmail-question@example.com>',
  });
  await handleInboundEmail(gmail, {
    FORWARD_TO: OWNER,
    INTAKE_DB: gmailDb,
    CLARIFY_DRAFTS: 'drafts',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, {
    now: () => NOW,
    log() {},
    classify: async () => other,
  });
  const gmailInsert = insertOf(gmailDb);
  assert.equal(gmailInsert.args.includes('pending_approval'), true);
  for (const code of ['list_unsubscribe', 'list_id', 'auto_submitted', 'precedence', 'sender']) {
    assert.equal(gmailInsert.args.includes(code), false);
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OWNER);
  assert.equal(sent[0].to === GMAIL, false);

  sent.length = 0;
  const humanDb = memoryDb();
  const human = inbound({
    from: GMAIL,
    fromHeader: `Ada Morgan <${GMAIL}>`,
    subject: 'Piper for a wedding',
    text: booking,
    messageId: '<gmail-booking@example.com>',
  });
  await handleInboundEmail(human, {
    FORWARD_TO: OWNER,
    INTAKE_DB: humanDb,
    CLARIFY_DRAFTS: 'drafts',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, { now: () => NOW, log() {} });
  const humanInsert = insertOf(humanDb);
  assert.equal(humanInsert.args.includes('pending_approval'), true);
  assert.equal(humanInsert.args.includes('sender'), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OWNER);

  sent.length = 0;
  const daemonDb = memoryDb();
  const daemon = inbound({
    from: 'bounce@example.net',
    fromHeader: 'Notifier <donotreply@example.com>',
    subject: 'Piper for a wedding',
    text: booking,
    messageId: '<donotreply-booking@example.com>',
  });
  await handleInboundEmail(daemon, {
    FORWARD_TO: OWNER,
    INTAKE_DB: daemonDb,
    CLARIFY_DRAFTS: 'drafts',
    ACK_REPLIES: 'on',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, {
    now: () => NOW,
    log() {},
    reply: async () => { throw new Error('no ack for donotreply'); },
  });
  const daemonInsert = insertOf(daemonDb);
  assert.equal(daemon.calls.forward.length, 1);
  assert.equal(daemonInsert.args.includes('pending_approval'), false);
  assert.equal(daemonInsert.args.includes('sender'), true);
  assert.equal(daemonInsert.args.includes('list_unsubscribe'), false);
  assert.equal(sent.length, 0);
});

test('the draft skip migration adds the reason column and does not store an address', () => {
  const sql = readFileSync(join(here, '../../../site/migrations/0009_draft_skip_reason.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE inbound_emails ADD COLUMN draft_skip_reason/);
  assert.match(sql, /Apply by hand/);
  assert.doesNotMatch(sql, /@/);
});
