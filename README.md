# The Celtic Coo · CelticCoo.ca

A Canada-first hub for Celtic and Gaelic culture: an events calendar (Highland Games, pipe bands,
Highland dance, ceilidhs, concerts, parades, cultural celebrations, Gaelic, festivals), a directory of Celtic shops and makers, and a newsletter.
Mascot: **Ceilidh the Coo** (said "Kaylee"), a friendly ginger Highland coo with a Fraser of Lovat bow
(original SVG in `site/public/coo.svg`; the page stripe is drawn by `scripts/make_tartan.py`).
On the home page an 8-bit sprite of her (`site/public/tartans/fraser-of-lovat/ceilidh-coo-strip.png`, drawn by `scripts/make_ceilidh_coo.py`) stays tucked in the bottom-right corner. A tap brings her out to dance a Highland fling and, if you want it, plays a chiptune. Visitors can choose another kilt from eight tartans; the choice stays in that browser. The first tune is Highland Laddie; each time you stop and start again it moves on to Gillie Callum, then Seann Triubhas, then back. A reload starts over, and she stays quiet until that first tap.

Same pattern as [UsedGlass](https://github.com/rsakauye/usedglass): an Astro static site built by
GitHub Actions and deployed to Cloudflare Pages with wrangler.

## What's here

| Path | What it is |
|---|---|
| `data/events_2027.json` | **Confirmed** events. Each date was checked on the organizer's or association's site. Published, in the ICS and RSS feeds. |
| `data/events_2027_pending.json` | Expected events without a confirmed date. Shown on /events/ **only as "Date TBA"** (Canada only, no tentative dates) and never in the feeds. |
| `data/events_manual.json` | Organizer-submitted or hand-curated events. Merged into the calendar at build time. Burns Supper rows are also added to the Burns Night list. The daily deploy and the weekly source check do not rewrite this file. |
| `data/shops_canada.json` | Shops and makers directory. |
| `data/groups_canada.json` | Clubs, bands, dance schools, clan societies, Gaelic classes (/groups/). Organizations only, never members' names. |
| `data/burns_2027.json` | Burns Night 2027 suppers (/burns-night/). Host-confirmed rows are also in `events_2027.json` (type "Burns Supper"). A Burns Supper in `events_manual.json` is added here at build time. |
| `data/season_champions.json` | Hand-entered band-level season winners by grade, each with its source link (/results/). No soloists. |
| `data/sources_and_orgs.csv` | Calendars and associations re-checked weekly. |
| `data/source_state.json` | Last snapshot from the weekly source check (written by the workflow). |
| `site/` | Astro site: `/`, `/events/`, `/results/`, `/groups/`, `/burns-night/`, `/shops/`, `/fundraising/`, `/what-to-wear/`, `/tartans/`, `/roots/`, `/submit/`, `/about/`, `/newsletter/`, `/book/`, `/events.ics`, `/rss.xml`, `/sitemap.xml`, 404. `/results/` pulls headline + link only from the pipes\|drums and Piping Press RSS feeds at build time. |
| `site/functions/api/book.js` | Booking form endpoint. Checks Turnstile, validates the fields, stores the request in private D1, then asks the mailer for a notice. |
| `site/migrations/` | D1 schema for the private booking intake and the hello@ log. Not applied until the setup below. |
| `scripts/check_sources.py` | Weekly re-check of source pages (standard library only). |
| `.github/workflows/deploy.yml` | Build on push, daily at 7am MT, or manual. Deploys to Cloudflare Pages project `celticcoo` only if the secrets exist; otherwise it builds and skips. The inbound mail job skips on its own when its secrets are missing. |
| `.github/workflows/source-check.yml` | Mondays 8am MT. Opens (or comments on) an issue labelled `source-check` when a source page's dates change, a page disappears, or one of our dates is no longer on its page. |
| `workers/inbound/` | Email Worker for `hello@celticcoo.ca`. Forwards a copy, logs the message, and classifies it. See `docs/inbound-email.md`. |
| `workers/mailer/` | Private Worker that sends booking notices. Pages calls it. It is not the hello@ inbox. |

### Adding or changing an event
Edit `data/events_2027.json`. Only add it there once the date is on an official or association page.
Otherwise put it in `events_2027_pending.json`. Pushing to `main` redeploys.

If the host sent the date directly and it is not on their site yet, add it to `data/events_manual.json`
instead. Use the same fields. Set `source_kind` to `organizer`. The build merges that file into the
event list (and, for a Burns Supper, into the Burns Night list with status `confirmed (date from organizer)`,
which shows the existing "✓ Confirmed by host" badge). A row already in `events_2027.json` with the
same name and date is kept, so the manual copy does not list it twice. `deploy.yml` only builds the
site, and the weekly source check only writes `data/source_state.json` and does not read the manual
file, so a later research update cannot drop a host-submitted date. Do not put a person's name,
email, or phone number in this file. `province_or_region` is a code such as `AB` or `ON`; the site
turns that into the province name.

Core fields: name, start_date, end_date, city, province_or_region, country, type, source_url,
source_kind (`official`, `association`, or `organizer`), notes. Optional structured-data fields, used on each event page:

`type` is free text. The calendar files it with the first match in `category()` (`site/src/lib/data.js`). These checks come first, because a later check would mis-file them (`dance` would turn "St. Patrick's Dinner & Dance" into Highland dance, and a concert would fall through to Festivals):

| Words in `type` | Category |
|---|---|
| parade | Parades |
| ceilidh, ceili | Ceilidhs |
| performance, concert, demo | Performances & demos |
| cultural, Tartan Day, Kirkin, St. Patrick, heritage | Cultural celebrations |

Then the older groups: Burns Night, Military tattoo, Markets, Highland dance, Pipes & drums, Heavy events, Gaelic language, Highland Games, Celtic music, and Festivals.

Useful `type` values for the newer groups: `Parade`, `Ceilidh`, `Performance (concert)`, `Performance & demo`, `Cultural celebration (Tartan Day)`, `Cultural celebration (St. Patrick's Day)`, `Cultural festival`.

Newer tags, each still needing its own `tag_quotes` line: `parade`, `tartan-day`, `st-patricks`. `ceilidh`, `irish`, and `music` were already on the list. A free event shows a FREE badge, and `?free=1` on `/events/` is the Free only filter.

| Field | When to set it |
|---|---|
| `cost` | `free`, `paid`, or `unknown`. Optional. Missing or any other value is treated as `unknown`, except that a missing cost with `offers.price` of `0` is free and a price above `0` is paid. Set `free` or `paid` only when the organizer's own page says so. Do not assume a street parade is free. |
| `cost_quote` | The organizer's own words showing that admission is free or paid. Required when `cost` is `free` or `paid`. Use `""` when `cost` is `unknown`. |
| `cost_source` | Optional URL of the page the quote is on, when that is not `source_url`. |
| `organizer` | `[{ "name", "url?" }]`. The society or association that hosts the event. `url` is their own site, not a ticket vendor. Do not list a sanctioning association (BCPA, for example) as the host of someone else's games. |
| `performers` | `[{ "name", "url?" }]` or a list of names. Only a person or group actually billed for this event. Leave it off for a competition full of unnamed bands. |
| `offers` | `{ "url", "price?", "priceCurrency?", "availability?", "validFrom?" }`. `url` must be a page where the public can buy admission to this event. `price` and `priceCurrency` go together, and only for a price published for this edition (not last year's). `availability` is `InStock`, `SoldOut`, or `PreOrder` when we know it. If tickets are not on sale yet, omit `availability` and set `validFrom` to the published date. |
| `image` | Absolute URL of an image we can publish. Leave it off to use the site artwork in `site/public/images/`. Do not copy or hotlink an organizer's photo. |

### Event structured data
Each confirmed event has a leaf page (`/events/[id]/`) with schema.org `Event` JSON-LD.
Google's [Event rich result](https://developers.google.com/search/docs/appearance/structured-data/event)
recommends `image`, `offers`, `organizer`, and `performer`. Search Console flagged those four as
missing. The old markup papered over that: every page pointed `image` at `/og.png` (a build-time
endpoint, and an SVG mislabelled as PNG if sharp is missing), and any official page became an
`Offer` with `priceCurrency` and `InStock` but no price. That claimed tickets were on sale when
we had not seen a ticket page.

What the pages emit now:

- **image**, on every event: `celtic-coo-event-16x9.png` (1920×1080), `celtic-coo-event-4x3.png`
  (1440×1080), and `celtic-coo-event-1x1.png` (1080×1080) in `site/public/images/`. Original
  Ceilidh the Coo artwork, copied into the build as real PNG files. No event in the data has its
  own photo. Several organizer sites explicitly reserve their pictures, so those are not used.
- **organizer**, on every confirmed event, from the host's own site (copyright line, about page, or
  their own schema) or from a page that names them as the presenter. Checked October 2026.
  Greater Moncton Highland Games' own footer says "Greater Moncton Highland Games"; the
  incorporated host named on greatermonctonscots.org, including as host of the 2027 Masters, is
  the Greater Moncton Scottish Association. ScotDance Canada's schedule page did not return
  readable HTML on that check; the championship is still theirs because the date source is
  scotdance.ca/sdccs/schedule/. Victoria, Fergus, and Cowal blocked a direct fetch; their
  organizer names are from their own about or association pages as indexed that week.
  Campbell River Highland Gathering's old domain redirects to the Campbell River Salmon Festival
  gathering page, so that festival is the organizer. The page still shows 2026 dates and a $5
  spectator price; neither was copied onto the 2027 record.
  Tea On West's own site links to the same TableAgent event (id 289214) and gives the restaurant
  as 192 West Street, Port Colborne. The Hamilton segment in that TableAgent URL is not the venue,
  so the record's city is Port Colborne.
- **isAccessibleForFree**, when `cost` is `free`. Paid and unknown events leave the property off.
  A free event also gets an `Offer`: `url` is `offers.url` or else `source_url`, `price` is `0`,
  `priceCurrency` follows the country (CAD, USD, GBP, or EUR), and `availability` is `InStock`.
  `validFrom` is added only when the record already has `offers.validFrom` or `tickets_on_sale`.
- **offers**, where there is a real ticket page, plus the free-admission offer above. A price
  above zero is set only when that page publishes a figure for this edition. Fees are included
  when the listing publishes one all-in total. The Celtic Tenors concert is $59.85 CAD on its
  Showpass page and is in stock. The Worlds page prints 2027 prices but adds a per-order
  transaction fee, so no single price is marked up. The ETS ceilidh page still publishes no price.
- **performer**, when a named act is billed for that event. The original competitions name two acts. Natalie MacMaster and Donnell Leahy, and The Celtic Tenors, are billed on their concert pages, so those pages name them too.

Still missing, on purpose:

- **Organizer URL: ETS Pipes and Drums Band.** The Eventbrite organizer profile lists no website.
  etspipesanddrums.ca answers over plain HTTP, and its HTTPS certificate does not match that
  hostname, so the domain is not used.
- **Performer: the other 43 events.** Highland Games, pipe-band championships, dance
  championships, and festivals here are competitions or variety programmes, not a billed act.
  Unnamed "ceilidh performers" and a "special guest piper" are not filled in. Lineups still
  published for a previous year (New Brunswick Highland Games Festival, Skagit Valley) are not
  copied onto 2027. The two that qualify: Blackthorn and Wee Drams (Place des Arts, from that
  Eventbrite listing) and Barrie Pipes & Drums (their own event page).
- **Offers: the other 40 events.** A homepage or an association date list is not a ticket page
  under Google's `offers.url` rules, so those stay off and the "missing offers" warning can
  remain. Also left off, with the reason:
  - Ticket pages that still sell or describe the previous edition, so the price was not reused:
    Antigonish (Ticketpro `AHG2026`), Saskatchewan (prices with no year, and taxes/fees on top),
    Penticton, Montreal, New Brunswick Highland Games Festival, Northumberland, Goderich, Skagit Valley.
  - Not on sale yet, and no exact date: Royal Nova Scotia International Tattoo ("this fall").
  - ScotFestBC's homepage says vendor applications and event tickets open 1 December 2026; the
    tickets page says tickets go on sale in 2027 and still describes 2026. No offer until those agree.
  - St. Andrew's Society of Toronto: the club says tickets go on sale in November 2026, without a
    day. The $155/$165 figures in `burns_2027.json` are 2026 prices.
  - Spruce Meadows Christmas Market has buy buttons, but the fetched page did not show a price
    and the only checkout URL was an unlabeled Stripe link.
  - Portland, Kamloops, Penticton, and Skagit organizers' sites were still featuring 2026 when
    checked, so no 2027 ticket URL was added. Seattle Scottish Highland Games Association's home
    page does say 24–25 July 2027, but its ticket links are still labelled 2026.
- **Offers that are present, and what they do not include:**
  - Royal Edinburgh Military Tattoo: `https://www.edintattoo.co.uk/tickets/tattoo-2027`, in stock
    ("Book Tickets Now"; the booking app sets public sale). The page HTML does not print a price,
    and the booking API does not return prices without a key, so there is no `price` and no `validFrom`.
  - World Pipe Band Championships: Glasgow Life's 2027 tickets page, in stock. Advertised advance
    prices include the booking fee (Friday general admission from £12.50 child / £16 adult) but
    exclude a transaction fee (£1.50 online per order), so no `price` is marked up. Grade 1 seated
    tickets in the first allocation were sold out; general admission was still on sale. The page
    does not name the RSPBA, so the organizer is Glasgow Life.
  - Braemar Gathering: `https://www.braemargathering.org/tickets`, on sale 1 February 2027.
    The page says "not on sale yet" and does not list a price, so there is no availability and no price.
  - The Celtic Tenors: Showpass shows $59.85 CAD and the general tickets are not sold out, so
    availability is `InStock`. The visible copy says on sale September 11, while the ticket object
    says `sale_starts_on` 2026-09-09, so `validFrom` is left off. The $59.85 figure is the displayed
    total before GST; the same object totals $62.35 with GST, and that higher number is not used.
  - Place des Arts (Blackthorn): Eventbrite ticket classes are Student/Senior CA$31.00 plus fee
    CA$3.35 and Adult CA$36.00 plus fee CA$3.67, tax CA$0.00, both on sale since 2026-06-20.
    The offer price is the lower all-in total, 34.35 CAD, with `InStock` and that `validFrom`.
  - Cornerstone Music Cafe: one General Admission class at CA$85.00 plus fee CA$6.86 (tax zero),
    so the offer price is 91.86 CAD and `validFrom` is 2026-11-15. Sales status is "Not Yet On Sale",
    so availability is omitted even though Eventbrite's own JSON-LD says `InStock`.

## Run locally
```bash
cd site && npm ci && npm test && npm run build   # output in site/dist
npm run dev                          # http://localhost:4321
python3 scripts/check_sources.py --no-save   # dry-run source check
cd workers/inbound && npm ci && npm test     # inbound mail worker
```

## Setup checklist (Russell)
1. **Cloudflare Pages project.** Create a Pages project named `celticcoo` (Direct Upload, production
   branch `main`) in the same Cloudflare account as UsedGlass. The workflow does not create it.
2. **Repo secrets** (Settings → Secrets and variables → Actions → *Secrets*): copy the same
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` used by `rsakauye/usedglass`. GitHub can't
   copy secrets between repos, so paste the values again. Until both are set, deploys skip cleanly.
3. **Domains.** Once CelticCoo.ca and TheCelticCoo.ca are bought (WHOIS privacy on): add them as
   Cloudflare zones, attach `celticcoo.ca` (and `www`) as custom domains on the Pages project,
   and redirect `thecelticcoo.ca` → `https://celticcoo.ca` with a Cloudflare redirect rule.
4. **Optional repo variables** (*Variables* tab):
   - `KIT_FORM_ID`: numeric Kit form ID. Defaults to 10068901 (Coo's Letter signup); set to `off` to show "Sign-up opens soon".
   - `CONTACT_EMAIL`: defaults to `hello@celticcoo.ca`. How that inbox is triaged is in `docs/inbound-email.md`.
   - `SUBMIT_FORM_URL`: link to a hosted submission form (**TODO**). Until set, /submit/ uses mailto links.
   - `SITE_URL`: defaults to `https://celticcoo.ca`.
5. **Private booking intake.** Do this before you rely on the booking form. Until the Turnstile secret and the public site key are both set, the form rejects submissions (the mailto link on the page still works). Steps are in the next section. Nothing in that section creates resources for you if you only read it; each command is yours to run.

## Private booking intake (Russell, one-time)

The booking form on `/book/` posts to the Pages Function `site/functions/api/book.js`. That function checks Cloudflare Turnstile, validates the fields, stores a valid request in a private D1 database, and then asks the existing `celticcoo-mailer` Worker to send a notice. The notice is sent **from** `bookings@celticcoo.ca` **to** the verified Email Routing destination in the GitHub secret `BOOKING_TO`. Pages cannot hold a `send_email` binding, so do not add one to the Pages project. If the notice fails, the database row stays.

Do not commit the database id, the Turnstile secret, or a submission. The id in `site/wrangler.jsonc` is the placeholder `REPLACE_WITH_D1_DATABASE_ID`.

1. **Create the D1 database.** From `site/`, with Wrangler already logged in to this Cloudflare account:

   ```bash
   cd site
   npx wrangler d1 create celticcoo-intake
   ```

   If Wrangler asks to add the binding to the config, answer **No**. The binding is already in `site/wrangler.jsonc`. Copy the `database_id` UUID it prints. Do not paste it into the repo or into chat.

2. **Apply the migration.** From the repo root, so the id stays out of shell history and out of git:

   ```bash
   read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
   export D1_DATABASE_ID
   node scripts/apply-intake-migration.mjs
   unset D1_DATABASE_ID
   ```

   That writes a gitignored `site/.wrangler-intake.jsonc`, runs `wrangler d1 migrations apply celticcoo-intake --remote`, and deletes the file. It applies every file in `site/migrations/` that is not on the database yet. `0001_intake.sql` creates `submissions` and `submission_failures`. `0002_inbound_emails.sql` creates the hello@ log. `0003_inbound_clarify.sql` adds clarifying-draft columns. `0004_mail_opt_outs.sql` creates the stop-mail list. Run the command again after a new migration is merged. Details for the mailbox are in `docs/inbound-email.md`.

3. **Give deploys the database id.** GitHub → Settings → Secrets and variables → Actions → Secrets → `D1_DATABASE_ID` = that same UUID. The deploy workflow copies it into the checkout for that deploy only. If the secret is empty, the workflow removes the D1 binding and the site still deploys, but requests are not stored.

4. **Create the Turnstile widget.** Do not put the secret in the repo. Production hostnames on the widget can include local ones; the Pages allowlist below will not accept a localhost token.

   ```bash
   npx wrangler turnstile widget create "Celtic Coo bookings" \
     --domain celticcoo.ca \
     --domain www.celticcoo.ca \
     --domain localhost \
     --domain 127.0.0.1 \
     --mode managed
   ```

   Keep the sitekey. Leave the secret in Wrangler's prompt output only long enough to do the next step. Do not commit either value. The widget's action is `book`.

5. **Set the Turnstile secret on the Pages project** (prompted input, not a command argument):

   ```bash
   cd site
   npx wrangler pages secret put TURNSTILE_SECRET --project-name celticcoo
   ```

   Set it before the deploy that should start accepting the form. `site/wrangler.jsonc` already has the production allowlist `TURNSTILE_HOSTNAMES=celticcoo.ca,www.celticcoo.ca`. Do not add `localhost` or `127.0.0.1` to that var.

6. **Set the public site key** as a GitHub **variable** (not a secret), because the static page has to embed it: Settings → Secrets and variables → Actions → Variables → `TURNSTILE_SITEKEY`. The next build passes it as `PUBLIC_TURNSTILE_SITEKEY`. An empty variable means the widget is not rendered and the function rejects the post.

7. **Confirm the notice can send.** The GitHub secret `BOOKING_TO` must already be the verified Email Routing destination used by `celticcoo-mailer`. The mailer sends only to that destination, from `bookings@celticcoo.ca`. No new email binding is required. A failed notice does not delete the saved row. The deploy uploads `BOOKING_TO` as a Worker secret. Do not pass it with `--var`. After the first deploy that contains that change, open `celticcoo-mailer` → Settings → Variables and Secrets and confirm `BOOKING_TO` is a Secret, not plain text. No new GitHub secret is required. The same check for `FORWARD_TO` on `celticcoo-inbound` is in `docs/inbound-email.md`.

8. **Read a request without publishing it.** Use the same unprinted id as step 2. This query leaves out the name, email, phone, and message:

   ```bash
   read -rsp 'D1 database id: ' D1_DATABASE_ID; echo
   export D1_DATABASE_ID
   node scripts/intake-d1.mjs execute --command "SELECT id, status, risk_flags, email_status, created_at FROM submissions ORDER BY created_at DESC LIMIT 20;"
   unset D1_DATABASE_ID
   ```

   `status` is `new`, `flagged`, or `handled`. A row is flagged when a minor is mentioned or ticked and no guardian confirmed, when the message asks for someone's private contact details, when it talks about a cheque or another odd way to pay, or when the date or venue is missing. `submission_failures` stores reason codes (`turnstile_rejected`, `validation`, `minor_no_guardian`, `honeypot`, `store_failed`, and so on) and no message body. After you have dealt with a row, mark it handled (replace `THE_ID` with the id from the query above, not with anyone's email):

   ```bash
   node scripts/intake-d1.mjs execute --command "UPDATE submissions SET status = 'handled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'THE_ID';"
   ```

   Selecting the name, email, phone, or message prints personal data on your machine. Don't paste that output into chat, a commit, or a log. `npm test` in `site/` covers validation, Turnstile decisions, and flagging without a Cloudflare account. A local Pages session still rejects a token whose hostname is not `celticcoo.ca` or `www.celticcoo.ca`.

## Inbound mail for hello@

`workers/inbound/` receives `hello@celticcoo.ca` when the Email Routing rule points at it, forwards a copy to the verified destination in `FORWARD_TO`, and logs the message in the private D1 database. Event listings and corrections are not opened as GitHub issues unless `INBOUND_GITHUB_TOKEN` is set and `INBOUND_ISSUES_REPO` names a different private repository. Leave that variable unset. A vague note can get a clarifying draft; that draft is not sent until it is approved. A daily cron counts rows past the retention window and does not delete them unless `RETENTION_PURGE` is `on`. A `stop` or `unsubscribe` reply is recorded and further non-transactional mail to that address is suppressed. The steps are in [docs/inbound-email.md](docs/inbound-email.md), [docs/retention.md](docs/retention.md), and [docs/breach-checklist.md](docs/breach-checklist.md). Deploying the Worker does not change the Email Routing rule.

## Notes
- Event dates change. The site tells visitors to confirm with organizers, and the weekly check
  flags changes for a human to review. Nothing auto-publishes from the check.
- All artwork is original. Shop names and trademarks belong to their owners.
