import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyMessage } from '../src/classify.js';
import { assessGaps, buildDraft, clarifyMode, planDraft } from '../src/clarify.js';
import { handleFetch, handleInboundEmail } from '../src/index.js';
import { hasPrivateContact } from '../src/redact.js';
import { buildReviewNote, sendApprovedReply } from '../src/review.js';
import { reviewLinks, signAction, verifyAction } from '../src/token.js';

const here = dirname(fileURLToPath(import.meta.url));
const OWNER = 'owner@example.com';
const SENDER = 'ada@example.com';
const SECRET = 'test-review-secret-value';
const NOW = new Date('2026-10-25T14:35:00.000Z');
const ROW_ID = '11111111-2222-4333-8444-555555555555';

function memoryDb() {
  const calls = [];
  const state = { row: null };
  return {
    calls,
    state,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.push({ sql, args, op: 'first' });
              return state.row;
            },
            async run() {
              calls.push({ sql, args, op: 'run' });
              if (/INSERT INTO inbound_emails/i.test(sql)) {
                state.row = { id: args[0], issue_status: 'skipped', issue_url: '', clarify_status: '' };
              }
              if (/SET issue_status = \?/i.test(sql)) {
                state.row = {
                  ...(state.row || {}),
                  id: args[args.length - 1],
                  issue_status: args[0],
                  issue_url: args[1] || '',
                };
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function reviewDb(row) {
  const state = { clarify_lock: '', ...row };
  return {
    state,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (/WHERE id = \?/i.test(sql)) return state.id === args[0] ? { ...state } : null;
              return { ...state };
            },
            async run() {
              if (/SET clarify_status = 'approved', clarify_lock = \?/i.test(sql)) {
                const [lock, id, stale] = args;
                const open = state.clarify_lock === '' || state.clarify_lock < stale;
                const statusOk = state.clarify_status === 'pending_approval' || state.clarify_status === 'approved';
                if (state.id === id && state.clarify_draft && statusOk && open) {
                  state.clarify_status = 'approved';
                  state.clarify_lock = lock;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/SET clarify_status = 'sent'/i.test(sql)) {
                const [id, lock] = args;
                if (state.id === id && state.clarify_lock === lock) {
                  state.clarify_status = 'sent';
                  state.clarify_lock = '';
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/clarify_send_failed/i.test(sql)) {
                const [id, lock] = args;
                if (state.id === id && state.clarify_lock === lock) {
                  state.clarify_status = 'approved';
                  state.clarify_lock = '';
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (/SET clarify_status = 'discarded'/i.test(sql)) {
                const [id] = args;
                const ok = state.id === id
                  && state.clarify_lock === ''
                  && (state.clarify_status === 'pending_approval' || state.clarify_status === 'approved');
                if (!ok) return { meta: { changes: 0 } };
                state.clarify_status = 'discarded';
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function mime(subject, text) {
  return [
    `From: Ada <${SENDER}>`,
    'To: hello@celticcoo.ca',
    `Subject: ${subject}`,
    'Date: Sat, 25 Oct 2026 14:35:00 +0000',
    'Message-ID: <clarify-1@example.com>',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');
}

function fake(overrides = {}) {
  const headers = new Headers({
    subject: overrides.subject || 'Hello',
    date: 'Sat, 25 Oct 2026 14:35:00 +0000',
    'message-id': overrides.messageId || '<clarify-1@example.com>',
  });
  const calls = { forward: [], reply: [] };
  return {
    from: overrides.from || SENDER,
    to: 'hello@celticcoo.ca',
    headers,
    raw: overrides.raw || '',
    rawSize: (overrides.raw || '').length || 80,
    calls,
    async forward(to) { calls.forward.push(to); },
    async reply(value) { calls.reply.push(value); },
  };
}

const listed = {
  category: 'event_listing_request',
  event: {
    title: 'Calgary Burns Supper',
    host: 'Calgary Burns Club',
    date: '25 January 2027',
    city: 'Calgary',
    province: 'Alberta',
    venue: 'Glencoe Club',
    url: 'https://calgaryburns.example/supper',
  },
  subject: 'Please list our Burns Supper',
  text: 'The Calgary Burns Club is hosting a Burns Supper on 25 January 2027 at 6:30 pm at the Glencoe Club in Calgary, Alberta. https://calgaryburns.example/supper',
  now: NOW,
};

test('clarify mode defaults to drafts and has no auto-send setting', () => {
  assert.equal(clarifyMode({}), 'drafts');
  assert.equal(clarifyMode({ CLARIFY_DRAFTS: 'drafts' }), 'drafts');
  assert.equal(clarifyMode({ CLARIFY_DRAFTS: 'auto' }), 'drafts');
  assert.equal(clarifyMode({ CLARIFY_DRAFTS: 'on' }), 'drafts');
  assert.equal(clarifyMode({ CLARIFY_DRAFTS: 'off' }), 'off');
});

test('gaps are only the missing or contradictory facts', () => {
  assert.deepEqual(assessGaps(listed), []);
  assert.deepEqual(assessGaps({
    ...listed,
    text: 'The Calgary Burns Club is hosting a Burns Supper on 25 January 2027 at the Glencoe Club in Calgary, Alberta. https://calgaryburns.example/supper',
  }), ['missing_time']);
  assert.deepEqual(assessGaps({
    category: 'event_listing_request',
    event: { title: 'Games', host: '', date: '', city: '', venue: '', url: '' },
    subject: 'Please list our games',
    text: 'Please list our Highland Games. We would love to be on the calendar.',
    now: NOW,
  }), ['missing_when', 'missing_place']);
  assert.deepEqual(assessGaps({
    ...listed,
    text: 'The Calgary Burns Club is hosting a Burns Supper on 1 January 2020 at 6:30 pm at the Glencoe Club in Calgary, Alberta. https://calgaryburns.example/supper',
    event: { ...listed.event, date: '1 January 2020' },
  }), ['past_date']);
  assert.deepEqual(assessGaps({
    ...listed,
    text: 'Please list the Calgary Burns Supper on 1 July 2027 or on 2 July 2027 at 7 pm at the Glencoe Club in Calgary, Alberta. https://calgaryburns.example/supper',
  }), ['contradiction']);
  assert.deepEqual(assessGaps({
    category: 'correction_or_update',
    event: { title: 'Victoria Highland Games', host: '', date: '18 July 2027', city: '', venue: '', url: '' },
    subject: 'Correction: Victoria Highland Games',
    text: 'The date is wrong. The games are 18 July 2027, not 18 June 2026.',
    now: NOW,
  }), []);
  assert.deepEqual(assessGaps({
    ...listed,
    text: 'The Calgary Burns Club is hosting a Burns Supper on 25 January 2027 at 6:30 pm at the Glencoe Club in Calgary, Alberta. https://user:pass@calgaryburns.example/supper',
  }), ['bad_link']);
  assert.ok(assessGaps({
    ...listed,
    event: { ...listed.event, url: 'https://casino-night.example/play' },
    text: 'The Calgary Burns Club is hosting a Burns Supper on 25 January 2027 at 6:30 pm at the Glencoe Club in Calgary, Alberta. https://casino-night.example/play',
  }).includes('link_mismatch'));
  assert.deepEqual(assessGaps({
    category: 'booking_inquiry',
    event: { title: '', host: '', date: '', city: '', venue: '', url: '' },
    subject: 'Piper',
    text: 'We would like to hire a piper for a wedding.',
    now: NOW,
  }), ['missing_when', 'missing_place']);
  assert.deepEqual(assessGaps({
    category: 'spam',
    event: {},
    subject: 'Offer',
    text: 'Buy now. SEO services for your site today and every day after.',
    now: NOW,
  }), []);
  assert.deepEqual(assessGaps({
    category: 'other',
    event: { title: 'Hello' },
    subject: 'Hello',
    text: 'Just saying the site looks good.',
    now: NOW,
  }), []);
  assert.deepEqual(assessGaps({
    category: 'other',
    event: { title: 'A question about the calendar' },
    subject: 'A question about the calendar',
    text: 'I am not sure if you list community dances or only the big games.',
    now: NOW,
  }), ['unclear']);
});

test('a draft asks only for the gap and does not copy the sender', () => {
  const draft = buildDraft(['missing_time'], 'event_listing_request');
  assert.match(draft, /What time does it start/);
  assert.doesNotMatch(draft, /Burns/);
  assert.doesNotMatch(draft, /ada@example.com/);
  assert.equal(hasPrivateContact(draft), false);
  assert.equal(planDraft({ ...listed, env: { CLARIFY_DRAFTS: 'off' }, text: 'Please list our event.' }), null);
  assert.equal(planDraft({ ...listed, env: {}, automated: true, text: 'Please list our event someday.' }), null);
});

test('the model is called for a short note, and a failed call logs a reason without the email', async () => {
  const logs = [];
  let calls = 0;
  const input = { subject: 'Hi', text: `Yes from ${SENDER}` };
  const short = await classifyMessage(input, {}, {
    log: (line) => logs.push(line),
    run: async () => {
      calls += 1;
      return { response: { category: 'other', confidence: 0.42, summary: 'A short note.' } };
    },
  });
  assert.equal(calls, 1);
  assert.equal(short.classifier, 'ai');
  assert.equal(short.reason, 'ai_ok');
  assert.equal(logs.some((line) => line.includes(SENDER) || line.includes('Yes from')), false);

  const failedLogs = [];
  const payloads = [];
  const failed = await classifyMessage(
    { subject: 'Please list our Burns Supper', text: `Please list it. ${SENDER}` },
    { AI: { async run() { throw new Error('should use deps.run'); } } },
    {
      log: (line) => failedLogs.push(line),
      run: async (_model, payload) => {
        payloads.push(payload);
        const err = new Error(`JSON mode rejected the note from ${SENDER}`);
        err.code = 'bad_request';
        throw err;
      },
    },
  );
  assert.equal(failed.classifier, 'rules');
  assert.equal(failed.reason, 'ai_request');
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].response_format.type, 'json_schema');
  assert.equal(Object.hasOwn(payloads[0], 'temperature'), false);
  assert.equal(payloads[1].response_format, undefined);
  assert.equal(failedLogs.some((line) => line.includes(SENDER) || line.includes('JSON mode rejected')), false);
  assert.match(failedLogs.at(-1), /"reason":"ai_request"/);

  const textLogs = [];
  let textCalls = 0;
  const recovered = await classifyMessage(input, {}, {
    log: (line) => textLogs.push(line),
    run: async () => {
      textCalls += 1;
      if (textCalls === 1) {
        const err = new Error('response_format was not accepted');
        throw err;
      }
      return { response: '{"category":"other","confidence":0.5,"summary":"A short note."}' };
    },
  });
  assert.equal(textCalls, 2);
  assert.equal(recovered.classifier, 'ai');
  assert.equal(recovered.reason, 'ai_text');
  assert.match(textLogs.at(-1), /"reason":"ai_text"/);

  const unavailable = [];
  const skipped = await classifyMessage(input, { AI: { binding: true } }, {
    log: (line) => unavailable.push(line),
  });
  assert.equal(skipped.classifier, 'rules');
  assert.equal(skipped.reason, 'ai_unavailable');
  assert.match(unavailable[0], /"binding":"object"/);
  assert.match(unavailable[0], /"run":"undefined"/);
  assert.equal(unavailable.some((line) => line.includes(SENDER)), false);
});

test('a review note goes to the owner and the sender is not mailed', async () => {
  const db = memoryDb();
  const sent = [];
  const logs = [];
  const raw = mime(
    'Piper for a wedding',
    'We would like to hire a piper for a wedding next spring.',
  );
  const message = fake({ subject: 'Piper for a wedding', raw });
  const result = await handleInboundEmail(message, {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    ACK_REPLIES: 'off',
    CLARIFY_DRAFTS: 'drafts',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, { now: () => NOW, log: (line) => logs.push(line) });
  assert.equal(result.outcome.category, 'booking_inquiry');
  assert.equal(message.calls.reply.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OWNER);
  assert.notEqual(sent[0].to, SENDER);
  assert.equal(sent[0].from.email, 'hello@celticcoo.ca');
  assert.match(sent[0].text, /What is the date/);
  assert.match(sent[0].text, /ada@example.com/);
  assert.match(sent[0].text, /Approval links are not configured/);
  assert.doesNotMatch(sent[0].text, /\/review\?/);
  const insert = db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  assert.equal(insert.args.includes('pending_approval'), true);
  assert.equal(logs.some((line) => line.includes(SENDER) || line.includes('403')), false);
  assert.match(logs.join('\n'), /ai_unavailable/);
});

test('an event issue shows the draft and not the approval link or the sender', async () => {
  const db = memoryDb();
  const github = { calls: [] };
  const raw = mime(
    'Please list our Burns Supper',
    'The Calgary Burns Club is hosting a Burns Supper on 25 January 2027 at the Glencoe Club in Calgary, Alberta. https://calgaryburns.example/supper',
  );
  const message = fake({
    subject: 'Please list our Burns Supper',
    raw,
    messageId: '<draft-issue@example.com>',
  });
  message.headers.set('message-id', '<draft-issue@example.com>');
  await handleInboundEmail(message, {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    GITHUB_TOKEN: 'github_pat_test_token_value_123456',
    ACK_REPLIES: 'off',
    REVIEW_SECRET: SECRET,
    REVIEW_BASE_URL: 'https://review.celticcoo.ca',
  }, {
    now: () => NOW,
    log() {},
    fetch: async (url, init) => {
      github.calls.push({ url: String(url), init });
      if (String(url).endsWith('/labels')) return { status: 201, text: async () => '{}' };
      return {
        status: 201,
        text: async () => JSON.stringify({
          number: 7,
          html_url: 'https://github.com/rsakauye/celticcoo/issues/7',
        }),
      };
    },
  });
  const issueCall = github.calls.find((call) => String(call.url).endsWith('/issues'));
  const body = JSON.parse(issueCall.init.body);
  assert.match(body.body, /What time does it start/);
  assert.match(body.body, /pending_approval/);
  assert.doesNotMatch(body.body, /\/review\?/);
  assert.doesNotMatch(body.body, /token=/);
  assert.doesNotMatch(body.body, /ada@example.com/);
  assert.equal(hasPrivateContact(`${body.title}\n${body.body}`), false);
});

test('approval links require a POST and send the stored draft once', async () => {
  const draft = buildDraft(['missing_when', 'missing_place'], 'booking_inquiry');
  const row = {
    id: ROW_ID,
    subject: 'Piper for a wedding',
    reply_to: '',
    envelope_from: SENDER,
    category: 'booking_inquiry',
    clarify_status: 'pending_approval',
    clarify_draft: draft,
    clarify_reasons: 'missing_when,missing_place',
  };
  const db = reviewDb(row);
  const env = {
    INTAKE_DB: db,
    REVIEW_SECRET: SECRET,
    REVIEW_BASE_URL: 'https://review.celticcoo.ca',
    FORWARD_TO: OWNER,
  };
  const links = await reviewLinks(env, ROW_ID, NOW);
  const sent = [];
  const send = async (mail) => sent.push(mail);

  const peeked = await handleFetch(new Request(links.approve), env, { now: () => NOW, send });
  const peekHtml = await peeked.text();
  assert.equal(peeked.status, 200);
  assert.match(peekHtml, /What is the date/);
  assert.match(peekHtml, /ada@example.com/);
  assert.equal(sent.length, 0);
  assert.equal(db.state.clarify_status, 'pending_approval');

  const unconfirmed = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URL(links.approve).search.slice(1),
  }), env, { now: () => NOW, send });
  assert.equal(unconfirmed.status, 400);
  assert.equal(sent.length, 0);

  const approved = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), env, { now: () => NOW, send });
  assert.equal(approved.status, 200);
  assert.match(await approved.text(), /was sent/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, SENDER);
  assert.equal(sent[0].from.email, 'hello@celticcoo.ca');
  assert.equal(sent[0].replyTo.email, 'hello@celticcoo.ca');
  assert.equal(sent[0].text, draft);
  assert.doesNotMatch(sent[0].text, /ada@example.com/);
  assert.equal(db.state.clarify_status, 'sent');

  const again = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), env, { now: () => NOW, send });
  assert.equal(again.status, 200);
  assert.match(await again.text(), /already sent/i);
  assert.equal(sent.length, 1);
});

test('a bad, expired, or discard link does not send', async () => {
  const draft = buildDraft(['unclear'], 'other');
  const db = reviewDb({
    id: ROW_ID,
    subject: 'Question',
    reply_to: SENDER,
    envelope_from: SENDER,
    category: 'other',
    clarify_status: 'pending_approval',
    clarify_draft: draft,
    clarify_reasons: 'unclear',
  });
  const env = { INTAKE_DB: db, REVIEW_SECRET: SECRET, REVIEW_BASE_URL: 'https://review.celticcoo.ca' };
  const sent = [];
  const send = async (mail) => sent.push(mail);
  const links = await reviewLinks(env, ROW_ID, NOW);
  const tamperedUrl = new URL(links.approve);
  const token = tamperedUrl.searchParams.get('token');
  tamperedUrl.searchParams.set('token', `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`);
  const tampered = tamperedUrl.toString();
  const bad = await handleFetch(new Request(tampered), env, { now: () => NOW, send });
  assert.equal(bad.status, 403);
  assert.doesNotMatch(await bad.text(), /Are you asking to list/);

  const expiredToken = await signAction(SECRET, { action: 'approve', id: ROW_ID, exp: 1_700_000_000 });
  const expired = await handleFetch(
    new Request(`https://review.celticcoo.ca/review?id=${ROW_ID}&action=approve&exp=1700000000&token=${expiredToken}`),
    env,
    { now: () => NOW, send },
  );
  assert.equal(expired.status, 403);

  const discarded = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.discard).search.slice(1)}&confirm=yes`,
  }), env, { now: () => NOW, send });
  assert.equal(discarded.status, 200);
  assert.match(await discarded.text(), /Discarded/);
  assert.equal(sent.length, 0);
  assert.equal(db.state.clarify_status, 'discarded');

  assert.equal(await verifyAction(SECRET, {
    action: 'approve',
    id: ROW_ID,
    exp: Math.floor(NOW.getTime() / 1000) + 60,
    token: 'not-a-token',
    nowSec: Math.floor(NOW.getTime() / 1000),
  }), false);
});

test('a locked or unsafe draft is not sent, and a failed send can be retried', async () => {
  const draft = buildDraft(['missing_time'], 'event_listing_request');
  const locked = reviewDb({
    id: ROW_ID,
    subject: 'Please list our Burns Supper',
    reply_to: SENDER,
    envelope_from: SENDER,
    category: 'event_listing_request',
    clarify_status: 'pending_approval',
    clarify_draft: draft,
    clarify_reasons: 'missing_time',
    clarify_lock: String(NOW.getTime()).padStart(16, '0'),
  });
  const env = { INTAKE_DB: locked, REVIEW_SECRET: SECRET, REVIEW_BASE_URL: 'https://review.celticcoo.ca' };
  const links = await reviewLinks(env, ROW_ID, NOW);
  const sent = [];
  const busy = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), env, { now: () => NOW, send: async (mail) => sent.push(mail) });
  assert.equal(busy.status, 409);
  assert.equal(sent.length, 0);

  const unsafe = reviewDb({
    id: ROW_ID,
    subject: 'Please list our Burns Supper',
    reply_to: SENDER,
    envelope_from: SENDER,
    category: 'event_listing_request',
    clarify_status: 'pending_approval',
    clarify_draft: `Hello\nEmail ${SENDER}\n`,
    clarify_reasons: 'missing_time',
  });
  let unsafeSends = 0;
  const blocked = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), { ...env, INTAKE_DB: unsafe }, {
    now: () => NOW,
    send: async () => { unsafeSends += 1; },
  });
  assert.equal(blocked.status, 502);
  assert.equal(unsafeSends, 0);
  assert.equal(unsafe.state.clarify_status, 'approved');

  const flaky = reviewDb({
    id: ROW_ID,
    subject: 'Piper for a wedding',
    reply_to: SENDER,
    envelope_from: SENDER,
    category: 'booking_inquiry',
    clarify_status: 'pending_approval',
    clarify_draft: draft,
    clarify_reasons: 'missing_time',
  });
  let attempts = 0;
  const first = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), { ...env, INTAKE_DB: flaky }, {
    now: () => NOW,
    send: async () => {
      attempts += 1;
      const err = new Error(`mailbox rejected ${SENDER}`);
      err.code = 'e_sender_not_verified';
      throw err;
    },
  });
  assert.equal(first.status, 502);
  assert.equal(flaky.state.clarify_status, 'approved');
  assert.equal(flaky.state.clarify_lock, '');
  const second = await handleFetch(new Request('https://review.celticcoo.ca/review', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `${new URL(links.approve).search.slice(1)}&confirm=yes`,
  }), { ...env, INTAKE_DB: flaky }, {
    now: () => new Date(NOW.getTime() + 1000),
    send: async (mail) => { attempts += 1; assert.equal(mail.to, SENDER); },
  });
  assert.equal(second.status, 200);
  assert.equal(attempts, 2);
  assert.equal(flaky.state.clarify_status, 'sent');
});

test('drafts stay off when the flag is off, and spam is not drafted', async () => {
  const db = memoryDb();
  const sent = [];
  const raw = mime('Piper for a wedding', 'We would like to hire a piper for a wedding next spring.');
  await handleInboundEmail(fake({ subject: 'Piper for a wedding', raw }), {
    FORWARD_TO: OWNER,
    INTAKE_DB: db,
    CLARIFY_DRAFTS: 'off',
    ACK_REPLIES: 'off',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, { now: () => NOW, log() {} });
  const insert = db.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  assert.equal(insert.args.includes('pending_approval'), false);
  assert.equal(sent.length, 0);

  const spamDb = memoryDb();
  const spamRaw = mime('Guest post offer', 'We can rank your site with SEO services. Buy now.');
  await handleInboundEmail(fake({ subject: 'Guest post offer', raw: spamRaw, messageId: '<spam@example.com>' }), {
    FORWARD_TO: OWNER,
    INTAKE_DB: spamDb,
    CLARIFY_DRAFTS: 'auto',
    EMAIL: { send: async (mail) => sent.push(mail) },
  }, { now: () => NOW, log() {} });
  const spamInsert = spamDb.calls.find((call) => /INSERT INTO inbound_emails/i.test(call.sql));
  assert.equal(spamInsert.args.includes('pending_approval'), false);
  assert.equal(sent.length, 0);
});

test('the review page escapes the stored draft and other routes stay closed', async () => {
  const db = reviewDb({
    id: ROW_ID,
    subject: 'Question',
    reply_to: SENDER,
    envelope_from: SENDER,
    category: 'other',
    clarify_status: 'pending_approval',
    clarify_draft: 'Hello\n<script>alert(1)</script>',
    clarify_reasons: 'unclear',
  });
  const env = { INTAKE_DB: db, REVIEW_SECRET: SECRET, REVIEW_BASE_URL: 'https://review.celticcoo.ca' };
  const links = await reviewLinks(env, ROW_ID, NOW);
  const response = await handleFetch(new Request(links.approve), env, { now: () => NOW, send: async () => { throw new Error('no send'); } });
  const html = await response.text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  const missing = await handleFetch(new Request('https://review.celticcoo.ca/'), env);
  assert.equal(missing.status, 404);
  const note = buildReviewNote({
    id: ROW_ID,
    category: 'booking_inquiry',
    reasons: ['missing_when'],
    draft: buildDraft(['missing_when'], 'booking_inquiry'),
    recipient: SENDER,
    links: null,
    forwardStatus: 'sent',
  });
  assert.match(note, /Nothing has been sent/);
  assert.doesNotMatch(note, /token=/);
});

test('sendApprovedReply refuses a draft that still has a phone number', async () => {
  await assert.rejects(
    () => sendApprovedReply({}, { to: SENDER, subject: 'Hello', text: 'Call 403-555-0199' }, { send: async () => { throw new Error('should not send'); } }),
    (err) => err.code === 'clarify_draft_blocked',
  );
});

test('config keeps drafts-only, acknowledgements off, and the owner inbox out of git', () => {
  const root = join(here, '..');
  const config = readFileSync(join(root, 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(config, /"ACK_REPLIES": "off"/);
  assert.match(config, /"CLARIFY_DRAFTS": "drafts"/);
  assert.match(config, /"send_email"/);
  assert.doesNotMatch(config, /destination_address/);
  assert.doesNotMatch(config, /"addresses"/);
  assert.doesNotMatch(config, /"routes"/);
  const index = readFileSync(join(root, 'src/index.js'), 'utf8');
  assert.doesNotMatch(index, /sendApprovedReply/);
  assert.match(index, /sendReviewNote/);
  const sql = readFileSync(join(here, '../../../site/migrations/0003_inbound_clarify.sql'), 'utf8');
  assert.match(sql, /clarify_status/);
  assert.match(sql, /classifier_reason/);
  assert.equal(hasPrivateContact(sql), false);
  const docs = readFileSync(join(here, '../../../docs/inbound-email.md'), 'utf8');
  assert.match(docs, /REVIEW_SECRET/);
  assert.match(docs, /REVIEW_BASE_URL/);
  assert.match(docs, /b0e54ddb-eca8-4072-99f3-c1efb4d60824/);
  assert.match(docs, /ai_unavailable/);
  const workflow = readFileSync(join(here, '../../../.github/workflows/deploy.yml'), 'utf8');
  assert.match(workflow, /REVIEW_SECRET/);
  assert.match(workflow, /Skipping celticcoo-inbound/);
});
