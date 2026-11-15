// Exhibitor and vendor invitations: an event organizer inviting The Celtic Coo
// to exhibit or vend. See docs/exhibitor-invitations.md.
//
// The record lives in the private D1 table exhibitor_invitations. It holds the
// organizer's contact details, so it never goes to a GitHub issue, a public
// page, or a public doc. Booth costs and vendor terms stay private too.
//
// The reply is drafted here and stored on the inbound row like a clarifying
// draft, so it shows on the review page and in GET /api/queue. Nothing in this
// file sends mail. EXHIBITOR_AUTO_SEND defaults to off. Every reply goes through
// the existing approval path until Russell approves turning it on.

import { DATE_RE, publicUrl } from './classify.js';
import { caslFooterText } from '../../../shared/casl/notice.js';
import { hasPrivateContact, PUBLIC_MAILBOX, redactContact } from './redact.js';
import { codeOf, firstEmail, oneLine } from './text.js';

export const EXHIBITOR_CATEGORY = 'exhibitor_invitation';

// Owner of the review queue for these rows. Kept here so the queue item and
// the docs say the same thing.
export const QUEUE_OWNER = 'Akindo (SHCEO)';

export const STATUSES = ['new', 'reviewed', 'replied', 'interested', 'declined', 'discarded'];

// Missing-field codes for this label. They extend the inbound missing_fields
// codes (date, time, venue, booking, event).
export const EXHIBITOR_MISSING = ['deadline', 'apply_link', 'booth_cost', 'setup'];

// Hemingway's final vendor-call reply, with Akindo's answers folded in
// (the listing is free, no price talk). Russell chose this text on
// 14 Nov 2026: it asks the organizer for the missing details. Do not edit the
// wording here without Hemingway and Russell. The CASL footer is added below.
export const HEMINGWAY_SUBJECT = 'Thanks for your call for vendors';

export const HEMINGWAY_BODY = [
  'Hi there,',
  '',
  "Thanks for sending your call for vendors. We've got it, and it's great to see your event coming together. We'd be happy to share it on your event's page on The Celtic Coo, free, so more makers and vendors see it. If you'd like that, just reply with:",
  '',
  '- your application link (or the email to apply)',
  '- the application deadline',
  '- the kinds of vendors you\'re looking for (crafts, food, clans, pipe and dance, and so on)',
  '- the vendor or booth fee, if there is one',
  '- a short blurb, 50 words or less',
  '- a contact email for applicants',
  '- one landscape photo you own the rights to, if you have one (please, no photos where kids can be identified)',
  '',
  "We may trim it a little for length, and we'll take it down once your deadline passes. We'll aim to have it up within a few days.",
  '',
  'Cheers,',
  'The Celtic Coo',
].join('\n');

export function buildExhibitorDraft() {
  return [
    HEMINGWAY_BODY,
    PUBLIC_MAILBOX,
    '',
    caslFooterText(),
    '',
  ].join('\n');
}

// Reply subject. The organizer's own subject keeps the thread together in
// their mail client and in loadThread (same subject once Re: is removed).
// Hemingway's subject is used only when the original had none.
export function exhibitorReplySubject(subject) {
  const clean = oneLine(subject, 180);
  if (!clean) return `Re: ${HEMINGWAY_SUBJECT}`;
  if (/^re:/i.test(clean)) return clean;
  return `Re: ${clean}`;
}

export function autoSendMode(env) {
  const value = String(env && env.EXHIBITOR_AUTO_SEND || '').trim().toLowerCase();
  return value === 'on' ? 'on' : 'off';
}

// ---- extraction ----------------------------------------------------------

const LINE_LIMIT = 200;

