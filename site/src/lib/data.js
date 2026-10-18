import verified from '../../../data/events_2027.json';
import pendingRaw from '../../../data/events_2027_pending.json';
import shopsRaw from '../../../data/shops_canada.json';
import groupsRaw from '../../../data/groups_canada.json';
import burnsRaw from '../../../data/burns_2027.json';
import championsRaw from '../../../data/season_champions.json';

// ---------- helpers ----------
export const slugify = (s) => String(s).toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', SK: 'Saskatchewan', MB: 'Manitoba', ON: 'Ontario', QC: 'Quebec',
  NB: 'New Brunswick', NS: 'Nova Scotia', PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador',
  YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
};
export const regionName = (r) => PROVINCES[r] || r;
export const COUNTRY_FLAG = { Canada: '🇨🇦', USA: '🇺🇸', UK: '🇬🇧', France: '🇫🇷' };

// Friendly categories for filtering (raw research types are kept for display).
export function category(type) {
  const t = String(type).toLowerCase();
  if (t.includes('burns')) return 'Burns Night';
  if (t.includes('dance')) return 'Highland dance';
  if (t.includes('pipe') || t.includes('piping') || t.includes('drum') || t.includes('tattoo')) return 'Pipes & drums';
  if (t.includes('heavy')) return 'Heavy events';
  if (t.includes('gaelic')) return 'Gaelic language';
  if (t.includes('highland games')) return 'Highland Games';
  if (t.includes('music') || t.includes('school')) return 'Celtic music';
  return 'Festivals';
}
export const CATEGORY_EMOJI = {
  'Highland Games': '🏋️', 'Pipes & drums': '🥁', 'Highland dance': '💃', 'Heavy events': '🪵',
  'Gaelic language': '🗣️', 'Celtic music': '🎻', 'Festivals': '🎉', 'Burns Night': '🥃',
};

// Research notes include internal sourcing remarks; only publish venue-style snippets.
const INTERNAL = /(bcpa|lists|official site|search|faq|optimist|sanctioned|schedule|champions|also tourism|tickets)/i;
const publicNote = (n) => String(n || '').split(';').map((s) => s.trim()).filter((s) => s && !INTERNAL.test(s)).join(' · ');

