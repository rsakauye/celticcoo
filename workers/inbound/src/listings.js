// Moderation for free self-listings (performers and clubs or lessons groups).
// The site stores each listing as pending in the listings table
// (site/migrations/0014_listings.sql). Nothing is public until a person sets
// it to listed here. Bots never publish:
//
// - GET /api/listings with the chat bearer token is read-only. It lists the
//   queue without the submitter's name or email. It cannot change a status.
// - The one-screen queue at /listings needs a signed link (REVIEW_SECRET,
//   short expiry) and a CSRF cookie. Only that page can approve, ask for
//   info, reject, or close a listing, and only that page can send the one
//   reply that goes with a step. The reply goes through the same send guard,
//   opt-out list, and outbound cap as every other reply from hello@.
//
// The daily cron closes needs-info rows after 14 days with no answer, and
// deletes rejected and closed rows 90 days after their last change when
// RETENTION_PURGE is "on" (dry run otherwise). The optional receipt sends
// only when ACK_REPLIES is "on". LISTING_DIGEST "on" emails FORWARD_TO a
// signed queue link once a day when something is waiting. Both are off.

import listingConfig from '../../../data/listings.json' with { type: 'json' };
import groupsRaw from '../../../data/groups_canada.json' with { type: 'json' };
import { caslFooterText } from '../../../shared/casl/notice.js';
import { acksEnabled } from './ack.js';
import { approvalToken, bearerMatches } from './approval.js';
import { recordOutbound, sendGate } from './guard.js';
import { optOutStatus } from './optout.js';
import { hasPrivateContact, PUBLIC_MAILBOX } from './redact.js';
import { purgeEnabled, daysAgo } from './retention.js';
import { reviewEscape as esc, reviewPage, sendApprovedReply } from './review.js';
import { codeOf, hasUnfilledPlaceholder, oneEmail, oneLine } from './text.js';
import { csrfPairMatches, issueCsrf, reviewOrigin, reviewSecret, signAction, verifyCsrf } from './token.js';

export const LISTING_CONFIG = listingConfig;
export const STATUSES = listingConfig.moderation.statuses.map(([id]) => id);
export const REJECT_REASONS = listingConfig.moderation.rejectReasons.map(([id]) => id);
const STATUS_LABEL = Object.fromEntries(listingConfig.moderation.statuses);
const REASON_LABEL = Object.fromEntries(listingConfig.moderation.rejectReasons);
const LIMITS = listingConfig.limits;
const REPLIES = listingConfig.copy.replies;
const QUEUE_LIMIT = 30;
const NOTE_LIMIT = 1000;
const DRAFT_LIMIT = 8000;
const QUEUE_LINK_SECONDS = 3 * 24 * 60 * 60;
const CSRF_ID = 'listings01';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Which status can follow which. needs_info is allowed once, from pending.
export const TRANSITIONS = {
  pending: ['listed', 'needs_info', 'rejected'],
  needs_info: ['listed', 'rejected', 'closed'],
  listed: ['rejected', 'closed'],
  rejected: [],
  closed: [],
};

// ---------- helpers ----------

export function foldKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