function lines(text) {
  return String(text || '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
}

// The first line that matches, trimmed and with contact details removed.
function lineWith(text, pattern) {
  const hit = lines(text).find((line) => pattern.test(line));
  return hit ? clean(hit) : '';
}

function linesWith(text, pattern, max = 3) {
  return lines(text).filter((line) => pattern.test(line)).slice(0, max).map(clean).filter(Boolean).join(' | ');
}

function clean(value) {
  return redactContact(oneLine(value, LINE_LIMIT)).replace(/\s+/g, ' ').trim();
}

const DEADLINE_RE = /\b(?:deadline|apply by|applications? (?:close|closes|are due|due)|due (?:by|on)|submit by|entries close|registration closes)\b/i;
const SETUP_RE = /\b(?:move[- ]?in|load[- ]?in|set[- ]?up)\b/i;
const TEARDOWN_RE = /\b(?:move[- ]?out|load[- ]?out|tear[- ]?down)\b/i;
const BOOTH_OPTIONS_RE = /\b(?:\d{1,2}\s*(?:'|ft|feet|foot)?\s*[x×]\s*\d{1,2}\s*(?:'|ft|feet|foot)?|booth sizes?|stall sizes?|table only|tent space|double booth|single booth|corner booth)\b/i;
const MONEY_RE = /(?:(?:US|CA|C|A|NZ)?\$|£|€|\b(?:CAD|USD|GBP|EUR|AUD|NZD)\s?)\s?\d{1,5}(?:[.,]\d{2})?(?:\s?(?:CAD|USD|GBP|EUR|AUD|NZD)\b)?|\b\d{1,5}(?:[.,]\d{2})?\s?(?:CAD|USD|GBP|EUR|AUD|NZD|dollars|pounds|euros)\b/i;
const COST_LINE_RE = /\b(?:fee|fees|cost|costs|price|rate|rates|per booth|per stall|per table|booth|stall|table|space)\b/i;
const FEES_RE = /\b(?:deposit|deposits|refund|refunds|refundable|non-refundable|late fee|cancellation|commission|percent of sales|% of sales)\b/i;
const POWER_RE = /\b(?:power|electric|electricity|outlet|generator|tables?|chairs?)\b/i;
const INSURANCE_RE = /\b(?:insurance|insured|permit|permits|licen[cs]e|licen[cs]es|certificate|health inspection|food safe)\b/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const APPLY_CONTEXT_RE = /\b(?:apply|application|register|registration|form|vendor|exhibitor|booth|stall)\b/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

function applyUrl(text) {
  const found = [];
  for (const line of lines(text)) {
    for (const match of line.matchAll(URL_RE)) {
      const url = publicUrl(match[0].replace(/[.,);]+$/, ''));
      if (url) found.push({ url, context: APPLY_CONTEXT_RE.test(line) });
    }
  }
  const best = found.find((item) => item.context) || found[0];
  return best ? best.url : '';
}

function boothCost(text) {
  for (const line of lines(text)) {
    if (!COST_LINE_RE.test(line)) continue;
    const money = line.match(MONEY_RE);
    if (money) return oneLine(money[0], 60);
  }
  return '';
}

function eventDates(text) {
  const re = new RegExp(DATE_RE.source, 'gi');
  const seen = [];
  for (const match of String(text || '').matchAll(re)) {
    const value = oneLine(match[1], 40);
    if (!seen.includes(value)) seen.push(value);
    if (seen.length >= 4) break;
  }
  return seen.join(', ');
}

function displayName(header) {
  const text = oneLine(header, 300);
  const named = text.match(/^\s*"?([^"<]+?)"?\s*</);
  const name = named ? named[1].trim() : '';
  if (!name || name.includes('@')) return '';
  return oneLine(name, 120);
}

// Last short line before a sign-off is often the name. A best guess only.
function signatureName(text) {
  const list = lines(text);
  const at = list.findIndex((line) => /^(?:thanks|thank you|cheers|regards|best|sincerely|kind regards|warm regards|best regards)[,!.]?$/i.test(line));
  if (at < 0 || !list[at + 1]) return '';
  const candidate = list[at + 1];
  if (candidate.length > 60 || /@|https?:|\d{3}/.test(candidate)) return '';
  return oneLine(candidate, 120);
}

// ---- currency ------------------------------------------------------------

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington State', 'West Virginia', 'Wisconsin', 'Wyoming',
];
const US_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

