-- Addresses that asked to stop non-transactional mail.
-- The address is stored. The message is not.
-- Do not delete a row before 60 days. The retention cron does not delete this
-- table, so a stop keeps suppressing mail after that minimum.

CREATE TABLE mail_opt_outs (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'reply'
);
