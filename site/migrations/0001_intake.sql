-- Private booking intake. Personal data belongs in submissions only.
-- submission_failures stores a reason code and a short machine detail
-- (field names or siteverify error codes), never the message, name, email, or phone.
-- status is new, flagged, or handled. handled is set by a person after follow-up.
-- email_status records the optional notice: pending, sent, failed, or skipped.

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'flagged', 'handled')),
  risk_flags TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  requester_type TEXT NOT NULL,
  request_type TEXT NOT NULL,
  events_json TEXT NOT NULL,
  custom_event_json TEXT,
  performers_json TEXT NOT NULL,
  performer_other TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  budget TEXT NOT NULL DEFAULT '',
  under18 INTEGER NOT NULL DEFAULT 0,
  guardian_confirm INTEGER NOT NULL DEFAULT 0,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed', 'skipped')),
  source TEXT NOT NULL DEFAULT 'book'
);

CREATE INDEX idx_submissions_status_created ON submissions (status, created_at);

CREATE TABLE submission_failures (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'book'
);

CREATE INDEX idx_submission_failures_created ON submission_failures (created_at);
