-- Private log of mail received at hello@celticcoo.ca.
-- The row may contain the sender address, subject, and message.
-- A GitHub issue must not. Issues store this row id and public event fields only.
-- category is the classifier result. classifier is ai, rules, or pending.
-- forward_status is pending, sent, failed, or skipped.
-- issue_status is skipped, pending, filed, or failed.

CREATE TABLE inbound_emails (
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
  raw_size INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_inbound_emails_dedupe ON inbound_emails (dedupe_key, envelope_to);
CREATE INDEX idx_inbound_emails_created ON inbound_emails (created_at);
CREATE INDEX idx_inbound_emails_category_created ON inbound_emails (category, created_at);
