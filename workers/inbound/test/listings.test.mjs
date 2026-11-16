// Moderation for free listings: status steps, the one reply per step, the
// send guard, the 14-day close, the 90-day purge, the read-only chat API,
// and the signed queue page. Local fixtures only. No real address or id.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleFetch, handleScheduled } from '../src/index.js';
import {
  CLOSE_REASONS,
  NO_LINK_HINT,
  REJECT_REASONS,
  closeStaleNeedsInfo,
  duplicateHints,
  linkCheck,
  listingQueue,
  purgeListings,
  queueLink,
  sendListingAcks,
  sendListingReply,
  setListingStatus,
  verifyQueueLink,
} from '../src/listings.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const NOW = new Date('2026-11-15T20:00:00.000Z');
const TOKEN = 'test-approval-token-value-1234';
const SECRET = 'test-review-secret-value-5678';
const ID = '11111111-2222-4333-8444-555555555555';
const ID2 = '11111111-2222-4333-8444-666666666666';

function migrated() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(join(root, 'site/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
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
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
      });
      return make([]);
    },
  };
}

function seed(db, { id = ID, kind = 'performer', status = 'pending', name = 'Foothills Piper', city = 'Okotoks', createdAt = NOW.toISOString(), extra = {} } = {}) {
  const pub = kind === 'group'
    ? { name, groupKind: 'Pipe band / piping', city, province: 'AB', website: 'https://band.example.ca/', lessons: 'y', lessonKinds: '', lessonAges: [], schedule: '', contact: '' }
    : { name, acts: ['solo-piper'], size: 'solo', city, province: 'AB', travel: 'province', services: [], blurb: 'Solo piper.', links: ['https://bit.ly/x', 'https://piper.example.ca/'], media: '', association: '' };
  const fold = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  db.raw.prepare(`INSERT INTO listings (id, created_at, updated_at, kind, status, name, name_key, city, city_key, province, public_json,
    submitter_name, submitter_email, submitter_role, adult_confirm, terms_confirm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AB', ?, 'Sample Submitter', 'submitter@example.com', 'self', 1, 1)`)
    .run(id, createdAt, createdAt, kind, status, name, fold(name), city, fold(city), JSON.stringify(pub));
  for (const [key, value] of Object.entries(extra)) db.raw.prepare(`UPDATE listings SET ${key} = ? WHERE id = ?`).run(value, id);
}

function env(db, more = {}) {
  return {
    INTAKE_DB: db,
    APPROVAL_API_TOKEN: TOKEN,
    REVIEW_SECRET: SECRET,
    REVIEW_BASE_URL: 'https://review.example.com',
    FORWARD_TO: 'owner@example.com',
    CLARIFY_DRAFTS: 'drafts',
    ACK_REPLIES: 'off',
    ...more,
  };
}

function sender() {
  const sent = [];
  return { sent, send: async (message) => { sent.push(message); } };
}

