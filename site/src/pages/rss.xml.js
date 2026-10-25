import { upcoming } from '../lib/data.js';

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
// Items are "added" when the seed list was verified; new data can carry an added_date field.
const ADDED = '2026-10-17';

export function GET(context) {
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  const items = upcoming.slice(0, 60).map((e) => `
    <item>
      <title>${esc(`${e.name} · ${e.when} · ${e.city}, ${e.regionLabel}`)}</title>
      <link>${esc(`${site}events/#${e.id}`)}</link>
      <guid isPermaLink="false">${esc(e.id)}</guid>
      <pubDate>${new Date((e.added_date || ADDED) + 'T12:00:00-06:00').toUTCString()}</pubDate>
      <category>${esc(e.category)}</category>
      <description>${esc(`${e.type} in ${e.city}, ${e.regionLabel}, ${e.country}. ${e.when}.${e.cost === 'free' ? ' Free admission.' : ''}${e.note ? ' ' + e.note + '.' : ''} ${e.source_kind === 'organizer' ? 'Date from organizer' : 'Details'}: ${e.source_url}`)}</description>
    </item>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>The Celtic Coo: upcoming Celtic &amp; Highland events</title>
  <link>${esc(site)}</link>
  <description>Confirmed Highland Games, pipe band, Highland dance, Gaelic and Celtic festival dates, Canada first.</description>
  <language>en-ca</language>${items}
</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
