// Free self-listing: validation, the private queue insert, and the public
// directory. Local fixtures only. No real address, row id, or database id.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  COPY,
  LIMITS,
  LISTED_PERFORMERS_SQL,
  LISTING_TURNSTILE_ACTION,
  cleanUrl,
  foldKey,
  handleListingRequest,
  handlePerformersRequest,
  listingConfig,
  listingFlags,
  listingStoreFromEnv,
  publicFields,
  publicListing,
  validateListing,
  wordCount,
} from '../src/lib/listing.js';
import { verifyTurnstile } from '../src/lib/intake.js';
import { SLOTS, performerCardHtml, renderPerformersPage, countText } from '../src/lib/performerCards.js';
import { NAV_GROUPS } from '../src/lib/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const root = join(site, '..');
const NOW = new Date('2026-11-15T20:00:00.000Z');

function migrated() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(join(site, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(site, 'migrations', name), 'utf8'));
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

function performer(extra = {}) {
  return {
    kind: 'performer',
    name: 'Foothills Piper',
    acts: ['solo-piper'],
    size: 'solo',
    city: 'Okotoks',
    province: 'AB',
    travel: 'province',
    services: ['weddings', 'burns'],
    blurb: 'Solo piper for weddings and Burns suppers across southern Alberta.',
    links: ['https://piper.example.ca/'],
    media: '',
    association: '',
    email: 'piper@example.com',
    showEmail: '',
    submitterName: 'Sample Submitter',
    role: 'self',
    adultConfirm: 'yes',
    termsConfirm: 'yes',
    newsletter: '',
    ...extra,
  };
}

function group(extra = {}) {
  return {
    kind: 'group',
    name: 'Sample Pipes and Drums',
    groupKind: 'Pipe band / piping',
    city: 'Red Deer',
    province: 'AB',
    website: 'https://band.example.ca/',
    lessons: 'y',
    lessonKinds: 'Beginner chanter and snare',
    lessonAges: ['adults'],
    schedule: 'Tuesday evenings, September to June',
    contact: 'info@band.example.ca',
    email: 'sec@example.com',
    submitterName: 'Sample Secretary',
    role: 'executive',
    adultConfirm: 'yes',
    termsConfirm: 'yes',
    ...extra,
  };
}

function formOf(fields) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else if (value !== undefined) fd.append(key, value);
  }
  return fd;
}

function performerForm(extra = {}) {
  return {
    kind: 'performer',
    name: 'Foothills Piper',
    acts: ['solo-piper'],
    size: 'solo',
    city: 'Okotoks',
    province: 'AB',
    travel: 'province',
    services: ['weddings'],
    blurb: 'Solo piper for weddings and Burns suppers across southern Alberta.',
    links: ['https://piper.example.ca/', '', ''],
    media: '',
    association: '',
    email: 'piper@example.com',
    submitter_name: 'Sample Submitter',
    role: 'self',
    adult_confirm: 'yes',
    terms_confirm: 'yes',
    listing_hp: '',
    'cf-turnstile-response': 'token-ok',
    ...extra,
  };
}

function post(fields, headers = {}) {
  return new Request('https://celticcoo.ca/api/listing', {
    method: 'POST',
    body: formOf(fields),
    headers: { accept: 'application/json', origin: 'https://celticcoo.ca', ...headers },
  });
}

const passTurnstile = async () => ({ ok: true });

// ---------- config ----------

test('the blurb cap is 50 words and the taxonomies live in data/listings.json', () => {
  assert.equal(LIMITS.blurbWords, 50);
  assert.equal(LIMITS.maxLinks, 3);
  assert.equal(listingConfig.defaultProvince, 'AB');
  assert.equal(listingConfig.provinces.length, 13);
  const acts = listingConfig.performer.acts.map(([id]) => id);
  for (const id of ['solo-piper', 'drummer', 'pipe-band', 'ceilidh-band', 'instrument', 'singer', 'highland-dance', 'country-dance', 'heavy-athlete', 'mc', 'other']) {
    assert.ok(acts.includes(id), id);
  }
  assert.deepEqual(listingConfig.moderation.rejectReasons.map(([id]) => id), ['not_celtic', 'outside_canada', 'incomplete', 'duplicate', 'minor_safety', 'spam']);
  assert.deepEqual(listingConfig.moderation.statuses.map(([id]) => id), ['pending', 'needs_info', 'listed', 'rejected', 'closed']);
});

