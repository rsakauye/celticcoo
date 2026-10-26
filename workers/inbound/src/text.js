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

function localPart(value, name) {
  const email = envelopeAddress(value);
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (domain !== 'celticcoo.ca') return false;
  return local.split('+')[0] === name;
}

export function isHelloRecipient(value) {
  return localPart(value, 'hello');
}

export function isBookingsRecipient(value) {
  return localPart(value, 'bookings');
}
