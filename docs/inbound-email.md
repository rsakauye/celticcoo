# Inbound mail for hello@celticcoo.ca

`hello@celticcoo.ca` is handled by the Worker in `workers/inbound/` (`celticcoo-inbound`) when the Email Routing rule for that address sends to the Worker. The Worker forwards a copy first, then stores the message, classifies it, and opens a GitHub issue for an event listing or a correction. A vague or incomplete inquiry can also get a clarifying draft. That draft is not sent to the person who wrote in unless you approve it.

This repository does not change the live routing rule. The Wrangler config has no `addresses` list and no `routes` list. Wrangler would otherwise create or take over the Email Routing rule, or replace a hostname you attached in the dashboard. Leaving both out keeps those dashboard settings in place on deploy.

## What the Worker does

1. Forwards the message to `FORWARD_TO` before it parses, stores, or classifies. That address is a verified Email Routing destination. It is not in the repo.
2. If that forward does not happen, the handler throws after trying to store the row. The failure is in the Workers logs, and the sending server can retry the delivery. A message the platform marks as not forwardable is stored and the handler returns, because another attempt will not make it forwardable.
3. Parses the sender, subject, date, and plain-text body. Attachment bytes are not stored. A note of the count and content types is. The raw message is capped at 256 KB before parsing.
4. Stores a row in the existing D1 database `celticcoo-intake`, table `inbound_emails`.
5. Classifies it as `event_listing_request`, `booking_inquiry`, `correction_or_update`, `partnership_or_press`, `spam`, or `other`. Workers AI (`@cf/meta/llama-3.1-8b-instruct`) does this when the binding works. Otherwise a weighted rules fallback does. The phrases, places, and seasons live in `shared/triage/sites/celticcoo.js`. The scorer in `shared/triage/engine.js` does not know the site. If the model and a clear rules match disagree about opening or suppressing an issue, the rules win. An auto-reply or a newsletter question that the rules call `other` also wins, so it does not open an issue. There is no minimum body length. A short note is still sent to the model.
6. For `event_listing_request` and `correction_or_update`, opens an issue in `rsakauye/celticcoo` with the label `inbound:event-request` or `inbound:correction`. The issue has the D1 row id, a short summary, and public event fields (title, host, date, city, province, venue, URL). It does not include the sender's email, phone, or message body. If a clarifying draft exists, the draft text is included. The approval link is not.
7. When `CLARIFY_DRAFTS` is `drafts` (the default), a vague, incomplete, or contradictory inquiry gets a short draft that asks only for what is missing. The draft is stored on the same row with status `pending_approval`. A private review note is sent to `FORWARD_TO` when the email binding is available. Nothing is sent to the original sender until you approve that draft.
8. Does not fetch any URL from the email and does not publish an event. `ACK_REPLIES` is `off`. An automatic receipt is sent only if that value is changed to `on` and the Worker is redeployed. That receipt is separate from clarifying drafts.

Only `hello@celticcoo.ca`, including plus-addresses such as `hello+events@celticcoo.ca`, is stored and classified. Any other recipient is forwarded and then ignored, in case a rule is pointed here by mistake.

The email is untrusted. Instructions inside it are not followed. The model is asked for JSON only, and the result is checked against the category list. A field that is not in that schema is dropped. The clarifying draft is built from fixed questions, not from the model's free text, so the inbound message cannot write the reply.

## Why one live row stayed on the rules classifier

A message stored as row `b0e54ddb-eca8-4072-99f3-c1efb4d60824` had `classifier=rules`, category `other`, and confidence `0.35`. Worker logs showed no AI call and no error. That confidence is the rules score for `other` when no keyword matches. It is not a cutoff that skips the model.

`classifier=rules` means the model result was not kept. The previous code could do that in three ways, and none of them wrote a log line:

- `env.AI.run` was missing or was not a function, so the call was skipped.
- The call threw, including a JSON-mode or schema rejection, and an empty `catch` returned the rules result.
- The call returned text that was not the category schema, and that was treated as "no model result" with no log.