test('statuses step in order and nothing sends when a person approves', async () => {
  const db = d1(migrated());
  seed(db);
  const listed = await setListingStatus(db, ID, { status: 'listed' }, NOW);
  assert.deepEqual(listed, { ok: true, status: 'listed', reason: '' });
  const row = db.raw.prepare('SELECT * FROM listings WHERE id = ?').get(ID);
  assert.equal(row.status, 'listed');
  assert.equal(row.listed_at, NOW.toISOString());
  assert.equal(row.reply_kind, 'listed');
  assert.equal(row.reply_status, 'pending_approval');
  assert.match(row.reply_draft, /https:\/\/celticcoo\.ca\/performers\//);
  assert.match(row.reply_draft, /Foothills Piper/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM outbound_sends').get().n, 0);
  assert.equal((await setListingStatus(db, ID, { status: 'needs_info', note: 'x' }, NOW)).error, 'bad_transition');
  assert.equal((await setListingStatus(db, ID, { status: 'closed' }, NOW)).error, 'reason_required');
  assert.deepEqual(await setListingStatus(db, ID, { status: 'closed', reason: 'removed_on_request' }, NOW), { ok: true, status: 'closed', reason: 'removed_on_request' });
  assert.equal(db.raw.prepare('SELECT status_reason, reply_status FROM listings WHERE id = ?').get(ID).status_reason, 'removed_on_request');
});

test('needs info asks one question, once, and reject needs a listed reason', async () => {
  const db = d1(migrated());
  seed(db);
  assert.equal((await setListingStatus(db, ID, { status: 'needs_info' }, NOW)).error, 'question_required');
  assert.equal((await setListingStatus(db, ID, { status: 'needs_info', note: 'Call 403-555-0100' }, NOW)).error, 'question_contact');
  assert.deepEqual(await setListingStatus(db, ID, { status: 'needs_info', note: 'Which city are you based in?' }, NOW), { ok: true, status: 'needs_info', reason: '' });
  const row = db.raw.prepare('SELECT * FROM listings WHERE id = ?').get(ID);
  assert.match(row.reply_draft, /Which city are you based in\?/);
  assert.match(row.reply_draft, /14 days/);
  assert.equal((await setListingStatus(db, ID, { status: 'needs_info', note: 'Again?' }, NOW)).error, 'already_asked');
  assert.equal((await setListingStatus(db, ID, { status: 'rejected' }, NOW)).error, 'reason_required');
  assert.equal((await setListingStatus(db, ID, { status: 'rejected', reason: 'bored' }, NOW)).error, 'reason_required');
  assert.equal((await setListingStatus(db, ID, { status: 'rejected', reason: 'removed_on_request' }, NOW)).error, 'reason_required');
  assert.deepEqual(await setListingStatus(db, ID, { status: 'rejected', reason: 'minor_safety' }, NOW), { ok: true, status: 'rejected', reason: 'minor_safety' });
  const after = db.raw.prepare('SELECT * FROM listings WHERE id = ?').get(ID);
  assert.equal(after.status_reason, 'minor_safety');
  assert.equal(after.reply_status, 'discarded');
  assert.deepEqual(REJECT_REASONS, ['not_celtic', 'outside_canada', 'incomplete', 'duplicate', 'minor_safety', 'spam']);
  assert.equal((await setListingStatus(db, ID, { status: 'listed' }, NOW)).error, 'bad_transition');
  assert.equal((await setListingStatus(db, ID2, { status: 'listed' }, NOW)).error, 'not_found');
});

test('the reply sends once, through the send guard, and a paused guard sends nothing', async () => {
  const db = d1(migrated());
  seed(db);
  await setListingStatus(db, ID, { status: 'listed' }, NOW);
  const mail = sender();
  db.raw.exec("UPDATE intake_control SET manual_pause = 1 WHERE id = 'singleton'");
  const paused = await sendListingReply(env(db), ID, {}, { send: mail.send, now: () => NOW });
  assert.deepEqual(paused, { ok: false, error: 'guard_paused' });
  assert.equal(mail.sent.length, 0);
  assert.equal(db.raw.prepare('SELECT reply_status FROM listings WHERE id = ?').get(ID).reply_status, 'pending_approval');
  db.raw.exec("UPDATE intake_control SET manual_pause = 0 WHERE id = 'singleton'");

  const first = await sendListingReply(env(db), ID, {}, { send: mail.send, now: () => NOW });
  assert.deepEqual(first, { ok: true, status: 'sent' });
  assert.equal(mail.sent.length, 1);
  assert.equal(mail.sent[0].to, 'submitter@example.com');
  assert.equal(mail.sent[0].from.email, 'hello@celticcoo.ca');
  const again = await sendListingReply(env(db), ID, {}, { send: mail.send, now: () => NOW });
  assert.deepEqual(again, { ok: true, status: 'already_sent' });
  assert.equal(mail.sent.length, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM outbound_sends WHERE kind = 'listing'").get().n, 1);
});

test('an edited reply with a placeholder or a phone number is refused', async () => {
  const db = d1(migrated());
  seed(db);
  await setListingStatus(db, ID, { status: 'listed' }, NOW);
  const mail = sender();
  assert.equal((await sendListingReply(env(db), ID, { text: 'Hi {{name}}' }, { send: mail.send, now: () => NOW })).error, 'draft_placeholder');
  assert.equal((await sendListingReply(env(db), ID, { text: 'Call 403-555-0100' }, { send: mail.send, now: () => NOW })).error, 'clarify_draft_blocked');
  assert.equal(mail.sent.length, 0);
});

test('needs info closes after 14 days and closed or rejected rows purge after 90 only when purge is on', async () => {
  const db = d1(migrated());
  const old = new Date(NOW.getTime() - 15 * 86_400_000).toISOString();
  seed(db, { id: ID, status: 'needs_info', extra: { needs_info_at: old } });
  seed(db, { id: ID2, status: 'needs_info', name: 'Fresh Ask', extra: { needs_info_at: NOW.toISOString() } });
  assert.equal(await closeStaleNeedsInfo(db, NOW), 1);
  assert.equal(db.raw.prepare('SELECT status FROM listings WHERE id = ?').get(ID).status, 'closed');
  assert.equal(db.raw.prepare('SELECT status FROM listings WHERE id = ?').get(ID2).status, 'needs_info');

  const later = new Date(NOW.getTime() + 91 * 86_400_000);
  const dry = await purgeListings(db, {}, later);
  assert.deepEqual(dry, { mode: 'dry_run', count: 1 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 2);
  const on = await purgeListings(db, { RETENTION_PURGE: 'on' }, later);
  assert.deepEqual(on, { mode: 'delete', count: 1 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 1);
});

test('the receipt stays off while ACK_REPLIES is off', async () => {
  const db = d1(migrated());
  seed(db);
  const mail = sender();
  assert.deepEqual(await sendListingAcks(env(db), NOW, { send: mail.send }), { status: 'off', sent: 0 });
  assert.equal(mail.sent.length, 0);
  const on = await sendListingAcks(env(db, { ACK_REPLIES: 'on' }), NOW, { send: mail.send });
  assert.equal(on.sent, 1);
  assert.match(mail.sent[0].text, /Foothills Piper/);
  const vars = readFileSync(join(here, '../wrangler.jsonc'), 'utf8');
  assert.match(vars, /"ACK_REPLIES": "off"/);
  assert.doesNotMatch(vars, /LISTING_DIGEST/);
});

test('duplicate hints match listings and groups already on /groups, and links are only format-checked', async () => {
  const db = d1(migrated());
  seed(db, { id: ID, name: 'Foothills Piper' });
  seed(db, { id: ID2, name: 'Foothills Piper', status: 'listed' });
  const row = db.raw.prepare('SELECT * FROM listings WHERE id = ?').get(ID);
  const hints = await duplicateHints(db, row);
  assert.equal(hints[0].source, 'listing');
  assert.equal(hints[0].match, 'name_city');
  const groups = JSON.parse(readFileSync(join(root, 'data/groups_canada.json'), 'utf8'));
  const g = groups[0];
  const clubHints = await duplicateHints(db, { id: 'x', name: g.name, city: g.city });
  assert.ok(clubHints.some((h) => h.source === 'groups' && h.match === 'name_city'));
  assert.deepEqual(linkCheck('https://bit.ly/x').notes.includes('shortener'), true);
  assert.equal(linkCheck('https://bit.ly/x').ok, false);
  assert.equal(linkCheck('https://piper.example.ca/').ok, true);
  const src = readFileSync(join(here, '../src/listings.js'), 'utf8');
  assert.doesNotMatch(src, /fetch\(/);
});

test('the chat API is read-only and leaves out the submitter name and email', async () => {
  const db = d1(migrated());
  seed(db);
  const unauth = await handleFetch(new Request('https://review.example.com/api/listings'), env(db), { now: () => NOW });
  assert.equal(unauth.status, 401);
  const res = await handleFetch(new Request('https://review.example.com/api/listings', { headers: { authorization: `Bearer ${TOKEN}` } }), env(db), { now: () => NOW });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].status, 'pending');
  assert.doesNotMatch(text, /submitter@example\.com|Sample Submitter/);
  const post = await handleFetch(new Request('https://review.example.com/api/listings', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{"status":"listed"}' }), env(db), { now: () => NOW });
  assert.equal(post.status, 405);
  assert.equal(db.raw.prepare('SELECT status FROM listings WHERE id = ?').get(ID).status, 'pending');
});

test('the queue page needs a signed link and a CSRF cookie, and approving sends nothing', async () => {
  const db = d1(migrated());
  seed(db);
  const e = env(db);
  const link = await queueLink(e, NOW);
  assert.match(link, /^https:\/\/review\.example\.com\/listings\?exp=\d+&sig=[A-Za-z0-9_-]+$/);
  const url = new URL(link);
  assert.equal(await verifyQueueLink(e, url.searchParams.get('exp'), url.searchParams.get('sig'), NOW), true);
  assert.equal(await verifyQueueLink(e, url.searchParams.get('exp'), `${url.searchParams.get('sig')}x`, NOW), false);
  assert.equal(await verifyQueueLink(e, url.searchParams.get('exp'), url.searchParams.get('sig'), new Date(NOW.getTime() + 4 * 86_400_000)), false);

  const bad = await handleFetch(new Request('https://review.example.com/listings?exp=1&sig=nope'), e, { now: () => NOW });
  assert.equal(bad.status, 403);

  const page = await handleFetch(new Request(link), e, { now: () => NOW });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Foothills Piper/);
  assert.match(html, /submitter@example\.com/);
  assert.match(html, /shortener/);
  const cookie = /coo_listings_csrf=([^;]+)/.exec(page.headers.get('set-cookie'))[1];
  assert.match(page.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict; Path=\/listings/);
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)[1];
  assert.equal(csrf, cookie);

  const form = (extra) => new URLSearchParams({ exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), op: 'status', status: 'listed', ...extra }).toString();
  const noCsrf = await handleFetch(new Request(`https://review.example.com/listings/${ID}`, { method: 'POST', body: form({}) }), e, { now: () => NOW });
  assert.equal(noCsrf.status, 403);
  assert.equal(db.raw.prepare('SELECT status FROM listings WHERE id = ?').get(ID).status, 'pending');

  const mail = sender();
  const ok = await handleFetch(new Request(`https://review.example.com/listings/${ID}`, {
    method: 'POST',
    body: form({ csrf }),
    headers: { cookie: `coo_listings_csrf=${cookie}` },
  }), e, { now: () => NOW, send: mail.send });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Listed\. The reply with their link is below/);
  assert.equal(db.raw.prepare('SELECT status FROM listings WHERE id = ?').get(ID).status, 'listed');
  assert.equal(mail.sent.length, 0);
  const audit = db.raw.prepare("SELECT actor, action, outcome FROM approval_audit WHERE action LIKE 'listing%'").all().map((r) => `${r.actor}:${r.action}:${r.outcome}`);
  assert.ok(audit.includes('person:listing_status:listed'));

  const sendForm = new URLSearchParams({ exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), op: 'reply', send: 'send', csrf, draft: 'Hi there,\n\nYour listing is up: https://celticcoo.ca/performers/\n\nCheers,\nThe Celtic Coo' }).toString();
  const sent = await handleFetch(new Request(`https://review.example.com/listings/${ID}`, { method: 'POST', body: sendForm, headers: { cookie: `coo_listings_csrf=${cookie}` } }), e, { now: () => NOW, send: mail.send });
  assert.equal(sent.status, 200);
  assert.equal(mail.sent.length, 1);
});

test('the queue lists pending and needs-info rows plus any reply still waiting', async () => {
  const db = d1(migrated());
  seed(db, { id: ID, status: 'pending' });
  seed(db, { id: ID2, status: 'listed', name: 'Already Listed' });
  let items = await listingQueue(db);
  assert.deepEqual(items.map((i) => i.id), [ID]);
  db.raw.prepare("UPDATE listings SET reply_status = 'pending_approval', reply_kind = 'listed', reply_draft = 'x' WHERE id = ?").run(ID2);
  items = await listingQueue(db);
  assert.deepEqual(items.map((i) => i.id).sort(), [ID, ID2].sort());
  assert.equal('submitter_email' in items[0], false);
});

test('the daily cron runs the listing jobs without deleting in dry run', async () => {
  const db = d1(migrated());
  const old = new Date(NOW.getTime() - 100 * 86_400_000).toISOString();
  seed(db, { id: ID, status: 'rejected', createdAt: old });
  const logs = [];
  const result = await handleScheduled({ INTAKE_DB: db }, { now: () => NOW, log: (line) => logs.push(line) });
  assert.equal(result.mode, 'dry_run');
  assert.equal(result.listings.purge.mode, 'dry_run');
  assert.equal(result.listings.purge.count, 1);
  assert.equal(result.listings.acks.status, 'off');
  assert.equal(result.listings.digest.status, 'off');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 1);
  assert.ok(logs.some((line) => /"message":"listings"/.test(line)));
  assert.ok(logs.every((line) => !/submitter@example\.com/.test(line)));
});

