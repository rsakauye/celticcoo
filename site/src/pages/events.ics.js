import { events } from '../lib/data.js';

// iCalendar feed of CONFIRMED events only (all-day; DTEND is exclusive per RFC 5545).
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const d = (iso) => iso.replace(/-/g, '');
const nextDay = (iso) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
// Fold lines longer than 75 octets.
const fold = (line) => { const out = []; let s = line; while (Buffer.byteLength(s) > 75) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };

export function GET(context) {
  const site = new URL(import.meta.env.BASE_URL, context.site).href;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Celtic Coo//CelticCoo.ca Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:The Celtic Coo: Celtic & Highland events', 'X-WR-TIMEZONE:America/Edmonton',
    'X-WR-CALDESC:Confirmed Highland Games\\, pipe band\\, dance\\, Gaelic and Celtic festival dates. Always confirm with the organizer.',
    'REFRESH-INTERVAL;VALUE=DURATION:P1D', 'X-PUBLISHED-TTL:P1D',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT',
      `UID:${e.id}@celticcoo.ca`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d(e.start_date)}`,
      `DTEND;VALUE=DATE:${d(nextDay(e.end_date))}`,
      `SUMMARY:${esc(e.name)}`,
      `LOCATION:${esc([e.city, e.regionLabel, e.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', '))}`,
      `DESCRIPTION:${esc(`${e.type}${e.note ? ` · ${e.note}` : ''}\nDetails and tickets: ${e.source_url}\nListed on The Celtic Coo: ${site}events/#${e.id}`)}`,
      `URL:${e.source_url}`,
      `CATEGORIES:${esc(e.category)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
}
