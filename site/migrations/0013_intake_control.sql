-- Kill switch and outbound log for replies from hello@celticcoo.ca.
-- intake_control is one row. manual_pause = 1, or any latch text, stops every
-- reply the send guard checks (workers/inbound/src/guard.js), including an
-- approved exhibitor reply. trust.js already reads this row for the score.
-- outbound_sends is one row per reply sent through the approval path. The
-- guard counts the last 24 hours against the 40 a day cap. It stores no
-- address and no message text.
-- Apply by hand before deploying the Worker that sends exhibitor replies.
-- Until it exists, exhibitor replies fail closed (guard_unavailable) and
-- nothing is sent. Safe to re-run: IF NOT EXISTS and INSERT OR IGNORE.
--
-- Pause:   UPDATE intake_control SET manual_pause = 1, pause_reason = 'manual', updated_at = datetime('now') WHERE id = 'singleton';
-- Resume:  UPDATE intake_control SET manual_pause = 0, latch = '', pause_reason = '', updated_at = datetime('now') WHERE id = 'singleton';

CREATE TABLE IF NOT EXISTS intake_control (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  manual_pause INTEGER NOT NULL DEFAULT 0 CHECK (manual_pause IN (0, 1)),
  latch TEXT NOT NULL DEFAULT '',
  pause_reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO intake_control (id, manual_pause, latch, pause_reason, updated_at)
VALUES ('singleton', 0, '', '', '');

CREATE TABLE IF NOT EXISTS outbound_sends (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'clarify',
  inbound_email_id TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'person'
);

CREATE INDEX IF NOT EXISTS outbound_sends_created ON outbound_sends (created_at);
