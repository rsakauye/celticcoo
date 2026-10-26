# Shared triage

Pure helpers for classifying inbound mail and for deciding when a burst of form posts or emails should be held for review instead of treated as an attack. There is no package, no network, and no database client. Copy this folder into another site, add a site pack, and call the two entry points.

## Layout

| Path | What it is |
|---|---|
| `engine.js` | Weighted phrase scoring, quoted-reply and signature stripping, date and place extraction. |
| `breaker.js` | Seasonal limit, legit bulk versus abuse, and the allow / hold / pause decision. |
| `text.js` | Folding and clamping. |
| `sites/celticcoo.js` | Categories, lexicon, Alberta towns, venue words, seasons, and default limits for The Celtic Coo. |
| `index.js` | Re-exports. It does not import a site pack. |

The engine does not know about Highland Games, Kit, or Alberta. Those words live in the site pack. The breaker does not know about Email Sending prices. The caller passes a count, a limit, and today's outbound total.

## Classify a message

```js
import { analyzeMessage } from './index.js';
import celticcoo from './sites/celticcoo.js';

const result = analyzeMessage({ subject, text }, celticcoo);
// result.category, result.confidence, result.event, result.signals
```

Scoring sums every matching phrase. A subject match counts double (`scoring.subjectWeight`). The highest score wins once it clears `scoring.minScore`. Spam wins a tie with a real request. No match, a newsletter question, and an auto-reply or bounce stay `other`. Confidence follows the score and the margin over the next category, and it stays under `scoring.maxConfidence`.

`result.signals` says whether a performer was named, whether it looks like a group or society directory listing, and whether it is a newsletter question or an automated note. The Celtic Coo draft logic uses those flags when it decides which question to ask.

## Hold, or pause

```js
import { adaptiveLimit, assessBurst, decideGuard } from './index.js';
import celticcoo from './sites/celticcoo.js';

const { limit } = adaptiveLimit({
  baseline: rollingDailyAverage,
  sameWeekLastYear, // null until that week exists
  now,
  ...celticcoo.guard,
  seasons: celticcoo.guard.seasons,
});

const burst = assessBurst(recentItems, { minBurst: celticcoo.guard.minBurst });
const decision = decideGuard({
  count: todayCount,
  limit,
  burst,
  outboundToday,
  outboundCap: celticcoo.guard.outboundDailyCap,
});
// decision.action is 'allow', 'hold', or 'pause'
```

`allow` means process the message normally.

`hold` means store it and show it to a person. Do not send mail, and do not trip the kill switch. This is the path for a seasonal rush and for a legit organizer burst (one Highland Games booking several bands, or a run of Burns Suppers).

`pause` is the hard stop. It is for clear abuse, or for the outbound cost cap. Volume by itself does not pause.

Abuse signals, any one of which is enough when it covers the burst: rotating senders, the same payload repeated, gibberish, several links in most messages, failed SPF or DKIM, or failed Turnstile checks. A template that changes the date, place, or act is a distinct request, not a repeated payload. Items should look like `{ sender, org, text, fields: { when, place, act }, links, spf, dkim, turnstile }`. `spf` and `dkim` are `'pass'`, `'fail'`, or `'unknown'`. Unknown is not a failure. Turnstile is the same, and mail that never saw Turnstile stays `'unknown'`.

The limit is `baseline * multiplier`, then clamped to `floorPerDay` and `ceilingPerDay`. In season (Burns Night in the second half of January, St Andrew's in the second half of November, Highland Games from April through August, Hogmanay across New Year) the site pack's multiplier is used. Outside those weeks the off-season multiplier is used. `sameWeekLastYear` replaces the rolling average once a caller has it. This module does not query D1. A cheap query the caller can run once a day:

```sql
SELECT date(created_at) AS day, count(*) AS n
FROM inbound_emails
WHERE created_at >= date('now', '-400 days')
GROUP BY day;
```

Count the form table the same way if that channel shares the guard. Cache the resulting limit. Do not recompute it on every request from raw rows.

## Porting to another site

1. Copy `shared/triage/` (or, later, extract it into a private package). Leave `sites/celticcoo.js` as the example.
2. Add `sites/<your-site>.js` with `categories`, `scoring`, `phrases`, `provinces` or whatever places you extract, `automatedForms`, `directoryForms`, and `guard.seasons`. Phrase `weight` is the body score. The subject multiplier is `scoring.subjectWeight`. `role` is a flag (`performer`, `event`, `listing`, `newsletter`, `spam`) and can be set with `weight: 0`.
3. Call `analyzeMessage(input, yourSite)` from the mail worker. Keep the worker's own redaction, storage, and reply policy. Do not put secrets or inbox addresses in the site pack.
4. Call `decideGuard` from the form handler and the mail worker when you wire the cutoff. Map `hold` to "store, do not send" and `pause` to the kill switch. One notification to the operator is the caller's job, so the alert cannot loop.
5. Keep categories stable if mail is already stored with a check constraint. A new category needs a migration in that site, not in this folder.

UsedGlass, or a later site, should need a new site pack and a thin adapter. It should not need a fork of `engine.js` or `breaker.js`.
