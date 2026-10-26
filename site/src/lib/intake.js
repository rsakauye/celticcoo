// Private booking intake: Turnstile decisions, risk flags, and D1 writes.
// Failure rows store a reason code and a short machine detail only.
// Never put a name, email, phone, message, token, or secret in a failure row or a log line.
// The trust columns are advisory codes. A Turnstile pass does not send mail by itself.

import celticcooTrust from '../../../shared/trust/sites/celticcoo.js';
import { detectRedFlags, formMissingFields, scoreTrust } from '../../../shared/trust/index.js';

export const TURNSTILE_ACTION = 'book';

const MINOR_RE = /\b(minors?|under[-\s]?18|underage|children|child|kids?|youths?|juniors?|juveniles?)\b|\b(?:1[0-7]|[1-9])[\s-]*years?[\s-]*old\b/i;
const PRIVATE_CONTACT_RE = /\b(private|personal|home|direct)\s+(phone|number|email|e-mail|address|contact|cell|mobile)\b|\b(cell|mobile|home)\s+(phone|number)\b|\bcontact details\b|\btheir (phone|email|e-mail|number|address)\b|\b(his|her|their) (private|personal|home|cell|mobile|direct)\b|\bperformer'?s? (phone|email|e-mail|number|address|contact)\b|\bprivate contact\b/i;
const PAYMENT_RE = /\b(cheques?|cashier'?s checks?|personal checks?|bank checks?|pay by checks?|a check for|mail(?:ing)? a check|send(?:ing)? a check|e-?transfers?|interac|wire transfers?|western union|gift ?cards?|bitcoin|crypto(?:currency)?|money orders?|paypal|venmo|cash only|in cash)\b/i;

function eventHasDate(event) {
  if (!event || event.tba) return false;
  const when = String(event.when || '');
  if (!when || /tba/i.test(when)) return false;
  return true;
}

function eventHasPlace(event) {
  return Boolean(String((event && (event.city || event.venue)) || '').trim());
}

export function assessRisk(value) {
  const message = String((value && value.message) || '');
  const other = String((value && value.performerOther) || '');
  const flags = [];
  const minorMentioned = Boolean(value && value.under18) || MINOR_RE.test(message);
  if (minorMentioned && !(value && value.guardianConfirm)) flags.push('minor_no_guardian');
  if (PRIVATE_CONTACT_RE.test(message) || PRIVATE_CONTACT_RE.test(other)) flags.push('private_contact');
  if (PAYMENT_RE.test(message)) flags.push('payment_oddity');
  const dated = Boolean(value && value.custom && value.custom.date) || ((value && value.events) || []).some(eventHasDate);
  if (!dated) flags.push('missing_date');
  const venue = value && value.custom
    ? Boolean(String(value.custom.venue || '').trim())
    : ((value && value.events) || []).some(eventHasPlace);
  if (!venue) flags.push('missing_venue');
  return flags;
}

export function intakeStatus(flags) {
  return flags && flags.length ? 'flagged' : 'new';
}

export function turnstileHostnames(env) {
  return new Set(
    String((env && env.TURNSTILE_HOSTNAMES) || '')
      .split(',')
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
}

function reasonCode(reason) {
  const code = String(reason || '').toLowerCase();
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : 'unknown';
}

function safeDetail(detail) {
  const text = String(detail || '').toLowerCase().replace(/\s+/g, '');
  return /^[a-z0-9_,.-]{0,200}$/.test(text) ? text : '';
}

export async function verifyTurnstile({ token, request, env, fetchImpl = fetch }) {
  const secret = env && typeof env.TURNSTILE_SECRET === 'string' ? env.TURNSTILE_SECRET.trim() : '';
  const expected = turnstileHostnames(env);
  if (!secret || expected.size === 0) return { ok: false, reason: 'turnstile_not_configured', detail: '' };
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: 'turnstile_missing', detail: '' };
  }
  const body = new URLSearchParams({ secret, response: token });
  const remoteip = request && request.headers ? request.headers.get('CF-Connecting-IP') : '';
  if (remoteip) body.set('remoteip', remoteip);
  let result;
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!response.ok) return { ok: false, reason: 'turnstile_unavailable', detail: `siteverify_${response.status}` };
    result = await response.json();
  } catch {
    return { ok: false, reason: 'turnstile_unavailable', detail: 'siteverify_error' };
  }
  if (!result || result.success !== true) {
    const codes = Array.isArray(result && result['error-codes'])
      ? result['error-codes'].filter((code) => typeof code === 'string').slice(0, 5).join(',')
      : '';
    return { ok: false, reason: 'turnstile_rejected', detail: codes };
  }
  if (result.action !== TURNSTILE_ACTION) return { ok: false, reason: 'turnstile_action', detail: '' };
  const hostname = String(result.hostname || '').toLowerCase();
  if (!expected.has(hostname)) return { ok: false, reason: 'turnstile_hostname', detail: '' };
  return { ok: true };
}