const COUNTRY_FORMS = [
  { country: 'Canada', currency: 'CAD', re: /\bcanada\b/i },
  { country: 'United States', currency: 'USD', re: /\b(?:united states|u\.s\.a\.?|usa)\b/i },
  { country: 'United Kingdom', currency: 'GBP', re: /\b(?:united kingdom|scotland|england|wales|northern ireland|great britain)\b/i },
  { country: 'Ireland', currency: 'EUR', re: /\b(?:republic of ireland|ireland|éire|eire)\b/i },
  { country: 'Australia', currency: 'AUD', re: /\baustralia\b/i },
  { country: 'New Zealand', currency: 'NZD', re: /\bnew zealand\b/i },
];

const STATED = [
  { currency: 'CAD', re: /\b(?:CAD|CDN|C\$|CA\$|canadian dollars?)\b|C\$/i },
  { currency: 'USD', re: /\b(?:USD|US\$|US dollars?|american dollars?)\b|US\$/i },
  { currency: 'GBP', re: /£|\b(?:GBP|pounds? sterling)\b/i },
  { currency: 'EUR', re: /€|\b(?:EUR|euros?)\b/i },
  { currency: 'AUD', re: /\b(?:AUD|A\$|australian dollars?)\b|A\$/i },
  { currency: 'NZD', re: /\b(?:NZD|NZ\$|new zealand dollars?)\b|NZ\$/i },
];

function statedCurrency(text) {
  const source = String(text || '');
  const hits = STATED.filter((item) => item.re.test(source)).map((item) => item.currency);
  return hits.length === 1 ? hits[0] : '';
}

function usState(text) {
  const source = String(text || '');
  if (new RegExp(`\\b(?:${US_STATES.join('|')})\\b`).test(source)) return true;
  // Two-letter state codes only after a comma, as in "Bellingham, WA".
  return new RegExp(`,\\s*(?:${US_CODES.join('|')})\\b(?:\\s+\\d{5})?`).test(source);
}

// Picks the booth-fee currency from the event's location.
// - A currency written in the note (CAD, USD, £, €) is used as stated, and a
//   clash with the location is flagged.
// - Otherwise a Canadian province or "Canada" means CAD, a US state USD, the
//   UK GBP, Ireland EUR, Australia AUD, New Zealand NZD.
// - When the location is unclear, the currency is CAD and the row is flagged
//   currency_unclear for the reviewer. A bare "$" is never enough on its own.
export function detectCurrency({ text = '', province = '', country = '' } = {}) {
  const stated = statedCurrency(text);
  let located = '';
  let place = '';
  if (province) { located = 'CAD'; place = 'Canada'; }
  if (!located && country) {
    const hit = COUNTRY_FORMS.find((item) => item.re.test(country));
    if (hit) { located = hit.currency; place = hit.country; }
  }
  if (!located) {
    const hit = COUNTRY_FORMS.find((item) => item.re.test(text));
    if (hit) { located = hit.currency; place = hit.country; }
  }
  if (!located && usState(text)) { located = 'USD'; place = 'United States'; }
  if (stated) {
    const flag = located && located !== stated ? 'currency_location_mismatch' : '';
    return { currency: stated, source: 'stated', country: place, flag };
  }
  if (located) return { currency: located, source: 'location', country: place, flag: '' };
  return { currency: 'CAD', source: 'default', country: '', flag: 'currency_unclear' };
}

// ---- record ----------------------------------------------------------------