The stored row does not say which of those happened. A direct Workers AI call on the account can succeed and this Worker can still fail, because the Worker was sending `response_format` JSON schema (and previously `temperature: 0`) and then hiding the failure. There is no separate short-body rule. The `0.35` on that row is the old fixed score for `other`. The current scorer uses `0.26` when nothing matches. Both are low on purpose.

The Worker now logs one line, `inbound classify`, with a short `reason`. On a failure it also logs `error_name`, `error_code`, and `error_message`. The message is truncated. Addresses, phone numbers, URLs, secrets, and words copied from the inbound subject or body are removed before the log line is written.

| `reason` | Meaning |
|---|---|
| `ai_ok` | JSON mode returned a usable category. |
| `ai_text` | JSON mode failed or was unusable, and a second call with messages only succeeded. |
| `ai_unavailable` | The AI binding or `run` was missing, or the call failed because `run` was not a function. The log also has `binding` and `run` types (`function`, `object`, `missing`). |
| `ai_request` | The call was rejected for JSON mode, schema, temperature, or `max_tokens`. |
| `ai_quota` | Neuron allocation or a paid-plan model refusal (codes 3036 and 5035, or that text). |
| `ai_capacity` | Workers AI was out of capacity or rate limited (code 3040 or HTTP 429). |
| `ai_timeout` | The call timed out or was aborted. |
| `ai_model` | The model id was not found (code 6002 or that text). |
| `ai_unparsed` | The model replied, but not with a category in the allowed list. |
| `ai_failed` | The call threw for another reason. The sanitized message is still on the log line. |
| `rules_override` | The model answered, and a clear rules match overrode it. |

The same code is stored on the row as `classifier_reason`. A failure appends a short slug, for example `ai_quota:3036_daily_free_allocation`. JSON mode is still tried first. `additionalProperties` is still not sent in the schema. If that attempt throws or does not parse, the Worker tries once more with only the messages, which is the shape of a plain Workers AI call, and logs which path worked.

### What failed on 26 October 2026

Two rows stored at 04:55 UTC that day have `classifier=rules` and `classifier_reason=ai_failed`. They are one second apart: one `booking_inquiry` at confidence `0.8`, and one `other` at confidence `0.35`. The Workers log for both is only `{ "message": "inbound classify", "classifier": "rules", "reason": "ai_failed" }`. The traces finished in about two seconds with outcome ok and no trace error. Both the JSON-schema attempt and the plain-messages attempt failed. The thrown text did not contain the words the old code used for `ai_request` (JSON mode, schema, `response_format`, temperature, `max_tokens`), and `run` was a function, or the reason would have been `ai_unavailable`.

The 25 October 14:35 UTC row is the earlier case. Its empty `classifier_reason` is the code from before this logging existed. The Worker script's `modified_on` is 16:49 UTC that day, after that row was written.

Checks run on the same account after the Workers Paid upgrade (the upgrade was about 04:45 UTC, the failures at 04:55):

- The model catalog does not list `@cf/meta/llama-3.1-8b-instruct`. A nearby id is `@cf/meta/llama-3.1-8b-instruct-fp8`.
- `GET /ai/models/schema` for the configured id returns HTTP 404, code 6002, "Model schema not found".
- `POST /ai/run/@cf/meta/llama-3.1-8b-instruct` with the Worker's schema returns HTTP 200 and a valid category object. A plain messages call also returns HTTP 200.

The model id and the schema are valid now. The exact 04:55 error text was discarded, so it cannot be quoted. The plausible cause is a Workers AI error whose message did not contain the schema keywords: the daily neuron allocation (code 3036) or a capacity response (3040 or 429), in the minutes after the paid-plan upgrade before the new entitlement applied. Both messages failed the same way, so it was not a one-off timeout. No Wrangler var change is required.

