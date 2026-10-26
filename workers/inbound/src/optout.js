// A stop or unsubscribe reply. The address is stored. The message is not.
// Suppression applies to non-transactional mail to that address. The operator
// copy (the forward, and the booking notice to the owner) is separate.

import { envelopeAddress, oneEmail } from './text.js';

const OPT_OUT_RE = /^(?:please\s+)?(?:stop(?:\s+all)?|unsubscribe(?:\s+all)?|stop\s+emailing(?:\s+me)?|remove\s+me|opt\s*out)[\s.!?]*$/i;

function flat(value) {
  return String(value ?? '').replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeOptOutEmail(value) {
  return oneEmail(envelopeAddress(value));
}

export function isOptOutMessage(subject, text) {
  const body = flat(text);
  const sub = flat(subject).replace(/^re:\s*/i, '');
  if (body && OPT_OUT_RE.test(body)) return true;
  if (!body && OPT_OUT_RE.test(sub)) return true;
  return false;
}

export async function recordOptOut(db, email, createdAt) {
  const normalized = normalizeOptOutEmail(email);
  if (!normalized) return false;
  if (!db || typeof db.prepare !== 'function') {
    const err = new Error('opt-out store missing');
    err.code = 'opt_out_store_failed';
    throw err;
  }
  await db.prepare(
    'INSERT OR IGNORE INTO mail_opt_outs (email, created_at, source) VALUES (?, ?, ?)',
  ).bind(normalized, createdAt, 'reply').run();
  return true;
}

export async function optOutStatus(db, email) {
  const normalized = normalizeOptOutEmail(email);
  if (!normalized) return 'allowed';
  if (!db || typeof db.prepare !== 'function') return 'unknown';
  try {
    const row = await db.prepare(
      'SELECT email FROM mail_opt_outs WHERE email = ?',
    ).bind(normalized).first();
    if (row && String(row.email || '').toLowerCase() === normalized) return 'opted_out';
    return 'allowed';
  } catch {
    return 'unknown';
  }
}

export async function isOptedOut(db, email) {
  return (await optOutStatus(db, email)) === 'opted_out';
}

export async function nonTransactionalAllowed(db, email) {
  return (await optOutStatus(db, email)) === 'allowed';
}
