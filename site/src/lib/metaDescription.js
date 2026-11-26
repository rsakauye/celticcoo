// Titles and meta descriptions for search results.
// A description is one or two finished sentences, at or under 155 characters.
// When a record is too long, the cut lands on a word and never on a comma,
// colon, dash, or ellipsis.

export const DESCRIPTION_MAX = 155;
export const TITLE_SUFFIX = ' · The Celtic Coo';
export const TITLE_MAX = 60;
export const TITLE_ROOM = TITLE_MAX - TITLE_SUFFIX.length;

export const HOME_DESCRIPTION = 'Find Highland Games, ceilidhs, pipe bands and Celtic festivals across Canada, plus the shops, clubs and performers that keep the season going.';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripDangling(text) {
  let out = clean(text);
  let prev = '';
  while (out && out !== prev) {
    prev = out;
    out = out.replace(/(?:\.{2,}|…)+$/u, '').replace(/[\s,;:|/\\~+&([{·•\u2013\u2014'"-]+$/u, '').trim();
  }
  return out;
}

// Keep whole words only. max is a character cap. An over-long single word
// is dropped rather than sliced in the middle.
export function trimAtWord(text, max) {
  const limit = Number(max);
  let body = clean(text);
  if (!body || !Number.isFinite(limit) || limit < 1) return '';
  if (body.length > limit) {
    const cut = body.slice(0, limit);
    const next = body[limit] || '';
    const endedOnSpace = /\s/.test(cut[cut.length - 1] || '');
    const nextIsBreak = next === '' || /\s/.test(next);
    if (!endedOnSpace && !nextIsBreak) {
      const space = cut.lastIndexOf(' ');
      body = space > 0 ? cut.slice(0, space) : '';
    } else {
      body = cut;
    }
    body = body.trim();
  }
  return stripDangling(body);
}

function finishSentence(text, limit) {
  let out = stripDangling(text);
  if (!out) return '';
  if (/[.!?]$/.test(out)) return out.length <= limit ? out : trimAtWord(out, limit);
  if (out.length + 1 <= limit) return `${out}.`;
  const shorter = trimAtWord(out, limit - 1);
  return shorter ? `${shorter}.` : '';
}

// Trim to a finished sentence. Prefer the last full sentence that fits.
// Otherwise cut at a word boundary and close with a period.
export function trimMetaDescription(text, max = DESCRIPTION_MAX) {
  const limit = Number(max);
  const source = clean(text);
  if (!source || !Number.isFinite(limit) || limit < 1) return '';
  if (source.length <= limit) return finishSentence(source, limit);
  const window = source.slice(0, limit);
  let best = -1;
  for (let i = 0; i < window.length; i++) {
    const ch = window[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    const next = window[i + 1];
    const prev = window[i - 1];
    if (next && next !== ' ') continue;
    if (prev && /\d/.test(prev) && next && /\d/.test(next)) continue;
    if (i + 1 >= 40) best = i;
  }
  if (best >= 0) return window.slice(0, best + 1).trim();
  return finishSentence(trimAtWord(source, limit), limit);
}

const TITLE_TAIL = /(?:\s+(?:at|of|the|and|with|for|in|a|an|or|&|to))+$/i;

function polishTitle(text, room) {
  let out = trimAtWord(text, room);
  let prev = '';
  while (out && out !== prev) {
    prev = out;
    const open = out.lastIndexOf('(');
    const close = out.lastIndexOf(')');
    if (open >= 0 && open > close) out = out.slice(0, open);
    out = out.replace(TITLE_TAIL, '');
    out = stripDangling(out);
  }
  return out.trim();
}

export function chooseSearchTitle(candidates, room = TITLE_ROOM) {
  const list = (Array.isArray(candidates) ? candidates : [candidates])
    .map((item) => clean(item))
    .filter(Boolean);
  if (!list.length) return '';
  const fit = list.find((item) => item.length <= room);
  if (fit) return fit;
  return polishTitle(list[list.length - 1], room);
}

function townOf(record) {
  const given = clean(record?.town);
  if (given) return given;
  const city = clean(record?.city);
  const cityOk = city && city !== 'National' ? city : '';
  const region = clean(record?.regionLabel);
  const regionOk = region && region !== cityOk ? region : '';
  return [cityOk, regionOk].filter(Boolean).join(', ');
}

function placeClause(venue, town) {
  if (venue && town) return `at ${venue} in ${town}`;
  if (venue) return `at ${venue}`;
  if (town) return `in ${town}`;
  return '';
}

function article(word) {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function pickDescription(lines) {
  const ready = lines.map(clean).filter(Boolean);
  const fit = ready.find((line) => line.length <= DESCRIPTION_MAX);
  return trimMetaDescription(fit || ready[ready.length - 1] || '');
}

export function eventPageTitle(event) {
  const name = clean(event?.name);
  const when = clean(event?.when);
  const city = clean(event?.city);
  return chooseSearchTitle([
    name && when && city ? `${name}: ${when}, ${city}` : '',
    name && city ? `${name}, ${city}` : '',
    name,
  ]);
}

export function eventMetaDescription(event) {
  const name = clean(event?.name) || 'This event';
  const when = clean(event?.when || event?.date);
  const venue = clean(event?.venue);
  const town = townOf(event);
  const place = placeClause(venue, town);
  return pickDescription([
    when && place ? `${name} is on ${when} ${place}.` : '',
    when && town ? `${name} is on ${when} in ${town}.` : '',
    when ? `${name} is on ${when}.` : '',
    place ? `${name} is ${place}.` : '',
    `${name} is a Celtic event.`,
  ]);
}

export function groupPageTitle(club, place = '') {
  const name = clean(club?.name);
  const where = clean(place);
  return chooseSearchTitle([
    name && where ? `${name} in ${where}` : '',
    name,
  ]);
}

export function groupMetaDescription(club) {
  const name = clean(club?.name) || 'This group';
  const kind = clean(club?.kind || club?.type) || 'group';
  const town = townOf(club);
  const note = clean(club?.note);
  const lead = town
    ? `${name} is ${article(kind)} ${kind} in ${town}.`
    : `${name} is ${article(kind)} ${kind}.`;
  const noteSentence = note ? (note.match(/[.!?]$/) ? note : `${note}.`) : '';
  return pickDescription([
    noteSentence ? `${lead} ${noteSentence}` : '',
    lead,
  ]);
}

export function performerMetaDescription(person) {
  const name = clean(person?.name) || 'This performer';
  const acts = Array.isArray(person?.acts)
    ? person.acts.map(clean).filter(Boolean).join(', ')
    : clean(person?.act);
  const who = acts ? `${name} (${acts})` : name;
  const when = clean(person?.when || person?.date);
  const venue = clean(person?.venue);
  const town = townOf(person);
  const place = placeClause(venue, town);
  return pickDescription([
    when && place ? `${who} is on ${when} ${place}.` : '',
    when && town ? `${who} is on ${when} in ${town}.` : '',
    town ? `${who} is based in ${town}.` : '',
    place ? `${who} is based ${place}.` : '',
    `${who} is a Celtic performer.`,
  ]);
}

export function shopMetaDescription(shop) {
  const name = clean(shop?.name) || 'This shop';
  const kind = clean(shop?.category || shop?.kind || shop?.type) || 'Celtic shop';
  const town = townOf(shop);
  const lead = town
    ? `${name} is ${article(kind)} ${kind} in ${town}.`
    : `${name} is ${article(kind)} ${kind}.`;
  return pickDescription([lead]);
}
