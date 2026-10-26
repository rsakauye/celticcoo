# Retention and deletion requests

The inbound Worker has a daily cron (`15 8 * * *` UTC). Each run counts rows that are past the window below and writes a count log. It does not delete anything unless the Worker var `RETENTION_PURGE` is exactly `on`.

That var is not set in `wrangler.jsonc` and the deploy workflow does not pass it. Leave it unset. Do not run a deletion against production from CI or from a laptop script in this repo.

| Rows | When they are eligible | Column |
|---|---|---|
| `submissions` (booking requests) | 12 months | `updated_at` |
| `inbound_emails` | 12 months | `created_at` |
| `submission_failures` | 90 days | `created_at` |

`submission_failures` stores a reason code only. It has no name, email, or message. The 90-day count is what removes those codes once deletion is turned on.

The count log is JSON with `message`, `mode` (`dry_run` or `delete`), and the three counts. It does not include row contents.

## Deletion request

Handle a deletion request within 30 days of receiving it.

1. Read the request from the privacy contact. Do not copy the person's message, name, email, or phone into git, a GitHub issue, or this file.
2. Find the matching row in the private database by its id.
3. Delete that `submissions` row and any `inbound_emails` row for the same request.
4. Keep a private note of the date the deletion was finished. The note should not contain the person's details.

`submission_failures` cannot be matched to a person. Those rows expire on the 90-day schedule.

## Opt-out rows

`mail_opt_outs` stores an address that asked to stop non-transactional mail. The daily cron does not count or delete that table. Keep each row for at least 60 days, and leave it after that so the stop continues. A deletion request should not remove the opt-out row if removing it would let mail resume. The row is the address and the date it was recorded. It does not include the message.

Example statements, using a placeholder id. Replace `ROW_ID` in a private session. Do not commit the filled statement, and do not run these against production as part of this change.

```sql
DELETE FROM submissions WHERE id = 'ROW_ID';
DELETE FROM inbound_emails WHERE id = 'ROW_ID';
```
