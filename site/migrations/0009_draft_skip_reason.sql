-- Why a clarifying draft was not queued for an inbound message.
-- Empty when a draft was queued, or when no automated-sender signal matched.
-- Codes, comma-separated: list_unsubscribe, list_id, auto_submitted,
-- precedence, sender. The header value is not stored.
-- Apply by hand before deploying the Worker that writes this column.
-- A deploy does not apply this file.

ALTER TABLE inbound_emails ADD COLUMN draft_skip_reason TEXT NOT NULL DEFAULT '';
