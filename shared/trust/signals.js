// Pure helpers for a trust score. No site names, no database, no network.
// A site pack supplies phrase lists and seasons. The worker supplies the
// header, the message text, and the clock.

const AUTH_VALUES = new Set([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permerror',
]);

function normalizeAuth(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'bestguesspass') return 'pass';
  return AUTH_VALUES.has(text) ? text : 'unknown';
}

function preferAuth(current, next) {
  if (!current) return next;
  const rank = { fail: 6, softfail: 5, permerror: 4, temperror: 3, neutral: 2, unknown: 1, none: 0, pass: 2 };
  return (rank[next] || 0) >= (rank[current] || 0) ? next : current;
}

// The last Authentication-Results block is the one the receiving server added.
// A sender can forge an earlier block. Only spf, dkim, and dmarc are read.
export function parseAuthenticationResults(headerValue) {
  const raw = String(headerValue || '');
  const blocks = raw.split(/\n(?=\s*Authentication-Results\s*:)/i);
  const block = blocks.length ? blocks[blocks.length - 1] : '';
  const found = {};
  const pattern = /\b(spf|dkim|dmarc)\s*=\s*([a-z0-9]+)/gi;
  for (const match of block.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    found[key] = preferAuth(found[key], normalizeAuth(match[2]));
  }
  return {
    spf: found.spf || 'none',
    dkim: found.dkim || 'none',
    dmarc: found.dmarc || 'none',
  };
}

function boundary(char) {
  return !char || !/[a-z0-9]/i.test(char);
}

function hasPhrase(text, phrase) {
  const needle = String(phrase || '').toLowerCase().trim();
  if (!needle) return false;
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + needle.length] || '';
    if (boundary(before) && boundary(after)) return true;
    from = at + needle.length;
  }
  return false;
}

// Counts distinct phrases per group. Repeated mentions of one phrase count once.
export function countLexiconHits(text, groups) {
  const haystack = String(text || '').toLowerCase().slice(0, 8000);
  const counts = {};
  const source = groups && typeof groups === 'object' ? groups : {};
  for (const [group, phrases] of Object.entries(source)) {
    let hits = 0;
    for (const phrase of phrases || []) {
      if (hasPhrase(haystack, phrase)) hits += 1;
    }
    counts[group] = hits;
  }
  return counts;
}

export function localMonthDay(now, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return { month: Number(parts.month), day: Number(parts.day) };
}

function inRange(month, day, start, end) {
  const cur = month * 100 + day;
  const from = start[0] * 100 + start[1];
  const to = end[0] * 100 + end[1];
  if (from <= to) return cur >= from && cur <= to;
  return cur >= from || cur <= to;
}

// Returns the season with the highest multiplier, or null. A season may wrap
// across the new year. start and end are [month, day], month 1-12.
export function seasonFor(now, seasons, timeZone) {
  const { month, day } = localMonthDay(now, timeZone);
  let best = null;
  for (const season of seasons || []) {
    if (!season || !Array.isArray(season.start) || !Array.isArray(season.end)) continue;
    if (!inRange(month, day, season.start, season.end)) continue;
    if (!best || Number(season.multiplier) > Number(best.multiplier)) best = season;
  }
  return best;
}
