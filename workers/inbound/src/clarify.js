// Decides when a short clarifying reply should be drafted.
// The draft is a fixed set of questions. It does not quote the inbound mail.
// Nothing here sends. CLARIFY_DRAFTS defaults to drafts. There is no auto-send mode.

import { DATE_RE, publicUrl, textSignals } from './classify.js';
import { caslFooterText } from '../../../shared/casl/notice.js';
import { hasPrivateContact, PUBLIC_MAILBOX } from './redact.js';

const TIME_RE = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:1[0-2]|0?[1-9])\s*(?:a\.?m\.?|p\.?m\.?)\b/i;
const LINK_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const GENERIC_TITLE = new Set(['event', 'events', 'listing', 'correction', 'update', 'hello', 'hi', 'inquiry', 'booking']);
const TICKET_HOSTS = [
  'eventbrite.com',
  'eventbrite.ca',
  'eventbrite.co.uk',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'ticketmaster.com',
  'ticketmaster.ca',
  'youtube.com',
  'youtu.be',
  'bandcamp.com',
  'spotify.com',
  'celticcoo.ca',
  'meetup.com',
  'lu.ma',
  'luma.com',
];

const MONTHS = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const QUESTIONS = {
  missing_event: 'Which event is this about? The event name is enough.',
  missing_when: 'What is the date, and is there a start time?',
  missing_time: 'What time does it start?',
  missing_place: 'Which city is it in, and which venue if there is one?',
  missing_act: 'Who do you need: a piper, a drummer, dancers, a fiddler, or a band?',
  past_date: 'The date looks like it has already passed. What is the correct date?',
  contradiction: 'There is more than one date in the note. Which date should we use?',
  bad_link: 'The link in the note does not look usable. What is the correct page?',
  link_mismatch: 'The link and the organizer name do not seem to match. Which page should we use?',
};

export function clarifyMode(env) {
  const raw = env && Object.prototype.hasOwnProperty.call(env, 'CLARIFY_DRAFTS')
    ? env.CLARIFY_DRAFTS
    : 'drafts';
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'off' || value === 'false' || value === '0') return 'off';
  return 'drafts';
}

export function parseDateToken(token) {
  const text = String(token || '').trim().replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return calendarIso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) return calendarIso(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (match) return calendarIso(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]));
  return '';
}

