// Club profile slugs and which events belong on a profile.
// Slugs are the accent-stripped name, and stay unique in source order:
// the first club keeps the base slug, and a later collision gets -2, -3, …
// An event is listed only when it carries that slug, or an organizer's name
// is exactly the club's name. Partial titles are not a match.

export function slugifyClub(name) {
  return String(name ?? '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function uniqueClubSlugs(names) {
  const seen = new Map();
  return (Array.isArray(names) ? names : []).map((name) => {
    const base = slugifyClub(name) || 'group';
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

export function explicitClubSlugs(event) {
  const raw = event?.groups ?? event?.group;
  return asList(raw).map((s) => String(s).trim()).filter(Boolean);
}

export function organizerNames(event) {
  return asList(event?.organizer)
    .map((org) => (typeof org === 'string' ? org : org?.name))
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim());
}

export function eventMatchesClub(event, club) {
  const slug = String(club?.id || club?.slug || '').trim();
  if (slug && explicitClubSlugs(event).includes(slug)) return true;
  const name = String(club?.name || '').trim().toLowerCase();
  if (!name) return false;
  return organizerNames(event).some((org) => org.toLowerCase() === name);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function eventEnd(event) {
  const end = String(event?.end_date || event?.start_date || '');
  return ISO.test(end) ? end : '';
}

export function splitClubEvents(events, club, today) {
  const day = String(today || '');
  const matched = (Array.isArray(events) ? events : []).filter((event) => eventMatchesClub(event, club) && eventEnd(event));
  const byStart = (a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.name).localeCompare(String(b.name));
  const upcoming = matched.filter((event) => eventEnd(event) >= day).sort(byStart);
  const past = matched.filter((event) => eventEnd(event) < day).sort((a, b) => byStart(b, a));
  return { upcoming, past };
}

const SOCIALS = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['tiktok', 'TikTok'],
  ['x', 'X'],
  ['bluesky', 'Bluesky'],
  ['linkedin', 'LinkedIn'],
];

function httpUrl(value) {
  const url = String(value || '').trim();
  return /^https?:\/\//i.test(url) ? url : '';
}

export function clubLinks(club) {
  const links = [];
  const seen = new Set();
  const push = (id, label, url) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ id, label, url });
  };
  push('website', 'Website', httpUrl(club?.website));
  const social = club?.social && typeof club.social === 'object' && !Array.isArray(club.social) ? club.social : {};
  for (const [id, label] of SOCIALS) push(id, label, httpUrl(club?.[id] || social[id]));
  const twitter = httpUrl(club?.twitter || social.twitter);
  if (!httpUrl(club?.x || social.x)) push('x', 'X', twitter);
  for (const item of asList(club?.socials)) {
    if (!item || typeof item !== 'object') continue;
    const label = String(item.label || '').trim();
    if (!label) continue;
    push('other', label, httpUrl(item.url));
  }
  return links;
}

export function clubPlace(club) {
  const city = club?.city && String(club.city).trim() && club.city !== 'National' ? String(club.city).trim() : '';
  const region = String(club?.regionLabel || '').trim();
  return [city, region].filter(Boolean).join(', ');
}

export function clubMetaDescription(club) {
  const place = clubPlace(club);
  const kind = club?.kind || club?.type || 'group';
  const name = String(club?.name || 'This group');
  const lead = place ? `${name} is a ${kind} in ${place}.` : `${name} is a ${kind}.`;
  const note = club?.note ? ` ${String(club.note).trim()}` : '';
  const text = `${lead}${note}`.replace(/\s+/g, ' ').trim();
  if (text.length <= 160) return text;
  const cut = text.slice(0, 157).replace(/\s+\S*$/, '');
  return `${cut || text.slice(0, 157)}…`;
}

export function eventDateParts(iso) {
  if (!ISO.test(String(iso || ''))) return { month: '', day: '' };
  const date = new Date(`${iso}T12:00:00Z`);
  return {
    month: date.toLocaleDateString('en-CA', { timeZone: 'UTC', month: 'short' }),
    day: String(date.getUTCDate()),
  };
}

export function eventPlace(event) {
  const venue = typeof event?.venue === 'string' ? event.venue.trim() : '';
  const city = typeof event?.city === 'string' ? event.city.trim() : '';
  const region = String(event?.regionLabel || '').trim();
  const town = [city, region].filter(Boolean).join(', ');
  return [venue, town].filter(Boolean).join(' · ');
}
