# Exhibitor and vendor invitations

An event organizer sometimes writes to `hello@celticcoo.ca` to invite The Celtic Coo to exhibit or vend: a Games vendor pack, a market stall, a booth with a fee and a move-in time. The inbound Worker (`workers/inbound/`, `celticcoo-inbound`) labels that mail `exhibitor_invitation`, keeps the details in a private table, and drafts Hemingway's reply for a person to approve. There is no second Worker and no new routing rule.

This is the other direction from a maker or shop asking to sell through The Celtic Coo, join a directory, or take space at an event Coo runs. Those notes are not this label.

## Decisions (Russell, 14 Nov 2026)

| Question | Decision |
|---|---|
| First reply | Hemingway's final vendor-call reply. It thanks the organizer, offers a free listing of their call for vendors on the event's Coo page, and asks for the missing details. |
| Auto-send | `EXHIBITOR_AUTO_SEND` stays `off`. Every reply is approved by a person, in chat or on the review page, for at least the first week. Turning it `on` is a separate yes from Russell, then a redeploy. |
| Queue owner | Akindo (SHCEO) watches the review queue for these rows. |
| "Interested" | The row becomes a Trello card on Steward's list. The hook is built and off (see Trello below). |
| Booth-fee currency | Taken from the event's location. CAD only when the event is in Canada or the place is unclear. Unclear is flagged for review. |
| Vendor and event details | Private table only. Never on the site, in an issue, or in a public doc. |
| Intake domain | Open. See the last section. |

## Detection

Lexicon first, then Workers AI, the same pattern as listings and bookings.

The phrases are in `shared/triage/sites/celticcoo.js`:

- `exhibit-invite` (weight 5): call for vendors or exhibitors, vendor or exhibitor application, vendor package, vendor registration, invitation to exhibit, apply for a booth, vendors wanted, now accepting vendors.
- `exhibit-word` (weight 1.5): booth, stall, vendor, exhibitor, artisan, vendor space, tent space, market stall.
- `exhibit-logistics` (weight 1.5): booth or stall fee, space cost, move-in, set-up time, tear-down, power or electricity, tables and chairs, vendor permit, liability insurance.
- `sell-via-coo` (weight 0): a shop that wants to sell through Coo, stock its products with Coo, join a directory, or get a booth "at your event".

The site pack also has a gate. `exhibitor_invitation` keeps its score only when the note has one invitation or application phrase and one exhibit word or logistics phrase, and no `sell-via-coo` phrase. A lone "vendor", or a booth fee with no invitation, is not enough. Subject matches still count double. The floor is still `minScore` 3.5 and confidence still caps at 0.93.

The model prompt and JSON schema list the category and an `exhibitor` object with public facts only. The body is still fenced as untrusted data. The model is never asked for a name, an email, or a phone number.

The rules-vs-model chooser:

- A rules `exhibitor_invitation` wins when the model says `other`, `event_listing_request`, or `booking_inquiry`. The rules only pick this label after the gate and `minScore`, so it is a clear hit.
- A model `exhibitor_invitation` is dropped for the rules result when the text has no exhibit signal at all, or has a `sell-via-coo` phrase.
- Spam still wins. "Please list our Games" with vendors mentioned stays a listing. "Piper for our event" stays a booking. SEO pitches and list footers stay spam.

## The private record

`site/migrations/0012_exhibitor_invitations.sql` creates `exhibitor_invitations`, keyed by `inbound_email_id`, with the source `message_id`. It holds the field table below, `confidence`, `classifier`, `missing_fields`, `review_flags`, and `status` (`new`, `reviewed`, `replied`, `interested`, `declined`, `discarded`). Retention follows `inbound_emails`: the daily cron counts rows older than 12 months and deletes them only when `RETENTION_PURGE` is `on`.

