import verified from '../../../data/events_2027.json' with { type: 'json' };
import pendingRaw from '../../../data/events_2027_pending.json' with { type: 'json' };
import manualRaw from '../../../data/events_manual.json' with { type: 'json' };
import shopsRaw from '../../../data/shops_canada.json' with { type: 'json' };
import groupsRaw from '../../../data/groups_canada.json' with { type: 'json' };
import burnsRaw from '../../../data/burns_2027.json' with { type: 'json' };
import championsRaw from '../../../data/season_champions.json' with { type: 'json' };
import { uniqueClubSlugs } from './groupProfiles.js';

// ---------- helpers ----------
export const slugify = (s) => String(s).toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function eventKey(e) {
  return slugify(`${e.name}-${e.start_date}`);
}

// Organizer-submitted rows need a real date, place, and name before they join the calendar.
export function manualEventRows(manual) {
  return (Array.isArray(manual) ? manual : []).filter((e) => (
    e && typeof e.name === 'string' && e.name.trim()
    && ISO_DATE.test(e.start_date || '')
    && typeof e.city === 'string' && e.city.trim()
    && typeof e.province_or_region === 'string' && e.province_or_region.trim()
    && typeof e.country === 'string' && e.country.trim()
  ));
}

// The researched file wins when the same name and date are already listed there.
export function mergeManualEvents(verifiedEvents, manual) {
  const seen = new Set((verifiedEvents || []).map(eventKey));
  const extra = [];
  for (const e of manualEventRows(manual)) {
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(e);
  }
  return [...(verifiedEvents || []), ...extra];
}

function hostName(e) {
  const orgs = Array.isArray(e.organizer) ? e.organizer : e.organizer ? [e.organizer] : [];
  const names = orgs.map((o) => (typeof o === 'string' ? o : o?.name)).filter((n) => typeof n === 'string' && n.trim());
  return names.map((n) => n.trim()).join(' / ') || e.name;
}

// Burns suppers submitted by a host also join the Burns Night list. An existing host+city row is kept.
export function manualBurnsRows(manual, existing = []) {
  const ids = new Set((existing || []).map((r) => slugify(`${r.host}-${r.city}`)));
  const rows = [];
  for (const e of manualEventRows(manual)) {
    if (!/burns/i.test(String(e.type || ''))) continue;
    const host = hostName(e);
    const row = {
      name: e.name,
      date: e.start_date,
      city: e.city,
      province: e.province_or_region,
      host,
      status: (typeof e.status === 'string' && e.status.trim())
        || (e.source_kind === 'organizer' ? 'confirmed (date from organizer)' : 'listed (manual)'),
      ticket_info_url: e.source_url,
      source_url: e.source_url,
      notes: e.notes || '',
    };
    const id = slugify(`${row.host}-${row.city}`);
    if (ids.has(id)) continue;
    ids.add(id);
    rows.push(row);
  }
  return rows;
}

export function sourceLinkLabel(kind) {
  if (kind === 'official') return 'Official site';
  if (kind === 'organizer') return "Organizer's site";
  return 'Association listing';
}

export function dateConfirmLine(kind) {
  if (kind === 'organizer') return 'The host submitted this date directly. It is not on their website yet.';
  if (kind === 'official') return "We confirmed this date on the organizer's own website.";
  return "We confirmed this date on the association's own website.";
}

const PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', SK: 'Saskatchewan', MB: 'Manitoba', ON: 'Ontario', QC: 'Quebec',
  NB: 'New Brunswick', NS: 'Nova Scotia', PE: 'Prince Edward Island', NL: 'Newfoundland and Labrador',
  YT: 'Yukon', NT: 'Northwest Territories', NU: 'Nunavut',
};
export const regionName = (r) => PROVINCES[r] || r;
// Verified on-site features (from the organizer's own pages; see features_source).
export const FEATURES = { 'clan-tents': ['🛡️', 'Clan tents'], 'vendor-village': ['🛍️', 'Vendor village'], 'heavy-events': ['🪵', 'Heavy events'] };
export const COUNTRY_FLAG = { Canada: '🇨🇦', USA: '🇺🇸', UK: '🇬🇧', France: '🇫🇷' };

// Friendly categories for filtering (raw research types are kept for display).
// The cultural checks have to come first. "St. Patrick's Dinner & Dance" contains
// "dance", and "Performance (concert)" would otherwise fall through to Festivals.
export function category(type) {
  const t = String(type).toLowerCase();
  if (t.includes('parade')) return 'Parades';
  if (t.includes('ceilidh') || t.includes('ceili')) return 'Ceilidhs';
  if (/performance|concert|demo/.test(t)) return 'Performances & demos';
  if (/cultural|tartan day|kirkin|st\.?\s*patrick|heritage/.test(t)) return 'Cultural celebrations';
  if (t.includes('burns')) return 'Burns Night';
  if (t.includes('tattoo')) return 'Military tattoo';
  if (t.includes('market')) return 'Markets';
  if (t.includes('dance')) return 'Highland dance';
  if (t.includes('pipe') || t.includes('piping') || t.includes('drum')) return 'Pipes & drums';
  if (t.includes('heavy')) return 'Heavy events';
  if (t.includes('gaelic')) return 'Gaelic language';
  if (t.includes('highland games')) return 'Highland Games';
  if (t.includes('music') || t.includes('school')) return 'Celtic music';
  return 'Festivals';
}
export const CATEGORY_EMOJI = {
  'Highland Games': '🏋️', 'Pipes & drums': '🥁', 'Highland dance': '💃', 'Heavy events': '🪵',
  'Gaelic language': '🗣️', 'Celtic music': '🎻', 'Festivals': '🎉', 'Burns Night': '🥃', 'Military tattoo': '🎖️', 'Markets': '🎄',
  'Parades': '🎺', 'Ceilidhs': '🪗', 'Performances & demos': '🎭', 'Cultural celebrations': '🎊',
};

