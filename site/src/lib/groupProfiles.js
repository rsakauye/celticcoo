// Which events belong on a club profile.
//
// The slug and the short code are permanent public links. A published slug never changes,
// and neither does its short code. The rules live in
// shared/slugs (site-agnostic). This file only applies the Celtic Coo pack.
// A published `slug` or `code` in data/groups_canada.json is returned as-is.
// Do not rewrite either one. The lock is site/test/fixtures/published-club-slugs.json.
// A club with no slug or code yet gets one from that module; write it onto
// the club after the first deploy and leave it. A removed club's code goes
// into retiredCodes in the site pack so it is never reused.
//
// An event is listed only when it carries that slug, or an organizer's name
// is exactly the club's name. Partial titles are not a match.

import { assignShortCodes, assignSlugs, publishedSlug as acceptSlug, suggestSlug } from '../../../shared/slugs/index.js';
import linkPack from '../../../shared/slugs/sites/celticcoo.js';

export { linkPack };

export function suggestClubSlug(name) {
  return suggestSlug(name, linkPack);
}

export function publishedSlug(value) {
  return acceptSlug(value);
}

export function assignClubSlugs(clubs) {
  return assignSlugs(clubs, linkPack);
}

export function assignClubCodes(clubs, random) {
  return assignShortCodes(clubs, linkPack, random);
}

export function clubShareTitle(club) {
  const name = String(club?.name || '').trim();
  const kind = String(club?.kind || club?.type || '').trim();
  const place = clubPlace(club);
  return [name, kind, place].filter(Boolean).join(' · ');
}

export const CLUB_SHARE_DESCRIPTION = 'Upcoming events on The Celtic Coo';

export async function shareClubPage(url, { copy, share, mobile } = {}) {
  try {
    if (typeof copy !== 'function') throw new Error('no clipboard');
    await copy(url);
    return 'copied';
  } catch {
    if (!(mobile && typeof share === 'function')) return 'failed';
    try {
      await share(url);
      return 'shared';
    } catch (err) {
      return err && err.name === 'AbortError' ? 'aborted' : 'failed';
    }
  }
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

export function clubCardFields(club) {
  const city = club?.city && String(club.city).trim() && club.city !== 'National' ? String(club.city).trim() : '';
  const province = city && club?.province && String(club.province).trim() && club.province !== 'National'
    ? String(club.province).trim()
    : '';
  return {
    name: String(club?.name || '').trim(),
    type: String(club?.type || '').trim(),
    location: [city, province].filter(Boolean).join(', '),
  };
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