const fmtDay = (iso, opts) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA', { timeZone: 'UTC', ...opts });
export function dateRange(start, end) {
  if (!end || end === start) return fmtDay(start, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const [sy, sm] = start.split('-'); const [ey, em] = end.split('-');
  if (sy === ey && sm === em) return `${fmtDay(start, { month: 'short', day: 'numeric' })}–${Number(end.slice(8))}, ${ey}`;
  if (sy === ey) return `${fmtDay(start, { month: 'short', day: 'numeric' })} – ${fmtDay(end, { month: 'short', day: 'numeric' })}, ${ey}`;
  return `${fmtDay(start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDay(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// "Today" in Alberta at build time; pages also hide past events client-side.
export const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' });

// ---------- events ----------
export const events = verified.map((e) => ({
  ...e,
  end_date: e.end_date || e.start_date,
  id: slugify(`${e.name}-${e.start_date}`),
  category: category(e.type),
  region: e.province_or_region,
  regionLabel: regionName(e.province_or_region),
  note: publicNote(e.notes),
  when: dateRange(e.start_date, e.end_date || e.start_date),
  isCanada: e.country === 'Canada',
})).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));

export const upcoming = events.filter((e) => e.end_date >= TODAY);

// Pending events: published ONLY as "Date TBA" (no tentative dates shown), Canada only.
export const tba = pendingRaw
  .filter((e) => e.country === 'Canada')
  .map((e) => ({
    name: e.name.replace(/\s*\((\d+)(st|nd|rd|th)\)\s*$/, ''),
    city: /tbc/i.test(e.city) ? '' : e.city,
    region: e.province_or_region,
    regionLabel: regionName(e.province_or_region),
    country: e.country,
    category: category(e.type),
    type: e.type,
    source_url: e.source_url,
    id: slugify(e.name),
  }))
  .sort((a, b) => (a.region === 'AB' ? -1 : 0) - (b.region === 'AB' ? -1 : 0) || a.region.localeCompare(b.region) || a.name.localeCompare(b.name));

// ---------- shops ----------
const sortName = (n) => n.replace(/^the\s+/i, '');
const SHOP_INTERNAL = /(russell|sponsor|contact|owners in|home-based)/i;
export const shops = shopsRaw.map((s) => ({
  ...s,
  id: slugify(s.name),
  regionLabel: regionName(s.province),
  isMaker: /maker/i.test(s.category),
  category: s.category.replace(/\s*\(maker\)\s*/i, '').trim(),
  note: String(s.notes || '').split(';').map((x) => x.trim()).filter((x) => x && !SHOP_INTERNAL.test(x)).join(' · '),
})).sort((a, b) => a.province.localeCompare(b.province) || sortName(a.name).localeCompare(sortName(b.name)));

// Featured shops on the home page: Alberta first (launch market), then one per other province.
export const featuredShops = (() => {
  const out = [];
  for (const [p, n] of [['AB', 2], ['BC', 1], ['ON', 2], ['NS', 1]]) out.push(...shops.filter((x) => x.province === p).slice(0, n));
  return out.slice(0, 6);
})();

export const counts = {
  events: events.length,
  canadaEvents: events.filter((e) => e.isCanada).length,
  provinces: new Set(events.filter((e) => e.isCanada).map((e) => e.region)).size,
  tba: tba.length,
  shops: shops.length,
};

// ---------- clubs, groups & lessons ----------

// Friendly group types for filtering; the raw research type is kept for display.
export function groupKind(type) {
  const t = String(type).toLowerCase();
  if (t.includes('clan')) return 'Clan society';
  if (t.includes('re-enactment')) return 'Pipe band / living history';
  if (t.includes('pipe band association')) return 'Association';
  if (t.includes('pipe band') || t.includes('piping')) return 'Pipe band / piping';
  if (t.includes('country dance')) return 'Scottish country dance';
  if (t.includes('highland dance')) return t.includes('association') ? 'Association' : 'Highland dance';
  if (t.includes('gaelic')) return 'Gaelic';
  if (t.includes('irish') || t.includes('welsh')) return 'Irish & Welsh';
  if (t.includes('heavy') || t.includes('umbrella')) return 'Association';
  return 'Scottish society & Burns club';
}
export const GROUP_EMOJI = {
  'Clan society': '🛡️', 'Pipe band / piping': '🥁', 'Pipe band / living history': '🎖️', 'Highland dance': '💃',
  'Scottish country dance': '👯', 'Gaelic': '🗣️', 'Irish & Welsh': '☘️', 'Scottish society & Burns club': '🥃', 'Association': '🏛️',
};
const FEATURED_GROUP = '78th Fraser Highlanders Fort Calgary Garrison Youth Squad';
const pName = (p) => (p === 'National' ? 'National / multi-province' : regionName(p));
export const groups = groupsRaw.map((g) => ({
  ...g,
  id: slugify(g.name),
  kind: groupKind(g.type),
  regionLabel: pName(g.province),
  lessons: g.offers_lessons === 'y',
  featured: g.name === FEATURED_GROUP,
})).sort((a, b) => (a.province === 'AB' ? -1 : 0) - (b.province === 'AB' ? -1 : 0) || (a.province === 'National' ? 1 : 0) - (b.province === 'National' ? 1 : 0)
  || a.province.localeCompare(b.province) || sortName(a.name).localeCompare(sortName(b.name)));
export const featuredGroup = groups.find((g) => g.featured);

// ---------- Burns Night 2027 ----------
// status: "confirmed (...)" = host/organizer/venue page; "listed (...)" = secondary source; "date TBA".
export const burns = burnsRaw.map((r) => {
  const dated = /^\d{4}-\d\d-\d\d$/.test(r.date);
  return {
    ...r,
    id: slugify(`${r.host}-${r.city}`),
    dated,
    confirmed: dated && /^confirmed/i.test(r.status),
    unconfirmed: dated && !/^confirmed/i.test(r.status),
    regionLabel: regionName(r.province),
    when: dated ? dateRange(r.date, r.date) : 'Usually late January, watch their page',
  };
}).sort((a, b) => (a.dated === b.dated ? 0 : a.dated ? -1 : 1) || (a.dated ? a.date.localeCompare(b.date) : 0) || (a.province === 'AB' ? -1 : 0) - (b.province === 'AB' ? -1 : 0) || a.city.localeCompare(b.city));

// ---------- season champions (band level only, hand-entered with sources) ----------
export const champions = championsRaw;

counts.groups = groups.length;
counts.groupsLessons = groups.filter((g) => g.lessons).length;
counts.clans = groups.filter((g) => g.kind === 'Clan society').length;
counts.burnsConfirmed = burns.filter((b) => b.confirmed).length;
counts.burnsUnconfirmed = burns.filter((b) => b.unconfirmed).length;
counts.burnsTba = burns.filter((b) => !b.dated).length;
