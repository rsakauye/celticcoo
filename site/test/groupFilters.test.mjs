import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groups } from '../src/lib/data.js';
import { fold, groupMatches, visibleMatches, groupSearchText, filtersFromSearch, searchFromFilters } from '../src/lib/groupFilters.js';

const slainte = groups.find((g) => g.name === 'Sláinte Social Club');
const calgary = groups.find((g) => g.name === 'Calgary Burns Club');
const toronto = groups.find((g) => g.city === 'Toronto');

test('fold ignores case, accents, and apostrophes', () => {
  assert.equal(fold('Sláinte'), 'slainte');
  assert.equal(fold('SLÁINTE'), 'slainte');
  assert.equal(fold('Gàidhlig'), 'gaidhlig');
  assert.equal(fold('Montréal'), 'montreal');
  assert.equal(fold('Québec'), 'quebec');
  assert.equal(fold("Hickey's"), 'hickeys');
  assert.equal(fold('St. Andrew’s'), 'st andrews');
  assert.equal(fold('  '), '');
});

test('slainte matches Sláinte Social Club on name, city, province, type, and note', () => {
  assert.ok(slainte);
  assert.equal(groupMatches(slainte, { q: 'slainte' }), true);
  assert.equal(groupMatches(slainte, { q: 'SLÁINTE' }), true);
  assert.equal(groupMatches(slainte, { q: 'Sláinte' }), true);
  assert.equal(groupMatches(slainte, { q: 'calgary' }), true);
  assert.equal(groupMatches(slainte, { q: 'AB' }), true);
  assert.equal(groupMatches(slainte, { q: 'alberta' }), true);
  assert.equal(groupMatches(slainte, { q: 'pipe' }), true);
  assert.equal(groupMatches(slainte, { q: 'chapelhow' }), true);
  assert.equal(groupMatches(slainte, { q: 'ceilidh band' }), true);
  assert.equal(groupMatches(slainte, { q: 'edmonton dance' }), false);
});

test('a short province code matches the code, not letters inside another word', () => {
  assert.equal(groupMatches(calgary, { q: 'ab' }), true);
  assert.equal(groupMatches(calgary, { q: 'Alberta' }), true);
  assert.equal(groupMatches(calgary, { q: 'on' }), false);
  assert.equal(groupMatches(toronto, { q: 'on' }), true);
  assert.equal(groupMatches(toronto, { q: 'Ontario' }), true);
  assert.equal(groupMatches(toronto, { q: 'AB' }), false);
  const quebec = groups.find((g) => g.name.includes('Québec'));
  assert.equal(groupMatches(quebec, { q: 'qc' }), true);
  assert.equal(groupMatches(quebec, { q: 'quebec' }), true);
});

test('the first letters of a word keep matching cards visible', () => {
  assert.equal(groupMatches(calgary, { q: 'c' }), true);
  assert.equal(groupMatches(calgary, { q: 'ca' }), true);
  assert.equal(groupMatches(calgary, { q: 'cal' }), true);
  assert.equal(groupMatches(toronto, { q: 't' }), true);
  assert.equal(groupMatches(toronto, { q: 'to' }), true);
  assert.equal(groups.filter((g) => groupMatches(g, { q: 'c' })).length > 0, true);
  assert.equal(groups.filter((g) => groupMatches(g, { q: 'ca' })).length > 0, true);
  assert.equal(groupMatches(calgary, { q: 'zz' }), false);
});

test('a throw while matching keeps every card visible', () => {
  const boom = { province: 'AB', kind: 'Pipe band / piping', lessons: false, get search() { throw new Error('blocked'); } };
  assert.deepEqual(visibleMatches([boom, calgary], { q: 'ca' }), [true, true]);
  assert.deepEqual(visibleMatches([calgary], filtersFromSearch('?q=calgary')), [true]);
});

test('accent-insensitive type and city search hits the real directory', () => {
  const gaelic = groups.filter((g) => groupMatches(g, { q: 'gaidhlig' }));
  assert.ok(gaelic.some((g) => g.name.includes('Gàidhlig')));
  const montreal = groups.filter((g) => groupMatches(g, { q: 'montreal' }));
  assert.ok(montreal.some((g) => /Montr[eé]al/i.test(g.name) || g.city === 'Montreal'));
  const hickey = groups.find((g) => g.name.includes("Hickey's"));
  assert.equal(groupMatches(hickey, { q: 'hickeys' }), true);
});

