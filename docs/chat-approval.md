# Chat approval

The primary way to approve a clarifying reply is a machine call on the review hostname. The HTML note and the short link at `/r/<id>` stay as the backup. Neither path sends on its own, and a trust score never sends.

The worker is the only sender. Chat does not get the email binding. It asks the worker to send, and the worker sends the stored draft, or the edited text in that request, from `hello@celticcoo.ca`.

## Set the token

Do this yourself. Do not put the value in the repo, a commit, a screenshot, or a chat.

```bash
openssl rand -hex 32
```

Use a different value from `REVIEW_SECRET`. Either:

- GitHub → Settings → Secrets and variables → Actions → Secrets → `APPROVAL_API_TOKEN`, then deploy `celticcoo-inbound`. The workflow copies it into the Worker secret of the same name when it is 16 to 200 characters and has no spaces.
- Or, from `workers/inbound`, `npx wrangler secret put APPROVAL_API_TOKEN`.

Until that secret is set, `GET /api/queue` and the approve and deny routes return 503 and send nothing. The review email still works.

## Apply the migration first

Deploy does not apply D1 migrations. Apply `site/migrations/0005_inbound_trust.sql` before the deploy that stores `trust_score`. The same command as the other intake migrations applies every file in `site/migrations/` that is not already on the database. See `docs/inbound-email.md`. It does not print the database id.

`0005` adds `trust_score` and `trust_reasons` on `inbound_emails`, and the `approval_audit` table. Another open branch adds `site/migrations/0004_intake_guard.sql` for a different table. The filenames differ, so both can be applied.

## Calls

All three routes are on the review hostname, for example `https://review.celticcoo.ca`. Send `Authorization: Bearer <APPROVAL_API_TOKEN>`. The compare hashes both values and then compares the digests, so it does not stop early on a shorter token.

There is no browser session. A missing or wrong token is 401. More than 60 calls in 60 seconds is 429. Each call writes one `approval_audit` row: the time, the action, the inbound id, and a short outcome code. The actor is `chat` when the token matched, and `rejected` when it did not. The row does not contain the message, the draft, or the token.

`GET /api/queue` lists up to 20 drafts waiting for approval, oldest first. Each item has `id`, `category`, `trust_score`, `trust_reasons`, `sender_display`, `subject`, `excerpt`, and `draft`. This call does not send. `GET` on an approve or deny URL does not send either. It is 405.

`POST /api/drafts/<id>/approve` sends the stored draft. A JSON body `{ "text": "..." }` sends that text instead, after the same checks as the review page: not empty, at most 8000 characters, and no email address or phone number left in the reply. The first successful approve sends once. A later approve for the same id returns `already_sent` and does not send again. A failed send leaves the draft retryable.

`POST /api/drafts/<id>/deny` discards the draft and sends nothing. A later deny returns `already_denied`.

The id is the `inbound_emails` id from the queue, not the short link id. The short link still works as the backup. If chat has already sent the reply, opening the link shows that it was sent and does not send it again.

## Trust score

The score is computed in the inbound worker and stored on the row. It is advisory. `scoreTrust` returns `autoSend: false` on every result, and the worker does not branch on the number to send.

The module is `shared/trust/`. The Celtic Coo weights, seasons, and phrase groups are `shared/trust/sites/celticcoo.js`. Another site copies the directory, adds its own pack, and passes signals in. See `shared/trust/README.md`.

| Signal | Effect |
|---|---|
| SPF, DKIM, DMARC | Parsed from the last `Authentication-Results` block. Pass raises the score. Fail lowers it. A missing result is `none`, which is a small penalty. |
| Sender history | Prior rows for the same reply address, or the envelope sender when there is no reply address. Approved replies raise the score, with a cap. Denials lower it, with a cap. A sender with no denials and at least one earlier message gets a small bonus. |
| Classifier | Source is `ai`, `rules`, or `ai_failed`. High confidence from the model helps. A clear rules result helps less. `ai_failed` means the classifier did not get a usable model result. Low confidence and a spam category lower the score. |
| Model flag check | A separate Workers AI call flags spam, phishing, and prompt injection. It does not write a reply. If the binding is missing, the call throws, or the JSON is not the schema, the score is capped at 20 and the reason code is `ai_check_failed`. |
| Lexicon | Phrase groups in the site pack: legitimate event and booking words, spam words, and prompt-injection words. Each phrase counts once. |
| Breaker | If the `intake_control` row is paused or latched, the score is capped at 10 and the reason is `guard_paused`. A missing table is `guard_unavailable` and does not by itself zero the score. |
| Bulk and seasonal holds | Five or more earlier messages from the same sender in 24 hours records `bulk_hold`. A date inside Hogmanay, Burns Night, Highland Games season, or St Andrew's, in `America/Edmonton`, records `seasonal_window`. That volume during a season also records `seasonal_hold`. These are flags for the person reading the queue. They are not a kill switch. |

Reason codes are JSON on the row. They are codes and weights, not a copy of the message.