If that legacy model id later returns model-not-found, set the `AI_MODEL` var to `@cf/meta/llama-3.1-8b-instruct-fp8` and keep the schema-then-text order. Do not switch today. A plain call to the fp8 id returned JSON inside a markdown fence, which is a worse default while the current id still runs.

## Rules, lexicon, and the shared module

`shared/triage/` is the site-agnostic piece. `workers/inbound/src/classify.js` is the Celtic Coo adapter: it redacts, calls Workers AI, and maps error text to the reason codes above. Copying the folder to another site is described in `shared/triage/README.md`. There is no package and no extra repo.

The lexicon is `shared/triage/sites/celticcoo.js`. It is static data: Burns Supper / Burns Night / Robbie Burns, ceilidh and céilidh and kaylee, céilí, Highland Games and Highland Gathering, pipe band and pipes and drums, Highland and Irish dance, St Andrew's, Hogmanay, Tartan Day, Gaelic, Canadian provinces and abbreviations, common Alberta towns, venue words (hall, legion, lodge, church, centre), and the common misspellings those phrases already include. Lookup is local. Nothing in that file calls the network.

Scoring sums every match. A subject match counts double. Spam wins a tie with a real request. Quoted lines, a signature after `--`, and "Sent from my…" are dropped before scoring. A marketing footer is scored only as spam. Confidence follows the score and the margin, and a note with no signals stays under `0.4`.

The same folder holds `breaker.js`: a seasonal limit, a legit organizer burst versus abuse, and the allow / hold / pause decision. Burns Night (10–31 January, multiplier 4), St Andrew's (15–30 November), Highland Games (April through August), and Hogmanay (27 December through 4 January) raise a trailing baseline. The baseline is the same week last year when that history exists, otherwise a rolling daily average, then clamped between 8 and 80 messages a day. A burst from one consistent sender with distinct event details is `bulk_organizer` and decides `hold` (store it, do not send, do not trip the kill switch). Rotating senders, a repeated payload, gibberish, several links, failed SPF or DKIM, or failed Turnstile checks decide `pause`. The outbound cap (40 a day in the site pack) also decides `pause`. Volume by itself does not.

This Worker does not call `decideGuard` yet. The emergency cutoff change wires it into the booking form and this Worker. The thresholds already live in the site pack so that change does not fork the scorer.

## Clarifying drafts

`CLARIFY_DRAFTS` in `workers/inbound/wrangler.jsonc` is `drafts`. Any other value except `off` means the same thing. There is no setting that sends a reply by itself. Set it to `off` and redeploy to stop new drafts.

A draft is created for an event listing, correction, or booking that is missing a date, a time, a place, or an event name; for a booking that names no performer; for a date that is already past; for two dates that disagree (a correction that states the old date and the new one is not treated as a contradiction); for a link that is not a normal http(s) URL; for an organizer name that does not appear in the link, unless the link is a known ticket or social host; and for a note classified as `other` or a very short partnership note. A group or society directory listing does not need a date. A newsletter question does not get the generic "unclear" draft. Spam is skipped. Mail from `noreply`, a list, or an auto-reply is skipped, including an out-of-office line in the subject or the first part of the body. An out-of-office line buried under a real request does not hide that request.

The draft status on the row is:

| Status | Meaning |
|---|---|
| `pending_approval` | Stored. Not sent to the sender. |
| `approved` | You approved it, and the send has not finished or did not succeed. Approving again retries the send. |
| `sent` | Sent once from `hello@celticcoo.ca`. Approving again does not send it again. |
| `discarded` | Dropped. Nothing was sent. |

The GitHub issue, when one is opened, includes the draft text and says that it has not been sent. It does not include the approval link. A booking or other note does not open an issue. The private review note covers those.

### Why approval is a signed link, not a GitHub label

A GitHub label or comment would only cover mail that opens an issue, so bookings would be left out. The issue can be read by anyone who can see the repo, so the thing that allows a send cannot be written there. GitHub also does not tell this Worker when a label changes unless a webhook is added, and this Worker has no public route in the repo for that webhook to call.

