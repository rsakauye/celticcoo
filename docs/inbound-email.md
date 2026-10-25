# Inbound mail for hello@celticcoo.ca

Mail to `hello@celticcoo.ca` is forwarded today by Cloudflare Email Routing to the owner's inbox. The Worker in `workers/inbound/` (`celticcoo-inbound`) can take that job: it forwards a copy first, then stores the message, classifies it, and opens a GitHub issue for an event listing or a correction.

Nothing in this repository changes the live routing rule. Deploying the Worker does not point `hello@` at it. Switch the rule only after the steps below, and only when you want to.

The Worker's Wrangler config has no `addresses` list. Wrangler would otherwise create or take over the Email Routing rule on deploy. Leaving it out keeps the current forward-to-Gmail rule in place.

## What the Worker does

1. Forwards the message to `FORWARD_TO` before it parses, stores, or classifies. That address is a verified Email Routing destination. It is not in the repo.
2. If that forward does not happen, the handler throws after trying to store the row. The failure is in the Workers logs, and the sending server can retry the delivery. Do not point the routing rule here until `FORWARD_TO` is set. A message the platform marks as not forwardable is stored and the handler returns, because another attempt will not make it forwardable.
3. Parses the sender, subject, date, and plain-text body. Attachment bytes are not stored. A note of the count and content types is. The raw message is capped at 256 KB before parsing.
4. Stores a row in the existing D1 database `celticcoo-intake`, table `inbound_emails`.
5. Classifies it as `event_listing_request`, `booking_inquiry`, `correction_or_update`, `partnership_or_press`, `spam`, or `other`. Workers AI (`@cf/meta/llama-3.1-8b-instruct`, JSON mode) does this when the binding works. Otherwise a rules fallback does. If the model and a clear rules match disagree about opening or suppressing an issue, the rules win.
6. For `event_listing_request` and `correction_or_update`, opens an issue in `rsakauye/celticcoo` with the label `inbound:event-request` or `inbound:correction`. The issue has the D1 row id, a short summary, and public event fields (title, host, date, city, province, venue, URL). It does not include the sender's email, phone, or message body.
7. Does not fetch any URL from the email, does not publish an event, and does not reply. `ACK_REPLIES` is `off` in `workers/inbound/wrangler.jsonc`. A reply is sent only if that value is changed to `on` and the Worker is redeployed.

Only `hello@celticcoo.ca`, including plus-addresses such as `hello+events@celticcoo.ca`, is stored and classified. Any other recipient is forwarded and then ignored, in case a rule is pointed here by mistake.

The email is untrusted. Instructions inside it are not followed. The model is asked for JSON only, and the result is checked against the category list. A field that is not in that schema is dropped.

## One-time setup

Do these in order. Steps 1–4 can happen before you switch routing. Step 5 is the switch.

### 1. Apply the D1 migration

The database is the same `celticcoo-intake` database as the booking form. The new file is `site/migrations/0002_inbound_emails.sql`. From the repo root, with Wrangler logged in to this Cloudflare account:

```bash
read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
export D1_DATABASE_ID
node scripts/apply-intake-migration.mjs
unset D1_DATABASE_ID
```

That applies every migration in `site/migrations/` that is not already on the database. If `0001_intake.sql` is already applied, this adds `inbound_emails` only. The command does not print the database id. Do not commit the id.

This repo's GitHub Actions workflow does not apply migrations.

### 2. Set the secrets and the database id

Names only. Do not put the values in the repo, a commit, or a chat.

GitHub → Settings → Secrets and variables → Actions → Secrets:

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Already used by the site deploy. Needs Workers Scripts:Edit, which the mailer deploy already needs. |
| `CLOUDFLARE_ACCOUNT_ID` | Already used by the site deploy. |
| `D1_DATABASE_ID` | Already used by the booking intake. The UUID from `wrangler d1 create celticcoo-intake`. |
| `FORWARD_TO` | The verified Email Routing destination that should keep receiving a copy. This is the inbox `hello@` forwards to today. The same address may already be the `BOOKING_TO` secret. Set `FORWARD_TO` itself. Do not assume the workflow copies `BOOKING_TO`. |
| `INBOUND_GITHUB_TOKEN` | Optional. A fine-grained personal access token, copied into the Worker secret `GITHUB_TOKEN` on deploy. Without it the Worker still forwards and logs. It does not open issues. |

`GITHUB_TOKEN` is the name of the **Worker** secret. GitHub Actions already reserves that name, so the Actions secret is `INBOUND_GITHUB_TOKEN`.

Token permission, and nothing broader:

- Fine-grained token, not a classic `repo` token.
- Resource owner: the account that owns the repo.
- Repository access: only `rsakauye/celticcoo`.
- Repository permissions: **Issues: Read and write**.
- Do not grant Contents, Administration, Pull requests, or Workflows. GitHub adds read-only Metadata on its own.

