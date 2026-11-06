// Issue #73: a reply that answers a clarifying question must be read with the
// note it answers. Every fixture here is synthetic and uses example.com.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planDraft, threadContext } from '../src/clarify.js';
import { handleInboundEmail } from '../src/index.js';
import { loadThread, THREAD_MAX_ROWS } from '../src/store.js';
import { normalizeSubject } from '../src/text.js';

const SENDER = 'organizer@example.com';
const OWNER = 'owner@example.com';
const NOW = new Date('2026-11-06T20:30:00.000Z');
const SUBJECT = 'Event for The Celtic Coo';
const REPLY_SUBJECT = `Re: ${SUBJECT}`;
const ANSWER = 'Thanks for getting back to me. The event starts at 7:30 a.m. Let me know if you need any other details.';

function earlier(overrides = {}) {
  return {
    subject: SUBJECT,
    category: 'event_listing_request',
    extracted_json: JSON.stringify({ title: 'Sample Ceilidh Night', city: 'Okotoks', date: '2027-02-13' }),
    text_body: 'Please list the Sample Ceilidh Night in Okotoks on 13 February 2027.',
    clarify_status: 'sent',
    clarify_reasons: 'missing_time',
    created_at: '2026-11-06T18:00:00.000Z',
    ...overrides,
  };
}

function reply(thread, overrides = {}) {
  return planDraft({
    category: 'other',
    event: {},
    subject: REPLY_SUBJECT,
    text: ANSWER,
    now: NOW,
    thread,
    ...overrides,
  });
}

test('reply prefixes are stripped so a reply lines up with its note', () => {
  assert.equal(normalizeSubject('Re: Event for The Celtic Coo'), 'event for the celtic coo');
  assert.equal(normalizeSubject('RE: Fwd: re:  Event   for The Celtic Coo '), 'event for the celtic coo');
  assert.equal(normalizeSubject('AW: Event for The Celtic Coo'), 'event for the celtic coo');
  assert.equal(normalizeSubject('Reunion night'), 'reunion night');
  assert.equal(normalizeSubject(''), '');
});

test('without a thread the same reply still gets the generic question (the old behaviour)', () => {
  const plan = reply([]);
  assert.deepEqual(plan.reasons, ['unclear']);
  assert.match(plan.draft, /list an event, correct a listing, or book a performer/);
});

test('a reply that only supplies the start time asks nothing more', () => {
  assert.equal(reply([earlier()]), null);
});

test('only what is still missing is asked, never the generic question', () => {
  const noPlace = earlier({
    extracted_json: JSON.stringify({ title: 'Sample Ceilidh Night', date: '2027-02-13' }),
    clarify_reasons: 'missing_time,missing_place',
  });
  const plan = reply([noPlace]);
  assert.deepEqual(plan.reasons, ['missing_place']);
  assert.match(plan.draft, /Which city is it in/);
  assert.doesNotMatch(plan.draft, /What time does it start/);
  assert.doesNotMatch(plan.draft, /list an event, correct a listing, or book a performer/);
});

test('a reply that answers nothing we asked does not repeat the question', () => {
  const plan = reply([earlier()], {
    text: 'Thanks for your note. Please let me know if you need anything else from us.',
  });
  assert.equal(plan, null);
});

test('the category is inherited from the earlier note, and the event fields are merged', () => {
  const ctx = threadContext({ category: 'other', event: { venue: 'Sample Hall' }, subject: REPLY_SUBJECT, text: ANSWER }, [earlier()]);
  assert.equal(ctx.category, 'event_listing_request');
  assert.equal(ctx.inherited, true);
  assert.deepEqual(ctx.asked, ['missing_time']);
  assert.equal(ctx.event.title, 'Sample Ceilidh Night');
  assert.equal(ctx.event.city, 'Okotoks');
  assert.equal(ctx.event.venue, 'Sample Hall');
  assert.match(ctx.text, /13 February 2027/);
  assert.match(ctx.text, /7:30 a\.m\./);
});