A signed link in the review note works for every category. The note goes only to `FORWARD_TO`. The token is an HMAC of the row id, the action (`approve` or `discard`), and an expiry seven days out. The secret is `REVIEW_SECRET`. The link is a bearer token until it expires: someone who has that email can approve. The draft itself is only the clarifying questions.

Opening the link does not send. Link scanners in mail gateways request the URL with GET. GET shows the draft and a button. The send happens only on POST when the form includes `confirm=yes` and a valid token. Discard is the same kind of POST and does not send.

The original forward is left unchanged. Adding the draft to that copy would mean rewriting a message that Email Routing is authenticating. The separate review note is the copy you act on.

The approved reply is sent with the Worker's `send_email` binding (`EMAIL`), from `hello@celticcoo.ca`, to the stored reply-to address or otherwise the envelope sender. The binding is unrestricted in Wrangler for the same reason as the booking mailer: the destination is not known at deploy time, and your inbox must not be committed. The code will only send the review note to `FORWARD_TO`, and the approved reply only to that one stored sender. A draft that still contains an email address or a phone number is refused.

## One-time setup

Do these in order. Deploy does not switch Email Routing and does not apply D1 migrations.

### 1. Apply the D1 migration

The database is the same `celticcoo-intake` database as the booking form. `site/migrations/0002_inbound_emails.sql` creates `inbound_emails`. `site/migrations/0003_inbound_clarify.sql` adds the draft columns and `classifier_reason`. From the repo root, with Wrangler logged in to this Cloudflare account:

```bash
read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
export D1_DATABASE_ID
node scripts/apply-intake-migration.mjs
unset D1_DATABASE_ID
```

That applies every migration in `site/migrations/` that is not already on the database. The command does not print the database id. Do not commit the id.

This repo's GitHub Actions workflow does not apply migrations. Until `0003` is applied, new mail will fail to store and the forward will still have been attempted. Apply it before the deploy that contains this code, or immediately after, and accept that mail in that gap is retried by the sender only if the forward itself failed.

### 2. Set the secrets and the database id

Names only. Do not put the values in the repo, a commit, or a chat.

GitHub → Settings → Secrets and variables → Actions → Secrets:

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Already used by the site deploy. Needs Workers Scripts:Edit. |
| `CLOUDFLARE_ACCOUNT_ID` | Already used by the site deploy. |
| `D1_DATABASE_ID` | Already used by the booking intake. The UUID from `wrangler d1 create celticcoo-intake`. |
| `FORWARD_TO` | The verified Email Routing destination that should keep receiving a copy. This is the inbox `hello@` forwards to. The same address may already be the `BOOKING_TO` secret. Set `FORWARD_TO` itself. |
| `INBOUND_GITHUB_TOKEN` | Optional. A fine-grained personal access token, copied into the Worker secret `GITHUB_TOKEN` on deploy. Without it the Worker still forwards and logs. It does not open issues. |
| `REVIEW_SECRET` | Optional until you want approval links. A random string, 16 to 200 characters, no spaces. `openssl rand -hex 32` is enough. Copied into the Worker secret `REVIEW_SECRET`. It is not a var. |

GitHub → Settings → Secrets and variables → Actions → Variables:

| Variable | What it is |
|---|---|
| `REVIEW_BASE_URL` | Optional. The https origin of this Worker, with no path, such as `https://review.celticcoo.ca`. Every inbound deploy passes it when it matches that shape. If a later deploy omits it, Wrangler drops the var, the same way it drops `FORWARD_TO`. |
| `INBOUND_ISSUES_REPO` | Optional, and unset on purpose. `owner/repo` of a **private** repository that is not `rsakauye/celticcoo`. Inbound issues stay off until this is set and `INBOUND_GITHUB_TOKEN` is set. The Worker also refuses to file if GitHub says the repo is not private. Do not point it at the public product repo. |