| Field | Source | Notes |
|---|---|---|
| organizer | From display name | Private. |
| organization | Model or event host | |
| event_name | Model, event title, or subject | |
| event_dates | Model or dates in the note | |
| venue, city, province | Existing place helpers | |
| country | Model or place words | Used for currency. |
| apply_deadline | Line with deadline, apply by, applications close | |
| apply_url | First application link, else first link | Not fetched. |
| setup_times | Line with move-in, load-in, set-up | |
| teardown_times | Line with move-out, tear-down | |
| booth_options | 10x10, booth sizes, table only, tent space | |
| booth_cost | First amount on a fee, cost, booth, or stall line, including a per-unit rate such as /day, per day, /weekend, or per event | Private. |
| currency, currency_source | See below | |
| fees_deposits | Deposit, refund, commission lines | Private. |
| power_tables | Power, electricity, tables, chairs | |
| insurance_permits | Insurance, permit, licence lines | |
| contact_name | Signature line, else display name | Private. |
| contact_email | Reply-To, then From | Private. |
| contact_phone | First phone in the body | Private. |

Public text fields pass through the same contact redaction as issues, so a phone or address in a line does not land in a public-looking field. The contact columns are the only place those live.

`missing_fields` on the inbound row gains four codes for this label: `deadline`, `apply_link`, `booth_cost`, `setup`.

### Currency

1. A currency written in the note (CAD, C$, USD, US$, £, GBP, €, EUR, AUD, NZD) is used as stated. If it clashes with the location, the row is flagged `currency_location_mismatch`.
2. Otherwise the place decides: a Canadian province or "Canada" is CAD, a US state (name, or a two-letter code after a comma) is USD, Scotland, England, Wales, or the UK is GBP, Ireland is EUR, Australia is AUD, New Zealand is NZD.
3. If neither is clear, the currency is CAD, `currency_source` is `default`, and the row is flagged `currency_unclear` for the reviewer. A bare "$" never decides on its own.

### Public use

Booth costs, vendor terms, and contact details are for The Celtic Coo team only. If a vendor call is ever shown on the site, it uses only what the organizer has already published, with a link to their page, or what they send back in answer to the reply and agree to share. No consent is needed for the private table because nothing in it is published.

## Review queue

These rows use the existing review path:

- The draft is stored on the inbound row with `clarify_status = pending_approval` and `clarify_reasons = exhibitor_invitation`, so it shows on `GET /api/queue` and the `/r/<id>` page.
- Each queue item for this label also has an `exhibitor` object: the field table, confidence, classifier, missing fields, review flags, and `queue_owner` (Akindo).
- The review page shows the same table in a "Vendor call details" card above the original message and the draft. The review note to `FORWARD_TO` lists the fields too.
- No GitHub issue is filed for this label.
- `POST /api/exhibitors/<id>/status` with `{"status": "reviewed" | "replied" | "interested" | "declined" | "discarded"}` sets the status. It uses the same bearer token, rate limit, and audit as the draft API. Approving a reply sets `replied`. Denying the draft sets `reviewed`.

## Reply and sending

The reply is Hemingway's final text in `workers/inbound/src/exhibitor.js` (`HEMINGWAY_BODY`), followed by the hello mailbox line and the existing CASL footer (sender, Okotoks PO box, "reply unsubscribe", privacy URL). Edit that text only with Hemingway and Russell.

The reply subject is "Re: " plus the organizer's own subject, so the reply stays in their thread and in the 45-day subject thread here. Hemingway's subject line ("Thanks for your call for vendors") is used only when the original had no subject.

The approved reply is sent with `sendApprovedReply` through the Cloudflare Email Sending binding (`EMAIL`). From and Reply-To are `hello@celticcoo.ca`. It is not sent through Fastmail. `celticcoo.ca` must stay an Email Sending domain, and SPF and DKIM must keep authorizing Cloudflare next to Fastmail. Approved replies now carry `In-Reply-To` and `References` set to the stored Message-ID when it is one well-formed id. Anything else is dropped, so a stored header cannot add lines.

### Safety

