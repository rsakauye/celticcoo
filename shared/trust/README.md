# Trust score

Advisory score for one inbound message. It is a number from 0 to 100 plus a list of reason codes. It does not send mail, open an issue, or pause intake. A high score is not an approval. The only send of a clarifying reply is a person's approve action, and the worker that already holds the mailbox is the only sender.

Copy this directory into another site. Leave `score.js`, `signals.js`, and `check.js` alone. Add `sites/<site>.js` with that site's weights, seasons, and phrase groups. The app imports the pack itself. `index.js` does not import a site.

The app gathers the signals and calls `scoreTrust(signals, pack)`:

| Signal | What the app passes |
|---|---|
| `auth` | `spf`, `dkim`, and `dmarc` from the last `Authentication-Results` block. Use `parseAuthenticationResults`. |
| `history` | Prior messages, prior approved replies, prior denials, and how many arrived inside `pack.bulk.windowHours`, for this sender address. |
| `classifier` | `source` is `ai`, `rules`, or `ai_failed`, plus `confidence` and `category`. |
| `aiCheck` | `{ status: 'ok', spam, phishing, promptInjection }` from a flag-only model call. Any other result is `{ status: 'failed' }`. The score is then capped at `pack.failClosedScore` and the reason code is `ai_check_failed`. |
| `lexicon` | Hit counts per group. `countLexiconHits` counts each phrase once. A site that already has a classifier lexicon can fill these counts from that lexicon instead of `pack.lexicon`. |
| `guard` | `action` is `allow`, `hold`, `pause`, or `unavailable`. Pause caps the score at `pack.pauseCap`. Hold applies `weights.guardHeld`. A missing guard table is `unavailable` and does not by itself zero the score. |
| `season` | `{ id }` from `seasonFor`, or null. |
| `holds` | Optional `{ bulk, seasonal }`. When a flag is omitted, the scorer derives it from recent volume and the season. Pass the intake breaker's own flags here when that breaker is wired, so the score and the breaker agree. |
| `missingFields` | Optional codes: `date`, `time`, `venue`, `booking`, `event`. Each one lowers the score, with a cap. The codes are also returned on the result. |
| `redFlags` | Optional booleans: `minor_mentioned`, `links_present`, `payment_request`, `bot_instruction_attempt`. A true flag lowers the score. The booleans are returned even when they are false. |
| `turnstile` | Optional `pass`, `fail`, or `unavailable`. Omit it for email, where Turnstile does not apply. |
| `channel` | `form` scores only the field gaps, red flags, and Turnstile result. Omit it, or pass `email`, for the full mail score. |

`missingFields` and `redFlags` are advisory. `scoreTrust` still returns `autoSend: false`.

`scoreTrust` always returns `autoSend: false`. Do not add a branch that sends when the score is above a threshold.

The Celtic Coo pack is `sites/celticcoo.js`. Its seasons use the same dates as the intake guard pack: Hogmanay, Burns Night, Highland Games season, and St Andrew's, on `America/Edmonton`.
