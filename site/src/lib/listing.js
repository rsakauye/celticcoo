// Free self-listing for performers and for clubs or lessons groups.
// One engine for the form page, the Pages Functions, and the tests.
//
// A listing is stored in the private intake database (table listings) with
// status pending. Nothing is shown on the site until a person sets it to
// listed in the moderation queue (workers/inbound/src/listings.js). The
// public directory reads only listed rows, and only the public fields.
//
// Private fields never leave the database through this file: the
// submitter's name, email, and role, the checkboxes, and the newsletter flag.
// A performer's booking email is shown only when they ticked the box to show it.
// A group's public contact is an organization address by design.
//
// Field lists, limits, and copy are in data/listings.json.

import listingConfig from '../../../data/listings.json' with { type: 'json' };
import celticcooTrust from '../../../shared/trust/sites/celticcoo.js';
import { detectRedFlags } from '../../../shared/trust/index.js';
import { failureContext, logIntakeFailure } from './intake.js';

export { listingConfig };
export const LISTING_TURNSTILE_ACTION = 'listing';
export const KINDS = ['performer', 'group'];
export const LIMITS = listingConfig.limits;
export const COPY = listingConfig.copy;

const ids = (pairs) => pairs.map(([id]) => id);

// ---------- small cleaners ----------

export function oneLine(value, max = 200) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function block(value, max = 2000) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

// Words are runs of non-space characters with at least one letter or digit.
// A dash or an emoji on its own does not count.
export function wordCount(value) {
  return String(value ?? '')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .length;
}

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function cleanEmail(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 200 || !EMAIL_RE.test(text)) return '';
  const tld = text.split('.').pop();
  if (!/^[A-Za-z]{2,24}$/.test(tld)) return '';
  return text;
}

// A public link must be a plain http or https address on a real host name.
// No login in the URL, no IP address, no localhost, no odd port.
// Returns '' for an empty value and null for a bad one.
export function cleanUrl(value, max = LIMITS.urlMax) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > max || /\s/.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443' && url.port !== '80') return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.')) return null;
  if (/^[0-9.]+$/.test(host) || host.startsWith('[')) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  const tld = host.split('.').pop();
  if (!/^[a-z]{2,24}$/.test(tld) && !/^xn--[a-z0-9-]{2,59}$/.test(tld)) return null;
  return url.href;
}

// Same shape as the inbound Worker's phone check: 3-3-4 with optional country code.
// Years and grades such as "since 1998, Grade 2 in 2019-2024" do not match.
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}(?!\d)/;
const EMAIL_IN_TEXT_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

export function hasPrivateContact(value) {
  const text = String(value ?? '');
  return PHONE_RE.test(text) || EMAIL_IN_TEXT_RE.test(text);
}

// Key for the duplicate hint shown to the moderator: case, accents,
// punctuation, and a leading "the" do not matter.
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

function pick(value, allowed) {
  const text = String(value ?? '').trim();
  return allowed.includes(text) ? text : '';
}

function pickMany(values, allowed) {
  const list = Array.isArray(values) ? values : [values];
  const out = [];
  for (const value of list) {
    const text = String(value ?? '').trim();
    if (allowed.includes(text) && !out.includes(text)) out.push(text);
  }
  return out;
}

function anyUnknown(values, allowed) {
  const list = Array.isArray(values) ? values : [values];
  return list.some((value) => String(value ?? '').trim() !== '' && !allowed.includes(String(value).trim()));
}

function ticked(value) {
  return value === true || value === 'yes' || value === 'on' || value === '1';
}

// ---------- reading the form ----------

function all(formData, name) {
  if (!formData || typeof formData.getAll !== 'function') return [];
  return formData.getAll(name).map((value) => (typeof value === 'string' ? value : ''));
}

