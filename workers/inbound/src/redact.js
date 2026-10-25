// Strips contact details before anything is written to a public GitHub issue.
// The private D1 row keeps the original message. The issue must not.

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const OBFUSCATED = /\b[A-Z0-9._%+-]{1,64}(?:\s*[([]\s*at\s*[)\]]\s*|\s+at\s+)(?:[A-Z0-9-]+\s*(?:[([]\s*dot\s*[)\]]\s*|\s+dot\s+|\.))+[A-Z]{2,24}\b/gi;
const PHONE = /(?<!\d)(?:\+\d{1,3}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}(?!\d)/g;
const TEL = /\btel:\+?[\d().\s-]{7,20}/gi;

export const PUBLIC_MAILBOX = 'hello@celticcoo.ca';

export function redactContact(value, allow = []) {
  const allowed = new Set(allow.map((item) => String(item).toLowerCase()));
  let out = String(value ?? '');
  out = out.replace(OBFUSCATED, '[redacted]');
  out = out.replace(EMAIL, (match) => (allowed.has(match.toLowerCase()) ? match : '[redacted]'));
  out = out.replace(PHONE, '[redacted]');
  out = out.replace(TEL, '[redacted]');
  return out;
}

function hits(pattern, text) {
  pattern.lastIndex = 0;
  return pattern.test(text);
}

export function hasPrivateContact(value) {
  const text = String(value ?? '').replaceAll(PUBLIC_MAILBOX, '');
  return hits(EMAIL, text) || hits(OBFUSCATED, text) || hits(PHONE, text) || hits(TEL, text);
}