- No draft for no-reply, do-not-reply, mailer-daemon, or postmaster senders, or for mail with `List-Id`, `Auto-Submitted`, or bulk, list, or junk precedence. The reason code is stored on `draft_skip_reason`. The private record is still kept.
- A `List-Unsubscribe` header alone does not skip an exhibitor reply draft. Real vendor calls often arrive as newsletters. That header still skips drafts for every other category. `List-Id`, `Auto-Submitted`, precedence, and no-reply senders still skip exhibitor drafts. Drafts still go to approval only. `EXHIBITOR_AUTO_SEND` stays off, and nothing is sent on its own.
- One reply per thread. If an earlier row in the 45-day thread already has a sent or approved reply, or an exhibitor draft still waiting, no new draft is queued and `draft_skip_reason` is `thread_replied`. A follow-up that the classifier calls `other` is read as part of the vendor thread.
- The send lock and `already_sent` still block a double send of the same draft.
- `mail_opt_outs` is honoured. If the list cannot be read, nothing is sent.
- `CLARIFY_DRAFTS=off` stops these drafts too.
- Every exhibitor send, approved or automatic, goes through the send guard (`workers/inbound/src/guard.js`):
  - `intake_control` paused or latched: nothing is sent (`guard_paused`).
  - 40 replies in the last 24 hours in `outbound_sends`: nothing is sent (`outbound_cap`). Every approved reply, of any kind, is now recorded there.
  - Either table missing or unreadable: nothing is sent (`guard_unavailable` or `outbound_unknown`). The guard fails closed.
  - `hold` (a seasonal rush over the adaptive limit) only stops automatic sends. A person can still approve.
  - Volume alone never pauses.
- The chat API cap stays 60 calls a minute. The trust score stays advisory.

### EXHIBITOR_AUTO_SEND

`off` in `workers/inbound/wrangler.jsonc`. While it is off, the email handler never sends to the organizer. If Russell later says yes and it is set to `on` and redeployed, the handler runs the same approval path with mode `auto` right after the review note. Auto mode adds one more stop: `hold` refuses too. Everything in Safety above still applies.

## Trello (Steward's lane)

`workers/inbound/src/trello.js` makes a card when a row is first set to `interested`. It does nothing unless all of these exist:

- `EXHIBITOR_TRELLO` = `on` (a var, `off` in the config today)
- `TRELLO_API_KEY` and `TRELLO_TOKEN`: Worker secrets, not in git
- `TRELLO_LIST_ID`: the id of Steward's list, also a Worker secret, so board and list ids stay out of this public repo

Secrets live on the Worker, not in git, and survive deploys. With all three in place, turning the hook on is one change: set `EXHIBITOR_TRELLO` to `on` in `workers/inbound/wrangler.jsonc` in a pull request, with Russell's yes, and let the merge deploy it. Changing it in the dashboard alone would be overwritten by the next deploy.

The card has the event name, dates, place, apply-by date, application link, and the intake row id. It has no organizer name, email, phone, or booth cost.

## Deploy order

Merging to `main` deploys the site and this Worker. Apply the migrations first, by hand, against `celticcoo-intake`, with a Time Travel bookmark taken first:

1. `site/migrations/0011_exhibitor_category.sql`: rebuilds `inbound_emails` with `exhibitor_invitation` in the category check. Every row and column is copied, and the three indexes are recreated.
2. `site/migrations/0012_exhibitor_invitations.sql`: the private table.
3. `site/migrations/0013_intake_control.sql`: the kill-switch row and `outbound_sends`. Without it, exhibitor replies refuse to send. Once it is applied, the trust score reads a real `intake_control` row instead of `guard_unavailable`.

If the Worker is deployed before 0011, an exhibitor invitation is stored as `other` with `classifier_reason` ending in `:exhibitor_fallback`, so no mail is lost. If it is deployed before 0012, the record is skipped and logged as `exhibitor_store_failed`.

## Open item: intake domain

The hello copy rule still needs a non-Fastmail intake domain. Fastmail treats every subdomain of a domain it hosts as local, and both `celticcoo.ca` and `celticcoo.com` are in Fastmail now, so `intake@in.celticcoo.ca` and `intake@in.celticcoo.com` cannot receive the copy. This change does not touch routing, DNS, or the intake address.
