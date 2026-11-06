// Small string guards shared by the inbound mail worker.
// Nothing here reads the network or the database.

export function oneLine(value, max) {
  const s = String(value ?? '').replace(/[\r\n\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max).trim() : s;
}

export function oneEmail(value) {
  const s = String(value ?? '').trim();
  if (!s || s.length > 200 || /[\r\n\s]/.test(s)) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s;
}

export function clampText(value, max) {
  const s = String(value ?? '').replace(/\u0000/g, '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[truncated]`;
}

// Strips reply and forward prefixes so a reply lines up with the note it answers.
export function normalizeSubject(value) {
  let s = oneLine(value, 300);
  for (let i = 0; i < 10; i += 1) {
    const next = s.replace(/^(?:re|fwd?|aw|sv)\s*:\s*/i, '');
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

export function codeOf(err) {
  const code = err && err.code;
  if (typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code)) return code.toLowerCase();
  return 'error';
}

export function envelopeAddress(value) {
  const raw = String(value ?? '').trim();
  const angle = raw.match(/<([^<>\s]+)>/);
  return (angle ? angle[1] : raw).trim().toLowerCase();
}

function localPart(value, name, domain = 'celticcoo.ca') {
  const email = envelopeAddress(value);
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const local = email.slice(0, at);
  const host = email.slice(at + 1);
  if (host !== domain) return false;
  return local.split('+')[0] === name;
}

export function isHelloRecipient(value) {
  return localPart(value, 'hello');
}

export function isIntakeRecipient(value) {
  return localPart(value, 'intake', 'in.celticcoo.ca');
}

// hello@ stays until the apex mailbox moves. intake@ is the internal pipeline.
export function isTriageRecipient(value) {
  return isHelloRecipient(value) || isIntakeRecipient(value);
}

export function isBookingsRecipient(value) {
  return localPart(value, 'bookings');
}

// First email-shaped address. Display names and bare IP addresses are ignored.
const EMAIL_SHAPE = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i;

export function firstEmail(value) {
  const raw = String(value ?? '').slice(0, 1000);
  for (const angle of raw.matchAll(/<([^<>]+)>/g)) {
    const email = emailShape(angle[1]);
    if (email) return email;
  }
  return emailShape(raw);
}

function emailShape(value) {
  const match = String(value).match(EMAIL_SHAPE);
  if (!match) return '';
  return oneEmail(match[0].toLowerCase());
}

function headerGet(message, name) {
  const headers = message && message.headers;
  if (!headers || typeof headers.get !== 'function') return '';
  return headers.get(name) || '';
}

function preferHeader(parsedValue, headerValue) {
  if (firstEmail(parsedValue)) return parsedValue;
  return headerValue || parsedValue || '';
}

// Headers only. The body is not a source of the sender.
// Reply-To, then From, then forward headers. X-Forwarded-For is usually an
// IP; only an email-shaped value is used. The SMTP envelope is stored apart.
const FORWARD_SENDER_HEADERS = [
  'x-original-from',
  'x-forwarded-for',
  'resent-from',
  'x-forwarded-from',
];

export function originalSender(message, parsed = {}) {
  const source = parsed || {};
  const direct = [
    preferHeader(source.replyTo, headerGet(message, 'reply-to')),
    preferHeader(source.fromHeader, headerGet(message, 'from')),
  ];
  for (const value of direct) {
    const email = firstEmail(value);
    if (email) return { email, forward: false };
  }
  for (const name of FORWARD_SENDER_HEADERS) {
    const email = firstEmail(headerGet(message, name));
    if (email) return { email, forward: true };
  }
  return { email: '', forward: false };
}

// Unfilled template markers. The approval path refuses to send these.
// Word boundaries keep "today" and "to-do" from matching.
const UNFILLED_PLACEHOLDER = /\bTODO\b|\{\{[^{}\r\n]{0,200}\}\}|\[(?:PLACEHOLDER|TBD|FIXME|XXX)\]|<(?:PLACEHOLDER|TODO|TBD|FIXME)>/i;

export function hasUnfilledPlaceholder(value) {
  return UNFILLED_PLACEHOLDER.test(String(value ?? ''));
}
