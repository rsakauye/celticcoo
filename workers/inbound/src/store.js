// Writes one inbound_emails row. Values are bound parameters.
// A repeat delivery of the same Message-ID updates the row instead of inserting another.

import { oneLine } from './text.js';

const INSERT_SQL = `INSERT INTO inbound_emails (
  id, created_at, received_at, dedupe_key, message_id,
  envelope_from, envelope_to, from_header, reply_to,
  subject, text_body, attachment_note,
  category, confidence, summary, extracted_json, classifier,
  forward_status, issue_status, issue_url, issue_number,
  error_code, raw_size
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?)`;

const UPDATE_SQL = `UPDATE inbound_emails SET
  received_at = ?, message_id = ?, envelope_from = ?, from_header = ?, reply_to = ?,
  subject = ?, text_body = ?, attachment_note = ?,
  category = ?, confidence = ?, summary = ?, extracted_json = ?, classifier = ?,
  forward_status = ?, error_code = ?, raw_size = ?
  WHERE id = ?`;

export async function upsertInbound(db, row) {
  if (!db || typeof db.prepare !== 'function') {
    const err = new Error('intake database is not configured');
    err.code = 'not_configured';
    throw err;
  }
  const existing = await db.prepare(
    'SELECT id, issue_status, issue_url FROM inbound_emails WHERE dedupe_key = ? AND envelope_to = ?',
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
      row.forwardStatus,
      row.errorCode,
      row.rawSize,
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
      row.forwardStatus,
      row.issueStatus,
      row.errorCode,
      row.rawSize,
    ).run();
  } catch (err) {
    const again = await db.prepare(
      'SELECT id, issue_status, issue_url FROM inbound_emails WHERE dedupe_key = ? AND envelope_to = ?',
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
