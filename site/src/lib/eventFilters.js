// Shared by the events page and the tests. A card shows when every active
// filter matches. freeOnly keeps events whose cost is exactly "free".
// An empty country still matches every country. The events page uses
// filtersForList() when it wants the Canada-first default.

const CATEGORIES = [
  ['Highland Games', 'highland-games'],
  ['Pipes & drums', 'pipes-drums'],
  ['Highland dance', 'highland-dance'],
  ['Heavy events', 'heavy-events'],
  ['Gaelic language', 'gaelic'],
  ['Celtic music', 'celtic-music'],
  ['Festivals', 'festivals'],
  ['Burns Night', 'burns'],
  ['Military tattoo', 'tattoo'],
  ['Markets', 'markets'],
  ['Parades', 'parades'],
  ['Ceilidhs', 'ceilidh'],
  ['Performances & demos', 'performances'],
  ['Cultural celebrations', 'cultural'],
];

const SLUG_TO_CATEGORY = Object.fromEntries(CATEGORIES.map(([name, slug]) => [slug, name]));
Object.assign(SLUG_TO_CATEGORY, {
  'pipe-band': 'Pipes & drums',
  pipes: 'Pipes & drums',
  piping: 'Pipes & drums',
  'pipes-and-drums': 'Pipes & drums',
  dance: 'Highland dance',
  ceilidhs: 'Ceilidhs',
  ceili: 'Ceilidhs',
  'gaelic-language': 'Gaelic language',
  'performances-and-demos': 'Performances & demos',
  'burns-night': 'Burns Night',
  'heavy-events-championship': 'Heavy events',
});

const MONTH_RE = /^\d{4}-\d{2}$/;

export function blankFilters() {
  return {
    country: '',
    region: '',
    cat: '',
    feat: '',
    tags: [],
    freeOnly: false,
    past: false,
    month: '',
    includeIntl: false,
  };
}

export function slugForCategory(cat) {
  const found = CATEGORIES.find(([name]) => name === cat);
  return found ? found[1] : String(cat || '').trim();
}

function typeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function categoryFromTypeParam(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fromSlug = SLUG_TO_CATEGORY[typeSlug(raw)];
  if (fromSlug) return fromSlug;
  const exact = CATEGORIES.find(([name]) => name.toLowerCase() === raw.toLowerCase());
  return exact ? exact[0] : raw;
}

export function eventMatches(el, filters = {}) {
  const country = filters.country || '';
  const region = filters.region || '';
  const cat = filters.cat || '';
  const feat = filters.feat || '';
  const tags = Array.isArray(filters.tags) ? filters.tags : [];
  const features = el?.features == null ? '' : String(el.features);
  const tagStr = el?.tags == null ? '' : String(el.tags);
  const past = el?.past === true || el?.past === '1';
  const month = filters.month || '';
  const start = el?.start || el?.start_date || el?.month || '';
  return (!country || el?.country === country)
    && (!region || el?.region === region)
    && (!cat || el?.cat === cat)
    && (!feat || ` ${features} `.includes(` ${feat} `))
    && (filters.past || !past)
    && (!tags.length || tags.some((t) => ` ${tagStr} `.includes(` ${t} `)))
    && (!filters.freeOnly || el?.cost === 'free')
    && (!month || String(start).startsWith(month));
}

// Where a card lives. International events stay in the trip section unless
// the reader includes them, or an older country link asks for that country.
export function listHome(el, filters = {}) {
  const intl = !!(el && el.country && el.country !== 'Canada');
  if (!intl) return 'main';
  if (filters.country && filters.country !== 'Canada') return 'main';
  if (filters.includeIntl && !filters.region) return 'main';
  return 'abroad';
}

export function filtersForList(filters = {}, list) {
  const base = {
    region: filters.region || '',
    cat: filters.cat || '',
    feat: filters.feat || '',
    tags: Array.isArray(filters.tags) ? filters.tags : [],
    freeOnly: !!filters.freeOnly,
    past: !!filters.past,
    month: filters.month || '',
    country: '',
  };
  if (list === 'abroad') return { ...base, region: '', country: '' };
  if (filters.country && filters.country !== 'Canada') return { ...base, country: filters.country };
  if (filters.includeIntl && !filters.region) return { ...base, country: '' };
  return { ...base, country: 'Canada' };
}

export function eventInList(el, filters = {}, list) {
  const home = listHome(el, filters);
  if (list && home !== list) return false;
  // A province is a Canadian place. It does not leave the trip list showing underneath.
  if (home === 'abroad' && filters.region) return false;
  return eventMatches(el, filtersForList(filters, home));
}

