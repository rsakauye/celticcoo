# Breach checklist

Internal note for a suspected breach of personal information. Keep this generic. Do not write a person's name, email address, phone number, or the contents of a message into this file, into git, or into a GitHub issue. Do not write secret values here either.

## 1. Contain it

- Turn on the kill switch so the booking form stops taking new posts and outbound replies stop.
- If that switch is not in production yet, stop outbound mail by hand: set `CLARIFY_DRAFTS` to `off`, leave `ACK_REPLIES` off, and stop the booking mailer from sending. Redeploy the inbound Worker after the var change.
- Rotate any secret that may have been exposed. That includes the Cloudflare API token, the Turnstile secret, the review secret, the inbound GitHub token, and the other Worker secrets. Put the new values in the secret store only.

## 2. Assess the harm

Decide whether there is a real risk of significant harm (PIPA s.34.1, the same federal test). Consider how sensitive the information is, whether it could be misused, and how likely that harm is.

## 3. Decision log

Write a private decision log. Include what happened, what was contained, whether the harm test was met, who decided, and when. Leave out message contents, secret values, and personal details. Do not commit the log.

## 4. Notify when the test is met

When there is a real risk of significant harm, notify Alberta's Office of the Information and Privacy Commissioner and the people affected, without unreasonable delay.

Where PIPEDA applies, report the breach to the federal Office of the Privacy Commissioner of Canada and give direct notice to the affected people. The harm test is the same.

## 5. Keep a record either way

Keep a record when you notify and when you do not. A record of every breach, even small ones, is kept for 24 months.