test('club types match the /groups taxonomy exactly', async () => {
  const data = readFileSync(join(site, 'src/lib/data.js'), 'utf8');
  const emoji = /export const GROUP_EMOJI = \{([\s\S]*?)\};/.exec(data)[1];
  const kinds = [...emoji.matchAll(/'([^']+)':/g)].map((m) => m[1]).sort();
  assert.deepEqual(listingConfig.group.kinds.map(([id]) => id).sort(), kinds);
});

test('copy has no em dashes and no paid tier, and the minor rule is in the form copy', () => {
  const raw = readFileSync(join(root, 'data/listings.json'), 'utf8');
  assert.doesNotMatch(raw, /\u2014/);
  assert.doesNotMatch(raw, /featured|premium|paid listing/i);
  assert.match(COPY.performerForm.adultsNote, /18 and older/);
  assert.match(COPY.performerForm.adultConfirm, /18 or older/);
  assert.match(COPY.groupForm.rule, /groups, not people/i);
  for (const block of ['performersPage', 'submitIntro', 'performerForm', 'performerExtra', 'groupForm', 'form', 'errors', 'replies', 'inquiryReply']) {
    assert.equal(COPY[block].source, 'hemingway', block);
  }
  assert.doesNotMatch(raw, /"source": "placeholder"/);
  assert.match(COPY.performerForm.mediaLabel, /Photo or video link/);
  assert.match(COPY.performerForm.linksHelp, /Up to 3 links/);
  assert.match(COPY.inquiryReply.body, /up to 3 website or social links/);
});

// ---------- validation ----------

test('word count ignores stray punctuation and the cap is enforced on the server', () => {
  assert.equal(wordCount('a b  c'), 3);
  assert.equal(wordCount('Pipes - drums'), 2);
  assert.equal(wordCount(''), 0);
  const fifty = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
  assert.equal(validateListing(performer({ blurb: fifty })).ok, true);
  const over = validateListing(performer({ blurb: `${fifty} more` }));
  assert.equal(over.ok, false);
  assert.equal(over.errors.blurb, COPY.errors.blurb_words);
});

test('the client form carries the same 50-word cap', () => {
  const form = readFileSync(join(site, 'src/components/ListingForm.astro'), 'utf8');
  const page = readFileSync(join(site, 'src/pages/submit/index.astro'), 'utf8');
  assert.match(form, /data-word-cap=\{LIMITS\.blurbWords\}/);
  assert.match(page, /wordCap: LIMITS\.blurbWords/);
  assert.match(page, /errors\.blurb = E\.blurb_words/);
});

test('the adults-only box is required and there are no under-18 or guardian fields', () => {
  const missing = validateListing(performer({ adultConfirm: '' }));
  assert.equal(missing.ok, false);
  assert.equal(missing.errors.adult_confirm, COPY.errors.adult_confirm);
  assert.equal(validateListing(group({ adultConfirm: '' })).errors.adult_confirm, COPY.errors.adult_confirm);
  assert.equal(validateListing(performer({ termsConfirm: '' })).errors.terms_confirm, COPY.errors.terms_confirm);
  const form = readFileSync(join(site, 'src/components/ListingForm.astro'), 'utf8');
  assert.match(form, /name="adult_confirm" value="yes" required/);
  assert.doesNotMatch(form, /name="(?:under18|guardian[^"]*|parent[^"]*)"/);
  assert.doesNotMatch(form, /name="phone"|name="fee|name="price/);
});

