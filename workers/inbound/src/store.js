// Writes one inbound_emails row. Values are bound parameters.
// A repeat delivery of the same Message-ID updates the row instead of inserting another.
// A draft that is already approved, sent, or discarded is left alone on that update.

import { newReviewTokenId } from './token.js';
import { normalizeSubject, oneLine } from './text.js';

// Earlier notes in one conversation: same recipient, same sender, same subject
// once Re:/Fwd: prefixes are gone. Message-ID threading headers are not stored,
// so this uses columns that already exist and needs no migration.
export const THREAD_WINDOW_DAYS = 45;
export const THREAD_MAX_ROWS = 5;
const THREAD_SCAN_ROWS = 25;

const THREAD_SQL = `SELECT subject, category, extracted_json, text_body, clarify_status, clarify_reasons, created_at
FROM inbound_emails
WHERE envelope_to = ?
  AND dedupe_key != ?
  AND created_at >= ?
  AND created_at <= ?
  AND (lower(envelope_from) = ? OR instr(lower(reply_to), ?) > 0 OR instr(lower(from_header), ?) > 0)
ORDER BY created_at DESC
LIMIT ${THREAD_SCAN_ROWS}`;

// Returns prior rows, oldest first. Any problem returns [] so a failed lookup
// leaves the plain, single-message behaviour in place. The forward has already
// happened by the time this runs, so it must never throw.
export async function loadThread(db, { envelopeTo, sender, subject, dedupeKey, now }) {
  try {
    const who = String(sender || '').trim().toLowerCase();
    const wanted = normalizeSubject(subject);
    if (!db || typeof db.prepare !== 'function' || !who || !wanted) return [];
    const stmt = db.prepare(THREAD_SQL).bind(
      envelopeTo,
      dedupeKey,
      new Date(now.getTime() - THREAD_WINDOW_DAYS * 86_400_000).toISOString(),
      now.toISOString(),
      who,
      who,
      who,
    );
    if (typeof stmt.all !== 'function') return [];
    const found = await stmt.all();
    const rows = Array.isArray(found && found.results) ? found.results : [];
    return rows
      .filter((row) => row && normalizeSubject(row.subject) === wanted)
      .slice(0, THREAD_MAX_ROWS)
      .reverse();
  } catch {
    return [];
  }
}

const INSERT_SQL = `INSERT INTO inbound_emails (
  id, created_at, received_at, dedupe_key, message_id,
  envelope_from, envelope_to, from_header, reply_to,
  subject, text_body, attachment_note,
  category, confidence, summary, extracted_json, classifier, classifier_reason,
  forward_status, issue_status, issue_url, issue_number,
  clarify_status, clarify_draft, clarify_reasons, draft_skip_reason, clarify_lock,
  trust_score, trust_reasons, missing_fields, red_flags,
  error_code, raw_size
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`;

const UPDATE_SQL = `UPDATE inbound_emails SET
  received_at = ?, message_id = ?, envelope_from = ?, from_header = ?, reply_to = ?,
  subject = ?, text_body = ?, attachment_note = ?,
  category = ?, confidence = ?, summary = ?, extracted_json = ?, classifier = ?, classifier_reason = ?,
  forward_status = ?, error_code = ?, raw_size = ?,
  trust_score = ?, trust_reasons = ?, missing_fields = ?, red_flags = ?,
  clarify_status = CASE WHEN clarify_status IN ('approved', 'sent', 'discarded') THEN clarify_status ELSE ? END,
  clarify_draft = CASE WHEN clarify_status IN ('approved', 'sent', 'discarded') THEN clarify_draft ELSE ? END,
  clarify_reasons = CASE WHEN clarify_status IN ('approved', 'sent', 'discarded') THEN clarify_reasons ELSE ? END,
  draft_skip_reason = CASE WHEN clarify_status IN ('approved', 'sent', 'discarded') THEN draft_skip_reason ELSE ? END
  WHERE id = ?`;

