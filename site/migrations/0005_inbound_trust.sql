-- Advisory trust score for one inbound message, and the chat approval audit.
-- Apply by hand before deploying the worker that reads these columns.
-- trust_score is 0 to 100. It never authorizes a send.
-- trust_reasons is a JSON array of reason codes. It is not the message.
-- approval_audit records the chat action. It does not store the message,
-- the draft, or the bearer token. actor is chat when the token matched.

ALTER TABLE inbound_emails ADD COLUMN trust_score INTEGER NOT NULL DEFAULT 0
  CHECK (trust_score >= 0 AND trust_score <= 100);
ALTER TABLE inbound_emails ADD COLUMN trust_reasons TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS approval_audit (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  inbound_email_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS approval_audit_created ON approval_audit (created_at);