test('URLs must be plain http or https on a real host', () => {
  assert.equal(cleanUrl(''), '');
  assert.equal(cleanUrl('https://piper.example.ca/a?b=1'), 'https://piper.example.ca/a?b=1');
  assert.equal(cleanUrl('http://old.example.com'), 'http://old.example.com/');
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://example.ca/file',
    'https://user:pw@example.ca/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://intranet/',
    'https://example.ca:8443/',
    'example.ca',
    'https://exa mple.ca/',
    `https://example.ca/${'a'.repeat(400)}`,
  ]) {
    assert.equal(cleanUrl(bad), null, bad);
  }
  const res = validateListing(performer({ links: ['https://a.example.ca', 'javascript:alert(1)'] }));
  assert.equal(res.errors.links, COPY.errors.links);
  const four = validateListing(performer({ links: ['https://a.example.ca', 'https://b.example.ca', 'https://c.example.ca', 'https://d.example.ca'] }));
  assert.equal(four.errors.links, COPY.errors.links);
  assert.equal(validateListing(performer({ media: 'file:///etc/passwd' })).errors.media, COPY.errors.media);
  assert.equal(validateListing(group({ website: '' })).errors.website, COPY.errors.website);
});

test('options outside the lists, phone numbers, and emails in public text are refused', () => {
  assert.equal(validateListing(performer({ acts: ['solo-piper', 'dj'] })).errors.acts, COPY.errors.acts);
  assert.equal(validateListing(performer({ acts: [] })).errors.acts, COPY.errors.acts);
  assert.equal(validateListing(performer({ province: 'ZZ' })).errors.province, COPY.errors.province);
  assert.equal(validateListing(performer({ blurb: 'Call me at 403 555 0100 any time.' })).errors.blurb, COPY.errors.contact_private);
  assert.equal(validateListing(performer({ blurb: 'Email me at piper@example.com.' })).errors.blurb, COPY.errors.contact_private);
  assert.equal(validateListing(group({ schedule: 'Text 403-555-0100' })).errors.schedule, COPY.errors.contact_private);
  assert.equal(validateListing(performer({ blurb: 'Piping since 1998. Grade 2 band 2010-2019, solo prizes 2021 2022 2023.' })).ok, true);
  assert.equal(validateListing(performer({ blurb: 'Call +1 (403) 555-0100.' })).errors.blurb, COPY.errors.contact_private);
  assert.equal(validateListing(group({ contact: 'not an email' })).errors.contact, COPY.errors.contact);
  assert.equal(validateListing(group({ groupKind: 'Disco' })).errors.kind, COPY.errors.kind);
  assert.equal(validateListing({ kind: 'shop' }).ok, false);
});

// ---------- privacy of the public view ----------

test('the contact email is not public unless the performer opted in', () => {
  const value = validateListing(performer()).value;
  const pub = publicFields(value);
  for (const key of ['email', 'submitterName', 'role', 'adultConfirm', 'termsConfirm', 'newsletter', 'showEmail']) {
    assert.equal(key in pub, false, key);
  }
  const hidden = publicListing({ id: 'x', kind: 'performer', status: 'listed', public_json: JSON.stringify(pub), show_email: 0, public_email: '' });
  assert.equal('email' in hidden, false);
  assert.doesNotMatch(JSON.stringify(hidden), /piper@example\.com|Sample Submitter/);
  const shown = publicListing({ id: 'x', kind: 'performer', status: 'listed', public_json: JSON.stringify(pub), show_email: 1, public_email: 'piper@example.com' });
  assert.equal(shown.email, 'piper@example.com');
  const sneaky = publicListing({ id: 'x', kind: 'performer', status: 'listed', public_json: JSON.stringify({ ...pub, submitter_email: 'leak@example.com', email: 'leak@example.com' }), show_email: 0 });
  assert.doesNotMatch(JSON.stringify(sneaky), /leak@example\.com/);
  assert.equal(publicListing({ id: 'x', kind: 'performer', status: 'pending', public_json: '{}' }), null);
  assert.doesNotMatch(LISTED_PERFORMERS_SQL, /submitter_|newsletter|moderator_note|reply_draft/);
  assert.match(LISTED_PERFORMERS_SQL, /status = 'listed'/);
});

test('risk codes are advisory and do not copy the text', () => {
  const flags = listingFlags(validateListing(group({ lessonAges: ['children', 'adults'] })).value);
  assert.ok(flags.includes('teaches_minors'));
  const kid = listingFlags(validateListing(performer({ blurb: 'Junior dancer, 12 years old, available weekends.' })).value);
  assert.ok(kid.includes('minor_mentioned'));
  assert.ok(flags.every((code) => /^[a-z_]+$/.test(code)));
});