function pick(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function extractExhibitor({ subject = '', text = '', event = {}, ai = {}, fromHeader = '', replyTo = '', sender = '' } = {}) {
  const body = String(text || '');
  const source = `${subject || ''}\n${body}`;
  const model = ai && typeof ai === 'object' ? ai : {};
  const province = pick(event.province, model.province);
  const city = pick(event.city, model.city);
  const record = {
    organizer: displayName(fromHeader),
    organization: clean(pick(model.organization, event.host)),
    event_name: clean(pick(model.event_name, event.title, oneLine(subject, 160).replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, ''))),
    event_dates: clean(pick(model.event_dates, eventDates(source), event.date)),
    venue: clean(pick(event.venue, model.venue)),
    city: clean(city),
    province: clean(province),
    apply_deadline: clean(pick(model.apply_deadline, lineWith(body, DEADLINE_RE))),
    apply_url: pick(publicUrl(model.apply_url), applyUrl(body), event.url),
    setup_times: clean(pick(model.setup_times, lineWith(body, SETUP_RE))),
    teardown_times: clean(pick(model.teardown_times, lineWith(body, TEARDOWN_RE))),
    booth_options: clean(pick(model.booth_options, linesWith(body, BOOTH_OPTIONS_RE, 2))),
    booth_cost: clean(pick(boothCost(body), model.booth_cost)),
    fees_deposits: clean(pick(model.fees_deposits, linesWith(body, FEES_RE, 2))),
    power_tables: clean(pick(model.power_tables, linesWith(body, POWER_RE, 2))),
    insurance_permits: clean(pick(model.insurance_permits, linesWith(body, INSURANCE_RE, 2))),
    contact_name: pick(signatureName(body), displayName(fromHeader)),
    contact_email: pick(firstEmail(replyTo), firstEmail(fromHeader), firstEmail(sender)),
    contact_phone: (body.match(PHONE_RE) || [''])[0],
  };
  const currency = detectCurrency({
    text: `${record.booth_cost}\n${source}`,
    province: record.province,
    country: pick(model.country),
  });
  record.currency = currency.currency;
  record.currency_source = currency.source;
  record.country = currency.country || pick(model.country);
  record.review_flags = currency.flag ? [currency.flag] : [];
  record.missing_fields = exhibitorMissingFields(record);
  return record;
}

export function exhibitorMissingFields(record) {
  const missing = [];
  if (!record || !record.apply_deadline) missing.push('deadline');
  if (!record || !record.apply_url) missing.push('apply_link');
  if (!record || !record.booth_cost) missing.push('booth_cost');
  if (!record || !record.setup_times) missing.push('setup');
  return missing;
}

// ---- draft planning ---------------------------------------------------------

// One reply per thread. A prior row in the 45-day thread that already has a
// sent reply of any kind, or an exhibitor draft still waiting, blocks another.
export function threadAlreadyAnswered(thread) {
  return (Array.isArray(thread) ? thread : []).some((row) => {
    if (!row) return false;
    if (row.clarify_status === 'sent' || row.clarify_status === 'approved') return true;
    return row.category === EXHIBITOR_CATEGORY && row.clarify_status === 'pending_approval';
  });
}

export function planExhibitorDraft({ env, automated, thread, mode }) {
  if (mode === 'off' || automated) return null;
  if (threadAlreadyAnswered(thread)) return { skip: 'thread_replied' };
  const draft = buildExhibitorDraft();
  if (hasPrivateContact(draft)) return null;
  return { status: 'pending_approval', draft, reasons: [EXHIBITOR_CATEGORY] };
}

// ---- D1 -------------------------------------------------------------------

const UPSERT_SQL = `INSERT INTO exhibitor_invitations (
  inbound_email_id, message_id, created_at, updated_at, status,
  organizer, organization, event_name, event_dates, venue, city, province, country,
  apply_deadline, apply_url, setup_times, teardown_times, booth_options, booth_cost,
  currency, currency_source, fees_deposits, power_tables, insurance_permits,
  contact_name, contact_email, contact_phone,
  confidence, classifier, missing_fields, review_flags
) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(inbound_email_id) DO UPDATE SET
  message_id = excluded.message_id, updated_at = excluded.updated_at,
  organizer = excluded.organizer, organization = excluded.organization, event_name = excluded.event_name,
  event_dates = excluded.event_dates, venue = excluded.venue, city = excluded.city, province = excluded.province,
  country = excluded.country, apply_deadline = excluded.apply_deadline, apply_url = excluded.apply_url,
  setup_times = excluded.setup_times, teardown_times = excluded.teardown_times, booth_options = excluded.booth_options,
  booth_cost = excluded.booth_cost, currency = excluded.currency, currency_source = excluded.currency_source,
  fees_deposits = excluded.fees_deposits, power_tables = excluded.power_tables, insurance_permits = excluded.insurance_permits,
  contact_name = excluded.contact_name, contact_email = excluded.contact_email, contact_phone = excluded.contact_phone,
  confidence = excluded.confidence, classifier = excluded.classifier,
  missing_fields = excluded.missing_fields, review_flags = excluded.review_flags`;