export function verifyFromEnv(env) {
  return (token, request) => verifyTurnstile({ token, request, env });
}

export async function logIntakeFailure(db, entry = {}) {
  const reason = reasonCode(entry.reason);
  const detail = safeDetail(entry.detail);
  const source = reasonCode(entry.source || 'book');
  if (!db || typeof db.prepare !== 'function') {
    console.error(JSON.stringify({ message: 'intake failure', reason, detail, stored: false }));
    return false;
  }
  try {
    await db.prepare(
      'INSERT INTO submission_failures (id, created_at, reason, detail, source) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), new Date().toISOString(), reason, detail, source).run();
    console.error(JSON.stringify({ message: 'intake failure', reason, detail, stored: true }));
    return true;
  } catch {
    console.error(JSON.stringify({ message: 'intake failure log failed', reason, stored: false }));
    return false;
  }
}

export function submissionTrust(value, turnstile) {
  const text = `${value && value.message || ''}\n${value && value.performerOther || ''}`.slice(0, 8000);
  const redFlags = detectRedFlags(text, {
    under18: Boolean(value && value.under18),
    injectionPhrases: celticcooTrust.lexicon && celticcooTrust.lexicon.injection,
  });
  const missingFields = formMissingFields(value);
  const verdict = turnstile === 'pass' || turnstile === 'fail' || turnstile === 'unavailable'
    ? turnstile
    : 'unavailable';
  try {
    const scored = scoreTrust({
      channel: 'form',
      missingFields,
      redFlags,
      turnstile: verdict,
    }, celticcooTrust);
    const reasons = (scored.reasons || []).filter((reason) => reason && /^[a-z0-9_]{1,40}$/.test(String(reason.code || '')))
      .map((reason) => ({ code: reason.code, delta: Number.isFinite(Number(reason.delta)) ? Number(reason.delta) : 0 }));
    return {
      score: scored.score,
      reasons: JSON.stringify(reasons),
      missingFields: JSON.stringify(scored.missingFields),
      redFlags: JSON.stringify(scored.redFlags),
      autoSend: false,
    };
  } catch {
    return {
      score: celticcooTrust.failClosedScore,
      reasons: JSON.stringify([{ code: 'trust_config', delta: 0 }]),
      missingFields: JSON.stringify(missingFields),
      redFlags: JSON.stringify(redFlags),
      autoSend: false,
    };
  }
}

export async function saveSubmission(db, row) {
  if (!db || typeof db.prepare !== 'function') {
    const err = new Error('intake database is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const value = row.value;
  const events = (value.events || []).map((event) => ({
    id: event.id,
    name: event.name,
    when: event.when,
    city: event.city || '',
    region: event.regionLabel || event.region || '',
    tba: Boolean(event.tba),
  }));
  const trust = submissionTrust(value, row.turnstile);
  await db.prepare(
    `INSERT INTO submissions (
      id, created_at, updated_at, status, risk_flags,
      name, email, phone, requester_type, request_type,
      events_json, custom_event_json, performers_json, performer_other,
      message, budget, under18, guardian_confirm, email_status, source,
      trust_score, trust_reasons, missing_fields, red_flags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).bind(
    row.id,
    row.createdAt,
    row.updatedAt,
    row.status,
    JSON.stringify(row.flags || []),
    value.name,
    value.email,
    value.phone || '',
    value.requesterType,
    value.requestType,
    JSON.stringify(events),
    value.custom ? JSON.stringify(value.custom) : null,
    JSON.stringify(value.performers || []),
    value.performerOther || '',
    value.message,
    value.budget || '',
    value.under18 ? 1 : 0,
    value.guardianConfirm ? 1 : 0,
    row.source || 'book',
    trust.score,
    trust.reasons,
    trust.missingFields,
    trust.redFlags,
  ).run();
}

export async function markEmailStatus(db, id, emailStatus) {
  if (!db || typeof db.prepare !== 'function') return;
  if (!['pending', 'sent', 'failed', 'skipped'].includes(emailStatus)) {
    throw Object.assign(new Error('bad email status'), { code: 'bad_email_status' });
  }
  await db.prepare('UPDATE submissions SET email_status = ?, updated_at = ? WHERE id = ?')
    .bind(emailStatus, new Date().toISOString(), id)
    .run();
}

export function intakeFromEnv(env) {
  const db = env && env.INTAKE_DB;
  return {
    save: (row) => saveSubmission(db, row),
    log: (entry) => logIntakeFailure(db, entry),
    markEmail: (id, emailStatus) => markEmailStatus(db, id, emailStatus),
  };
}