// Plain words for a published international event whose existing notes or
// source already tie it to a Canadian pipe-band association or band.
// There is no separate field for this. Canadian events return an empty string.
export function canadianConnection(event) {
  if (!event || event.country === 'Canada' || event.isCanada === true) return '';
  const notes = String(event.notes || '');
  const source = String(event.source_url || '');
  const hay = `${notes}\n${source}`.toLowerCase();
  const band = /(^|[^a-z])sfu([^a-z]|$)/.test(hay) || hay.includes('simon fraser');
  const bcpa = hay.includes('bcpa') || hay.includes('bcpipers.org');
  if (band || bcpa) return 'Canadian bands competing';
  return '';
}

export function filtersFromSearch(search) {
  const raw = String(search || '');
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  const month = params.get('month') || '';
  return {
    country: params.get('country') || '',
    region: params.get('prov') || params.get('region') || '',
    cat: categoryFromTypeParam(params.get('type') || ''),
    feat: params.get('feature') || '',
    tags: (params.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean),
    freeOnly: params.get('free') === '1',
    past: params.get('past') === '1',
    month: MONTH_RE.test(month) ? month : '',
    includeIntl: params.get('intl') === '1',
  };
}

export function searchFromFilters(filters = {}) {
  const q = new URLSearchParams();
  if (filters.region) q.set('prov', filters.region);
  if (filters.cat) q.set('type', slugForCategory(filters.cat));
  if (filters.month && MONTH_RE.test(filters.month)) q.set('month', filters.month);
  if (filters.country && filters.country !== 'Canada') q.set('country', filters.country);
  if (filters.feat) q.set('feature', filters.feat);
  if (filters.tags && filters.tags.length) q.set('tags', filters.tags.join(','));
  if (filters.freeOnly) q.set('free', '1');
  if (filters.past) q.set('past', '1');
  if (filters.includeIntl) q.set('intl', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function activeChips(filters = {}, labels = {}) {
  const chips = [];
  const regionLabel = labels.region || {};
  const monthLabel = labels.month || {};
  const featLabel = labels.feat || {};
  const tagLabel = labels.tags || {};
  if (filters.country && filters.country !== 'Canada') {
    chips.push({ key: 'country', value: filters.country, label: filters.country });
  }
  if (filters.region) {
    chips.push({ key: 'region', value: filters.region, label: regionLabel[filters.region] || filters.region });
  }
  if (filters.cat) chips.push({ key: 'cat', value: filters.cat, label: filters.cat });
  if (filters.month) {
    chips.push({ key: 'month', value: filters.month, label: monthLabel[filters.month] || filters.month });
  }
  if (filters.feat) {
    chips.push({ key: 'feat', value: filters.feat, label: featLabel[filters.feat] || filters.feat });
  }
  for (const tag of filters.tags || []) {
    chips.push({ key: 'tag', value: tag, label: tagLabel[tag] || tag });
  }
  if (filters.freeOnly) chips.push({ key: 'free', value: '1', label: 'Free only' });
  if (filters.past) chips.push({ key: 'past', value: '1', label: 'Past events' });
  if (filters.includeIntl) chips.push({ key: 'intl', value: '1', label: 'Outside Canada included' });
  return chips;
}

// A province is a place in Canada, so the outside-Canada control is not offered.
export function showIntlToggle(filters = {}) {
  return !filters.region;
}

// The empty state has its own clear button. Hide the bar link when nothing matched.
export function showClearLink(resultCount, activeCount) {
  return resultCount > 0 && activeCount > 0;
}

// Drop a tag whose label repeats the type chip already on the event page.
export function visibleTags(event, tagLabels = {}) {
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  const names = [event?.category, event?.cat, event?.type]
    .filter((value) => value != null && String(value).trim() !== '')
    .map((value) => String(value).trim().toLowerCase());
  return tags.filter((tag) => {
    const label = String(tagLabels[tag] || tag).trim().toLowerCase();
    return !names.includes(label);
  });
}

export function emptyMessage(mainCount, abroadCount) {
  if (mainCount > 0) return { show: false, lead: '', link: '', tail: '' };
  if (abroadCount > 0) {
    return {
      show: true,
      lead: 'No Canadian events match those filters. Try another province or month, or see ',
      link: 'Worth the trip',
      tail: '.',
    };
  }
  return {
    show: true,
    lead: 'No events match those filters. Try another province, type, or month.',
    link: '',
    tail: '',
  };
}

export function resultLabel(count) {
  const n = Number(count) || 0;
  return `${n} ${n === 1 ? 'event' : 'events'}`;
}