test('a field in the reply wins over the same field in the earlier note', () => {
  const ctx = threadContext({ category: 'other', event: { city: 'Calgary' }, subject: REPLY_SUBJECT, text: ANSWER }, [earlier()]);
  assert.equal(ctx.event.city, 'Calgary');
});

test('an earlier note that was only classified other gives nothing to inherit', () => {
  const plan = reply([earlier({ category: 'other', clarify_status: '', clarify_reasons: '' })]);
  assert.deepEqual(plan.reasons, ['unclear']);
});

test('a newsletter question inside a thread is not turned into a listing', () => {
  const text = 'Can you tell me when the next newsletter goes out? Thanks so much for your help.';
  const ctx = threadContext({ category: 'other', event: {}, subject: REPLY_SUBJECT, text }, [earlier()]);
  assert.equal(ctx.inherited, false);
  assert.equal(ctx.category, 'other');
  assert.equal(reply([earlier()], { text }), null);
});

test('a draft that was never sent counts as no question asked', () => {
  const ctx = threadContext(
    { category: 'other', event: {}, subject: REPLY_SUBJECT, text: ANSWER },
    [earlier({ clarify_status: 'pending_approval' }), earlier({ clarify_status: 'discarded' })],
  );
  assert.deepEqual(ctx.asked, []);
  assert.equal(ctx.inherited, true);
});

test('a reply that picks one date replaces the conflicting dates in the thread', () => {
  const conflicting = earlier({
    text_body: 'Please list the Sample Ceilidh Night on 13 February 2027. Or maybe 20 February 2027.',
    clarify_reasons: 'contradiction',
  });
  const text = 'Please use 13 February 2027. The event starts at 7:30 a.m. and thanks for checking.';
  assert.equal(reply([conflicting], { text }), null);
  // The same conflict with no answer still asks.
  const unanswered = planDraft({
    category: 'event_listing_request',
    event: { title: 'Sample Ceilidh Night', city: 'Okotoks' },
    subject: SUBJECT,
    text: conflicting.text_body,
    now: NOW,
    thread: [],
  });
  assert.deepEqual(unanswered.reasons, ['contradiction']);
});

test('a reply that is itself a clear request keeps its own category', () => {
  const ctx = threadContext(
    { category: 'booking_inquiry', event: {}, subject: REPLY_SUBJECT, text: 'We would also like to hire a piper.' },
    [earlier()],
  );
  assert.equal(ctx.category, 'booking_inquiry');
  assert.equal(ctx.inherited, false);
});

test('spam, automated mail, and the off switch never draft, thread or not', () => {
  assert.equal(reply([earlier()], { category: 'spam' }), null);
  assert.equal(reply([], { automated: true }), null);
  assert.equal(reply([earlier()], { automated: true }), null);
  assert.equal(reply([], { env: { CLARIFY_DRAFTS: 'off' } }), null);
});

function threadDb(rows, { all = true, boom = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          if (boom) throw new Error('d1 unavailable');
          const stmt = {};
          if (all) stmt.all = async () => ({ results: rows });
          return stmt;
        },
      };
    },
  };
}

const LOOKUP = {
  envelopeTo: 'hello@celticcoo.ca',
  sender: 'Organizer@Example.com',
  subject: REPLY_SUBJECT,
  dedupeKey: '<reply-1@example.com>',
  now: NOW,
};