That permission lets the Worker create the labels `inbound:event-request` and `inbound:correction` and open issues. It cannot push code.

You can set the Worker secret by hand instead of storing the token in Actions:

```bash
cd workers/inbound
npx wrangler secret put GITHUB_TOKEN
```

Paste the token when prompted. A later deploy keeps an existing Worker secret if `INBOUND_GITHUB_TOKEN` is empty.

`FORWARD_TO` is a Worker var, not a secret on Cloudflare, same as `BOOKING_TO` on the mailer. It is still a GitHub secret so the address stays out of the repo. Every deploy of this Worker must pass `--var FORWARD_TO:...`. Wrangler drops a var that the config does not name when a later deploy omits it.

### 3. Deploy the Worker

Push to `main`, or run the "Build & deploy site" workflow by hand. The `inbound-email` job runs the tests, then deploys only when `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FORWARD_TO`, and `D1_DATABASE_ID` are all set. If any of those is missing, the job logs `Skipping celticcoo-inbound deploy` and exits successfully. The Pages deploy is a separate job and is unchanged.

The daily scheduled rebuild does not redeploy this Worker.

To deploy once from your own machine, without writing the database id into the committed config:

```bash
read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
read -rsp 'Forward to: ' FORWARD_TO; echo
export D1_DATABASE_ID FORWARD_TO
node scripts/prepare-inbound-config.mjs workers/inbound/wrangler.jsonc workers/inbound/.wrangler-deploy.jsonc
cd workers/inbound
npx wrangler deploy --config .wrangler-deploy.jsonc --var "FORWARD_TO:${FORWARD_TO}"
rm -f .wrangler-deploy.jsonc
unset D1_DATABASE_ID FORWARD_TO
```

`.wrangler-deploy.jsonc` is gitignored. Confirm `celticcoo-inbound` exists in the Workers list. Do not switch routing yet. Send a test message only after step 5, or it will still follow the old rule.

Workers AI is a binding. There is no AI token to paste. If the account cannot run the model, the Worker uses the rules fallback and still forwards. The model id is the `AI_MODEL` var. JSON mode for this model is documented by Cloudflare at [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

### 4. Read a row without publishing it

```bash
read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
export D1_DATABASE_ID
node scripts/intake-d1.mjs execute --command "SELECT id, category, confidence, classifier, forward_status, issue_status, issue_url, created_at FROM inbound_emails ORDER BY created_at DESC LIMIT 20;"
unset D1_DATABASE_ID
```

Selecting `envelope_from`, `from_header`, `reply_to`, `subject`, `text_body`, or `summary` can print personal data on your machine. Don't paste that output into chat, a commit, an issue, or a log.

`forward_status` is `sent`, `failed`, or `skipped`. `issue_status` is `skipped`, `filed`, or `failed`. Actionable mail is the GitHub issue. The other categories stay in D1 only.

### 5. Switch the routing rule

Do this last, after a deploy with `FORWARD_TO` set. `FORWARD_TO` must already be a verified destination address. The inbox that receives `hello@` today is already verified.

1. In the Cloudflare dashboard, go to **Compute → Email Service → Email Routing → Routing rules** for `celticcoo.ca`.
2. Edit the rule whose address is `hello` (the address `hello@celticcoo.ca`).
3. Change the action from **Send to an email** to **Send to a Worker**.
4. Choose `celticcoo-inbound`.
5. Save.

There must be only one rule for that address. The dashboard uses the first matching rule.

Send a message to `hello@celticcoo.ca` from a different account than the destination. Confirm the destination inbox still gets a copy, and that a row exists with the query in step 4. For a listing request, confirm the GitHub issue has no sender address and no phone number.

Logs are Workers logs for `celticcoo-inbound`. They record the category and the row id, not the body or the sender.

## Turn acknowledgement replies on

Leave this off until you want a one-line receipt. The receipt does not quote the inbound message.

1. In `workers/inbound/wrangler.jsonc`, set `ACK_REPLIES` to `"on"`.
2. Deploy the Worker again.

The next deploy from git uses the value in that file. A dashboard edit is overwritten by the next deploy. Replies use `message.reply` on the inbound message. The Worker has no `send_email` binding, so it cannot send to an arbitrary address.

Automated mail (`Auto-Submitted`, list mail, `noreply`, `mailer-daemon`) is not answered, even when the flag is on.

## Roll back

1. In **Email Routing → Routing rules**, edit `hello` again.
2. Set the action back to **Send to an email**.
3. Choose the same verified destination you put in `FORWARD_TO`.
4. Save.

New mail goes straight to that inbox again. The Worker can stay deployed; it receives nothing until a rule points at it. Rows already in `inbound_emails` stay. Do not delete the `celticcoo-intake` database to undo this. Booking requests live in that database too.

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

The tests cover MIME parsing, the rules fallback, issue-body redaction, and the forward-first behaviour. Cloudflare bindings are mocked. They do not call Workers AI, GitHub, or Email Routing.
