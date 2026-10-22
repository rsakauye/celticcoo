# The Celtic Coo · CelticCoo.ca

A Canada-first hub for Celtic and Gaelic culture: an events calendar (Highland Games, pipe bands,
Highland dance, Gaelic, festivals), a directory of Celtic shops and makers, and a newsletter.
Mascot: **Ceilidh the Coo** (said "Kaylee"), a friendly ginger Highland coo with a bow in Canada's national
**Maple Leaf tartan** (original SVG in `site/public/coo.svg`; tartan rendered from its threadcount by `scripts/make_tartan.py`).

Same pattern as [UsedGlass](https://github.com/rsakauye/usedglass): an Astro static site built by
GitHub Actions and deployed to Cloudflare Pages with wrangler.

## What's here

| Path | What it is |
|---|---|
| `data/events_2027.json` | **Confirmed** events. Each date was checked on the organizer's or association's site. Published, in the ICS and RSS feeds. |
| `data/events_2027_pending.json` | Expected events without a confirmed date. Shown on /events/ **only as "Date TBA"** (Canada only, no tentative dates) and never in the feeds. |
| `data/shops_canada.json` | Shops and makers directory. |
| `data/groups_canada.json` | Clubs, bands, dance schools, clan societies, Gaelic classes (/groups/). Organizations only, never members' names. |
| `data/burns_2027.json` | Burns Night 2027 suppers (/burns-night/). Host-confirmed rows are also in `events_2027.json` (type "Burns Supper"). |
| `data/season_champions.json` | Hand-entered band-level season winners by grade, each with its source link (/results/). No soloists. |
| `data/sources_and_orgs.csv` | Calendars and associations re-checked weekly. |
| `data/source_state.json` | Last snapshot from the weekly source check (written by the workflow). |
| `site/` | Astro site: `/`, `/events/`, `/results/`, `/groups/`, `/burns-night/`, `/shops/`, `/fundraising/`, `/what-to-wear/`, `/tartans/`, `/roots/`, `/submit/`, `/about/`, `/newsletter/`, `/events.ics`, `/rss.xml`, `/sitemap.xml`, 404. `/results/` pulls headline + link only from the pipes\|drums and Piping Press RSS feeds at build time. |
| `scripts/check_sources.py` | Weekly re-check of source pages (standard library only). |
| `.github/workflows/deploy.yml` | Build on push, daily at 7am MT, or manual. Deploys to Cloudflare Pages project `celticcoo` only if the secrets exist; otherwise it builds and skips. |
| `.github/workflows/source-check.yml` | Mondays 8am MT. Opens (or comments on) an issue labelled `source-check` when a source page's dates change, a page disappears, or one of our dates is no longer on its page. |

### Adding or changing an event
Edit `data/events_2027.json`. Only add it there once the date is on an official or association page.
Otherwise put it in `events_2027_pending.json`. Pushing to `main` redeploys.

Core fields: name, start_date, end_date, city, province_or_region, country, type, source_url,
source_kind, notes. Optional structured-data fields, used on each event page:

| Field | When to set it |
|---|---|
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
- **organizer**, on 44 of 45 events, from the host's own site (copyright line, about page, or
  their own schema) or from a page that names them as the presenter. Checked October 2026.
  Greater Moncton Highland Games' own footer says "Greater Moncton Highland Games"; the
  incorporated host named on greatermonctonscots.org, including as host of the 2027 Masters, is
  the Greater Moncton Scottish Association. ScotDance Canada's schedule page did not return
  readable HTML on that check; the championship is still theirs because the date source is
  scotdance.ca/sdccs/schedule/. Victoria, Fergus, and Cowal blocked a direct fetch; their
  organizer names are from their own about or association pages as indexed that week.
- **offers**, on 5 events where there is a real ticket page. No event has a `price`: the one page
  that prints 2027 prices (the Worlds) also adds a transaction fee that is not a single per-ticket
  number, and the Eventbrite listings do not show a price in the page HTML.
- **performer**, on 2 events that name the act.

Still missing, on purpose:

- **Organizer: Campbell River Highland Gathering.** Kelvern Celtic Society names itself organizer
  on an old listing, and the Campbell River Salmon Festival currently hosts the gathering page
  (campbellriverhighlandgathering.ca redirects there). The 2026 spectator price on that page is
  $5. Neither the 2027 host nor a 2027 price is clear, so both are omitted.
- **Organizer URL: Tea On West, and the Royal Canadian Legion (Barrie).** The names are on the
  event pages we already trust. teaonwest.ca is a Port Colborne tea room, and this supper is
  listed in Hamilton, so that domain is not used. The Legion branch has no URL in our sources.
  Barrie Pipes & Drums, who share the host line and play the supper, do have a URL.
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
  - Royal Edinburgh Military Tattoo: `https://www.edintattoo.co.uk/tickets/tattoo-2027`, in stock.
    The box office page does not print a price in the HTML.
  - World Pipe Band Championships: Glasgow Life's 2027 tickets page, in stock. Advertised advance
    prices include the booking fee (Friday general admission from £12.50 child / £16 adult) but
    exclude a transaction fee, so no `price` is marked up. Grade 1 seated tickets in the first
    allocation were sold out; general admission was still on sale. The page does not name the
    RSPBA, so the organizer is Glasgow Life.
  - Braemar Gathering: `https://www.braemargathering.org/tickets`, on sale 1 February 2027.
    The page says "not on sale yet" and does not list a price, so there is no availability and no price.
  - Cornerstone Music Cafe and Place des Arts: the Eventbrite listing is the ticket page. No price
    or stock status in the static HTML, so the offer is the URL only.

## Run locally
```bash
cd site && npm ci && npm test && npm run build   # output in site/dist
npm run dev                          # http://localhost:4321
python3 scripts/check_sources.py --no-save   # dry-run source check
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
   - `CONTACT_EMAIL`: defaults to `hello@celticcoo.ca` (**TODO: that inbox doesn't exist yet**,
     e.g. set up Cloudflare Email Routing).
   - `SUBMIT_FORM_URL`: link to a hosted submission form (**TODO**). Until set, /submit/ uses mailto links.
   - `SITE_URL`: defaults to `https://celticcoo.ca`.

## Notes
- Event dates change. The site tells visitors to confirm with organizers, and the weekly check
  flags changes for a human to review. Nothing auto-publishes from the check.
- All artwork is original. Shop names and trademarks belong to their owners.
