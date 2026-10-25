// Shared by the events page and the tests. A card shows when every active
// filter matches. freeOnly keeps events whose cost is exactly "free".

export function eventMatches(el, filters = {}) {
  const country = filters.country || '';
  const region = filters.region || '';
  const cat = filters.cat || '';
  const feat = filters.feat || '';
  const tags = Array.isArray(filters.tags) ? filters.tags : [];
  const features = el?.features == null ? '' : String(el.features);
  const tagStr = el?.tags == null ? '' : String(el.tags);
  const past = el?.past === true || el?.past === '1';
  return (!country || el?.country === country)
    && (!region || el?.region === region)
    && (!cat || el?.cat === cat)
    && (!feat || ` ${features} `.includes(` ${feat} `))
    && (filters.past || !past)
    && (!tags.length || tags.some((t) => ` ${tagStr} `.includes(` ${t} `)))
    && (!filters.freeOnly || el?.cost === 'free');
}

export function filtersFromSearch(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    country: params.get('country') || '',
    region: params.get('region') || '',
    cat: params.get('type') || '',
    feat: params.get('feature') || '',
    tags: (params.get('tags') || '').split(',').filter(Boolean),
    freeOnly: params.get('free') === '1',
  };
}

export function searchFromFilters(filters = {}) {
  const q = new URLSearchParams();
  if (filters.country) q.set('country', filters.country);
  if (filters.region) q.set('region', filters.region);
  if (filters.cat) q.set('type', filters.cat);
  if (filters.feat) q.set('feature', filters.feat);
  if (filters.tags && filters.tags.length) q.set('tags', filters.tags.join(','));
  if (filters.freeOnly) q.set('free', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}