export async function upsertInbound(db, row) {
  if (!db || typeof db.prepare !== 'function') {
    const err = new Error('intake database is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const existing = await db.prepare(
    'SELECT id, issue_status, issue_url, clarify_status FROM inbound_emails WHERE dedupe_key = ? AND envelope_to = ?',
  ).bind(row.dedupeKey, row.envelopeTo).first();
  if (existing && existing.id) {
    await db.prepare(UPDATE_SQL).bind(
      row.receivedAt,
      row.messageId,
      row.envelopeFrom,
      row.fromHeader,
      row.replyTo,
      row.subject,
      row.textBody,
      row.attachmentNote,
      row.category,
      row.confidence,
      row.summary,
      row.extractedJson,
      row.classifier,
      row.classifierReason || '',
      row.forwardStatus,
      row.errorCode,
      row.rawSize,
      row.trustScore,
      row.trustReasons || '[]',
      row.missingFields || '[]',
      row.redFlags || '{}',
      row.clarifyStatus || '',
      row.clarifyDraft || '',
      row.clarifyReasons || '',
      row.draftSkipReason || '',
      existing.id,
    ).run();
    return {
      id: existing.id,
      issueStatus: existing.issue_status || 'skipped',
      issueUrl: existing.issue_url || '',
      created: false,
    };
  }
  try {
    await db.prepare(INSERT_SQL).bind(
      row.id,
      row.createdAt,
      row.receivedAt,
      row.dedupeKey,
      row.messageId,
      row.envelopeFrom,
      row.envelopeTo,
      row.fromHeader,
      row.replyTo,
      row.subject,
      row.textBody,
      row.attachmentNote,
      row.category,
      row.confidence,
      row.summary,
      row.extractedJson,
      row.classifier,
      row.classifierReason || '',
      row.forwardStatus,
      row.issueStatus,
      row.clarifyStatus || '',
      row.clarifyDraft || '',
      row.clarifyReasons || '',
      row.draftSkipReason || '',
      row.trustScore,
      row.trustReasons || '[]',
      row.missingFields || '[]',
      row.redFlags || '{}',
      row.errorCode,
      row.rawSize,
    ).run();
  } catch (err) {
    const again = await db.prepare(
      'SELECT id, issue_status, issue_url, clarify_status FROM inbound_emails WHERE dedupe_key = ? AND envelope_to = ?',
    ).bind(row.dedupeKey, row.envelopeTo).first();
    if (again && again.id) {
      return { id: again.id, issueStatus: again.issue_status || 'skipped', issueUrl: again.issue_url || '', created: false };
    }
    const wrapped = new Error('store failed');
    wrapped.code = 'store_failed';
    wrapped.cause = err;
    throw wrapped;
  }
  return { id: row.id, issueStatus: 'skipped', issueUrl: '', created: true };
}

export async function markIssue(db, id, issueStatus, issueUrl, issueNumber, errorCode = '') {
  if (!db || typeof db.prepare !== 'function') return;
  const code = oneLine(errorCode, 80);
  await db.prepare(
    'UPDATE inbound_emails SET issue_status = ?, issue_url = ?, issue_number = ?, error_code = CASE WHEN ? != \'\' THEN ? ELSE error_code END WHERE id = ?',
  ).bind(issueStatus, issueUrl || '', Number.isInteger(issueNumber) ? issueNumber : null, code, code, id).run();
}

export async function loadInbound(db, id) {
  if (!db || typeof db.prepare !== 'function') return null;
  return db.prepare(
    `SELECT id, subject, reply_to, envelope_from, from_header, text_body, category,
            clarify_status, clarify_draft, clarify_reasons
     FROM inbound_emails WHERE id = ?`,
  ).bind(id).first();
}

const TOKEN_INSERT = `INSERT INTO review_tokens (
  id, inbound_email_id, created_at, expires_at, used_at
) VALUES (?, ?, ?, ?, '')`;

const TOKEN_READ = `SELECT id, inbound_email_id, created_at, expires_at, used_at
FROM review_tokens WHERE id = ?`;

export async function createReviewToken(db, inboundEmailId, now, ttlSeconds) {
  if (!db || typeof db.prepare !== 'function') {
    const err = new Error('intake database is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  let last = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = newReviewTokenId();
    try {
      await db.prepare(TOKEN_INSERT).bind(id, inboundEmailId, createdAt, expiresAt).run();
      return { id, inboundEmailId, createdAt, expiresAt, usedAt: '' };
    } catch (err) {
      last = err;
    }
  }
  const err = new Error('review token was not stored');
  err.code = 'token_store_failed';
  err.cause = last;
  throw err;
}

export async function loadReviewToken(db, id) {
  if (!db || typeof db.prepare !== 'function') return null;
  try {
    return await db.prepare(TOKEN_READ).bind(id).first();
  } catch {
    return null;
  }
}

export async function claimReviewToken(db, id, usedAt, nowIso) {
  const result = await db.prepare(
    `UPDATE review_tokens SET used_at = ?
     WHERE id = ? AND used_at = '' AND expires_at > ?`,
  ).bind(usedAt, id, nowIso).run();
  return changed(result);
}

export async function releaseReviewToken(db, id, usedAt) {
  if (!db || typeof db.prepare !== 'function') return;
  await db.prepare(
    `UPDATE review_tokens SET used_at = '' WHERE id = ? AND used_at = ?`,
  ).bind(id, usedAt).run();
}

export async function saveClarifyDraft(db, id, draft) {
  await db.prepare(
    `UPDATE inbound_emails SET clarify_draft = ?
     WHERE id = ? AND clarify_status IN ('pending_approval', 'approved')`,
  ).bind(draft, id).run();
}

function changed(result) {
  const value = result && result.meta ? result.meta.changes : result && result.changes;
  return Number(value) > 0;
}

export async function claimClarifySend(db, id, lock, staleBefore) {
  const result = await db.prepare(
    `UPDATE inbound_emails
     SET clarify_status = 'approved', clarify_lock = ?
     WHERE id = ?
       AND clarify_draft != ''
       AND clarify_status IN ('pending_approval', 'approved')
       AND (clarify_lock = '' OR clarify_lock < ?)`,
  ).bind(lock, id, staleBefore).run();
  return changed(result);
}

export async function markClarifySent(db, id, lock) {
  await db.prepare(
    `UPDATE inbound_emails SET clarify_status = 'sent', clarify_lock = ''
     WHERE id = ? AND clarify_lock = ?`,
  ).bind(id, lock).run();
}

export async function releaseClarifySend(db, id, lock) {
  await db.prepare(
    `UPDATE inbound_emails
     SET clarify_status = 'approved', clarify_lock = '', error_code = 'clarify_send_failed'
     WHERE id = ? AND clarify_lock = ?`,
  ).bind(id, lock).run();
}

export async function suppressClarify(db, id, lock) {
  const result = await db.prepare(
    `UPDATE inbound_emails
     SET clarify_status = 'discarded', clarify_lock = '', error_code = 'opt_out'
     WHERE id = ? AND clarify_lock = ?`,
  ).bind(id, lock).run();
  return changed(result);
}

export async function discardClarify(db, id) {
  const result = await db.prepare(
    `UPDATE inbound_emails SET clarify_status = 'discarded', clarify_lock = ''
     WHERE id = ? AND clarify_status IN ('pending_approval', 'approved') AND clarify_lock = ''`,
  ).bind(id).run();
  return changed(result);
}
