# Free listings for performers and clubs

Performers, bands, clubs, dance schools and lessons groups can list themselves for free on `/submit` (sections `#performers` and `#groups`). Every listing waits for a person. Nothing publishes on its own, and bots never publish.

## Flow

1. **Form.** `/submit#performers` or `/submit#groups` posts to the Pages Function `site/functions/api/listing.js`. Checks, in order: same origin, size, honeypot (`listing_hp`), Turnstile (action `listing`), field rules, the intake kill switch (`intake_control`), and daily caps (3 per email and 60 in total per 24 hours, in `data/listings.json`). Refusals are `submission_failures` rows with source `listing` and a reason code. They hold no name, email, or text.
2. **Pending.** A valid listing is one row in the `listings` table of the private intake database, status `pending`. Public fields go in `public_json`. Private fields (submitter name, email, role, the checkboxes, the Coo's Letter flag) are separate columns.
3. **Queue.** Russell reviews on one screen at `/listings` on the review hostname (inbound Worker). The page needs a signed link (`REVIEW_SECRET`, valid 3 days) and sets a CSRF cookie. Each card shows the public fields, the private submitter details, advisory flags (minor mentioned, teaches children or teens, links in text, payment words, instruction-like text), a duplicate hint (same name, and same name and city, against other listings and against `data/groups_canada.json`), and a format check of each link. Links are not visited.
4. **Steps.** Approve (Listed), Needs info (one question, once), Reject (reason: not Celtic, outside Canada, incomplete, duplicate, minor safety, spam), or Close (removes a listed entry, or ends a needs-info row).
5. **Reply.** Listed and Needs info each store one reply draft (copy in `data/listings.json` under `copy.replies`). It sends only when Russell presses **Send this reply** on the queue page. It goes through the same send guard as every reply from hello@: the kill switch, the 40-a-day outbound cap, the opt-out list, and the placeholder and private-contact checks. **Don't send** discards it.
6. **Public.** `/performers` loads `/api/performers`, which returns listed performers only, public fields only. A performer's booking email is included only when they ticked the box to show it. Booking goes through `/book` by default (`?act=` fills the message box).

Listed clubs do not appear on `/groups` by themselves. That page is the weekly link-checked data file. When a club is listed, the queue card shows the `data/groups_canada.json` row to add in a normal pull request.

## Chat

`GET /api/listings` with the chat bearer token (`APPROVAL_API_TOKEN`) lists the queue without the submitter's name or email. It is read-only. A POST answers 405. Status changes and sends happen only on the signed page.

## Daily cron

The inbound Worker's existing cron (`15 8 * * *` UTC) also:

- closes `needs_info` rows 14 days after the question with no answer (`closed`, reason `no_reply`);
- deletes `rejected` and `closed` rows 90 days after their last change, private fields included, only when `RETENTION_PURGE` is `on` (otherwise it logs a count);
- sends the receipt to new submitters only when `ACK_REPLIES` is `on` (it is `off`), through the send guard;
- emails `FORWARD_TO` a signed queue link when something is waiting, only when `LISTING_DIGEST` is `on`. That var is not in `wrangler.jsonc`, so it is off.

## Images

There are no uploads. The form takes an optional link to a photo or video the performer owns, and the directory shows it as a link, not an embedded image. Real uploads wait for the images work (R2, EXIF strip, CSAM scan, review queue).

## Minors

Individual listings are adults only (18+). There is no under-18 or guardian field. Schools and bands with junior members list under the school or band name, with a crest or logo, and never members' names or photos of minors. The minor-safety reject reason is for anything that breaks that rule.

## Changing fields and copy

`data/listings.json` holds the word cap (`limits.blurbWords`, 50), the link cap, the caps per day, every option list, the reject reasons, and all copy. Copy blocks are marked `source: hemingway` (final) or `source: placeholder` (waiting for Hemingway).

## Live steps (each needs Russell's yes)

1. Apply `site/migrations/0014_listings.sql` to the live intake database (`node scripts/apply-intake-migration.mjs`, or the same `wrangler d1 migrations apply`).
2. Merge, then let the deploy workflow publish the site and the inbound Worker.
3. Set the Worker var `LISTING_DIGEST` to `on` so the daily email to `FORWARD_TO` brings the signed queue link. Without it, the queue page has no way in. Chat can still read the queue through `GET /api/listings`.
4. Optional, later: `ACK_REPLIES` `on` for receipts (also affects mail receipts), and `RETENTION_PURGE` `on` for deletions.