test('search and the province, type, and lessons filters all have to match', () => {
  assert.equal(groupMatches(slainte, { q: 'slainte', province: 'AB' }), true);
  assert.equal(groupMatches(slainte, { q: 'slainte', province: 'BC' }), false);
  assert.equal(groupMatches(slainte, { q: 'slainte', kind: slainte.kind }), true);
  assert.equal(groupMatches(slainte, { q: 'slainte', kind: 'Highland dance' }), false);
  assert.equal(groupMatches(slainte, { q: 'slainte', lessons: true }), false);
  assert.equal(groupMatches(slainte, { lessons: false }), true);
  const withLessons = groups.filter((g) => g.lessons);
  assert.ok(withLessons.length > 0);
  assert.ok(withLessons.every((g) => groupMatches(g, { lessons: true, q: ' ' })));
  assert.equal(groups.filter((g) => groupMatches(g, { lessons: true, province: 'AB', q: 'dance' })).every((g) => g.lessons && g.province === 'AB'), true);
});

test('a precomputed search string is what the card matches on', () => {
  const card = {
    province: 'NS',
    kind: 'Gaelic',
    lessons: 'y',
    search: groupSearchText({
      name: 'Colaisde na Gàidhlig',
      city: 'St. Anns',
      province: 'NS',
      regionLabel: 'Nova Scotia',
      kind: 'Gaelic',
      type: 'gaelic college',
      note: 'Lessons on the hill',
    }),
  };
  assert.equal(groupMatches(card, { q: 'gaidhlig' }), true);
  assert.equal(groupMatches(card, { q: 'nova scotia' }), true);
  assert.equal(groupMatches(card, { q: 'ns' }), true);
  assert.equal(groupMatches(card, { q: 'hill', lessons: 'y', kind: 'Gaelic' }), true);
  assert.equal(groupMatches(card, { q: 'hill', province: 'AB' }), false);
  assert.equal(groupMatches(card, { q: 'hill', lessons: 'n' }), true);
});

test('q round-trips in the same query string as the other filters', () => {
  const filters = { province: 'AB', kind: 'Clan society', lessons: true, q: '  macLeod  ' };
  assert.equal(searchFromFilters(filters), '?province=AB&type=Clan+society&lessons=1&q=macLeod');
  assert.deepEqual(filtersFromSearch(searchFromFilters(filters)), {
    province: 'AB', kind: 'Clan society', lessons: true, q: 'macLeod',
  });
  assert.equal(searchFromFilters({ q: '   ' }), '');
  assert.deepEqual(filtersFromSearch(''), { province: '', kind: '', lessons: false, q: '' });
  assert.equal(filtersFromSearch('?lessons=1').lessons, true);
  assert.equal(filtersFromSearch('?type=Clan+society').kind, 'Clan society');
  assert.equal(filtersFromSearch('?q=sl%C3%A1inte').q, 'sláinte');
  assert.equal(groupMatches(slainte, filtersFromSearch('?q=slainte&province=AB')), true);
});

test('the clubs page has an accessible search box wired to the shared filter', () => {
  const page = readFileSync(new URL('../src/pages/groups/index.astro', import.meta.url), 'utf8');
  assert.match(page, /id="g-q"/);
  assert.match(page, /type="search"/);
  assert.match(page, /for="g-q"/);
  assert.match(page, /id="g-clear"/);
  assert.match(page, /aria-label="Clear search"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /id="g-empty-clear"/);
  assert.match(page, /visibleMatches/);
  assert.match(page, /revealAll/);
  assert.match(page, /filtersFromSearch/);
  assert.match(page, /searchFromFilters/);
  assert.match(page, /data-search=\{groupSearchText\(g\)\}/);
  assert.match(page, /setTimeout\(apply, 200\)/);
  assert.match(page, /\.g-clear\[hidden\] \{ display:none !important; \}/);
  assert.match(page, /from '\.\.\/\.\.\/lib\/groupFilters\.js'/);
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(headers, /\/groups\/\n  Cache-Control: public, max-age=0, must-revalidate/);
  assert.match(headers, /\/_astro\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  const a11y = readFileSync(new URL('../public/a11y.js', import.meta.url), 'utf8');
  assert.match(a11y, /catch \(e\) \{\}/);
});
