# The Celtic Coo · CelticCoo.ca

A Canada-first hub for Celtic and Gaelic culture: an events calendar (Highland Games, pipe bands,
Highland dance, Gaelic, festivals), a directory of Celtic shops and makers, and a newsletter.
Mascot: a friendly Highland coo (original SVG in `site/public/coo.svg`).

Same pattern as [UsedGlass](https://github.com/rsakauye/usedglass): an Astro static site built by
GitHub Actions and deployed to Cloudflare Pages with wrangler.

## What's here

| Path | What it is |
|---|---|
| `data/events_2027.json` | **Confirmed** events. Each date was checked on the organizer's or association's site. Published, in the ICS and RSS feeds. |
| `data/events_2027_pending.json` | Expected events without a confirmed date. Shown on /events/ **only as "Date TBA"** (Canada only, no tentative dates) and never in the feeds. |
| `data/shops_canada.json` | Shops and makers directory. |
| `data/sources_and_orgs.csv` | Calendars and associations re-checked weekly. |
| `data/source_state.json` | Last snapshot from the weekly source check (written by the workflow). |
| `site/` | Astro site: `/`, `/events/`, `/shops/`, `/submit/`, `/about/`, `/newsletter/`, `/events.ics`, `/rss.xml`, 404. |
| `scripts/check_sources.py` | Weekly re-check of source pages (standard library only). |
| `.github/workflows/deploy.yml` | Build on push, daily at 7am MT, or manual. Deploys to Cloudflare Pages project `celticcoo` only if the secrets exist; otherwise it builds and skips. |
| `.github/workflows/source-check.yml` | Mondays 8am MT. Opens (or comments on) an issue labelled `source-check` when a source page's dates change, a page disappears, or one of our dates is no longer on its page. |

### Adding or changing an event
Edit `data/events_2027.json` (fields: name, start_date, end_date, city, province_or_region,
country, type, source_url, source_kind, notes). Only add it there once the date is on an official
or association page. Otherwise put it in `events_2027_pending.json`. Pushing to `main` redeploys.

## Run locally
```bash
cd site && npm ci && npm run build   # output in site/dist
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
   - `KIT_FORM_ID`: numeric Kit form ID. Until set, the newsletter box shows "Sign-up opens soon".
   - `CONTACT_EMAIL`: defaults to `hello@celticcoo.ca` (**TODO: that inbox doesn't exist yet**,
     e.g. set up Cloudflare Email Routing).
   - `SUBMIT_FORM_URL`: link to a hosted submission form (**TODO**). Until set, /submit/ uses mailto links.
   - `SITE_URL`: defaults to `https://celticcoo.ca`.

## Notes
- Event dates change. The site tells visitors to confirm with organizers, and the weekly check
  flags changes for a human to review. Nothing auto-publishes from the check.
- All artwork is original. Shop names and trademarks belong to their owners.