test('an entry with no links gets a no-link flag and a hint, and nothing else changes', async () => {
  const db = d1(migrated());
  seed(db, { id: ID, name: 'Linked Piper' });
  seed(db, { id: ID2, name: 'Unlinked Piper' });
  const pub = JSON.parse(db.raw.prepare('SELECT public_json FROM listings WHERE id = ?').get(ID2).public_json);
  db.raw.prepare('UPDATE listings SET public_json = ? WHERE id = ?').run(JSON.stringify({ ...pub, links: [], media: 'https://piper.example.ca/photo' }), ID2);
  const items = Object.fromEntries((await listingQueue(db)).map((i) => [i.name, i]));
  assert.ok(items['Unlinked Piper'].risk_flags.includes('no_link'));
  assert.ok(!items['Linked Piper'].risk_flags.includes('no_link'));
  assert.equal(items['Unlinked Piper'].status, 'pending');
  assert.match(NO_LINK_HINT, /Needs info rather than Listed/);
  const e = env(db);
  const page = await handleFetch(new Request(await queueLink(e, NOW)), e, { now: () => NOW });
  const html = await page.text();
  assert.match(html, /No link to check\. If you can&#39;t verify this act, use Needs info rather than Listed\./);
  const api = await (await handleFetch(new Request('https://review.example.com/api/listings', { headers: { authorization: `Bearer ${TOKEN}` } }), e, { now: () => NOW })).json();
  assert.ok(api.items.find((i) => i.name === 'Unlinked Piper').risk_flags.includes('no_link'));
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM listings WHERE status != 'pending'").get().n, 0);
});

test('a removal or reject keeps its reason and private note out of public data and purges them at 90 days', async () => {
  const db = d1(migrated());
  seed(db, { id: ID, status: 'listed', name: 'Removed Piper' });
  seed(db, { id: ID2, status: 'pending', name: 'Rejected Piper' });
  assert.deepEqual(CLOSE_REASONS.slice(-2), ['removed_on_request', 'no_reply']);
  await setListingStatus(db, ID, { status: 'closed', reason: 'removed_on_request', note: 'Asked by phone at the Games, private note' }, NOW);
  await setListingStatus(db, ID2, { status: 'rejected', reason: 'outside_canada', note: 'Based in Ohio' }, NOW);
  const rows = db.raw.prepare('SELECT * FROM listings ORDER BY name').all();
  assert.deepEqual(rows.map((r) => [r.status, r.status_reason, r.moderator_note]), [
    ['rejected', 'outside_canada', 'Based in Ohio'],
    ['closed', 'removed_on_request', 'Asked by phone at the Games, private note'],
  ]);
  for (const row of rows) assert.doesNotMatch(row.public_json, /private note|Ohio|outside_canada|removed_on_request/);
  const api = await (await handleFetch(new Request('https://review.example.com/api/listings', { headers: { authorization: `Bearer ${TOKEN}` } }), env(db), { now: () => NOW })).text();
  assert.doesNotMatch(api, /private note|Ohio/);
  const audit = db.raw.prepare('SELECT detail FROM approval_audit').all().map((r) => r.detail).join(' ');
  assert.doesNotMatch(audit, /private note|Ohio/);
  const later = new Date(NOW.getTime() + 91 * 86_400_000);
  assert.deepEqual(await purgeListings(db, { RETENTION_PURGE: 'on' }, later), { mode: 'delete', count: 2 });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 0);
});