// Never throws. The forward already happened, and the inbound row is stored.
export async function saveExhibitor(db, { inboundEmailId, messageId, now, record, confidence, classifier }) {
  if (!db || typeof db.prepare !== 'function' || !inboundEmailId || !record) return { status: 'skipped' };
  const at = (now instanceof Date ? now : new Date()).toISOString();
  try {
    await db.prepare(UPSERT_SQL).bind(
      inboundEmailId,
      oneLine(messageId, 500),
      at,
      at,
      record.organizer || '',
      record.organization || '',
      record.event_name || '',
      record.event_dates || '',
      record.venue || '',
      record.city || '',
      record.province || '',
      record.country || '',
      record.apply_deadline || '',
      record.apply_url || '',
      record.setup_times || '',
      record.teardown_times || '',
      record.booth_options || '',
      record.booth_cost || '',
      record.currency || 'CAD',
      record.currency_source || 'default',
      record.fees_deposits || '',
      record.power_tables || '',
      record.insurance_permits || '',
      record.contact_name || '',
      record.contact_email || '',
      record.contact_phone || '',
      Number.isFinite(Number(confidence)) ? Number(confidence) : 0,
      classifier === 'ai' ? 'ai' : 'rules',
      JSON.stringify(record.missing_fields || []),
      JSON.stringify(record.review_flags || []),
    ).run();
    return { status: 'stored' };
  } catch (err) {
    console.error(JSON.stringify({ message: 'exhibitor store failed', code: codeOf(err) }));
    return { status: 'failed', error: 'exhibitor_store_failed' };
  }
}

export async function loadExhibitor(db, inboundEmailId) {
  if (!db || typeof db.prepare !== 'function') return null;
  try {
    return await db.prepare('SELECT * FROM exhibitor_invitations WHERE inbound_email_id = ?').bind(inboundEmailId).first();
  } catch {
    return null;
  }
}

export async function setExhibitorStatus(db, inboundEmailId, status, now = new Date()) {
  if (!STATUSES.includes(status)) return false;
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    const result = await db.prepare(
      'UPDATE exhibitor_invitations SET status = ?, updated_at = ? WHERE inbound_email_id = ?',
    ).bind(status, now.toISOString(), inboundEmailId).run();
    const changes = result && result.meta ? result.meta.changes : result && result.changes;
    return Number(changes) > 0;
  } catch (err) {
    console.error(JSON.stringify({ message: 'exhibitor status failed', code: codeOf(err) }));
    return false;
  }
}

// Fields shown on the private review page and in the private chat queue.
// The contact details are included because both are behind the owner's
// review secret or bearer token. Neither goes to a GitHub issue.
export const REVIEW_FIELDS = [
  ['event_name', 'Event'],
  ['organization', 'Organizer'],
  ['event_dates', 'Dates'],
  ['venue', 'Venue'],
  ['city', 'City'],
  ['province', 'Province'],
  ['country', 'Country'],
  ['apply_deadline', 'Apply by'],
  ['apply_url', 'Application link'],
  ['setup_times', 'Set-up'],
  ['teardown_times', 'Tear-down'],
  ['booth_options', 'Booth options'],
  ['booth_cost', 'Booth cost'],
  ['currency', 'Currency'],
  ['fees_deposits', 'Fees and deposits'],
  ['power_tables', 'Power and tables'],
  ['insurance_permits', 'Insurance and permits'],
  ['contact_name', 'Contact'],
  ['status', 'Status'],
];

function jsonList(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.filter((item) => /^[a-z_]{1,40}$/.test(String(item))) : [];
  } catch {
    return [];
  }
}

export function exhibitorView(row) {
  if (!row) return null;
  const fields = {};
  for (const [key] of REVIEW_FIELDS) fields[key] = oneLine(row[key], 240);
  return {
    fields,
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0,
    classifier: row.classifier === 'ai' ? 'ai' : 'rules',
    missing_fields: jsonList(row.missing_fields),
    review_flags: jsonList(row.review_flags),
    queue_owner: QUEUE_OWNER,
  };
}
