// Club profile slugs and which events belong on a profile.
//
// A profile URL is /groups/<slug>/. Clubs paste that link into their own
// social bios, so a published slug never changes: not when the name,
// spelling, city, or file order changes. The value that shipped lives on
// the club as `slug` in data/groups_canada.json and in
// site/test/fixtures/published-club-slugs.json. assignClubSlugs() returns
// that field as-is. Do not rewrite it, and do not "fix" it to match a new
// name. A club with no slug yet (a new row, not yet deployed) gets a short
// one from suggestClubSlug(): lowercase ASCII, accents removed, hyphens
// only, filler words and generic suffixes dropped, cut at a word boundary
// around 30 characters. Two new clubs that land on the same slug get a
// short city suffix (harbour, harbour-edmonton), never a number or a hash.
// After the first deploy, write that slug onto the club and leave it.
//
// An event is listed only when it carries that slug, or an organizer's name
// is exactly the club's name. Partial titles are not a match.

const FILLERS = new Set(['the', 'of', 'and', 'a', 'an', 'city']);
const SUFFIX_PHRASES = [['social', 'club'], ['pipe', 'band'], ['pipes', 'and', 'drums'], ['pipes', 'drums']];
const SUFFIX_WORDS = new Set(['society', 'association', 'club', 'inc', 'ltd', 'canada']);
const SLUG_MAX = 30;

function wordsOf(name) {
  const raw = String(name ?? '').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’ʼ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  return raw.filter((word, i) => i === 0 || word !== raw[i - 1]);
}

function stripSuffixes(words) {
  let w = words.slice();
  for (let guard = 0; w.length > 1 && guard < 24; guard += 1) {
    let removed = false;
    for (const phrase of SUFFIX_PHRASES) {
      for (let i = 0; i <= w.length - phrase.length; i += 1) {
        if (w.length === phrase.length) continue;
        if (!phrase.every((part, k) => w[i + k] === part)) continue;
        w = w.slice(0, i).concat(w.slice(i + phrase.length));
        removed = true;
        break;
      }
      if (removed) break;
    }
    if (removed) continue;
    const at = w.findIndex((word) => SUFFIX_WORDS.has(word));
    if (at < 0) break;
    w = w.slice(0, at).concat(w.slice(at + 1));
  }
  return w;
}

function significantWords(name) {
  const tokens = wordsOf(name).filter((word) => !FILLERS.has(word));
  const stripped = stripSuffixes(tokens);
  if (stripped.length) return stripped;
  if (tokens.length) return tokens;
  const raw = wordsOf(name);
  return raw.length ? raw : ['group'];
}

function capWords(words, max = SLUG_MAX) {
  const out = [];
  for (const word of words) {
    const next = out.length ? `${out.join('-')}-${word}` : word;
    if (next.length > max) {
      if (out.length && next.length <= max + 2) out.push(word);
      break;
    }
    out.push(word);
  }
  if (!out.length) return [String(words[0] || 'group').slice(0, max)];
  return out;
}

function citySuffix(city) {
  if (!city || String(city).trim().toLowerCase() === 'national') return '';
  return capWords(significantWords(city), 16).join('-');
}

function fitSuffix(words, extra, max = SLUG_MAX) {
  const kept = words.slice();
  while (kept.length > 1 && `${kept.join('-')}-${extra}`.length > max) kept.pop();
  return `${kept.join('-')}-${extra}`;
}

export function suggestClubSlug(name) {
  return capWords(significantWords(name)).join('-');
}

const PUBLISHED_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function publishedSlug(value) {
  const slug = String(value ?? '').trim();
  return PUBLISHED_SLUG.test(slug) ? slug : '';
}

export function assignClubSlugs(clubs) {
  const list = Array.isArray(clubs) ? clubs : [];
  const taken = new Set(list.map((club) => publishedSlug(club?.slug)).filter(Boolean));
  return list.map((club) => {
    const explicit = publishedSlug(club?.slug);
    if (explicit) return explicit;
    const words = significantWords(club?.name);
    let slug = capWords(words).join('-');
    if (taken.has(slug)) {
      const city = citySuffix(club?.city);
      if (city && !slug.split('-').includes(city)) slug = fitSuffix(words, city);
      if (taken.has(slug)) {
        for (const word of words) {
          if (slug.split('-').includes(word)) continue;
          const next = fitSuffix(slug.split('-'), word, SLUG_MAX + 2);
          if (!taken.has(next)) {
            slug = next;
            break;
          }
        }
      }
      const province = String(club?.province || '').toLowerCase().replace(/[^a-z]/g, '');
      if (taken.has(slug) && province && !slug.endsWith(`-${province}`)) slug = `${slug}-${province}`;
    }
    taken.add(slug);
    return slug;
  });
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