function one(formData, name) {
  if (!formData || typeof formData.get !== 'function') return '';
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function readListingForm(formData) {
  const kind = one(formData, 'kind');
  return {
    kind,
    honeypot: one(formData, 'listing_hp'),
    name: one(formData, 'name'),
    acts: all(formData, 'acts'),
    size: one(formData, 'size'),
    city: one(formData, 'city'),
    province: one(formData, 'province'),
    travel: one(formData, 'travel'),
    services: all(formData, 'services'),
    blurb: one(formData, 'blurb'),
    links: all(formData, 'links'),
    association: one(formData, 'association'),
    media: one(formData, 'media'),
    email: one(formData, 'email'),
    showEmail: one(formData, 'show_email'),
    groupKind: one(formData, 'group_kind'),
    website: one(formData, 'website'),
    lessons: one(formData, 'lessons'),
    lessonKinds: one(formData, 'lesson_kinds'),
    lessonAges: all(formData, 'lesson_ages'),
    schedule: one(formData, 'schedule'),
    contact: one(formData, 'contact'),
    submitterName: one(formData, 'submitter_name'),
    role: one(formData, 'role'),
    adultConfirm: one(formData, 'adult_confirm'),
    termsConfirm: one(formData, 'terms_confirm'),
    newsletter: one(formData, 'newsletter'),
  };
}

// ---------- validation ----------

function shared(input, errors, cfg, roles) {
  const E = cfg.copy.errors;
  const L = cfg.limits;
  const name = oneLine(input.name, L.nameMax + 1);
  if (!name) errors.name = E.name;
  else if (name.length > L.nameMax || hasPrivateContact(name)) errors.name = E.name;
  const city = oneLine(input.city, L.cityMax + 1);
  if (!city || city.length > L.cityMax || hasPrivateContact(city)) errors.city = E.city;
  const province = pick(input.province, ids(cfg.provinces));
  if (!province) errors.province = E.province;
  const submitterName = oneLine(input.submitterName, L.nameMax + 1);
  if (!submitterName || submitterName.length > L.nameMax) errors.submitter_name = E.submitter_name;
  const role = pick(input.role, ids(roles));
  if (!role) errors.role = E.role;
  const adultConfirm = ticked(input.adultConfirm);
  if (!adultConfirm) errors.adult_confirm = E.adult_confirm;
  const termsConfirm = ticked(input.termsConfirm);
  if (!termsConfirm) errors.terms_confirm = E.terms_confirm;
  return {
    name: name.slice(0, L.nameMax),
    city: city.slice(0, L.cityMax),
    province,
    submitterName: submitterName.slice(0, L.nameMax),
    role,
    adultConfirm,
    termsConfirm,
    newsletter: ticked(input.newsletter),
  };
}

function shortText(value, key, errors, E, max) {
  const text = oneLine(value, max + 1);
  if (text.length > max) { errors[key] = E.text; return ''; }
  if (hasPrivateContact(text)) { errors[key] = E.contact_private; return ''; }
  return text;
}

function validatePerformer(input, cfg) {
  const errors = {};
  const E = cfg.copy.errors;
  const L = cfg.limits;
  const P = cfg.performer;
  const base = shared(input, errors, cfg, P.roles);
  const acts = pickMany(input.acts, ids(P.acts));
  if (!acts.length || anyUnknown(input.acts, ids(P.acts))) errors.acts = E.acts;
  const size = pick(input.size, ids(P.sizes));
  if (!size) errors.size = E.size;
  const travel = pick(input.travel, ids(P.travel));
  if (!travel) errors.travel = E.travel;
  const services = pickMany(input.services, ids(P.services));
  if (anyUnknown(input.services, ids(P.services))) errors.services = E.services;
  const blurb = block(input.blurb, 4000);
  if (!blurb) errors.blurb = E.blurb;
  else if (wordCount(blurb) > L.blurbWords) errors.blurb = E.blurb_words;
  else if (hasPrivateContact(blurb)) errors.blurb = E.contact_private;
  const rawLinks = (Array.isArray(input.links) ? input.links : [input.links]).map((link) => String(link ?? '').trim()).filter(Boolean);
  const links = [];
  if (rawLinks.length > L.maxLinks) errors.links = E.links;
  for (const raw of rawLinks.slice(0, L.maxLinks)) {
    const url = cleanUrl(raw);
    if (url === null) { errors.links = E.links; continue; }
    if (url && !links.includes(url)) links.push(url);
  }
  const media = cleanUrl(input.media);
  if (media === null) errors.media = E.media;
  const association = shortText(input.association, 'association', errors, E, 80);
  if (errors.association === E.text) errors.association = E.association;
  const email = cleanEmail(input.email);
  if (!email) errors.email = E.email;
  const value = {
    kind: 'performer',
    ...base,
    acts,
    size,
    travel,
    services,
    blurb,
    links,
    media: media || '',
    association,
    email,
    showEmail: ticked(input.showEmail),
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

function validateGroup(input, cfg) {
  const errors = {};
  const E = cfg.copy.errors;
  const G = cfg.group;
  const L = cfg.limits;
  const base = shared(input, errors, cfg, G.roles);
  const groupKind = pick(input.groupKind, ids(G.kinds));
  if (!groupKind) errors.kind = E.kind;
  const website = cleanUrl(input.website);
  if (!website) errors.website = E.website;
  const lessons = pick(input.lessons, ['y', 'n']);
  if (!lessons) errors.lessons = E.lessons;
  const lessonKinds = lessons === 'y' ? shortText(input.lessonKinds, 'lesson_kinds', errors, E, L.textMax) : '';
  const lessonAges = lessons === 'y' ? pickMany(input.lessonAges, ids(G.lessonAges)) : [];
  if (lessons === 'y' && anyUnknown(input.lessonAges, ids(G.lessonAges))) errors.lesson_ages = E.lesson_ages;
  const schedule = shortText(input.schedule, 'schedule', errors, E, L.textMax);
  const contactRaw = String(input.contact ?? '').trim();
  const contact = contactRaw ? cleanEmail(contactRaw) : '';
  if (contactRaw && !contact) errors.contact = E.contact;
  const email = cleanEmail(input.email);
  if (!email) errors.email = E.email;
  const value = {
    kind: 'group',
    ...base,
    groupKind,
    website: website || '',
    lessons,
    lessonKinds,
    lessonAges,
    schedule,
    contact,
    email,
    showEmail: false,
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

export function validateListing(input, cfg = listingConfig) {
  const kind = String(input && input.kind || '');
  if (kind === 'performer') return validatePerformer(input, cfg);
  if (kind === 'group') return validateGroup(input, cfg);
  return { ok: false, errors: { kind: cfg.copy.errors.kind } };
}

// ---------- public view ----------

const PERFORMER_PUBLIC = ['name', 'acts', 'size', 'city', 'province', 'travel', 'services', 'blurb', 'links', 'media', 'association'];
const GROUP_PUBLIC = ['name', 'groupKind', 'city', 'province', 'website', 'lessons', 'lessonKinds', 'lessonAges', 'schedule', 'contact'];

// The JSON stored in public_json. It never holds the submitter's name,
// email, role, checkboxes, or the newsletter flag.
export function publicFields(value) {
  const keys = value && value.kind === 'group' ? GROUP_PUBLIC : PERFORMER_PUBLIC;
  const out = {};
  for (const key of keys) out[key] = value[key] ?? (key.endsWith('s') ? [] : '');
  return out;
}

// A row from the listings table as the public sees it. Only the listed
// status is shown. Unknown keys in public_json are dropped. The booking
// email is added only when show_email is 1.
export function publicListing(row) {
  if (!row || row.status && row.status !== 'listed') return null;
  const kind = row.kind === 'group' ? 'group' : 'performer';
  let stored = {};
  try { stored = JSON.parse(String(row.public_json || '{}')) || {}; } catch { stored = {}; }
  const keys = kind === 'group' ? GROUP_PUBLIC : PERFORMER_PUBLIC;
  const out = { id: String(row.id || ''), kind };
  for (const key of keys) {
    const v = stored[key];
    if (Array.isArray(v)) out[key] = v.map((item) => oneLine(item, LIMITS.urlMax)).filter(Boolean).slice(0, 12);
    else out[key] = key === 'blurb' ? block(v, 2000) : oneLine(v, LIMITS.urlMax);
  }
  if (kind === 'performer') {
    out.links = (out.links || []).map((link) => cleanUrl(link)).filter(Boolean).slice(0, LIMITS.maxLinks);
    out.media = cleanUrl(out.media) || '';
    const email = Number(row.show_email) === 1 ? cleanEmail(row.public_email) : '';
    if (email) out.email = email;
  } else {
    out.website = cleanUrl(out.website) || '';
    out.contact = cleanEmail(out.contact) || '';
  }
  return out;
}

// Advisory codes for the moderator. They never publish or reject anything.
export function listingFlags(value) {
  const text = [value.name, value.blurb, value.association, value.lessonKinds, value.schedule]
    .filter(Boolean).join('\n').slice(0, 8000);
  const red = detectRedFlags(text, { injectionPhrases: celticcooTrust.lexicon && celticcooTrust.lexicon.injection });
  const flags = Object.entries(red).filter(([, on]) => on).map(([code]) => code);
  if (value.kind === 'group' && value.lessonAges && value.lessonAges.some((age) => age === 'children' || age === 'teens' || age === 'all')) {
    flags.push('teaches_minors');
  }
  return flags;
}

// ---------- storage ----------

export const LISTING_INSERT_SQL = `INSERT INTO listings (
  id, created_at, updated_at, kind, status, name, name_key, city, city_key, province,
  public_json, public_email, show_email, submitter_name, submitter_email, submitter_role,
  newsletter_opt_in, newsletter_consent_at, newsletter_source, adult_confirm, terms_confirm,
  risk_flags, ack_status, source
) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'listing')`;

// Where a Coo's Letter consent came from, for the CASL record: the form and
// the page path. The path comes from a same-origin Referer and is reduced to
// a plain path. Anything else falls back to /submit/.
export function consentSource(kind, request) {
  let path = '/submit/';
  try {
    const here = new URL(request.url);
    const from = new URL(request.headers.get('referer') || '');
    if (from.host === here.host && /^\/[a-z0-9/_-]{0,80}$/.test(from.pathname)) path = from.pathname;
  } catch { /* keep the default */ }
  return `${kind === 'group' ? 'group' : 'performer'}-listing-form ${path}`;
}

export async function saveListing(db, row) {
  if (!db || typeof db.prepare !== 'function') {
    throw Object.assign(new Error('intake database is not configured'), { code: 'not_configured' });
  }
  const v = row.value;
  await db.prepare(LISTING_INSERT_SQL).bind(
    row.id,
    row.createdAt,
    row.createdAt,
    v.kind,
    v.name,
    foldKey(v.name),
    v.city,
    foldKey(v.city),
    v.province,
    JSON.stringify(publicFields(v)),
    v.kind === 'performer' && v.showEmail ? v.email : '',
    v.kind === 'performer' && v.showEmail ? 1 : 0,
    v.submitterName,
    v.email,
    v.role,
    v.newsletter ? 1 : 0,
    v.newsletter ? row.createdAt : '',
    v.newsletter ? String(row.newsletterSource || `${v.kind}-listing-form /submit/`).slice(0, 120) : '',
    v.adultConfirm ? 1 : 0,
    v.termsConfirm ? 1 : 0,
    JSON.stringify(row.flags || []),
  ).run();
}

function countOf(row) {
  const n = Number(row && (row.n ?? row['COUNT(*)']));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Daily caps. A failed count does not block a person, since Turnstile has
// already passed. It is logged as a code.
export async function recentListingCounts(db, sinceIso, email) {
  try {
    const total = await db.prepare('SELECT COUNT(*) AS n FROM listings WHERE created_at >= ?').bind(sinceIso).first();
    const mine = await db.prepare('SELECT COUNT(*) AS n FROM listings WHERE created_at >= ? AND lower(submitter_email) = lower(?)').bind(sinceIso, email).first();
    return { total: countOf(total), mine: countOf(mine) };
  } catch {
    return { total: 0, mine: 0, error: 'count_failed' };
  }
}

// The intake kill switch from 0013_intake_control.sql. When it is paused,
// new listings are refused with a friendly note. A missing table does not
// block the form.
export async function listingsPaused(db) {
  try {
    const row = await db.prepare("SELECT manual_pause, latch FROM intake_control WHERE id = 'singleton'").bind().first();
    return Boolean(row && (Number(row.manual_pause) === 1 || String(row.latch || '') !== ''));
  } catch {
    return false;
  }
}

export const LISTED_PERFORMERS_SQL = `SELECT id, kind, status, public_json, show_email, public_email, listed_at
FROM listings
WHERE kind = 'performer' AND status = 'listed'
ORDER BY name_key ASC
LIMIT 500`;

export async function listedPerformers(db) {
  const result = await db.prepare(LISTED_PERFORMERS_SQL).bind().all();
  const rows = (result && result.results) || [];
  return rows.map(publicListing).filter(Boolean);
}

export function listingStoreFromEnv(env) {
  const db = env && env.INTAKE_DB;
  return {
    save: (row) => saveListing(db, row),
    log: (entry) => logIntakeFailure(db, { ...entry, source: 'listing' }),
    counts: (sinceIso, email) => (db ? recentListingCounts(db, sinceIso, email) : Promise.resolve({ total: 0, mine: 0 })),
    paused: () => (db ? listingsPaused(db) : Promise.resolve(false)),
  };
}

// ---------- request handlers ----------

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...extra },
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function html(status, heading, paragraphs = [], list = []) {
  const body = `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(heading)} · The Celtic Coo</title>
<style>
  body { margin:0; font:1.0625rem/1.55 system-ui,sans-serif; background:#fbf6ec; color:#2a1d14; }
  .bar { height:10px; background:#1f4d3a; }
  main { max-width:40rem; margin:0 auto; padding:1.5rem 1.1rem 3rem; }
  h1 { font-family:Georgia,serif; color:#1f4d3a; line-height:1.2; }
  a { color:#2f6b52; }
</style>
</head>
<body>
<div class="bar"></div>
<main>
<h1>${escapeHtml(heading)}</h1>
${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
${list.length ? `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
<p><a href="/submit/">Back to the form</a> · <a href="/">The Celtic Coo</a></p>
</main>
</body>
</html>`;
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
}

function sameOrigin(request) {
  let url;
  try { url = new URL(request.url); } catch { return false; }
  const origin = request.headers.get('origin');
  if (origin) {
    try { return new URL(origin).host === url.host; } catch { return false; }
  }
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  return true;
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

async function note(store, request, entry, token = '') {
  if (!store || typeof store.log !== 'function') return;
  try { await store.log({ ...entry, ...failureContext(request, token) }); }
  catch { console.error(JSON.stringify({ message: 'listing failure log threw', reason: 'log_failed' })); }
}

export async function handleListingRequest(request, deps = {}) {
  const cfg = deps.config || listingConfig;
  const F = cfg.copy.form;
  const contactEmail = deps.contactEmail || 'hello@celticcoo.ca';
  const vars = { email: contactEmail };
  const store = deps.store;
  const wants = (request.headers.get('accept') || '').includes('application/json');
  const now = deps.now ? deps.now() : new Date();

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', ...NO_STORE } });
  }
  if (!sameOrigin(request)) {
    await note(store, request, { reason: 'origin', detail: '' });
    return wants ? json(403, { ok: false, code: 'origin' }) : html(403, 'That request did not come from this site.');
  }
  if (Number(request.headers.get('content-length') || 0) > 60000) {
    await note(store, request, { reason: 'too_large', detail: '' });
    return wants ? json(413, { ok: false, code: 'too_large' }) : html(413, 'That listing is too long.');
  }
  let formData;
  try { formData = await request.formData(); }
  catch {
    await note(store, request, { reason: 'unreadable', detail: '' });
    return wants ? json(400, { ok: false, code: 'unreadable' }) : html(400, 'We could not read that form.');
  }
  const token = one(formData, 'cf-turnstile-response');
  const input = readListingForm(formData);
  const kind = KINDS.includes(input.kind) ? input.kind : 'performer';
  const success = kind === 'group' ? cfg.copy.groupForm.success : cfg.copy.performerForm.success;
  if (input.honeypot) {
    await note(store, request, { reason: 'honeypot', detail: kind }, token);
    return wants ? json(200, { ok: true }) : html(200, 'Thanks', [success]);
  }
  if (typeof deps.verify === 'function') {
    let verdict;
    try { verdict = await deps.verify(token, request); }
    catch { verdict = { ok: false, reason: 'turnstile_unavailable', detail: '' }; }
    if (!verdict || verdict.ok !== true) {
      const reason = (verdict && verdict.reason) || 'turnstile_rejected';
      await note(store, request, { reason, detail: (verdict && verdict.detail) || '' }, token);
      const message = cfg.copy.errors.turnstile;
      return wants ? json(403, { ok: false, code: reason, errors: { turnstile: message } }) : html(403, F.errorsHeading, [message]);
    }
  }
  const result = validateListing(input, cfg);
  if (!result.ok) {
    const fields = Object.keys(result.errors).sort().join(',');
    await note(store, request, { reason: 'validation', detail: `${kind}:${fields}`.slice(0, 120) }, token);
    return wants ? json(400, { ok: false, errors: result.errors }) : html(400, F.errorsHeading, ['Your browser\'s back button should keep what you typed.'], Object.values(result.errors));
  }
  if (!store) {
    return wants ? json(503, { ok: false, code: 'not_configured', message: fill(F.fallback, vars) }) : html(503, fill(F.fallback, vars));
  }
  if (await store.paused()) {
    await note(store, request, { reason: 'paused', detail: kind }, token);
    const message = fill(F.paused, vars);
    return wants ? json(503, { ok: false, code: 'paused', message }) : html(503, message);
  }
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const counts = await store.counts(since, result.value.email);
  if (counts.mine >= cfg.limits.perEmailPerDay || counts.total >= cfg.limits.perDayTotal) {
    const reason = counts.mine >= cfg.limits.perEmailPerDay ? 'listing_sender_cap' : 'listing_daily_cap';
    await note(store, request, { reason, detail: kind }, token);
    const message = fill(F.tooMany, vars);
    return wants ? json(429, { ok: false, code: 'too_many', message }) : html(429, message);
  }
  const id = crypto.randomUUID();
  try {
    await store.save({
      id,
      createdAt: now.toISOString(),
      value: result.value,
      flags: listingFlags(result.value),
      newsletterSource: consentSource(kind, request),
    });
  } catch (err) {
    const detail = err && err.code === 'not_configured' ? 'not_configured' : 'insert_failed';
    await note(store, request, { reason: 'store_failed', detail }, token);
    const message = fill(F.fallback, vars);
    return wants ? json(503, { ok: false, code: 'store_failed', message }) : html(503, message);
  }
  console.log(JSON.stringify({ message: 'listing stored', kind, status: 'pending' }));
  return wants ? json(200, { ok: true, stored: true }) : html(200, 'Thanks', [success]);
}

// GET /api/performers. Listed performers only, public fields only.
export async function handlePerformersRequest(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', ...NO_STORE } });
  }
  const db = env && env.INTAKE_DB;
  if (!db || typeof db.prepare !== 'function') {
    return json(200, { ok: true, listings: [] }, { 'cache-control': 'public, max-age=60' });
  }
  try {
    const listings = await listedPerformers(db);
    return json(200, { ok: true, listings }, { 'cache-control': 'public, max-age=300' });
  } catch {
    console.error(JSON.stringify({ message: 'performers read failed', code: 'read_failed' }));
    return json(503, { ok: false, code: 'unavailable' });
  }
}
