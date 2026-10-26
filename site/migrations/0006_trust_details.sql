-- Advisory gaps and red flags for one inbound message or booking submission.
-- Apply by hand before deploying the worker or the booking function that writes them.
-- The columns are codes and booleans. They are not a copy of the message.
-- A flag, including a Turnstile pass, never authorizes a send.

ALTER TABLE inbound_emails ADD COLUMN missing_fields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE inbound_emails ADD COLUMN red_flags TEXT NOT NULL DEFAULT '{}';

ALTER TABLE submissions ADD COLUMN trust_score INTEGER NOT NULL DEFAULT 0
  CHECK (trust_score >= 0 AND trust_score <= 100);
ALTER TABLE submissions ADD COLUMN trust_reasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE submissions ADD COLUMN missing_fields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE submissions ADD COLUMN red_flags TEXT NOT NULL DEFAULT '{}';