test('the lookup keeps only the same conversation, oldest first, and binds its values', async () => {
  const rows = [
    earlier({ created_at: '2026-11-06T19:00:00.000Z', text_body: 'newest' }),
    earlier({ subject: 'Something else entirely', text_body: 'other subject' }),
    earlier({ subject: 'RE: event for the celtic coo', created_at: '2026-11-05T12:00:00.000Z', text_body: 'older' }),
  ];
  const db = threadDb(rows);
  const found = await loadThread(db, LOOKUP);
  assert.deepEqual(found.map((row) => row.text_body), ['older', 'newest']);
  const [call] = db.calls;
  assert.match(call.sql, /FROM inbound_emails/);
  assert.match(call.sql, /dedupe_key != \?/);
  assert.doesNotMatch(call.sql, /Organizer|example\.com/i);
  assert.equal(call.args[0], 'hello@celticcoo.ca');
  assert.equal(call.args[1], '<reply-1@example.com>');
  assert.deepEqual(call.args.slice(4), ['organizer@example.com', 'organizer@example.com', 'organizer@example.com']);
  assert.ok(call.args[2] < call.args[3]);
});

test('the lookup never returns more than the cap', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => earlier({ created_at: `2026-11-0${(i % 6) + 1}T00:00:00.000Z` }));
  const found = await loadThread(threadDb(rows), LOOKUP);
  assert.equal(found.length, THREAD_MAX_ROWS);
});

test('a lookup that cannot run returns no thread instead of throwing', async () => {
  assert.deepEqual(await loadThread(null, LOOKUP), []);
  assert.deepEqual(await loadThread(threadDb([], { boom: true }), LOOKUP), []);
  assert.deepEqual(await loadThread(threadDb([], { all: false }), LOOKUP), []);
  assert.deepEqual(await loadThread(threadDb([earlier()]), { ...LOOKUP, sender: '' }), []);
  assert.deepEqual(await loadThread(threadDb([earlier()]), { ...LOOKUP, subject: '' }), []);
});

function mime(subject, text) {
  return [
    `From: Organizer <${SENDER}>`,
    'To: hello@celticcoo.ca',
    `Subject: ${subject}`,
    'Date: Fri, 06 Nov 2026 20:20:00 +0000',
    'Message-ID: <reply-1@example.com>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');
}

function fakeMessage(raw) {
  return {
    from: SENDER,
    to: 'hello@celticcoo.ca',
    headers: new Headers({ subject: REPLY_SUBJECT, date: 'Fri, 06 Nov 2026 20:20:00 +0000', 'message-id': '<reply-1@example.com>' }),
    raw,
    rawSize: raw.length,
    async forward() {},
    async reply() { throw new Error('the handler must not reply'); },
  };
}

function intakeDb(priorRows) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { calls.push({ sql, args, op: 'first' }); return null; },
            async all() { calls.push({ sql, args, op: 'all' }); return { results: priorRows }; },
            async run() { calls.push({ sql, args, op: 'run' }); return { success: true, meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
}

async function receive(priorRows) {
  const db = intakeDb(priorRows);
  const sent = [];
  await handleInboundEmail(fakeMessage(mime(REPLY_SUBJECT, ANSWER)), {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    ACK_REPLIES: 'off',
    CLARIFY_DRAFTS: 'drafts',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, {
    now: () => NOW,
    log() {},
    classify: async () => ({
      category: 'other',
      confidence: 0.4,
      summary: 'A reply.',
      event: {},
      classifier: 'rules',
      reason: 'rules_ok',
    }),
  });
  const insert = db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  return { db, sent, insert };
}

test('end to end: the answer to our time question is stored with no new draft', async () => {
  const { db, sent, insert } = await receive([earlier()]);
  assert.ok(db.calls.some((call) => call.op === 'all' && /FROM inbound_emails/.test(call.sql)));
  assert.equal(insert.args.includes('pending_approval'), false);
  assert.equal(sent.length, 0);
  // The stored category is still what the classifier said. Only the draft plan used the thread.
  assert.equal(insert.args.includes('other'), true);
});

test('end to end: with no earlier note the reply is drafted exactly as before', async () => {
  const { insert, sent } = await receive([]);
  assert.equal(insert.args.includes('pending_approval'), true);
  assert.equal(insert.args.includes('unclear'), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OWNER);
});
