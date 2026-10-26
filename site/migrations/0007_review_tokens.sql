-- Short review links for clarifying drafts.
-- Apply by hand before deploying the review-page change. A link is one row.
-- Opening it does not send. used_at is set when Approve or Deny starts.
-- It is cleared if that action does not finish, so a failed send can be retried.
-- The id is an unguessable token, not a person's address or the message.

CREATE TABLE IF NOT EXISTS review_tokens (
  id TEXT PRIMARY KEY,
  inbound_email_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS review_tokens_email ON review_tokens (inbound_email_id);
