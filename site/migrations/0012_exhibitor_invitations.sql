-- Private record for an exhibitor or vendor invitation (an organizer inviting
-- The Celtic Coo to exhibit or vend). One row per inbound_emails row.
-- This table holds the organizer's name, email, and phone, and booth costs.
-- None of it goes to a GitHub issue, a public page, or a public doc.
-- Retention follows inbound_emails: 12 months (workers/inbound/src/retention.js).
-- status: new, reviewed, replied, interested, declined, discarded.
-- currency_source: stated (written in the note), location (from the event's
-- place), or default (place unclear, CAD, flagged currency_unclear).
-- missing_fields and review_flags are JSON arrays of codes.
-- Apply by hand before deploying the Worker that writes it. A deploy does not
-- apply this file. Until it exists, the Worker logs exhibitor_store_failed and
-- keeps going; the inbound row and the review draft are still stored.

CREATE TABLE IF NOT EXISTS exhibitor_invitations (
  inbound_email_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'replied', 'interested', 'declined', 'discarded')),
  organizer TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  event_name TEXT NOT NULL DEFAULT '',
  event_dates TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  apply_deadline TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  setup_times TEXT NOT NULL DEFAULT '',
  teardown_times TEXT NOT NULL DEFAULT '',
  booth_options TEXT NOT NULL DEFAULT '',
  booth_cost TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'CAD',
  currency_source TEXT NOT NULL DEFAULT 'default' CHECK (currency_source IN ('stated', 'location', 'default')),
  fees_deposits TEXT NOT NULL DEFAULT '',
  power_tables TEXT NOT NULL DEFAULT '',
  insurance_permits TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  classifier TEXT NOT NULL DEFAULT 'rules' CHECK (classifier IN ('ai', 'rules')),
  missing_fields TEXT NOT NULL DEFAULT '[]',
  review_flags TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS exhibitor_invitations_status ON exhibitor_invitations (status, created_at);
CREATE INDEX IF NOT EXISTS exhibitor_invitations_created ON exhibitor_invitations (created_at);
CREATE INDEX IF NOT EXISTS exhibitor_invitations_message ON exhibitor_invitations (message_id);