// Tags are a fixed list. Every tag on a dated event needs a verbatim tag_quotes entry.
export const TAG_LABEL = {
  'highland-games': 'Highland Games', 'pipe-band': 'Pipe bands', 'highland-dance': 'Highland dance',
  'scottish-country-dance': 'Scottish country dance', ceilidh: 'Ceilidh', burns: 'Burns',
  'st-andrews': "St Andrew's", music: 'Music', 'heavy-events': 'Heavy events', 'ball-formal': 'Ball / formal',
  'workshop-class': 'Workshops & classes', irish: 'Irish', 'family-friendly': 'Family-friendly',
  parade: 'Parade', 'tartan-day': 'Tartan Day', 'st-patricks': "St. Patrick's", other: 'Other',
};

// cost is free or paid only when the organizer's page says so. Anything else is unknown.
export function normCost(e) {
  const stated = e && e.cost != null && String(e.cost).trim() !== '';
  if (stated) {
    const raw = String(e.cost).trim().toLowerCase();
    if (raw === 'free' || raw === 'paid' || raw === 'unknown') return raw;
    return 'unknown';
  }
  const price = e?.offers?.price;
  if (price === 0) return 'free';
  if (typeof price === 'number' && Number.isFinite(price) && price > 0) return 'paid';
  return 'unknown';
}

function costQuote(e) {
  return typeof e?.cost_quote === 'string' ? e.cost_quote : '';
}

function costSource(e) {
  return typeof e?.cost_source === 'string' && e.cost_source.trim() ? e.cost_source.trim() : '';
}

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
// events_manual.json is merged here. Deploy and the weekly source check do not rewrite that file.
export function decorateEvent(e) {
  return {
    ...e,
    end_date: e.end_date || e.start_date,
    id: slugify(`${e.name}-${e.start_date}`),
    category: category(e.type),
    region: e.province_or_region,
    regionLabel: regionName(e.province_or_region),
    note: publicNote(e.notes),
    when: dateRange(e.start_date, e.end_date || e.start_date),
    isCanada: e.country === 'Canada',
    cost: normCost(e),
    cost_quote: costQuote(e),
    cost_source: costSource(e),
  };
}

export const events = mergeManualEvents(verified, manualRaw).map(decorateEvent)
  .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));

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
    features: e.features || [],
    features_source: e.features_source || '',
    id: slugify(e.name),
    cost: normCost(e),
    cost_quote: costQuote(e),
    cost_source: costSource(e),
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
  free: events.filter((e) => e.cost === 'free').length,
};

// ---------- clubs, groups & lessons ----------

// Friendly group types for filtering; the raw research type is kept for display.
export function groupKind(type) {
  const t = String(type).toLowerCase();
  if (t.includes('heavy')) return 'Heavy events';
  if (t.includes('trad session')) return 'Trad sessions';
  if (t.includes('whisky')) return 'Whisky societies';
  if (t.includes('clan')) return 'Clan society';
  if (t.includes('re-enactment')) return 'Pipe band / living history';
  if (t.includes('pipe band association')) return 'Association';
  if (t.includes('pipe band') || t.includes('piping')) return 'Pipe band / piping';
  if (t.includes('country dance')) return 'Scottish country dance';
  if (t.includes('highland dance')) return t.includes('association') ? 'Association' : 'Highland dance';
  if (t.includes('gaelic')) return 'Gaelic';
  if (t.includes('irish') || t.includes('welsh')) return 'Irish & Welsh';
  if (t.includes('umbrella')) return 'Association';
  return 'Scottish society & Burns club';
}
export const GROUP_EMOJI = {
  'Clan society': '🛡️', 'Pipe band / piping': '🥁', 'Pipe band / living history': '🎖️', 'Highland dance': '💃',
  'Scottish country dance': '👯', 'Gaelic': '🗣️', 'Irish & Welsh': '☘️', 'Scottish society & Burns club': '🏴', 'Association': '🏛️', 'Heavy events': '🪵', 'Trad sessions': '🎻', 'Whisky societies': '🥃',
};
const FEATURED_GROUP = '78th Fraser Highlanders Fort Calgary Garrison Youth Squad';
const pName = (p) => (p === 'National' ? 'National / multi-province' : regionName(p));
const groupIds = uniqueClubSlugs(groupsRaw.map((g) => g.name));
export const groups = groupsRaw.map((g, i) => ({
  ...g,
  id: groupIds[i],
  kind: groupKind(g.type),
  regionLabel: pName(g.province),
  lessons: g.offers_lessons === 'y',
  featured: g.name === FEATURED_GROUP,
})).sort((a, b) => (a.province === 'AB' ? -1 : 0) - (b.province === 'AB' ? -1 : 0) || (a.province === 'National' ? 1 : 0) - (b.province === 'National' ? 1 : 0)
  || a.province.localeCompare(b.province) || sortName(a.name).localeCompare(sortName(b.name)));
export const featuredGroup = groups.find((g) => g.featured);

// ---------- Burns Night 2027 ----------
// status: "confirmed (...)" = host, organizer, or venue page, or a date the host submitted directly.
// "listed (...)" = secondary source; "date TBA".
export const burns = [...burnsRaw, ...manualBurnsRows(manualRaw, burnsRaw)].map((r) => {
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
