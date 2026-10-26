# Emergency cutoff

One switch for the booking form and for mail to the public hello address. It lives in the private D1 database `celticcoo-intake`, table `intake_control`, row `singleton`. There is no KV namespace, no new secret, and no GitHub Actions workflow. The repo is public: this document, the alerts, and GitHub issues do not contain message bodies, sender addresses, or phone numbers.

Apply `site/migrations/0004_intake_guard.sql` before you depend on the switch. `scripts/apply-intake-migration.mjs` applies every file in `site/migrations/` when `D1_DATABASE_ID` is set in the environment. Until that table exists, both channels stay open (`guard_unavailable`) and `GET /cutoff` returns 503 `guard_not_ready`. A deploy by itself does not black-hole the mailbox.

## What you are looking at

A legit organizer is one consistent sender, or one organization, with distinct event details. One Highland Games asking for several bands, or a series of Burns Suppers, is a bulk organizer request. The guard stores it and flags it for review. It does not send the usual notice, and it does not trip the kill switch.

Seasonal traffic uses the same hold. The calendar is America/Edmonton: Hogmanay 27 December–4 January (×3), Burns Night 10–31 January (×4), Highland Games 1 April–31 August (×3), St Andrew's 15–30 November (×3). Other weeks use ×3 as well (`offSeasonMultiplier`). The baseline is the same weekday 364 days ago when that count is above zero, otherwise the mean of the previous 28 days, including zeros. The result is clamped between 8 and 80 messages a day across the form and the mailbox together. The limit is cached on the control row for six hours.

These are holds, not pauses:

| Reason | Meaning |
|---|---|
| `bulk_organizer` | One sender or organization, distinct dates, places, or acts. |
| `over_seasonal` | Today's count is above the adaptive daily limit. |
| `over_hourly` | The last hour is above about one tenth of the daily limit, clamped between 6 and 24. |
| `sender_burst` | One sender is over 8 messages in the last hour and the burst is not already a bulk organizer. |
| `ip_burst` | One form client is over 10 posts in the last hour. The stored value is an 8-byte hash, not the raw IP. |

A hold clears by itself as the window moves. Nothing stays latched.

These pause, and they stay paused until you clear the switch:

| Reason | Meaning |
|---|---|
| `manual` | You turned the switch on. |
| `abuse` | Rotating senders, the same payload repeated, gibberish, several links in most items, failed SPF or DKIM, or a run of failed Turnstile checks. |
| `outbound_cap` | Outbound mail for the local day has reached 40. The alert itself is not counted. |

`paused_until` is unused. There is no automatic cooldown timer. Abuse and the cost cap set `latch` to `severe`. Clearing the switch is a manual reset, not a wait.

Volume alone never pauses. A quiet site that suddenly receives a real festival's lineup is held, not dropped.

## While the switch is paused

The booking form returns 503. The HTML page says the form is temporarily unavailable and names the public destination address from the booking config. The JSON body is `{ "ok": false, "code": "paused" }`. The form does not store the visitor's answers. It writes one `submission_failures` row with `reason` `paused` and a short reason code in `detail`.

Inbound mail is still written to `inbound_emails`, so a delivery is not silently lost. That row is private to D1. The Worker does not forward a copy, does not call Workers AI, does not draft a reply, does not send a review note, and does not open a GitHub issue. `classifier_reason` is `paused:<reason>`. Email Routing is not asked to retry: the handler does not throw for this case.

A hold is softer. The form stores the submission, sets status `flagged`, adds a flag `held_<reason>`, and does not send the notice. Inbound mail is still forwarded to the operator, classified with the rules only, and stored with `classifier_reason` `held:<reason>`. It does not open an issue and it does not send a draft or an acknowledgement.

GitHub issues are unchanged on the normal path: a listing or a correction still gets the row id, a redacted summary, and the public event fields. Hold and pause do not file an issue. Do not add a path that posts the inbound body, the sender address, or a phone number.

## One alert

The first pause or hold in a window sends one note. Inbound sends it to `FORWARD_TO`. The form sends it through the existing mailer to `BOOKING_TO`, because Pages has no `FORWARD_TO`. Both channels share `alerted_at`, so the second channel stays quiet for six hours (`GUARD_ALERT_DEBOUNCE_MINUTES`). The note is fixed text: channel, action, and reason code. It does not quote the message that tripped it.

A later request while the switch is already latched does not send another note.

## How to flip it