`GITHUB_TOKEN` and `REVIEW_SECRET` are Worker secret names. GitHub Actions already reserves `GITHUB_TOKEN`, so the Actions secret for issues is `INBOUND_GITHUB_TOKEN`. A deploy uploads whichever of those two is set and leaves other Worker secrets in place.

Token permission for `INBOUND_GITHUB_TOKEN`, and nothing broader:

- Fine-grained token, not a classic `repo` token.
- Resource owner: the account that owns the repo.
- Repository access: only the private repository named by `INBOUND_ISSUES_REPO`. Do not grant this token access to the public product repo.
- Repository permissions: **Issues: Read and write**.
- Do not grant Contents, Administration, Pull requests, or Workflows. GitHub adds read-only Metadata on its own.

You can set the Worker secrets by hand instead:

```bash
cd workers/inbound
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put REVIEW_SECRET
```

`FORWARD_TO` is a Worker var, not a Cloudflare secret, same as `BOOKING_TO` on the mailer. It is still a GitHub secret so the address stays out of the repo. Every deploy of this Worker must pass `--var FORWARD_TO:...`.

### 3. Give the Worker a hostname for approval links

Do this in the dashboard. Do not add a `routes` key to `wrangler.jsonc`. A routes key in that file would replace dashboard routes on the next deploy.

1. Workers & Pages → `celticcoo-inbound` → Settings → Domains & Routes.
2. Add a custom domain or route on a hostname that is not the Pages site. `celticcoo.ca` and `www.celticcoo.ca` belong to Pages. `review.celticcoo.ca` does not.
3. Set the Actions variable `REVIEW_BASE_URL` to that origin, for example `https://review.celticcoo.ca`.

Until both `REVIEW_SECRET` and `REVIEW_BASE_URL` are set, drafts are still stored. The review note says the links are not configured. Nothing is sent to the original sender.

Listings and corrections are not filed as GitHub issues unless `INBOUND_GITHUB_TOKEN` and `INBOUND_ISSUES_REPO` are both set. The repo must be private. Leave `INBOUND_ISSUES_REPO` unset. Issues stay off.

The daily cron counts old booking rows, inbound emails, and failed form attempts. It does not delete them. See `docs/retention.md`. Do not set `RETENTION_PURGE`.

### 4. Let hello@ send mail

The Worker has a `send_email` binding named `EMAIL`.

- The review note goes to `FORWARD_TO`. That address is already a verified destination, so this part works with Email Routing alone.
- The approved reply goes to the person who wrote in. That needs Email Sending on the Workers Paid plan, with `celticcoo.ca` onboarded as a sending domain, so `hello@celticcoo.ca` can be the From address. Onboard the domain under **Compute → Email Service → Email Sending** if it is not already. The booking mailer already sends as `bookings@celticcoo.ca` once the domain is onboarded; this Worker sends as `hello@celticcoo.ca`.

If sending the approved reply fails, the row stays `approved` and the approval page says it was not sent. The same link can be used again. The sender does not get a partial or automatic reply.

### 5. Deploy the Worker

Push to `main`, or run the "Build & deploy site" workflow by hand. The `inbound-email` job runs the tests, then deploys only when `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FORWARD_TO`, and `D1_DATABASE_ID` are all set. If any of those is missing, the job logs `Skipping celticcoo-inbound deploy` and exits successfully. The Pages deploy is a separate job and is unchanged.

The daily scheduled rebuild does not redeploy this Worker.

To deploy once from your own machine, without writing the database id into the committed config:

```bash
read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
read -rsp 'Forward to: ' FORWARD_TO; echo
read -rsp 'Review origin (or leave empty): ' REVIEW_BASE_URL; echo
export D1_DATABASE_ID FORWARD_TO REVIEW_BASE_URL
node scripts/prepare-inbound-config.mjs workers/inbound/wrangler.jsonc workers/inbound/.wrangler-deploy.jsonc
cd workers/inbound
# Pass REVIEW_BASE_URL only when it is an https origin with no path.
npx wrangler deploy --config .wrangler-deploy.jsonc --var "FORWARD_TO:${FORWARD_TO}"
rm -f .wrangler-deploy.jsonc
unset D1_DATABASE_ID FORWARD_TO REVIEW_BASE_URL
```