function countOf(row) {
  const n = Number(row && (row.n ?? row['COUNT(*)']));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function changesOf(result) {
  const n = Number(result && result.meta && result.meta.changes);
  return Number.isFinite(n) ? n : 0;
}

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at']);
const SOCIAL = new Set(['facebook.com', 'instagram.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'x.com', 'twitter.com', 'linktr.ee', 'soundcloud.com', 'bandcamp.com', 'spotify.com', 'vimeo.com']);

// A format check for the moderator. No URL from a listing is fetched.
// The weekly club link check covers group websites once they are on /groups.
export function linkCheck(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return { url: String(url || ''), host: '', ok: false, notes: ['unreadable'] }; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const notes = [];
  if (parsed.protocol !== 'https:') notes.push('not_https');
  if (SHORTENERS.has(host)) notes.push('shortener');
  if (SOCIAL.has(host) || [...SOCIAL].some((s) => host.endsWith(`.${s}`))) notes.push('social');
  if (!host.endsWith('.ca') && !SOCIAL.has(host)) notes.push('not_ca');
  return { url: parsed.href, host, ok: !notes.includes('shortener') && !notes.includes('unreadable'), notes };
}

function linksOf(kind, pub) {
  if (kind === 'group') return [pub.website].filter(Boolean);
  return [...(Array.isArray(pub.links) ? pub.links : []), pub.media].filter(Boolean);
}

const STATIC_GROUPS = groupsRaw.map((g) => ({ name: g.name, city: g.city, province: g.province, slug: g.slug || '', nameKey: foldKey(g.name), cityKey: foldKey(g.city) }));

// Possible duplicates: same folded name in the listings table (any kind,
// any live status), or a group already on /groups with that name.
export async function duplicateHints(db, row) {
  const hints = [];
  const nameKey = row.name_key || foldKey(row.name);
  const cityKey = row.city_key || foldKey(row.city);
  try {
    const result = await db.prepare(
      `SELECT id, kind, status, name, city, province, city_key FROM listings
       WHERE id != ? AND name_key = ? AND status IN ('pending', 'needs_info', 'listed')
       ORDER BY created_at ASC LIMIT 5`,
    ).bind(row.id, nameKey).all();
    for (const other of (result && result.results) || []) {
      hints.push({
        source: 'listing',
        id: other.id,
        kind: other.kind,
        status: other.status,
        name: other.name,
        city: other.city,
        province: other.province,
        match: other.city_key === cityKey ? 'name_city' : 'name',
      });
    }
  } catch { /* advisory only */ }
  for (const g of STATIC_GROUPS) {
    if (g.nameKey !== nameKey) continue;
    hints.push({ source: 'groups', slug: g.slug, name: g.name, city: g.city, province: g.province, match: g.cityKey === cityKey ? 'name_city' : 'name' });
  }
  return hints;
}

// A row from /groups data for a listed group. The public directory there is
// a data file with a weekly link check, so a listed group becomes a one-line
// change to data/groups_canada.json. This is that line, ready to paste.
export function groupsRow(row, pub, today) {
  const kinds = {
    'Pipe band / piping': 'pipe band',
    'Pipe band / living history': 're-enactment / pipe band',
    'Highland dance': 'highland dance school',
    'Scottish country dance': 'scottish country dance',
    Gaelic: 'gaelic class',
    'Clan society': 'clan society',
    'Scottish society & Burns club': 'scottish society',
    'Irish & Welsh': 'irish club',
    'Trad sessions': 'trad session',
    'Heavy events': 'heavy events club',
    'Whisky societies': 'whisky society',
    Association: 'umbrella organization',
  };
  return {
    name: row.name,
    type: kinds[pub.groupKind] || 'scottish society',
    city: row.city,
    province: row.province,
    website: pub.website || '',
    source_url: pub.website || '',
    offers_lessons: pub.lessons === 'y' ? 'yes' : 'no',
    verified: today,
  };
}

function queueRow(row) {
  const pub = parseJson(row.public_json, {});
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    status_label: STATUS_LABEL[row.status] || row.status,
    status_reason: row.status_reason || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    city: row.city,
    province: row.province,
    public: pub,
    show_email: Number(row.show_email) === 1,
    submitter_role: row.submitter_role || '',
    newsletter_opt_in: Number(row.newsletter_opt_in) === 1,
    risk_flags: parseJson(row.risk_flags, []).filter((code) => /^[a-z0-9_]{1,40}$/.test(String(code))),
    links: linksOf(row.kind, pub).map(linkCheck),
    reply: { kind: row.reply_kind || '', status: row.reply_status || '', draft: row.reply_draft || '' },
    needs_info_at: row.needs_info_at || '',
  };
}

const QUEUE_SQL = `SELECT * FROM listings
WHERE status IN ('pending', 'needs_info')
   OR (reply_status IN ('pending_approval', 'failed'))
ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'needs_info' THEN 1 ELSE 2 END, created_at ASC
LIMIT ?`;

// The full queue for the signed page. withPrivate adds the submitter's
// name and email. The bearer API never asks for them.
export async function listingQueue(db, { withPrivate = false, limit = QUEUE_LIMIT } = {}) {
  const result = await db.prepare(QUEUE_SQL).bind(limit).all();
  const rows = (result && result.results) || [];
  const items = [];
  for (const row of rows) {
    const item = queueRow(row);
    item.duplicates = await duplicateHints(db, row);
    if (withPrivate) {
      item.submitter_name = row.submitter_name;
      item.submitter_email = row.submitter_email;
      item.public_email = Number(row.show_email) === 1 ? row.public_email : '';
      item.moderator_note = row.moderator_note || '';
    }
    items.push(item);
  }
  return items;
}

export async function loadListing(db, id) {
  if (!ID_RE.test(String(id || ''))) return null;
  return db.prepare('SELECT * FROM listings WHERE id = ?').bind(String(id).toLowerCase()).first();
}

export function listedDraft(row) {
  const link = listingConfig.moderation.publicLinks[row.kind === 'group' ? 'group' : 'performer'];
  return fill(REPLIES.listed, { name: row.name, link });
}

export function needsInfoDraft(row, question) {
  return fill(REPLIES.needsInfo, { name: row.name, question });
}

// One status step by a person. Returns { ok, status } or { ok: false, error }.
export async function setListingStatus(db, id, { status, reason = '', note = '' }, now = new Date()) {
  const row = await loadListing(db, id);
  if (!row) return { ok: false, error: 'not_found' };
  const next = String(status || '');
  if (!STATUSES.includes(next)) return { ok: false, error: 'bad_status' };
  if (!(TRANSITIONS[row.status] || []).includes(next)) {
    return { ok: false, error: next === 'needs_info' && row.status === 'needs_info' ? 'already_asked' : 'bad_transition' };
  }
  const cleanNote = String(note || '').replace(/\r\n?/g, '\n').trim();
  if (cleanNote.length > NOTE_LIMIT) return { ok: false, error: 'note_too_long' };
  const iso = now.toISOString();
  let sql = '';
  let args = [];
  if (next === 'listed') {
    sql = `UPDATE listings SET status = 'listed', status_reason = '', listed_at = ?, updated_at = ?,
      reply_kind = 'listed', reply_draft = ?, reply_status = 'pending_approval', moderator_note = ?
      WHERE id = ? AND status = ?`;
    args = [iso, iso, listedDraft(row), cleanNote, row.id, row.status];
  } else if (next === 'needs_info') {
    if (!cleanNote) return { ok: false, error: 'question_required' };
    if (hasPrivateContact(cleanNote)) return { ok: false, error: 'question_contact' };
    sql = `UPDATE listings SET status = 'needs_info', needs_info_at = ?, updated_at = ?,
      reply_kind = 'needs_info', reply_draft = ?, reply_status = 'pending_approval', moderator_note = ?
      WHERE id = ? AND status = ?`;
    args = [iso, iso, needsInfoDraft(row, cleanNote), cleanNote, row.id, row.status];
  } else if (next === 'rejected') {
    const why = String(reason || '');
    if (!REJECT_REASONS.includes(why)) return { ok: false, error: 'reason_required' };
    sql = `UPDATE listings SET status = 'rejected', status_reason = ?, closed_at = ?, updated_at = ?,
      reply_status = CASE WHEN reply_status IN ('pending_approval', 'failed') THEN 'discarded' ELSE reply_status END,
      moderator_note = ?
      WHERE id = ? AND status = ?`;
    args = [why, iso, iso, cleanNote, row.id, row.status];
  } else if (next === 'closed') {
    sql = `UPDATE listings SET status = 'closed', status_reason = ?, closed_at = ?, updated_at = ?,
      reply_status = CASE WHEN reply_status IN ('pending_approval', 'failed') THEN 'discarded' ELSE reply_status END,
      moderator_note = ?
      WHERE id = ? AND status = ?`;
    args = [row.status === 'listed' ? 'removed' : 'no_reply', iso, iso, cleanNote, row.id, row.status];
  }
  const result = await db.prepare(sql).bind(...args).run();
  if (changesOf(result) !== 1) return { ok: false, error: 'busy' };
  return { ok: true, status: next };
}

// Send the one reply for the current step, after a person pressed send.
export async function sendListingReply(env, id, { text = null } = {}, deps = {}) {
  const db = env && env.INTAKE_DB;
  const row = await loadListing(db, id);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.reply_status === 'sent') return { ok: true, status: 'already_sent' };
  if (row.reply_status !== 'pending_approval' && row.reply_status !== 'failed') return { ok: false, error: 'no_draft' };
  const body = text == null ? String(row.reply_draft || '') : String(text).replace(/\r\n?/g, '\n');
  if (!body.trim() || body.length > DRAFT_LIMIT) return { ok: false, error: 'draft_blocked' };
  if (hasUnfilledPlaceholder(body)) return { ok: false, error: 'draft_placeholder' };
  const now = deps.now ? deps.now() : new Date();
  const gate = await sendGate(env, { now, mode: 'approved' });
  if (!gate.ok) return { ok: false, error: gate.reason };
  const claim = await db.prepare(
    "UPDATE listings SET reply_status = 'sending', updated_at = ? WHERE id = ? AND reply_status IN ('pending_approval', 'failed')",
  ).bind(now.toISOString(), row.id).run();
  if (changesOf(claim) !== 1) return { ok: false, error: 'busy' };
  const subject = row.reply_kind === 'needs_info' ? REPLIES.needsInfoSubject : REPLIES.listedSubject;
  try {
    await sendApprovedReply(env, { to: row.submitter_email, subject, text: body }, deps);
  } catch (err) {
    await db.prepare("UPDATE listings SET reply_status = 'failed', updated_at = ? WHERE id = ?").bind(now.toISOString(), row.id).run();
    return { ok: false, error: codeOf(err) === 'error' ? 'send_failed' : codeOf(err) };
  }
  await db.prepare("UPDATE listings SET reply_status = 'sent', reply_draft = ?, updated_at = ? WHERE id = ?")
    .bind(body, now.toISOString(), row.id).run();
  await recordOutbound(db, { kind: 'listing', inboundEmailId: row.id, actor: 'person', now });
  return { ok: true, status: 'sent' };
}

export async function discardListingReply(db, id, now = new Date()) {
  const result = await db.prepare(
    "UPDATE listings SET reply_status = 'discarded', updated_at = ? WHERE id = ? AND reply_status IN ('pending_approval', 'failed')",
  ).bind(now.toISOString(), String(id || '').toLowerCase()).run();
  return changesOf(result) === 1 ? { ok: true, status: 'discarded' } : { ok: false, error: 'no_draft' };
}

// ---------- daily jobs ----------

export async function closeStaleNeedsInfo(db, now = new Date(), days = LIMITS.needsInfoDays) {
  const cutoff = daysAgo(now, days);
  const iso = now.toISOString();
  const result = await db.prepare(
    `UPDATE listings SET status = 'closed', status_reason = 'no_reply', closed_at = ?, updated_at = ?,
       reply_status = CASE WHEN reply_status IN ('pending_approval', 'failed') THEN 'discarded' ELSE reply_status END
     WHERE status = 'needs_info' AND needs_info_at != '' AND needs_info_at < ?`,
  ).bind(iso, iso, cutoff).run();
  return changesOf(result);
}

// Rejected and closed rows, private fields included, go 90 days after their
// last change. Dry run unless RETENTION_PURGE is "on", like the other tables.
export async function purgeListings(db, env, now = new Date(), days = LIMITS.closedRetentionDays) {
  const cutoff = daysAgo(now, days);
  const where = "status IN ('rejected', 'closed') AND updated_at < ?";
  const count = countOf(await db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${where}`).bind(cutoff).first());
  const mode = purgeEnabled(env) ? 'delete' : 'dry_run';
  if (mode === 'delete' && count) await db.prepare(`DELETE FROM listings WHERE ${where}`).bind(cutoff).run();
  return { mode, count };
}

// Optional receipt. Only when ACK_REPLIES is "on" (it is off), only for rows
// from the last two days, and only through the send guard.
export async function sendListingAcks(env, now = new Date(), deps = {}) {
  if (!acksEnabled(env)) return { status: 'off', sent: 0 };
  const db = env.INTAKE_DB;
  const send = typeof deps.send === 'function'
    ? deps.send
    : (env.EMAIL && typeof env.EMAIL.send === 'function' ? env.EMAIL.send.bind(env.EMAIL) : null);
  if (!send) return { status: 'not_configured', sent: 0 };
  const result = await db.prepare(
    "SELECT id, name, submitter_email FROM listings WHERE ack_status = 'pending' AND created_at >= ? ORDER BY created_at ASC LIMIT 10",
  ).bind(daysAgo(now, 2)).all();
  let sent = 0;
  for (const row of (result && result.results) || []) {
    const gate = await sendGate(env, { now, mode: 'auto' });
    if (!gate.ok) return { status: gate.reason, sent };
    const to = oneEmail(row.submitter_email);
    const stopped = to ? await optOutStatus(db, to) : 'opted_out';
    if (stopped !== 'allowed') {
      await db.prepare("UPDATE listings SET ack_status = 'skipped' WHERE id = ?").bind(row.id).run();
      continue;
    }
    try {
      await send({
        to,
        from: { email: PUBLIC_MAILBOX, name: 'The Celtic Coo' },
        subject: REPLIES.ackSubject,
        text: `${fill(REPLIES.ack, { name: oneLine(row.name, 120) })}\n\n${caslFooterText()}\n`,
      });
      await db.prepare("UPDATE listings SET ack_status = 'sent' WHERE id = ?").bind(row.id).run();
      await recordOutbound(db, { kind: 'listing_ack', inboundEmailId: row.id, actor: 'auto', now });
      sent += 1;
    } catch {
      await db.prepare("UPDATE listings SET ack_status = 'failed' WHERE id = ?").bind(row.id).run();
    }
  }
  return { status: 'ok', sent };
}

export function digestEnabled(env) {
  return String(env && env.LISTING_DIGEST || '').trim().toLowerCase() === 'on';
}

export async function queueLink(env, now = new Date()) {
  const secret = reviewSecret(env);
  const origin = reviewOrigin(env);
  if (!secret || !origin) return '';
  const exp = Math.floor(now.getTime() / 1000) + QUEUE_LINK_SECONDS;
  const sig = await signAction(secret, { action: 'listings', id: 'queue', exp });
  return `${origin}/listings?exp=${exp}&sig=${sig}`;
}

export async function verifyQueueLink(env, exp, sig, now = new Date()) {
  const secret = reviewSecret(env);
  const expiry = Number(exp);
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!secret || !Number.isInteger(expiry) || expiry < nowSec || expiry > nowSec + QUEUE_LINK_SECONDS + 60) return false;
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(String(sig || ''))) return false;
  const expected = await signAction(secret, { action: 'listings', id: 'queue', exp: expiry });
  return csrfPairMatches(expected, String(sig));
}

export async function sendListingDigest(env, now = new Date(), deps = {}) {
  if (!digestEnabled(env)) return { status: 'off' };
  const db = env.INTAKE_DB;
  const waiting = countOf(await db.prepare(
    "SELECT COUNT(*) AS n FROM listings WHERE status = 'pending' OR reply_status IN ('pending_approval', 'failed')",
  ).bind().first());
  if (!waiting) return { status: 'empty' };
  const to = oneEmail(env.FORWARD_TO);
  const link = await queueLink(env, now);
  const send = typeof deps.send === 'function'
    ? deps.send
    : (env.EMAIL && typeof env.EMAIL.send === 'function' ? env.EMAIL.send.bind(env.EMAIL) : null);
  if (!to || !link || !send) return { status: 'not_configured' };
  await send({
    to,
    from: { email: PUBLIC_MAILBOX, name: 'The Celtic Coo' },
    subject: `Listings waiting for review: ${waiting}`,
    text: `${waiting} listing${waiting === 1 ? '' : 's'} or replies are waiting for you.\n\nOpen the queue (link works for 3 days):\n${link}\n\nNothing is published or sent until you press a button there.\n`,
  });
  return { status: 'sent', waiting };
}

export async function runListingJobs(env, now = new Date(), log = console.log, deps = {}) {
  const db = env && env.INTAKE_DB;
  if (!db || typeof db.prepare !== 'function') return { status: 'skipped' };
  const out = {};
  for (const [name, job] of [
    ['closed', () => closeStaleNeedsInfo(db, now)],
    ['purge', () => purgeListings(db, env, now)],
    ['acks', () => sendListingAcks(env, now, deps)],
    ['digest', () => sendListingDigest(env, now, deps)],
  ]) {
    try { out[name] = await job(); }
    catch (err) { out[name] = { error: codeOf(err) === 'error' ? 'job_failed' : codeOf(err) }; }
  }
  log(JSON.stringify({
    message: 'listings',
    closed: typeof out.closed === 'number' ? out.closed : 'error',
    purge_mode: out.purge && out.purge.mode || 'error',
    purge_count: out.purge && Number.isInteger(out.purge.count) ? out.purge.count : 'error',
    acks: out.acks && out.acks.status || 'error',
    digest: out.digest && out.digest.status || 'error',
  }));
  return out;
}

// ---------- HTTP ----------

const NO_STORE = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, 'content-type': 'application/json; charset=utf-8' },
  });
}

async function audit(db, { now, actor, action, id, outcome, detail = '' }) {
  try {
    await db.prepare(
      'INSERT INTO approval_audit (id, created_at, actor, action, inbound_email_id, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), now.toISOString(), actor, action, id || '', outcome, detail).run();
  } catch { /* audit is best effort; a missing table must not block a person */ }
}

// GET /api/listings. Read-only, chat bearer token, no submitter name or email.
export async function handleListingsApi(request, env, deps = {}) {
  const db = env && env.INTAKE_DB;
  if (!db || typeof db.prepare !== 'function') return json(503, { ok: false, error: 'not_configured' });
  const secret = approvalToken(env);
  if (!secret) return json(503, { ok: false, error: 'not_configured' });
  const now = deps.now ? deps.now() : new Date();
  let authed = false;
  try { authed = await bearerMatches(secret, request.headers.get('authorization')); } catch { authed = false; }
  if (!authed) {
    await audit(db, { now, actor: 'rejected', action: 'listing_queue', outcome: 'unauthorized' });
    return json(401, { ok: false, error: 'unauthorized' });
  }
  if (request.method !== 'GET') {
    await audit(db, { now, actor: 'chat', action: 'listing_queue', outcome: 'method' });
    return json(405, { ok: false, error: 'read_only', detail: 'Listings are approved on the signed queue page only.' });
  }
  const items = await listingQueue(db, { withPrivate: false });
  await audit(db, { now, actor: 'chat', action: 'listing_queue', outcome: 'ok', detail: String(items.length) });
  return json(200, { ok: true, items });
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq !== -1 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return '';
}

function csrfCookie(value) {
  return `coo_listings_csrf=${value}; HttpOnly; Secure; SameSite=Strict; Path=/listings; Max-Age=7200`;
}

const ACTION_LABEL = { listed: 'Approve and list', needs_info: 'Needs info', rejected: 'Reject', closed: 'Close or remove' };
const FLAG_LABEL = {
  minor_mentioned: 'Mentions a minor or junior',
  teaches_minors: 'Teaches children or teens',
  links_present: 'Links in the text',
  payment_request: 'Payment words',
  bot_instruction_attempt: 'Instruction-like text',
};

function pubRows(item) {
  const p = item.public || {};
  const P = listingConfig.performer;
  const label = (pairs, id) => (Object.fromEntries(pairs)[id] || id);
  const rows = [];
  const add = (k, v) => { if (v != null && String(v).trim() !== '') rows.push([k, v]); };
  if (item.kind === 'performer') {
    add('What they do', (p.acts || []).map((id) => label(P.acts, id)).join(', '));
    add('Solo or group', label(P.sizes, p.size));
    add('Travels', label(P.travel, p.travel));
    add('Booked for', (p.services || []).map((id) => label(P.services, id)).join(', '));
    add('Description', p.blurb);
    add('Association or grade', p.association);
    add('Public email', item.show_email ? item.public_email || '(shown)' : 'Private');
  } else {
    add('Type', p.groupKind);
    add('Lessons', p.lessons === 'y' ? 'Yes' : 'No');
    add('What they teach', p.lessonKinds);
    add('Ages', (p.lessonAges || []).join(', '));
    add('When they meet', p.schedule);
    add('Public contact', p.contact);
  }
  return rows;
}

function itemHtml(item, hidden, today) {
  const rows = [
    ['Kind', item.kind === 'group' ? 'Club or lessons' : 'Performer'],
    ['Status', item.status_label + (item.status_reason ? ` (${REASON_LABEL[item.status_reason] || item.status_reason})` : '')],
    ['Where', `${item.city}, ${item.province}`],
    ...pubRows(item),
    ['Sent in by (private)', `${item.submitter_name || ''} · ${item.submitter_email || ''} · ${item.submitter_role}`],
    ['Coo\'s Letter opt-in', item.newsletter_opt_in ? 'Yes (add by hand in Kit)' : 'No'],
  ];
  const flags = item.risk_flags.length
    ? `<p class="banner">Check: ${item.risk_flags.map((f) => esc(FLAG_LABEL[f] || f)).join(', ')}</p>` : '';
  const dupes = item.duplicates.length
    ? `<p class="banner">Possible duplicate: ${item.duplicates.map((d) => esc(`${d.name}, ${d.city} (${d.source === 'groups' ? 'on /groups' : STATUS_LABEL[d.status] || d.status}, ${d.match === 'name_city' ? 'same name and city' : 'same name'})`)).join('; ')}</p>` : '';
  const links = item.links.length
    ? `<ul>${item.links.map((l) => `<li><a href="${esc(l.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(l.host || l.url)}</a>${l.notes.length ? ` <span class="muted">(${esc(l.notes.join(', '))})</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No links.</p>';
  const allowed = TRANSITIONS[item.status] || [];
  const actions = allowed.length ? `
<form method="post" action="/listings/${esc(item.id)}">
${hidden}
<input type="hidden" name="op" value="status">
<p>${allowed.map((s, i) => `<label style="display:inline-block;margin-right:1rem;font-weight:600"><input type="radio" name="status" value="${s}"${i === 0 ? ' required' : ''}> ${esc(ACTION_LABEL[s])}</label>`).join('')}</p>
<label for="reason-${esc(item.id)}">Reason (for reject)</label>
<select id="reason-${esc(item.id)}" name="reason"><option value="">None</option>${listingConfig.moderation.rejectReasons.map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select>
<label for="note-${esc(item.id)}" style="margin-top:.6rem">Question (for needs info) or private note</label>
<textarea id="note-${esc(item.id)}" name="note" style="min-height:5rem" maxlength="${NOTE_LIMIT}"></textarea>
<div class="actions"><button class="primary" type="submit">Save</button></div>
</form>` : '';
  const reply = item.reply.status === 'pending_approval' || item.reply.status === 'failed' ? `
<form method="post" action="/listings/${esc(item.id)}">
${hidden}
<input type="hidden" name="op" value="reply">
<label for="draft-${esc(item.id)}">Reply to send (${esc(item.reply.kind === 'needs_info' ? 'the one follow-up' : 'their listing link')})${item.reply.status === 'failed' ? ' · last send failed' : ''}</label>
<textarea id="draft-${esc(item.id)}" name="draft" style="min-height:10rem">${esc(item.reply.draft)}</textarea>
<div class="actions"><button class="primary" type="submit" name="send" value="send">Send this reply</button><button class="ghost" type="submit" name="send" value="discard">Don't send</button></div>
</form>` : '';
  const paste = item.kind === 'group' && item.status === 'listed'
    ? `<p class="muted">Add to data/groups_canada.json:</p><pre class="quote">${esc(JSON.stringify(groupsRow(item, item.public, today), null, 2))}</pre>` : '';
  return `<section class="card" style="margin-bottom:1rem">
<h2>${esc(item.name)}</h2>
${flags}${dupes}
<table class="details">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:.6rem 0 0;font-weight:600">Links (format check only, not visited)</p>
${links}
${actions}
${reply}
${paste}
</section>`;
}

const OUTCOME_TEXT = {
  listed: 'Listed. The reply with their link is below, waiting for you to send it.',
  needs_info: 'Marked needs info. The follow-up is below, waiting for you to send it.',
  rejected: 'Rejected. Nothing was sent.',
  closed: 'Closed. Nothing was sent.',
  sent: 'Reply sent.',
  already_sent: 'That reply was already sent.',
  discarded: 'Reply discarded. Nothing was sent.',
};

export async function handleListingsPage(request, env, deps = {}) {
  const url = new URL(request.url);
  const db = env && env.INTAKE_DB;
  const now = deps.now ? deps.now() : new Date();
  const secret = reviewSecret(env);
  if (!db || typeof db.prepare !== 'function' || !secret) {
    return reviewPage(503, 'Listings queue is not set up', '<p>The review secret or the database is missing.</p>');
  }
  let fields = new URLSearchParams(url.search);
  let idFromPath = '';
  const match = /^\/listings\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (url.pathname !== '/listings' && !match) return reviewPage(404, 'Not found', '<p>That page does not exist.</p>');
  if (request.method === 'POST') {
    const raw = await request.text();
    if (raw.length > 20000) return reviewPage(413, 'Too long', '<p>That form was too long.</p>');
    fields = new URLSearchParams(raw);
    idFromPath = match ? match[1].toLowerCase() : '';
  } else if (request.method !== 'GET' || match) {
    return reviewPage(405, 'Not allowed', '<p>Use the queue page.</p>', { allow: 'GET' });
  }
  const exp = fields.get('exp') || '';
  const sig = fields.get('sig') || '';
  if (!(await verifyQueueLink(env, exp, sig, now))) {
    await audit(db, { now, actor: 'rejected', action: 'listing_page', outcome: 'bad_link' });
    return reviewPage(403, 'This link has expired', '<p>Ask for a fresh queue link.</p>');
  }
  const linkQuery = `exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
  let banner = '';
  if (request.method === 'POST') {
    const cookie = readCookie(request, 'coo_listings_csrf');
    const presented = fields.get('csrf') || '';
    const csrfOk = (await csrfPairMatches(cookie, presented)) && (await verifyCsrf(secret, CSRF_ID, presented));
    if (!csrfOk) {
      await audit(db, { now, actor: 'rejected', action: 'listing_change', id: idFromPath, outcome: 'csrf' });
      return reviewPage(403, 'Please reload the queue', '<p>The page was open too long. Reload it and try again.</p>');
    }
    let result;
    let action = 'listing_status';
    if (fields.get('op') === 'reply') {
      action = fields.get('send') === 'discard' ? 'listing_discard' : 'listing_send';
      result = action === 'listing_discard'
        ? await discardListingReply(db, idFromPath, now)
        : await sendListingReply(env, idFromPath, { text: fields.get('draft') }, deps);
    } else {
      result = await setListingStatus(db, idFromPath, {
        status: fields.get('status') || '',
        reason: fields.get('reason') || '',
        note: fields.get('note') || '',
      }, now);
    }
    const outcome = result.ok ? result.status : result.error;
    await audit(db, { now, actor: 'person', action, id: idFromPath, outcome: String(outcome).slice(0, 40) });
    banner = result.ok ? OUTCOME_TEXT[result.status] || 'Saved.' : `Not saved: ${result.error}.`;
  }
  const csrf = await issueCsrf(secret, CSRF_ID);
  const hidden = `<input type="hidden" name="exp" value="${esc(exp)}"><input type="hidden" name="sig" value="${esc(sig)}"><input type="hidden" name="csrf" value="${esc(csrf)}">`;
  const items = await listingQueue(db, { withPrivate: true });
  const today = now.toISOString().slice(0, 10);
  const body = `${banner ? `<p class="banner" role="status">${esc(banner)}</p>` : ''}
<p class="muted">${items.length} waiting. Approve lists it on the site right away. Every reply waits for you to press send. Rejected and closed listings are deleted after ${LIMITS.closedRetentionDays} days. <a href="/listings?${linkQuery}">Reload</a></p>
${items.length ? items.map((item) => itemHtml(item, hidden, today)).join('\n') : '<p class="card">Nothing waiting.</p>'}`;
  return reviewPage(200, 'Listings queue', body, { 'set-cookie': csrfCookie(csrf) });
}