Any one of these is enough. You do not need a code deploy.

**D1 console.** Pause:

```sql
UPDATE intake_control
SET manual_pause = 1, latch = 'manual', pause_reason = 'manual', paused_until = '', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'singleton';
```

Resume:

```sql
UPDATE intake_control
SET manual_pause = 0, latch = '', pause_reason = '', paused_until = '', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'singleton';
```

**Wrangler.** From `site/`, with the database id in the environment and not printed:

```bash
npx wrangler d1 execute celticcoo-intake --remote --command "UPDATE intake_control SET manual_pause = 1, latch = 'manual', pause_reason = 'manual', paused_until = '', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'singleton'"
```

Use `manual_pause = 0` and empty `latch` and `pause_reason` to resume. Point `--config` at the same gitignored config the migration script writes if the placeholder id is still in `wrangler.jsonc`.

**Authenticated endpoint.** `POST https://review.celticcoo.ca/cutoff` with `Authorization: Bearer` set to the existing Worker secret `REVIEW_SECRET`, and a body of exactly `{ "paused": true }` or `{ "paused": false }`. `GET` the same path to read `{ "ok", "paused", "reason", "latch" }`. The comparison hashes both values. The response never includes the secret or a message body. Approval links are a different route and still require the HMAC and `confirm=yes`.

Read the secret from the Worker secret store or your password manager when you run curl. Do not paste it into the repo, a GitHub issue, or a commit.

```bash
curl -sS -X POST https://review.celticcoo.ca/cutoff \
  -H "Authorization: Bearer ${REVIEW_SECRET}" \
  -H 'content-type: application/json' \
  -d '{"paused":true}'
```

## If the switch is not enough

These are dashboard steps, outside this repo:

- Cloudflare Under Attack mode on the zone, if the form or the site itself is being flooded.
- A WAF rate limit on `POST /api/book`.
- Pause the Email Routing rule for the public hello address if mail delivery itself is the problem. This Worker has no `addresses` list, so a Worker deploy does not change that rule. Pausing the rule is what stops delivery before the Worker runs. Messages that never arrive are not stored.

The hard pause inside the app is for abuse you can see in the guard, or for the outbound bill. Prefer the hold for a festival week.

## Reset

Resume with any flip method above. That clears `manual_pause`, `latch`, and `pause_reason`. New mail and form posts are classified and sent again, subject to the same hourly and daily holds. The outbound counter resets on the next local day by itself. To zero it the same day:

```sql
UPDATE intake_control
SET outbound_count = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'singleton';
```

## Clean up junk rows

Run deletes in the D1 console. Do not `SELECT` message bodies into a ticket, a chat, or a commit.

Form posts that were only counted while paused:

```sql
DELETE FROM submission_failures
WHERE reason = 'paused' AND created_at >= '2026-01-01T00:00:00.000Z';
```

Inbound rows stored during a pause, after you have decided they are junk:

```sql
DELETE FROM inbound_emails
WHERE classifier_reason LIKE 'paused:%' AND created_at >= '2026-01-01T00:00:00.000Z';
```

Held rows are real requests. Read them in the D1 console, then handle them by hand. Change the date window. Do not copy the body out of the database into git.

A repeated-payload attack that was stored before the latch (the messages that caused the pause) uses the same private console. Filter by time. Do not paste those rows into GitHub.

## Defaults you can override

Unset vars keep the site pack. Set a var on the Worker or on the Pages project only when a default is wrong. None of these are secrets.

| Var | Default |
|---|---|
| `GUARD_FLOOR_PER_DAY` | 8 |
| `GUARD_CEILING_PER_DAY` | 80 |
| `GUARD_OFF_SEASON_MULTIPLIER` | 3 |
| `OUTBOUND_DAILY_CAP` | 40 |
| `GUARD_MIN_BURST` | 4 |
| `GUARD_HOURLY_FLOOR` | 6 |
| `GUARD_HOURLY_CEILING` | 24 |
| `GUARD_SENDER_HOURLY` | 8 |
| `GUARD_IP_HOURLY` | 10 |
| `GUARD_ALERT_DEBOUNCE_MINUTES` | 360 |
| `GUARD_HISTORY_CACHE_MINUTES` | 360 |

## Another site

`shared/triage/` is the reusable folder. Copy it, add a site pack, and point a thin adapter at `assessChannel`. UsedGlass should not fork `breaker.js` or `guard.js`. The porting steps are in `shared/triage/README.md`.
