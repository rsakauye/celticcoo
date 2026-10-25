// Sitemap of the site's pages plus one page per confirmed event (no extra dependency).
// <lastmod> is the date the page's content really changed (see lib/lastmod.js), or omitted when unknown,
// so search engines and the IndexNow ping (scripts/indexnow.mjs) only see genuine updates.
import { events } from '../lib/data.js';
import { gitDate, eventLastmod } from '../lib/lastmod.js';
const P = (f) => `site/src/pages/${f}`;
const D = (f) => `data/${f}`;
const PAGES = {
  '': [P('index.astro'), D('events_2027.json'), D('events_manual.json')],
  'events/': [P('events/index.astro'), D('events_2027.json'), D('events_2027_pending.json'), D('events_manual.json')],
  'results/': [P('results/index.astro'), D('season_champions.json')],
  'groups/': [P('groups/index.astro'), D('groups_canada.json')],
  'burns-night/': [P('burns-night/index.astro'), D('burns_2027.json'), D('events_manual.json')],
  'st-andrews-day/': [P('st-andrews-day/index.astro')],
  'shops/': [P('shops/index.astro'), D('shops_canada.json')],
  'fundraising/': [P('fundraising/index.astro')],
  'what-to-wear/': [P('what-to-wear/index.astro')],
  'tartans/': [P('tartans/index.astro')],
  'roots/': [P('roots/index.astro')],
  'book/': [P('book/index.astro'), D('booking.json'), D('events_2027.json'), D('events_2027_pending.json'), D('events_manual.json')],
  'book/checklist/': [P('book/checklist/index.astro'), D('booking.json')],
  'submit/': [P('submit/index.astro')],
  'about/': [P('about/index.astro'), D('events_manual.json')],
  'newsletter/': [P('newsletter/index.astro')],
  'privacy/': [P('privacy/index.astro')],
  'terms/': [P('terms/index.astro')],
};
export function GET(context) {
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  const entries = [
    ...Object.entries(PAGES).map(([p, deps]) => [p, gitDate(deps)]),
    ...events.map((e) => [`events/${e.id}/`, eventLastmod(e.id)]),
  ];
  const urls = entries.map(([p, d]) => `  <url><loc>${site}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