test('the listed section takes an entry down with a reason, records the reason code in the audit, and not the note', async () => {
  const db = d1(migrated());
  seed(db, { id: ID, status: 'listed', extra: { newsletter_opt_in: 1, newsletter_consent_at: NOW.toISOString(), newsletter_source: 'performer-listing-form /submit/' } });
  const e = env(db);
  const link = new URL(await queueLink(e, NOW));
  const page = await handleFetch(new Request(link), e, { now: () => NOW });
  const html = await page.text();
  assert.match(html, /Listed now \(1\)/);
  assert.match(html, /Take down/);
  const cookie = /coo_listings_csrf=([^;]+)/.exec(page.headers.get('set-cookie'))[1];
  const body = new URLSearchParams({ exp: link.searchParams.get('exp'), sig: link.searchParams.get('sig'), csrf: cookie, op: 'status', status: 'closed', reason: 'duplicate', note: 'Same act as another row' }).toString();
  const res = await handleFetch(new Request(`https://review.example.com/listings/${ID}`, { method: 'POST', body, headers: { cookie: `coo_listings_csrf=${cookie}` } }), e, { now: () => NOW });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Closed or taken down/);
  const row = db.raw.prepare('SELECT status, status_reason, moderator_note FROM listings WHERE id = ?').get(ID);
  assert.deepEqual({ ...row }, { status: 'closed', status_reason: 'duplicate', moderator_note: 'Same act as another row' });
  const audit = db.raw.prepare("SELECT detail FROM approval_audit WHERE action = 'listing_status'").get();
  assert.equal(audit.detail, 'reason:duplicate');
});

test('a pending entry with a Coo\'s Letter opt-in shows the consent time and source on the signed page only', async () => {
  const db = d1(migrated());
  seed(db, { id: ID, extra: { newsletter_opt_in: 1, newsletter_consent_at: NOW.toISOString(), newsletter_source: 'performer-listing-form /submit/' } });
  const e = env(db);
  const html = await (await handleFetch(new Request(await queueLink(e, NOW)), e, { now: () => NOW })).text();
  assert.ok(html.includes(`Yes, ${NOW.toISOString()}, from performer-listing-form /submit/ (add by hand in Kit)`));
  const api = await (await handleFetch(new Request('https://review.example.com/api/listings', { headers: { authorization: `Bearer ${TOKEN}` } }), e, { now: () => NOW })).text();
  assert.doesNotMatch(api, /listing-form|consent_at/);
});
