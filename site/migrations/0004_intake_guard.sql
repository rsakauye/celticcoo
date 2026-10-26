-- Intake guard: one manual/latched switch, a daily outbound counter, and a cached limit.
-- Apply by hand before deploying the cutoff. The Workers keep working if this
-- table is missing: they allow mail through and the /cutoff route reports
-- guard_not_ready.
--
-- auth_spf / auth_dkim and submissions.client_hash are optional. The code
-- ignores a missing column. Per-IP and historical SPF checks need them.
-- client_hash is a short hash, not the raw IP. Do not add the IP itself.

CREATE TABLE IF NOT EXISTS intake_control (
  id TEXT PRIMARY KEY,
  manual_pause INTEGER NOT NULL DEFAULT 0,
  latch TEXT NOT NULL DEFAULT '',
  pause_reason TEXT NOT NULL DEFAULT '',
  paused_until TEXT NOT NULL DEFAULT '',
  alerted_at TEXT NOT NULL DEFAULT '',
  outbound_day TEXT NOT NULL DEFAULT '',
  outbound_count INTEGER NOT NULL DEFAULT 0,
  limit_per_day INTEGER NOT NULL DEFAULT 0,
  limit_source TEXT NOT NULL DEFAULT '',
  limit_season TEXT NOT NULL DEFAULT '',
  limit_computed_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

INSERT INTO intake_control (id, updated_at)
VALUES ('singleton', '')
ON CONFLICT(id) DO NOTHING;

ALTER TABLE inbound_emails ADD COLUMN auth_spf TEXT NOT NULL DEFAULT '';
ALTER TABLE inbound_emails ADD COLUMN auth_dkim TEXT NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN client_hash TEXT NOT NULL DEFAULT '';