test('the duplicate key ignores case, accents, punctuation, and a leading the', () => {
  assert.equal(foldKey('The Calgary & District Pipe Band'), foldKey('calgary and district pipe-band'));
  assert.equal(foldKey('Société Gaélique'), 'societe gaelique');
});

// ---------- the private queue ----------

test('a valid listing lands in the private queue as pending and nothing else', async () => {
  const db = d1(migrated());
  const store = listingStoreFromEnv({ INTAKE_DB: db });
  const res = await handleListingRequest(post(performerForm({ newsletter: 'yes' })), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, stored: true });
  const rows = db.raw.prepare('SELECT * FROM listings').all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.kind, 'performer');
  assert.equal(row.submitter_email, 'piper@example.com');
  assert.equal(row.submitter_name, 'Sample Submitter');
  assert.equal(row.newsletter_opt_in, 1);
  assert.equal(row.adult_confirm, 1);
  assert.equal(row.show_email, 0);
  assert.equal(row.public_email, '');
  assert.equal(row.ack_status, 'pending');
  assert.equal(row.reply_status, '');
  assert.equal(row.name_key, 'foothills piper');
  assert.doesNotMatch(row.public_json, /piper@example\.com|Sample Submitter|self/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM submissions').get().n, 0);
});

test('a Coo\'s Letter opt-in stores the consent time and source, and no opt-in stores neither', async () => {
  const db = d1(migrated());
  const store = listingStoreFromEnv({ INTAKE_DB: db });
  const yes = await handleListingRequest(post(performerForm({ newsletter: 'yes' }), { referer: 'https://celticcoo.ca/submit/' }), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(yes.status, 200);
  const no = await handleListingRequest(post(performerForm({ name: 'No Letter Piper' })), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(no.status, 200);
  const odd = await handleListingRequest(post({
    kind: 'group', name: 'Sample Club', group_kind: 'Gaelic', city: 'Halifax', province: 'NS', website: 'https://club.example.ca/',
    lessons: 'n', email: 'club@example.com', submitter_name: 'Sample Secretary', role: 'executive', adult_confirm: 'yes', terms_confirm: 'yes', newsletter: 'yes',
  }, { referer: 'https://elsewhere.example/submit/?x=<b>' }), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(odd.status, 200);
  const rows = Object.fromEntries(db.raw.prepare('SELECT name, newsletter_opt_in, newsletter_consent_at, newsletter_source, public_json FROM listings').all().map((r) => [r.name, r]));
  assert.equal(rows['Foothills Piper'].newsletter_opt_in, 1);
  assert.equal(rows['Foothills Piper'].newsletter_consent_at, NOW.toISOString());
  assert.equal(rows['Foothills Piper'].newsletter_source, 'performer-listing-form /submit/');
  assert.equal(rows['No Letter Piper'].newsletter_opt_in, 0);
  assert.equal(rows['No Letter Piper'].newsletter_consent_at, '');
  assert.equal(rows['No Letter Piper'].newsletter_source, '');
  assert.equal(rows['Sample Club'].newsletter_source, 'group-listing-form /submit/');
  for (const row of Object.values(rows)) assert.doesNotMatch(row.public_json, /newsletter|consent/);
  db.raw.prepare("UPDATE listings SET status = 'listed'").run();
  const text = await (await handlePerformersRequest(new Request('https://celticcoo.ca/api/performers'), { INTAKE_DB: db })).text();
  assert.doesNotMatch(text, /newsletter|consent|listing-form/);
});

test('a club listing goes to the same queue with its org contact public and the submitter private', async () => {
  const db = d1(migrated());
  const store = listingStoreFromEnv({ INTAKE_DB: db });
  const res = await handleListingRequest(post({
    kind: 'group',
    name: 'Sample Pipes and Drums',
    group_kind: 'Pipe band / piping',
    city: 'Red Deer',
    province: 'AB',
    website: 'https://band.example.ca/',
    lessons: 'n',
    contact: 'info@band.example.ca',
    email: 'sec@example.com',
    submitter_name: 'Sample Secretary',
    role: 'executive',
    adult_confirm: 'yes',
    terms_confirm: 'yes',
  }), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(res.status, 200);
  const row = db.raw.prepare('SELECT * FROM listings').get();
  assert.equal(row.kind, 'group');
  assert.equal(row.status, 'pending');
  assert.match(row.public_json, /info@band\.example\.ca/);
  assert.doesNotMatch(row.public_json, /sec@example\.com|Sample Secretary/);
});

test('honeypot, Turnstile, origin, pause, and daily caps keep rows out of the queue', async () => {
  const db = d1(migrated());
  const store = listingStoreFromEnv({ INTAKE_DB: db });
  const count = () => db.raw.prepare('SELECT COUNT(*) AS n FROM listings').get().n;

  const hp = await handleListingRequest(post(performerForm({ listing_hp: 'bot' })), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(hp.status, 200);
  assert.equal(count(), 0);

  const ts = await handleListingRequest(post(performerForm()), { verify: async () => ({ ok: false, reason: 'turnstile_rejected', detail: 'invalid-input-response' }), store, now: () => NOW });
  assert.equal(ts.status, 403);
  assert.equal(count(), 0);

  const cross = await handleListingRequest(post(performerForm(), { origin: 'https://evil.example' }), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(cross.status, 403);
  assert.equal(count(), 0);

  const bad = await handleListingRequest(post(performerForm({ adult_confirm: '' })), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).errors.adult_confirm);
  assert.equal(count(), 0);

  db.raw.exec("UPDATE intake_control SET manual_pause = 1 WHERE id = 'singleton'");
  const paused = await handleListingRequest(post(performerForm()), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).code, 'paused');
  assert.equal(count(), 0);
  db.raw.exec("UPDATE intake_control SET manual_pause = 0 WHERE id = 'singleton'");

  for (let i = 0; i < LIMITS.perEmailPerDay; i += 1) {
    const ok = await handleListingRequest(post(performerForm({ name: `Act ${i}` })), { verify: passTurnstile, store, now: () => NOW });
    assert.equal(ok.status, 200);
  }
  const capped = await handleListingRequest(post(performerForm({ name: 'One more' })), { verify: passTurnstile, store, now: () => NOW });
  assert.equal(capped.status, 429);
  assert.equal(count(), LIMITS.perEmailPerDay);

  const reasons = db.raw.prepare("SELECT reason, source FROM submission_failures ORDER BY created_at").all().map((r) => `${r.source}:${r.reason}`);
  for (const code of ['listing:honeypot', 'listing:turnstile_rejected', 'listing:origin', 'listing:validation', 'listing:paused', 'listing:listing_sender_cap']) {
    assert.ok(reasons.includes(code), code);
  }
  const failures = JSON.stringify(db.raw.prepare('SELECT * FROM submission_failures').all());
  assert.doesNotMatch(failures, /piper@example\.com|Sample Submitter|token-ok/);
});

test('Turnstile checks the listing action and the booking default is unchanged', async () => {
  const env = { TURNSTILE_SECRET: 'secret', TURNSTILE_HOSTNAMES: 'celticcoo.ca' };
  const fetchAs = (action) => async () => new Response(JSON.stringify({ success: true, action, hostname: 'celticcoo.ca' }));
  assert.deepEqual(await verifyTurnstile({ token: 't', env, fetchImpl: fetchAs('listing'), action: LISTING_TURNSTILE_ACTION }), { ok: true });
  assert.equal((await verifyTurnstile({ token: 't', env, fetchImpl: fetchAs('listing') })).reason, 'turnstile_action');
  assert.deepEqual(await verifyTurnstile({ token: 't', env, fetchImpl: fetchAs('book') }), { ok: true });
});

// ---------- the public directory ----------

test('the directory shows only listed performers and never a private field', async () => {
  const db = d1(migrated());
  const store = listingStoreFromEnv({ INTAKE_DB: db });
  const names = { pending: 'Pending Piper', listed: 'Listed Piper', rejected: 'Rejected Piper', needs_info: 'Asked Piper', closed: 'Closed Piper' };
  let i = 0;
  for (const [status, name] of Object.entries(names)) {
    i += 1;
    const value = validateListing(performer({ name, email: `p${i}@example.com`, showEmail: status === 'listed' ? '' : 'yes' })).value;
    await store.save({ id: `00000000-0000-4000-8000-00000000000${i}`, createdAt: NOW.toISOString(), value, flags: [] });
    db.raw.prepare('UPDATE listings SET status = ? WHERE name = ?').run(status, name);
  }
  const groupValue = validateListing(group({ name: 'Listed Club' })).value;
  await store.save({ id: '00000000-0000-4000-8000-000000000009', createdAt: NOW.toISOString(), value: groupValue, flags: [] });
  db.raw.prepare("UPDATE listings SET status = 'listed' WHERE kind = 'group'").run();

  const res = await handlePerformersRequest(new Request('https://celticcoo.ca/api/performers'), { INTAKE_DB: db });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(body.listings.map((l) => l.name), ['Listed Piper']);
  assert.doesNotMatch(text, /@example\.com|Sample Submitter|submitter|newsletter/);
  assert.equal(body.listings[0].kind, 'performer');

  db.raw.prepare("UPDATE listings SET show_email = 1, public_email = 'shown@example.com' WHERE name = 'Listed Piper'").run();
  const opted = await (await handlePerformersRequest(new Request('https://celticcoo.ca/api/performers'), { INTAKE_DB: db })).json();
  assert.equal(opted.listings[0].email, 'shown@example.com');

  const empty = await (await handlePerformersRequest(new Request('https://celticcoo.ca/api/performers'), {})).json();
  assert.deepEqual(empty.listings, []);
  const nope = await handlePerformersRequest(new Request('https://celticcoo.ca/api/performers', { method: 'POST' }), { INTAKE_DB: db });
  assert.equal(nope.status, 405);
});

test('the directory page ships filters and the empty state in the first HTML, with no loading line or client fetch', () => {
  const page = readFileSync(join(site, 'src/pages/performers/index.astro'), 'utf8');
  assert.doesNotMatch(page, /\.innerHTML\s*=|insertAdjacentHTML|set:html=\{p\./);
  assert.doesNotMatch(page, /fetch\(|C\.loading/);
  assert.match(page, /C\.empty/);
  assert.match(page, /submit\/#performers/);
  assert.doesNotMatch(page, /id="pf-filters"[^>]*hidden/);
  for (const slot of [SLOTS.list, SLOTS.count]) assert.ok(page.includes(slot), slot);
  assert.ok(page.includes(SLOTS.emptyOpen));
  assert.ok(page.includes(SLOTS.statusOpen));
  assert.equal(page.split(SLOTS.off).length - 1, 2);
  const fn = readFileSync(join(site, 'functions/performers/index.js'), 'utf8');
  assert.match(fn, /listedPerformers/);
  assert.match(fn, /renderPerformersPage/);
});

test('server-rendered performer cards escape everything and keep links safe', () => {
  const card = performerCardHtml({
    name: '<img src=x onerror=alert(1)>', acts: ['solo-piper', 'nope'], size: 'solo', city: 'Okotoks"', province: 'AB',
    blurb: '<script>alert(1)</script>', links: ['javascript:alert(1)', 'https://example.com/a?b=<c>'], media: 'data:text/html,hi',
    email: 'x@example.com', travel: 'local', services: ['weddings'], association: '',
  });
  assert.doesNotMatch(card, /<img|<script|javascript:|data:text/);
  assert.match(card, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(card, /data-acts="solo-piper"/);
  assert.match(card, /rel="nofollow ugc noopener"/);
  assert.match(card, /href="https:\/\/example\.com\/a\?b=%3Cc%3E"/);
  assert.match(card, /mailto:x@example\.com/);
  assert.match(card, /\/book\/\?act=%3Cimg/);
  assert.doesNotMatch(performerCardHtml({ name: 'A', email: 'bad"@x.com' }), /mailto/);
});

test('renderPerformersPage fills the slots, keeps the empty state, and shows a retry note on a failed read', () => {
  const html = ['<select id="pf-act"', SLOTS.off, '>', SLOTS.count, '<div id="pf-list">', SLOTS.list, '</div>', SLOTS.emptyOpen, '</div>', SLOTS.statusOpen, '</p>'].join('');
  assert.equal(renderPerformersPage(html, []), html);
  const full = renderPerformersPage(html, [{ name: 'One', acts: ['drummer'], province: 'AB' }, { name: 'Two', province: 'NS' }]);
  assert.equal((full.match(/<article/g) || []).length, 2);
  assert.match(full, /2 performers/);
  assert.match(full, /id="pf-empty" hidden>/);
  assert.doesNotMatch(full, /disabled|pf:list|pf:count/);
  const failed = renderPerformersPage(html, null);
  assert.match(failed, /id="pf-empty" hidden>/);
  assert.match(failed, /id="pf-status" role="status">/);
  assert.match(failed, /disabled/);
  assert.equal(countText(1), '1 performer');
});

test('the /performers Function serves the static page when there is no database and fills it when there is', async () => {
  const { handlePerformersPage } = await import('../functions/performers/index.js');
  const staticHtml = `<html>${SLOTS.count}${SLOTS.list}${SLOTS.emptyOpen}</div></html>`;
  const next = () => Promise.resolve(new Response(staticHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const bare = await handlePerformersPage({ request: new Request('https://celticcoo.ca/performers/'), env: {}, next });
  assert.equal(await bare.text(), staticHtml);
  const db = d1(migrated());
  const store = listingStoreFromEnv({ INTAKE_DB: db });
  const value = validateListing(performer({ name: 'Shown Piper', email: 'p@example.com' })).value;
  await store.save({ id: '00000000-0000-4000-8000-000000000031', createdAt: NOW.toISOString(), value, flags: [] });
  db.raw.prepare("UPDATE listings SET status = 'listed'").run();
  const res = await handlePerformersPage({ request: new Request('https://celticcoo.ca/performers/'), env: { INTAKE_DB: db }, next });
  const text = await res.text();
  assert.match(text, /Shown Piper/);
  assert.match(text, /1 performer/);
  assert.doesNotMatch(text, /p@example\.com|Sample Submitter/);
  assert.match(res.headers.get('cache-control'), /max-age=300/);
  const broken = { prepare() { throw new Error('down'); } };
  const failed = await handlePerformersPage({ request: new Request('https://celticcoo.ca/performers/'), env: { INTAKE_DB: broken }, next });
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  assert.match(await failed.text(), /id="pf-empty" hidden>/);
});

test('nav, /book, /submit, and /groups point at the new pages and sections', () => {
  const community = NAV_GROUPS.find((g) => g.id === 'community');
  assert.ok(community.items.some((item) => item.href === 'performers/' && item.label === COPY.navLabel));
  const book = readFileSync(join(site, 'src/pages/book/index.astro'), 'utf8');
  assert.match(book, /u\('performers\/'\)/);
  assert.match(book, /LISTING_COPY\.bookLine\.text/);
  const groups = readFileSync(join(site, 'src/pages/groups/index.astro'), 'utf8');
  assert.equal((groups.match(/u\('submit\/#groups'\)/g) || []).length, 2);
  assert.doesNotMatch(groups, /u\('submit\/'\)/);
  const submit = readFileSync(join(site, 'src/pages/submit/index.astro'), 'utf8');
  assert.match(submit, /<ListingForm kind="performer"/);
  assert.match(submit, /<ListingForm kind="group"/);
  assert.match(submit, /href="#groups"/);
  const form = readFileSync(join(site, 'src/components/ListingForm.astro'), 'utf8');
  assert.match(form, /group \? 'groups' : 'performers'/);
  assert.doesNotMatch(form, /type="file"/);
});

test('the listing migration keeps private columns out of the public query and the Functions exist', () => {
  const sql = readFileSync(join(site, 'migrations/0014_listings.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listings/);
  assert.match(sql, /status IN \('pending', 'needs_info', 'listed', 'rejected', 'closed'\)/);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  const fn = readFileSync(join(site, 'functions/api/listing.js'), 'utf8');
  assert.match(fn, /LISTING_TURNSTILE_ACTION/);
  assert.match(readFileSync(join(site, 'functions/api/performers.js'), 'utf8'), /handlePerformersRequest/);
});
