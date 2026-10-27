-- Adult confirmation and optional performer head counts on a booking request.
-- Apply by hand to the live intake database before deploying the form
-- that writes these columns. A deploy does not apply this file.
-- adult_confirm is 1 when the sender ticked the box, and 0 on older rows.
-- performer_counts_json is an object of line id to a whole number, plus
-- otherNote when that line is used. "{}" means the lines were left blank.
-- The note is short text the sender typed. Do not copy it into git.

ALTER TABLE submissions ADD COLUMN adult_confirm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE submissions ADD COLUMN performer_counts_json TEXT NOT NULL DEFAULT '{}';
