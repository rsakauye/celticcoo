import verified from '../../../data/events_2027.json';
import pendingRaw from '../../../data/events_2027_pending.json';
import shopsRaw from '../../../data/shops_canada.json';

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
  'Gaelic language': '🗣️', 'Celtic music': '🎻', 'Festivals': '🎉',
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