`.wrangler-deploy.jsonc` is gitignored. Add `--var "REVIEW_BASE_URL:https://review.celticcoo.ca"` on that deploy when the hostname exists. Set `REVIEW_SECRET` with `wrangler secret put` before relying on the links. Secrets are not deleted by a deploy that does not mention them.

Workers AI is a binding. There is no AI token to paste. If the account cannot run the model, the Worker uses the rules fallback, logs the reason, and still forwards. The model id is the `AI_MODEL` var.

### 6. Read a row without publishing it

```bash
read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
export D1_DATABASE_ID
node scripts/intake-d1.mjs execute --command "SELECT id, category, confidence, classifier, classifier_reason, clarify_status, forward_status, issue_status, issue_url, created_at FROM inbound_emails ORDER BY created_at DESC LIMIT 20;"
unset D1_DATABASE_ID
```

Selecting `envelope_from`, `from_header`, `reply_to`, `subject`, `text_body`, or `summary` can print personal data on your machine. Don't paste that output into chat, a commit, an issue, or a log. `clarify_draft` is the questions, not the inbound message. `classifier_reason` is one of the codes above.

`forward_status` is `sent`, `failed`, or `skipped`. `issue_status` is `skipped`, `filed`, or `failed`. `clarify_status` is empty, `pending_approval`, `approved`, `sent`, or `discarded`.

After the next real message, `classifier_reason` should be `ai_ok` or `ai_text` when the model ran, or a specific failure code when it did not. The Workers log line `inbound classify` has the same reason.

## Turn acknowledgement replies on

Leave this off until you want a one-line receipt. The receipt does not quote the inbound message and is not the clarifying draft.

1. In `workers/inbound/wrangler.jsonc`, set `ACK_REPLIES` to `"on"`.
2. Deploy the Worker again.

The next deploy from git uses the value in that file. A dashboard edit is overwritten by the next deploy. Receipts use `message.reply` on the inbound message. They do not use the approval link and they do not wait for `REVIEW_SECRET`.

Automated mail (`Auto-Submitted`, list mail, `noreply`, `mailer-daemon`) is not answered, even when the flag is on. That mail also does not get a clarifying draft.

## Roll back

1. In **Email Routing → Routing rules**, edit `hello` again.
2. Set the action back to **Send to an email**.
3. Choose the same verified destination you put in `FORWARD_TO`.
4. Save.

New mail goes straight to that inbox again. The Worker can stay deployed; it receives nothing until a rule points at it. Rows already in `inbound_emails` stay. Do not delete the `celticcoo-intake` database to undo this. Booking requests live in that database too.

To stop new drafts without moving the mailbox, set `CLARIFY_DRAFTS` to `off` and redeploy. Drafts already waiting can still be approved until you remove `REVIEW_SECRET` or the review hostname. To stop sends and keep drafts, remove the review hostname. A sent reply cannot be unsent from this Worker.

To remove the Worker after the rule no longer points at it:

```bash
cd workers/inbound
npx wrangler delete --name celticcoo-inbound
```

That does not delete D1, and it does not change DNS.

## Tests

```bash
cd workers/inbound && npm ci && npm test
```

The tests cover MIME parsing, the rules fallback (a synthetic vague note and a synthetic Burns booking, not copies of received mail), the lexicon, the seasonal and bulk-organizer guard, the classifier failure reasons, drafting, approval, issue-body redaction, and the forward-first behaviour. `npm test` also runs `shared/triage/test/`. Cloudflare bindings are mocked. They do not call Workers AI, GitHub, or Email Routing. Fixtures use example.com addresses and made-up names.
