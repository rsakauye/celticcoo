// Exhibitor and vendor invitations: detection, extraction, currency, the
// category migration, the private record, the review queue, and the send
// rules. Local fixtures only. No real address, row id, or database id.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseClassification, classifyByRules } from '../src/classify.js';
import {
  HEMINGWAY_BODY,
  autoSendMode,
  buildExhibitorDraft,
  detectCurrency,
  exhibitorMissingFields,
  extractExhibitor,
  threadAlreadyAnswered,
} from '../src/exhibitor.js';
import { handleFetch, handleInboundEmail } from '../src/index.js';
import { shouldFile } from '../src/issue.js';
import { hasPrivateContact } from '../src/redact.js';
import { reviewLinks, threadHeaders } from '../src/review.js';
import { hasUnfilledPlaceholder } from '../src/text.js';
import { cardFor, createInterestedCard, trelloConfig } from '../src/trello.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const OWNER = 'owner@example.com';
const ORGANIZER = 'games.office@example.org';
const NOW = new Date('2026-11-14T20:00:00.000Z');
const TOKEN = 'test-approval-token-value-1234';

// ---- fixtures -------------------------------------------------------------

const GAMES_PACK = {
  subject: 'Call for vendors: Foothills Highland Games 2027',
  text: [
    'Hello,',
    '',
    'Our call for vendors is now open for the Foothills Highland Games on July 10, 2027 at the Millarville Fairgrounds, Millarville, AB.',
    'The vendor package and application form are here: https://foothillsgames.example.ca/vendors/apply',
    'Applications close May 1, 2027.',
    'Booth fee is $150 for a 10x10 space. A $50 deposit holds your spot and is non-refundable.',
    'Move-in is Friday 4 pm to 8 pm. Tear-down after 6 pm Saturday.',
    'Power is available for an extra $25. Tables and chairs are not provided.',
    'Vendors need liability insurance and a vendor permit from the county.',
    '',
    'Thanks,',
    'Morag Fraser',
    '403-555-0199',
  ].join('\n'),
};

const MARKET_STALL = {
  subject: 'Invitation to exhibit at our Celtic Christmas Market',
  text: 'We would love to have you as a vendor at our Celtic Christmas Market in Edmonton, AB on December 5, 2026. Market stalls are $60 per table. Vendor applications are due November 25, 2026. Set-up time is 8 am.',
};

const BOOTH_FEE_MOVE_IN = {
  subject: 'Now accepting vendors',
  text: 'The Rocky Mountain Celtic Festival is now accepting vendors for 2027. Booth cost is $200 and move-in starts at 7 am on the Saturday. Electricity is available.',
};

const LIST_OUR_GAMES = {
  subject: 'Please list our Games',
  text: 'Please list our Highland Games on July 18, 2027 at the Canmore Recreation Centre in Canmore, AB. There will be food vendors and a beer garden.',
};

const HIRE_PIPER = {
  subject: 'Piper for our event',
  text: 'We would like to hire a piper for our Burns Supper on January 24, 2027 at the Legion in Okotoks. Vendors will also be there.',
};

const SELL_VIA_COO = {
  subject: 'Vendor application',
  text: 'Hi! I make tartan scrunchies and would love to sell through The Celtic Coo. Do you have a vendor application or could I get a booth at your event?',
};

const SEO_BLAST = {
  subject: 'Grow your vendor sales',
  text: 'We offer SEO services and link building for vendors and festivals. Boost your ranking today. Click here.',
};

const LONE_VENDOR = {
  subject: 'Question',
  text: 'Who is the vendor for your Coo stickers?',
};

// ---- sqlite as D1 ----------------------------------------------------------

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const MIGRATIONS = readdirSync(join(root, 'site/migrations')).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();

function migrated({ upTo = '9999' } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const name of MIGRATIONS) {
    if (name.slice(0, 4) > upTo) continue;
    db.exec(readFileSync(join(root, 'site/migrations', name), 'utf8'));
  }
  return db;
}

