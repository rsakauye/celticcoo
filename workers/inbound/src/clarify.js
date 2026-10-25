// Decides when a short clarifying reply should be drafted.
// The draft is a fixed set of questions. It does not quote the inbound mail.
// Nothing here sends. CLARIFY_DRAFTS defaults to drafts. There is no auto-send mode.

import { DATE_RE, publicUrl } from './classify.js';
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
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const QUESTIONS = {
  missing_event: 'Which event is this about? The event name is enough.',
  missing_when: 'What is the date, and is there a start time?',
  missing_time: 'What time does it start?',
  missing_place: 'Which city is it in, and which venue if there is one?',
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
  const text = String(token || '').trim();
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
  if (category === 'other') return wordCount(source) >= 8 ? ['unclear'] : [];
  if (category === 'partnership_or_press') return wordCount(text) < 12 ? ['unclear'] : [];

  const unique = [...new Set(datesIn(source))];
  const today = localDay(now || new Date());
  const wantsEvent = category === 'event_listing_request' || category === 'correction_or_update';
  const wantsWhen = wantsEvent || category === 'booking_inquiry';
  const wantsPlace = category === 'event_listing_request' || category === 'booking_inquiry';
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
  ].join('\n');
}

export function planDraft({ category, event, subject, text, now, env, automated }) {
  if (clarifyMode(env) !== 'drafts' || automated || category === 'spam') return null;
  const reasons = assessGaps({ category, event, subject, text, now });
  if (!reasons.length) return null;
  const draft = buildDraft(reasons, category);
  if (!draft || hasPrivateContact(draft)) return null;
  return { status: 'pending_approval', draft, reasons };
}