function calendarIso(year, month, day) {
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function localDay(now, timeZone = 'America/Edmonton') {
  const date = now instanceof Date ? now : new Date(now);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function wordCount(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function hasTitle(event) {
  const title = String(event && event.title || '').trim().toLowerCase();
  return title.length >= 4 && !GENERIC_TITLE.has(title);
}

function datesIn(text) {
  const re = new RegExp(DATE_RE.source, 'gi');
  return [...String(text || '').matchAll(re)]
    .map((match) => parseDateToken(match[1]))
    .filter(Boolean);
}

function rawLinks(text) {
  return String(text || '').match(new RegExp(LINK_RE.source, 'gi')) || [];
}

function ticketHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return TICKET_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function linkMismatch(hostName, url) {
  if (!hostName || !url) return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (ticketHost(parsed.hostname)) return false;
  const words = String(hostName).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 5);
  if (!words.length) return false;
  const haystack = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  return !words.some((word) => haystack.includes(word));
}

export function assessGaps({ category, event, subject, text, now }) {
  if (!category || category === 'spam') return [];
  const source = `${subject || ''}\n${text || ''}`;
  const signals = textSignals(subject, source);
  if (signals.automated) return [];
  const asBooking = bookingIntent(category, signals);
  if (category === 'other' && !asBooking) {
    if (signals.newsletter) return [];
    return wordCount(source) >= 8 ? ['unclear'] : [];
  }
  if (category === 'partnership_or_press') return wordCount(text) < 12 ? ['unclear'] : [];

  const unique = [...new Set(datesIn(source))];
  const today = localDay(now || new Date());
  const wantsEvent = category === 'event_listing_request' || category === 'correction_or_update';
  const directory = category === 'event_listing_request' && signals.directory;
  const wantsWhen = (wantsEvent || asBooking) && !directory;
  const wantsPlace = category === 'event_listing_request' || asBooking;
  const reasons = [];

  if (wantsEvent && !hasTitle(event)) reasons.push('missing_event');
  if (unique.length >= 2 && category !== 'correction_or_update') {
    reasons.push('contradiction');
  } else if (wantsWhen && unique.length === 0) {
    reasons.push('missing_when');
  } else if (wantsWhen && unique.length > 0 && unique.every((day) => day < today)) {
    reasons.push('past_date');
  } else if (wantsWhen && unique.length === 1 && category !== 'correction_or_update' && !TIME_RE.test(source)) {
    reasons.push('missing_time');
  }
  if (wantsPlace && !(event && (event.city || event.venue))) reasons.push('missing_place');
  if (asBooking && !signals.performer) reasons.push('missing_act');

  const links = rawLinks(source).map((link) => link.replace(/[.,);]+$/, ''));
  if (links.some((link) => !publicUrl(link))) reasons.push('bad_link');
  else if (category === 'event_listing_request' && linkMismatch(event && event.host, (event && event.url) || links[0] || '')) {
    reasons.push('link_mismatch');
  }
  return reasons;
}

function unclearQuestion(category) {
  if (category === 'partnership_or_press') return 'What did you have in mind, and roughly when?';
  return 'Are you asking to list an event, correct a listing, or book a performer?';
}

// A performer or booking phrase is a clear hire even when the score stays
// under the category cutoff and the label is still other.
function bookingIntent(category, signals) {
  if (category === 'booking_inquiry') return true;
  if (category !== 'other' || !signals) return false;
  if (signals.newsletter || signals.listing || signals.directory || signals.automated) return false;
  return Boolean(signals.performer || signals.booking);
}

export function questionFor(reason, category) {
  if (reason === 'unclear') return unclearQuestion(category);
  return QUESTIONS[reason] || '';
}

export function buildDraft(reasons, category) {
  const questions = (reasons || []).map((reason) => questionFor(reason, category)).filter(Boolean);
  if (!questions.length) return '';
  const intro = questions.length === 1
    ? 'Thanks for writing to The Celtic Coo. I need one detail before I can help.'
    : 'Thanks for writing to The Celtic Coo. I need a few details before I can help.';
  return [
    'Hello,',
    '',
    intro,
    '',
    ...questions.map((question) => `- ${question}`),
    '',
    'A person reads this mailbox. This note was sent only after they approved it.',
    '',
    'The Celtic Coo',
    PUBLIC_MAILBOX,
    '',
    caslFooterText(),
    '',
  ].join('\n');
}

const ACTIONABLE = new Set(['event_listing_request', 'correction_or_update', 'booking_inquiry']);
const EVENT_FIELDS = ['title', 'host', 'date', 'city', 'province', 'venue', 'url'];
const PRIOR_TEXT_LIMIT = 4000;

function priorEvent(row) {
  try {
    const value = JSON.parse((row && row.extracted_json) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function mergeEvent(prior, current) {
  const merged = {};
  for (const source of [...prior.map(priorEvent), current || {}]) {
    for (const field of EVENT_FIELDS) {
      const value = String(source[field] ?? '').trim();
      if (value) merged[field] = value;
    }
  }
  return merged;
}

// The questions the last sent clarify reply asked. A draft that was never sent
// asked nothing, so only the `sent` status counts.
function askedReasons(prior) {
  for (let i = prior.length - 1; i >= 0; i -= 1) {
    const row = prior[i];
    if (!row || row.clarify_status !== 'sent') continue;
    const list = String(row.clarify_reasons || '')
      .split(',')
      .map((reason) => reason.trim())
      .filter((reason) => QUESTIONS[reason]);
    if (list.length) return list;
  }
  return [];
}

function stripDates(text) {
  return String(text || '').replace(new RegExp(DATE_RE.source, 'gi'), ' ');
}

// Reads one message together with the earlier notes in its conversation.
// `thread` is oldest first. Without it the message stands on its own.
//
// - A reply that came out as `other` inherits the earlier listing, correction,
//   or booking category, unless it looks like a newsletter or automated mail.
// - Event fields and body text from the earlier notes fill what this one lacks.
// - If we asked about a date that was past or in conflict and this reply gives
//   a date, the reply's date replaces the earlier ones.
export function threadContext({ category, event, subject, text }, thread) {
  const prior = (Array.isArray(thread) ? thread : []).filter(Boolean);
  if (!prior.length) return { category, event, text, asked: [], inherited: false };

  const asked = askedReasons(prior);
  let merged = category;
  let inherited = false;
  if (category === 'other') {
    const signals = textSignals(subject, `${subject || ''}\n${text || ''}`);
    const earlier = [...prior].reverse().find((row) => ACTIONABLE.has(row.category));
    if (earlier && !signals.newsletter && !signals.automated) {
      merged = earlier.category;
      inherited = true;
    }
  }

  const replacesDate = asked.some((reason) => reason === 'contradiction' || reason === 'past_date')
    && datesIn(text).length > 0;
  const earlierText = prior.map((row) => {
    const body = String(row.text_body || '').slice(0, PRIOR_TEXT_LIMIT);
    return replacesDate ? stripDates(body) : body;
  });
  return {
    category: merged,
    event: mergeEvent(prior, event),
    text: [...earlierText, text].filter(Boolean).join('\n\n'),
    asked,
    inherited,
  };
}

export function planDraft({ category, event, subject, text, now, env, automated, thread }) {
  if (clarifyMode(env) !== 'drafts' || automated || category === 'spam') return null;
  const ctx = threadContext({ category, event, subject, text }, thread);
  let reasons = assessGaps({ category: ctx.category, event: ctx.event, subject, text: ctx.text, now });
  // A reply in a thread we already asked questions in, that answers none of
  // them, adds nothing. Repeating the same questions would be noise, so the
  // person reads the forwarded copy instead.
  if (ctx.inherited && ctx.asked.length && reasons.length >= ctx.asked.length
    && reasons.every((reason) => ctx.asked.includes(reason))) {
    reasons = [];
  }
  if (!reasons.length) return null;
  const draft = buildDraft(reasons, ctx.category);
  if (!draft || hasPrivateContact(draft)) return null;
  return { status: 'pending_approval', draft, reasons };
}