function d1(db) {
  const plain = (row) => (row ? { ...row } : null);
  return {
    raw: db,
    prepare(sql) {
      const make = (args) => ({
        bind: (...next) => make(next),
        async first() { return plain(db.prepare(sql).get(...args)); },
        async all() { return { results: db.prepare(sql).all(...args).map(plain) }; },
        async run() {
          const result = db.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      });
      return make([]);
    },
  };
}

function mime({ subject, text, from = `Morag Fraser <${ORGANIZER}>`, messageId = '<vendor-call-1@example.org>', extra = [] }) {
  return [
    `From: ${from}`,
    'To: hello@celticcoo.ca',
    `Subject: ${subject}`,
    'Date: Sat, 14 Nov 2026 19:00:00 +0000',
    `Message-ID: ${messageId}`,
    ...extra,
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');
}

function inbound(fixture, { from = ORGANIZER, messageId = '<vendor-call-1@example.org>', headers = {}, fromHeader } = {}) {
  const raw = mime({ ...fixture, messageId, from: fromHeader || `Morag Fraser <${from}>`, extra: Object.entries(headers).map(([k, v]) => `${k}: ${v}`) });
  return {
    from,
    to: 'hello@celticcoo.ca',
    headers: new Headers({ subject: fixture.subject, 'message-id': messageId, from: fromHeader || `Morag Fraser <${from}>`, ...headers }),
    raw,
    rawSize: raw.length,
    async forward() {},
    async reply() { throw new Error('the handler must not reply'); },
  };
}

function envFor(db, sent, extra = {}) {
  return {
    FORWARD_TO: OWNER,
    INTAKE_DB: d1(db),
    ACK_REPLIES: 'off',
    CLARIFY_DRAFTS: 'drafts',
    APPROVAL_API_TOKEN: TOKEN,
    EMAIL: { send: async (mail) => { sent.push(mail); } },
    ...extra,
  };
}

const deps = { now: () => NOW, log() {} };

async function receive(db, fixture, options = {}, extraEnv = {}) {
  const sent = [];
  const env = envFor(db, sent, extraEnv);
  const result = await handleInboundEmail(inbound(fixture, options), env, deps);
  return { sent, env, result };
}

function api(env, path, method = 'GET', body) {
  return handleFetch(new Request(`https://review.example.test${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  }), env, deps);
}

const sqlite = { skip: DatabaseSync ? false : 'node:sqlite is not available' };

// ---- detection ---------------------------------------------------------------

test('true vendor calls are exhibitor_invitation by rules', () => {
  for (const fixture of [GAMES_PACK, MARKET_STALL, BOOTH_FEE_MOVE_IN]) {
    const got = classifyByRules(fixture);
    assert.equal(got.category, 'exhibitor_invitation', fixture.subject);
    assert.ok(got.confidence >= 0.6, fixture.subject);
    assert.equal(got.signals.exhibitInvite, true);
  }
});

test('near misses keep their own labels', () => {
  assert.equal(classifyByRules(LIST_OUR_GAMES).category, 'event_listing_request');
  assert.equal(classifyByRules(HIRE_PIPER).category, 'booking_inquiry');
  assert.notEqual(classifyByRules(SELL_VIA_COO).category, 'exhibitor_invitation');
  assert.equal(classifyByRules(SELL_VIA_COO).signals.sellViaCoo, true);
  assert.equal(classifyByRules(SEO_BLAST).category, 'spam');
  assert.notEqual(classifyByRules(LONE_VENDOR).category, 'exhibitor_invitation');
  // A booth fee with no invitation or application phrase is not enough.
  assert.notEqual(classifyByRules({ subject: 'Fees', text: 'What is the booth fee at the Games?' }).category, 'exhibitor_invitation');
});

test('a clear rules vendor call wins when the model says other, listing, or booking', () => {
  const rules = classifyByRules(GAMES_PACK);
  for (const category of ['other', 'event_listing_request', 'booking_inquiry']) {
    const chosen = chooseClassification(rules, { category, confidence: 0.9, summary: 'x', event: {}, classifier: 'ai' });
    assert.equal(chosen.category, 'exhibitor_invitation', category);
    assert.equal(chosen.classifier, 'rules');
  }
  const spam = chooseClassification(rules, { category: 'spam', confidence: 0.9, summary: 'x', event: {}, classifier: 'ai' });
  assert.equal(spam.category, 'spam');
});

test('the model cannot call a note a vendor call without exhibit signals, or for a shop selling through Coo', () => {
  const ai = { category: 'exhibitor_invitation', confidence: 0.95, summary: 'x', event: {}, classifier: 'ai', exhibitor: {} };
  assert.notEqual(chooseClassification(classifyByRules({ subject: 'Hello', text: 'Can you send me your newsletter?' }), ai).category, 'exhibitor_invitation');
  assert.notEqual(chooseClassification(classifyByRules(SELL_VIA_COO), ai).category, 'exhibitor_invitation');
  const kept = chooseClassification(classifyByRules({ subject: 'Hi', text: 'We have booths for exhibitors at our fair.' }), ai);
  assert.equal(kept.category, 'exhibitor_invitation');
  assert.equal(kept.classifier, 'ai');
});

// ---- extraction and currency ---------------------------------------------------

test('the field table is filled from a Games vendor pack', () => {
  const rules = classifyByRules(GAMES_PACK);
  const record = extractExhibitor({
    subject: GAMES_PACK.subject,
    text: GAMES_PACK.text,
    event: rules.event,
    fromHeader: `Morag Fraser <${ORGANIZER}>`,
    sender: ORGANIZER,
  });
  assert.equal(record.organizer, 'Morag Fraser');
  assert.equal(record.contact_name, 'Morag Fraser');
  assert.equal(record.contact_email, ORGANIZER);
  assert.match(record.contact_phone, /555-0199/);
  assert.equal(record.province, 'Alberta');
  assert.equal(record.apply_url, 'https://foothillsgames.example.ca/vendors/apply');
  assert.match(record.apply_deadline, /May 1, 2027/);
  assert.equal(record.booth_cost, '$150');
  assert.match(record.booth_options, /10x10/);
  assert.match(record.fees_deposits, /deposit/);
  assert.match(record.setup_times, /Move-in is Friday/);
  assert.match(record.teardown_times, /Tear-down/);
  assert.match(record.power_tables, /Power is available/);
  assert.match(record.insurance_permits, /liability insurance/);
  assert.match(record.event_dates, /July 10, 2027/);
  assert.equal(record.currency, 'CAD');
  assert.equal(record.currency_source, 'location');
  assert.deepEqual(record.missing_fields, []);
  assert.deepEqual(record.review_flags, []);
  // Public fields carry no contact details.
  for (const key of ['event_name', 'organization', 'apply_deadline', 'setup_times', 'fees_deposits', 'power_tables', 'insurance_permits']) {
    assert.equal(hasPrivateContact(record[key]), false, key);
  }
});

test('missing vendor facts become deadline, apply_link, booth_cost, setup codes', () => {
  assert.deepEqual(exhibitorMissingFields({}), ['deadline', 'apply_link', 'booth_cost', 'setup']);
  const record = extractExhibitor({ subject: 'Call for vendors', text: 'Our call for vendors is open. Booths available.' });
  assert.deepEqual(record.missing_fields, ['deadline', 'apply_link', 'booth_cost', 'setup']);
});

test('currency comes from the event location, CAD only for Canada or unclear', () => {
  assert.deepEqual(detectCurrency({ text: 'Booth $150', province: 'Alberta' }), { currency: 'CAD', source: 'location', country: 'Canada', flag: '' });
  assert.equal(detectCurrency({ text: 'Booths are $150 at the Games in Missoula, Montana' }).currency, 'USD');
  assert.equal(detectCurrency({ text: 'Stalls at the fair in Bellingham, WA 98225 are $90' }).currency, 'USD');
  assert.equal(detectCurrency({ text: 'Pitches are 40 each, Perth, Scotland' }).currency, 'GBP');
  assert.equal(detectCurrency({ text: 'Stall fee £40' }).currency, 'GBP');
  assert.equal(detectCurrency({ text: 'Fleadh stalls in Ireland, 60 euro' }).currency, 'EUR');
  const unclear = detectCurrency({ text: 'Booths are $150.' });
  assert.deepEqual(unclear, { currency: 'CAD', source: 'default', country: '', flag: 'currency_unclear' });
  const clash = detectCurrency({ text: 'Booth fee 150 USD', province: 'Ontario' });
  assert.equal(clash.currency, 'USD');
  assert.equal(clash.flag, 'currency_location_mismatch');
  const record = extractExhibitor({ subject: 'Call for vendors', text: 'Call for vendors! Booth fee $150. Move-in 7 am.' });
  assert.deepEqual(record.review_flags, ['currency_unclear']);
});

// ---- reply text -----------------------------------------------------------------

test('the reply is Hemingway\'s final text plus the CASL footer, sendable, no placeholders', () => {
  const draft = buildExhibitorDraft();
  assert.ok(draft.startsWith(HEMINGWAY_BODY));
  assert.match(draft, /Thanks for sending your call for vendors/);
  assert.match(draft, /the application deadline/);
  assert.match(draft, /reply to this message with only the word unsubscribe/);
  assert.match(draft, /PO Box 1604, Okotoks/);
  assert.equal(hasPrivateContact(draft), false);
  assert.equal(hasUnfilledPlaceholder(draft), false);
  assert.doesNotMatch(draft, /\u2014/);
});

test('auto-send is off unless the var is exactly on, and the config ships it off', () => {
  assert.equal(autoSendMode({}), 'off');
  assert.equal(autoSendMode({ EXHIBITOR_AUTO_SEND: 'yes' }), 'off');
  assert.equal(autoSendMode({ EXHIBITOR_AUTO_SEND: 'on' }), 'on');
  const config = readFileSync(join(here, '../wrangler.jsonc'), 'utf8');
  assert.match(config, /"EXHIBITOR_AUTO_SEND": "off"/);
  assert.match(config, /"EXHIBITOR_TRELLO": "off"/);
  const code = config.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /TRELLO_API_KEY|TRELLO_TOKEN|TRELLO_LIST_ID/);
});

test('threading headers take one well-formed Message-ID only', () => {
  assert.deepEqual(threadHeaders('<abc@example.org>'), { 'In-Reply-To': '<abc@example.org>', References: '<abc@example.org>' });
  assert.equal(threadHeaders('<abc@example.org>\r\nBcc: x@example.org'), null);
  assert.equal(threadHeaders('abc@example.org'), null);
  assert.equal(threadHeaders(''), null);
});

test('one reply per thread', () => {
  assert.equal(threadAlreadyAnswered([]), false);
  assert.equal(threadAlreadyAnswered([{ category: 'booking_inquiry', clarify_status: 'sent' }]), true);
  assert.equal(threadAlreadyAnswered([{ category: 'exhibitor_invitation', clarify_status: 'pending_approval' }]), true);
  assert.equal(threadAlreadyAnswered([{ category: 'exhibitor_invitation', clarify_status: 'discarded' }]), false);
});

test('vendor calls never open a GitHub issue', () => {
  assert.equal(shouldFile('exhibitor_invitation'), false);
});

// ---- migrations ---------------------------------------------------------------

test('0011 rebuilds inbound_emails, keeps every row, and allows the new category', sqlite, () => {
  const db = migrated({ upTo: '0010' });
  db.prepare(`INSERT INTO inbound_emails (id, created_at, received_at, dedupe_key, envelope_from, envelope_to, category, clarify_status, trust_score, draft_skip_reason)
    VALUES ('row-a', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'k1', 'a@example.org', 'hello@celticcoo.ca', 'booking_inquiry', 'sent', 55, 'sender')`).run();
  assert.throws(() => db.prepare(`INSERT INTO inbound_emails (id, created_at, received_at, dedupe_key, envelope_from, envelope_to, category)
    VALUES ('row-b', 'x', 'x', 'k2', 'a', 'b', 'exhibitor_invitation')`).run(), /CHECK/);
  for (const name of MIGRATIONS.filter((file) => file >= '0011')) db.exec(readFileSync(join(root, 'site/migrations', name), 'utf8'));
  const kept = db.prepare("SELECT * FROM inbound_emails WHERE id = 'row-a'").get();
  assert.equal(kept.category, 'booking_inquiry');
  assert.equal(kept.clarify_status, 'sent');
  assert.equal(kept.trust_score, 55);
  assert.equal(kept.draft_skip_reason, 'sender');
  db.prepare(`INSERT INTO inbound_emails (id, created_at, received_at, dedupe_key, envelope_from, envelope_to, category)
    VALUES ('row-b', 'x', 'x', 'k2', 'a', 'b', 'exhibitor_invitation')`).run();
  assert.throws(() => db.prepare(`INSERT INTO inbound_emails (id, created_at, received_at, dedupe_key, envelope_from, envelope_to, category)
    VALUES ('row-c', 'x', 'x', 'k3', 'a', 'b', 'not_a_category')`).run(), /CHECK/);
  assert.throws(() => db.prepare(`INSERT INTO inbound_emails (id, created_at, received_at, dedupe_key, envelope_from, envelope_to)
    VALUES ('row-d', 'x', 'x', 'k2', 'a', 'b')`).run(), /UNIQUE/);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'inbound_emails'").all().map((row) => row.name);
  for (const name of ['idx_inbound_emails_dedupe', 'idx_inbound_emails_created', 'idx_inbound_emails_category_created']) assert.ok(indexes.includes(name), name);
  const control = db.prepare("SELECT * FROM intake_control WHERE id = 'singleton'").get();
  assert.equal(control.manual_pause, 0);
  assert.throws(() => db.prepare("INSERT INTO exhibitor_invitations (inbound_email_id, created_at, updated_at, status) VALUES ('x', 'a', 'a', 'maybe')").run(), /CHECK/);
});

test('the new migrations name no address, phone, or database id', () => {
  for (const name of ['0011_exhibitor_category.sql', '0012_exhibitor_invitations.sql', '0013_intake_control.sql']) {
    const sql = readFileSync(join(root, 'site/migrations', name), 'utf8');
    assert.equal(hasPrivateContact(sql), false, name);
    assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, name);
    assert.doesNotMatch(sql, /\u2014/, name);
  }
});

// ---- end to end ------------------------------------------------------------------

test('end to end: a vendor call is stored privately, queued for review, and nothing goes to the organizer', sqlite, async () => {
  const db = migrated();
  const { sent, env, result } = await receive(db, GAMES_PACK);
  assert.equal(result.outcome.category, 'exhibitor_invitation');
  assert.equal(result.outcome.issueStatus, 'skipped');
  assert.equal(result.outcome.autoSend, '');
  const row = db.prepare('SELECT * FROM inbound_emails').get();
  assert.equal(row.category, 'exhibitor_invitation');
  assert.equal(row.clarify_status, 'pending_approval');
  assert.equal(row.clarify_reasons, 'exhibitor_invitation');
  assert.match(row.clarify_draft, /Thanks for sending your call for vendors/);
  assert.match(row.clarify_draft, /unsubscribe/);
  const record = db.prepare('SELECT * FROM exhibitor_invitations').get();
  assert.equal(record.inbound_email_id, row.id);
  assert.equal(record.status, 'new');
  assert.equal(record.booth_cost, '$150');
  assert.equal(record.currency, 'CAD');
  assert.equal(record.contact_email, ORGANIZER);
  // Only the private review note went out, to the owner.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OWNER);
  assert.match(sent[0].text, /Vendor call details/);
  assert.match(sent[0].text, /Queue owner: Akindo/);
  assert.equal(sent.some((mail) => mail.to === ORGANIZER), false);

  const queue = await (await api(env, '/api/queue')).json();
  assert.equal(queue.ok, true);
  assert.equal(queue.drafts.length, 1);
  assert.equal(queue.drafts[0].category, 'exhibitor_invitation');
  assert.equal(queue.drafts[0].exhibitor.fields.booth_cost, '$150');
  assert.equal(queue.drafts[0].exhibitor.queue_owner, 'Akindo (SHCEO)');
  assert.deepEqual(queue.drafts[0].exhibitor.missing_fields, []);
});

test('end to end: the review page shows the private field table beside the draft', sqlite, async () => {
  const db = migrated();
  const { env } = await receive(db, GAMES_PACK);
  env.REVIEW_SECRET = 'test-review-secret-value';
  env.REVIEW_BASE_URL = 'https://review.example.test';
  const id = db.prepare('SELECT id FROM inbound_emails').get().id;
  const link = await reviewLinks(env, id, NOW);
  const res = await handleFetch(new Request(link.url), env, deps);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Vendor call details/);
  assert.match(html, /Booth cost/);
  assert.match(html, /\$150/);
  assert.match(html, /Akindo/);
  assert.match(html, /Thanks for sending your call for vendors/);
});

test('end to end: one approved reply is threaded, counted, and never sent twice', sqlite, async () => {
  const db = migrated();
  const { env } = await receive(db, GAMES_PACK);
  const id = db.prepare('SELECT id FROM inbound_emails').get().id;
  const out = [];
  env.EMAIL = { send: async (mail) => { out.push(mail); } };
  const first = await (await api(env, `/api/drafts/${id}/approve`, 'POST', {})).json();
  assert.equal(first.status, 'sent');
  assert.equal(out.length, 1);
  assert.equal(out[0].to, ORGANIZER);
  assert.equal(out[0].from.email, 'hello@celticcoo.ca');
  assert.equal(out[0].replyTo.email, 'hello@celticcoo.ca');
  assert.equal(out[0].subject, 'Re: Call for vendors: Foothills Highland Games 2027');
  assert.deepEqual(out[0].headers, { 'In-Reply-To': '<vendor-call-1@example.org>', References: '<vendor-call-1@example.org>' });
  assert.match(out[0].text, /unsubscribe/);
  assert.equal(db.prepare('SELECT status FROM exhibitor_invitations').get().status, 'replied');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbound_sends').get().n, 1);
  const again = await (await api(env, `/api/drafts/${id}/approve`, 'POST', {})).json();
  assert.equal(again.status, 'already_sent');
  assert.equal(out.length, 1);
});

test('end to end: a second note in the same thread queues no second reply', sqlite, async () => {
  const db = migrated();
  await receive(db, GAMES_PACK);
  const { sent } = await receive(db, { subject: `Re: ${GAMES_PACK.subject}`, text: 'Just checking you got our call for vendors. Booths are filling up.' }, { messageId: '<vendor-call-2@example.org>' });
  const rows = db.prepare('SELECT clarify_status, draft_skip_reason FROM inbound_emails ORDER BY created_at, rowid').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].clarify_status, '');
  assert.equal(rows[1].draft_skip_reason, 'thread_replied');
  assert.equal(sent.length, 0);
});

test('end to end: no-reply, list mail, and CLARIFY_DRAFTS=off queue nothing', sqlite, async () => {
  const noReply = migrated();
  await receive(noReply, GAMES_PACK, { from: 'no-reply@example.org' });
  assert.equal(noReply.prepare('SELECT clarify_status FROM inbound_emails').get().clarify_status, '');

  const list = migrated();
  await receive(list, GAMES_PACK, { headers: { 'list-unsubscribe': '<https://example.org/u>' } });
  const listed = list.prepare('SELECT clarify_status, draft_skip_reason FROM inbound_emails').get();
  assert.equal(listed.clarify_status, '');
  assert.match(listed.draft_skip_reason, /list_unsubscribe/);
  // The private record is still kept for the queue owner.
  assert.equal(list.prepare('SELECT COUNT(*) AS n FROM exhibitor_invitations').get().n, 1);

  const off = migrated();
  await receive(off, GAMES_PACK, {}, { CLARIFY_DRAFTS: 'off' });
  assert.equal(off.prepare('SELECT clarify_status FROM inbound_emails').get().clarify_status, '');
});

test('end to end: approval refuses for opt-out, pause, a missing guard, and the 40 a day cap', sqlite, async () => {
  const setup = async (prep) => {
    const db = migrated();
    const { env } = await receive(db, GAMES_PACK);
    const out = [];
    env.EMAIL = { send: async (mail) => { out.push(mail); } };
    prep(db);
    const id = db.prepare('SELECT id FROM inbound_emails').get().id;
    const res = await api(env, `/api/drafts/${id}/approve`, 'POST', {});
    return { status: res.status, body: await res.json(), out, db };
  };
  const optOut = await setup((db) => db.prepare("INSERT INTO mail_opt_outs (email, created_at) VALUES (?, '2026-11-01')").run(ORGANIZER));
  assert.equal(optOut.out.length, 0);
  assert.notEqual(optOut.body.status, 'sent');

  const paused = await setup((db) => db.prepare("UPDATE intake_control SET manual_pause = 1, pause_reason = 'manual'").run());
  assert.equal(paused.out.length, 0);
  assert.equal(paused.body.error, 'guard_paused');

  const latched = await setup((db) => db.prepare("UPDATE intake_control SET latch = 'abuse'").run());
  assert.equal(latched.out.length, 0);
  assert.equal(latched.body.error, 'guard_paused');

  const missing = await setup((db) => db.exec('DROP TABLE intake_control'));
  assert.equal(missing.out.length, 0);
  assert.equal(missing.body.error, 'guard_unavailable');
  assert.equal(missing.status, 503);

  const capped = await setup((db) => {
    const insert = db.prepare("INSERT INTO outbound_sends (id, created_at, kind) VALUES (?, ?, 'clarify')");
    for (let i = 0; i < 40; i += 1) insert.run(`send-${i}`, new Date(NOW.getTime() - 60_000).toISOString());
  });
  assert.equal(capped.out.length, 0);
  assert.equal(capped.body.error, 'outbound_cap');
});

test('end to end: EXHIBITOR_AUTO_SEND=on sends once through the guard, and a pause stops it', sqlite, async () => {
  const db = migrated();
  const { sent, result } = await receive(db, GAMES_PACK, {}, { EXHIBITOR_AUTO_SEND: 'on' });
  assert.equal(result.outcome.autoSend, 'sent');
  const toOrganizer = sent.filter((mail) => mail.to === ORGANIZER);
  assert.equal(toOrganizer.length, 1);
  assert.equal(db.prepare('SELECT actor FROM outbound_sends').get().actor, 'auto');

  const pausedDb = migrated();
  pausedDb.prepare("UPDATE intake_control SET manual_pause = 1").run();
  const paused = await receive(pausedDb, GAMES_PACK, {}, { EXHIBITOR_AUTO_SEND: 'on' });
  assert.equal(paused.result.outcome.autoSend, 'guard_paused');
  assert.equal(paused.sent.filter((mail) => mail.to === ORGANIZER).length, 0);
  assert.equal(pausedDb.prepare('SELECT clarify_status FROM inbound_emails').get().clarify_status, 'pending_approval');
});

test('end to end: before 0011 is applied, a vendor call is kept as other', sqlite, async () => {
  const db = migrated({ upTo: '0010' });
  db.exec(readFileSync(join(root, 'site/migrations/0012_exhibitor_invitations.sql'), 'utf8'));
  await receive(db, GAMES_PACK);
  const row = db.prepare('SELECT category, classifier_reason FROM inbound_emails').get();
  assert.equal(row.category, 'other');
  assert.match(row.classifier_reason, /exhibitor_fallback/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM exhibitor_invitations').get().n, 1);
});

test('status API: interested creates a Trello card only when configured, with no contact details', sqlite, async () => {
  const db = migrated();
  const { env } = await receive(db, GAMES_PACK);
  const id = db.prepare('SELECT id FROM inbound_emails').get().id;
  const bad = await api(env, `/api/exhibitors/${id}/status`, 'POST', { status: 'maybe' });
  assert.equal(bad.status, 400);
  const skipped = await (await api(env, `/api/exhibitors/${id}/status`, 'POST', { status: 'interested' })).json();
  assert.equal(skipped.status, 'interested');
  assert.equal(skipped.trello, 'skipped');
  assert.equal(db.prepare('SELECT status FROM exhibitor_invitations').get().status, 'interested');

  assert.equal(trelloConfig({ EXHIBITOR_TRELLO: 'on' }), null);
  const calls = [];
  const configured = {
    EXHIBITOR_TRELLO: 'on',
    TRELLO_API_KEY: 'k'.repeat(32),
    TRELLO_TOKEN: 't'.repeat(64),
    TRELLO_LIST_ID: 'a'.repeat(24),
  };
  const view = { fields: { event_name: 'Foothills Highland Games 2027', city: 'Millarville', province: 'Alberta', apply_url: 'https://foothillsgames.example.ca/vendors/apply', contact_name: 'Morag Fraser', booth_cost: '$150' } };
  const made = await createInterestedCard(configured, view, id, { fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; } });
  assert.equal(made.status, 'created');
  const body = JSON.parse(calls[0].init.body);
  assert.match(body.name, /Vendor call: Foothills/);
  assert.doesNotMatch(body.desc, /Morag|@|\$150/);
  assert.doesNotMatch(cardFor(view, id).desc, /555/);
});

test('the exhibitor doc names the owner, the flag, and no private details', () => {
  const doc = readFileSync(join(root, 'docs/exhibitor-invitations.md'), 'utf8');
  assert.match(doc, /EXHIBITOR_AUTO_SEND/);
  assert.match(doc, /Akindo/);
  assert.match(doc, /Steward/);
  assert.match(doc, /0011_exhibitor_category\.sql/);
  // Only The Celtic Coo's own mailboxes are named.
  const others = doc.replace(/\b[a-z]+@(?:in\.)?celticcoo\.(?:ca|com)\b/g, '');
  assert.equal(hasPrivateContact(others), false);
  assert.doesNotMatch(doc, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(doc, /\u2014/);
});
