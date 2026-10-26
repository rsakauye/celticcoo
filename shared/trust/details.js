// Advisory field gaps and red flags. The result is codes and booleans.
// It never includes the message, and it never authorizes a send.

import { countLexiconHits } from './signals.js';

const FIELD_ORDER = ['date', 'time', 'venue', 'booking', 'event'];

const MINOR_RE = /\b(minors?|under[-\s]?18|underage|children|child|kids?|youths?|juniors?|juveniles?)\b|\b(?:1[0-7]|[1-9])[\s-]*years?[\s-]*old\b/i;
const PAYMENT_RE = /\b(cheques?|cashier'?s checks?|personal checks?|bank checks?|pay by checks?|a check for|mail(?:ing)? a check|send(?:ing)? a check|e-?transfers?|interac|wire transfers?|western union|gift ?cards?|bitcoin|crypto(?:currency)?|money orders?|paypal|venmo|cash only|in cash)\b/i;
const LINK_RE = /https?:\/\/[^\s<>"')\]]+/i;
const BOOKING_RE = /\b(?:book(?:ing|ed)?|hire|hiring|performer|player|band|musician)\b/i;
const INJECTION_RE = /\b(?:ignore previous instructions|ignore all previous|disregard your instructions|you are now|system prompt)\b/i;

export function emptyRedFlags() {
  return {
    minor_mentioned: false,
    links_present: false,
    payment_request: false,
    bot_instruction_attempt: false,
  };
}

export function detectRedFlags(text, options = {}) {
  const body = String(text || '').slice(0, 8000);
  const phrases = Array.isArray(options.injectionPhrases) ? options.injectionPhrases : [];
  const injection = phrases.length
    ? countLexiconHits(body, { injection: phrases }).injection > 0
    : INJECTION_RE.test(body);
  return {
    minor_mentioned: Boolean(options.under18) || MINOR_RE.test(body),
    links_present: LINK_RE.test(body),
    payment_request: PAYMENT_RE.test(body),
    bot_instruction_attempt: injection,
  };
}

export function bookingSignal(text) {
  return BOOKING_RE.test(String(text || '').slice(0, 8000));
}

export function emailMissingFields({ category, gaps = [], hasBooking = false } = {}) {
  const fields = new Set();
  const list = Array.isArray(gaps) ? gaps : [];
  if (list.includes('missing_when') || list.includes('past_date')) fields.add('date');
  if (list.includes('missing_time')) fields.add('time');
  if (list.includes('missing_place')) fields.add('venue');
  if (category === 'booking_inquiry' && !hasBooking) fields.add('booking');
  if ((category === 'event_listing_request' || category === 'correction_or_update') && list.includes('missing_event')) {
    fields.add('event');
  }
  return FIELD_ORDER.filter((field) => fields.has(field));
}

function hasText(value) {
  return Boolean(String(value || '').trim());
}

export function formMissingFields(value) {
  const events = Array.isArray(value && value.events) ? value.events : [];
  const custom = value && value.custom;
  const dated = Boolean(custom && hasText(custom.date) && !/tba/i.test(String(custom.date)))
    || events.some((event) => event && !event.tba && hasText(event.when) && !/tba/i.test(String(event.when)));
  const placed = Boolean(custom && (hasText(custom.city) || hasText(custom.venue)))
    || events.some((event) => hasText(event && (event.city || event.venue)));
  const performers = Array.isArray(value && value.performers) ? value.performers : [];
  const booked = performers.length > 0 || hasText(value && value.performerOther);
  const named = Boolean(custom && hasText(custom.name))
    || events.some((event) => hasText(event && event.name));
  const fields = [];
  if (!dated) fields.push('date');
  if (!placed) fields.push('venue');
  if (!booked) fields.push('booking');
  if (!named) fields.push('event');
  return fields;
}
