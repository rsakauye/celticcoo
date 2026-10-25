-- Draft clarifying replies for vague inbound mail.
-- clarify_status is empty, pending_approval, approved, sent, or discarded.
-- The draft text asks for missing facts. It is not a copy of the sender's message.
-- classifier_reason is a short code such as ai_ok or ai_unavailable. It is not the email.
-- clarify_lock is an internal send lock. Approval still requires the signed link.

ALTER TABLE inbound_emails ADD COLUMN classifier_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE inbound_emails ADD COLUMN clarify_status TEXT NOT NULL DEFAULT '';
ALTER TABLE inbound_emails ADD COLUMN clarify_draft TEXT NOT NULL DEFAULT '';
ALTER TABLE inbound_emails ADD COLUMN clarify_reasons TEXT NOT NULL DEFAULT '';
ALTER TABLE inbound_emails ADD COLUMN clarify_lock TEXT NOT NULL DEFAULT '';
