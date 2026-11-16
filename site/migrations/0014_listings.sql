-- Free self-listings for performers and for clubs or lessons groups.
-- Apply by hand to the live intake database before deploying the site and
-- the inbound Worker that read and write this table. A deploy does not apply
-- this file. Safe to re-run: IF NOT EXISTS.
--
-- status: pending (new, not public), needs_info (one follow-up asked),
-- listed (approved by a person, public), rejected, closed (needs_info with no
-- answer after 14 days). Only listed rows are ever shown on the site, and only
-- public_json plus public_email when show_email = 1.
--
-- Private columns: submitter_name, submitter_email, submitter_role,
-- newsletter_opt_in, adult_confirm, terms_confirm, moderator_note, reply_draft.
-- They are never returned by /api/performers and never copied into git.
-- Rejected and closed rows are deleted 90 days after their last change by the
-- inbound Worker's daily retention job (only when RETENTION_PURGE is "on").
--
-- name_key and city_key are folded copies for the moderator's duplicate hint.
-- reply_status tracks the one email a person may approve per step: the listed
-- link or the needs-info question. Nothing sends without that approval.
-- ack_status tracks the optional receipt. It sends only when ACK_REPLIES is
-- "on" in the inbound Worker. That flag is off.

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('performer', 'group')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'needs_info', 'listed', 'rejected', 'closed')),
  status_reason TEXT NOT NULL DEFAULT '',
  moderator_note TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  city TEXT NOT NULL,
  city_key TEXT NOT NULL,
  province TEXT NOT NULL,
  public_json TEXT NOT NULL,
  public_email TEXT NOT NULL DEFAULT '',
  show_email INTEGER NOT NULL DEFAULT 0 CHECK (show_email IN (0, 1)),
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  submitter_role TEXT NOT NULL DEFAULT '',
  newsletter_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (newsletter_opt_in IN (0, 1)),
  adult_confirm INTEGER NOT NULL DEFAULT 0 CHECK (adult_confirm IN (0, 1)),
  terms_confirm INTEGER NOT NULL DEFAULT 0 CHECK (terms_confirm IN (0, 1)),
  risk_flags TEXT NOT NULL DEFAULT '[]',
  ack_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ack_status IN ('pending', 'sent', 'skipped', 'failed')),
  reply_kind TEXT NOT NULL DEFAULT '' CHECK (reply_kind IN ('', 'listed', 'needs_info')),
  reply_draft TEXT NOT NULL DEFAULT '',
  reply_status TEXT NOT NULL DEFAULT ''
    CHECK (reply_status IN ('', 'pending_approval', 'sending', 'sent', 'failed', 'discarded')),
  needs_info_at TEXT NOT NULL DEFAULT '',
  listed_at TEXT NOT NULL DEFAULT '',
  closed_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'listing'
);

CREATE INDEX IF NOT EXISTS listings_status_kind ON listings (status, kind, updated_at);
CREATE INDEX IF NOT EXISTS listings_dupe ON listings (name_key, city_key);
CREATE INDEX IF NOT EXISTS listings_created ON listings (created_at);
