-- Extra context on a failed booking-form attempt.
-- user_agent is truncated. It is not the form message.
-- token_present is 1 when a Turnstile token was sent and 0 when the field was empty.
-- Turnstile error codes stay in detail. The token itself is not stored.
-- country is a two-letter code. asn is digits. No IP address is stored.
-- Apply by hand before deploying the form that writes these columns.
-- A deploy does not apply this file.

ALTER TABLE submission_failures ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE submission_failures ADD COLUMN token_present INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submission_failures ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE submission_failures ADD COLUMN asn TEXT NOT NULL DEFAULT '';
