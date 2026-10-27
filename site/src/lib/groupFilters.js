// Shared by the clubs page and the tests. A card shows when every active
// filter matches and every search word is in the name, city, province
// (code or name), type, or note. Matching ignores case and accents.

export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function groupSearchText(group = {}) {
  return [
    group.name,
    group.city,
    group.province,
    group.regionLabel,
    group.kind,
    group.type,
    group.note,
  ].filter((part) => part != null && String(part).trim() !== '').join(' ');
}

// One- and two-letter queries match the start of a word. A whole-word check
// made the first keystrokes ("c", "ca") match nothing, so every card was
// hidden while someone was still typing. "on" still does not match "toronto"
// or "demonstration", because those words do not start with "on".
function hasWord(hay, word) {
  if (word.length <= 2) return hay.split(' ').some((part) => part.startsWith(word));
  return hay.includes(word);
}

function wantsLessons(filters) {
  return filters.lessons === true || filters.lessons === '1' || filters.lessons === 'y';
}

function offersLessons(group) {
  return group?.lessons === true || group?.lessons === 'y';
}

export function groupMatches(group, filters = {}) {
  const province = filters.province || '';
  const kind = filters.kind || '';
  if (province && group?.province !== province) return false;
  if (kind && group?.kind !== kind) return false;
  if (wantsLessons(filters) && !offersLessons(group)) return false;
  const words = fold(filters.q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const source = group?.search != null && String(group.search).trim() !== ''
    ? group.search
    : groupSearchText(group);
  const hay = fold(source);
  return words.every((word) => hasWord(hay, word));
}

export function filtersFromSearch(search) {
  const raw = String(search || '');
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  return {
    province: params.get('province') || '',
    kind: params.get('type') || '',
    lessons: params.get('lessons') === '1',
    q: (params.get('q') || '').trim(),
  };
}

export function searchFromFilters(filters = {}) {
  const params = new URLSearchParams();
  if (filters.province) params.set('province', filters.province);
  if (filters.kind) params.set('type', filters.kind);
  if (wantsLessons(filters)) params.set('lessons', '1');
  const q = String(filters.q || '').trim();
  if (q) params.set('q', q);
  const s = params.toString();
  return s ? `?${s}` : '';
}
