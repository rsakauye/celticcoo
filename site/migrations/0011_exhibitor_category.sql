-- Adds exhibitor_invitation to the inbound_emails category check.
-- SQLite cannot change a CHECK constraint in place, so this file rebuilds the
-- table: create the new shape, copy every row, swap the names, and recreate
-- the indexes. Column order and defaults match 0002 plus 0003, 0005, 0006,
-- and 0009. No row is changed or dropped.
--
-- Apply by hand, once, before deploying the Worker that can store
-- exhibitor_invitation. A deploy does not apply this file. Until it is
-- applied, the Worker stores an exhibitor invitation as category other
-- (classifier_reason ends in :exhibitor_fallback) so the row is not lost.
-- Take a D1 Time Travel bookmark first so the old table can be restored.
-- A second run rebuilds the table again with the same rows. It is harmless
-- but not needed. Check first with
-- SELECT sql FROM sqlite_master WHERE name = 'inbound_emails'.

CREATE TABLE inbound_emails_new (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  envelope_from TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  from_header TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  attachment_note TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN (
    'event_listing_request',
    'booking_inquiry',
    'correction_or_update',
    'partnership_or_press',
    'exhibitor_invitation',
    'spam',
    'other'
  )),
  confidence REAL,
  summary TEXT NOT NULL DEFAULT '',
  extracted_json TEXT,
  classifier TEXT NOT NULL DEFAULT 'pending' CHECK (classifier IN ('ai', 'rules', 'pending')),
  forward_status TEXT NOT NULL DEFAULT 'pending' CHECK (forward_status IN ('pending', 'sent', 'failed', 'skipped')),
  issue_status TEXT NOT NULL DEFAULT 'skipped' CHECK (issue_status IN ('skipped', 'pending', 'filed', 'failed')),
  issue_url TEXT NOT NULL DEFAULT '',
  issue_number INTEGER,
  error_code TEXT NOT NULL DEFAULT '',
  raw_size INTEGER NOT NULL DEFAULT 0,
  classifier_reason TEXT NOT NULL DEFAULT '',
  clarify_status TEXT NOT NULL DEFAULT '',
  clarify_draft TEXT NOT NULL DEFAULT '',
  clarify_reasons TEXT NOT NULL DEFAULT '',
  clarify_lock TEXT NOT NULL DEFAULT '',
  trust_score INTEGER NOT NULL DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 100),
  trust_reasons TEXT NOT NULL DEFAULT '[]',
  missing_fields TEXT NOT NULL DEFAULT '[]',
  red_flags TEXT NOT NULL DEFAULT '{}',
  draft_skip_reason TEXT NOT NULL DEFAULT ''
);

INSERT INTO inbound_emails_new (
  id, created_at, received_at, dedupe_key, message_id,
  envelope_from, envelope_to, from_header, reply_to,
  subject, text_body, attachment_note,
  category, confidence, summary, extracted_json, classifier,
  forward_status, issue_status, issue_url, issue_number, error_code, raw_size,
  classifier_reason, clarify_status, clarify_draft, clarify_reasons, clarify_lock,
  trust_score, trust_reasons, missing_fields, red_flags, draft_skip_reason
)
SELECT
  id, created_at, received_at, dedupe_key, message_id,
  envelope_from, envelope_to, from_header, reply_to,
  subject, text_body, attachment_note,
  category, confidence, summary, extracted_json, classifier,
  forward_status, issue_status, issue_url, issue_number, error_code, raw_size,
  classifier_reason, clarify_status, clarify_draft, clarify_reasons, clarify_lock,
  trust_score, trust_reasons, missing_fields, red_flags, draft_skip_reason
FROM inbound_emails;

ALTER TABLE inbound_emails RENAME TO inbound_emails_old;
ALTER TABLE inbound_emails_new RENAME TO inbound_emails;
DROP TABLE inbound_emails_old;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_emails_dedupe ON inbound_emails (dedupe_key, envelope_to);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_created ON inbound_emails (created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_emails_category_created ON inbound_emails (category, created_at);
