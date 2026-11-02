import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import verified from '../../data/events_2027.json' with { type: 'json' };
import {
  activeChips,
  blankFilters,
  canadianConnection,
  categoryFromTypeParam,
  emptyMessage,
  eventInList,
  eventMatches,
  filtersForList,
  filtersFromSearch,
  listHome,
  resultLabel,
  searchFromFilters,
} from '../src/lib/eventFilters.js';

const canada = { country: 'Canada', region: 'AB', cat: 'Highland Games', cost: 'paid', start: '2027-07-01', tags: 'highland-games', features: 'heavy-events', past: false };
const usa = { country: 'USA', region: 'Oregon', cat: 'Highland Games', cost: 'paid', start: '2027-06-05', tags: 'highland-games', features: '', past: false };
const worlds = { country: 'UK', region: 'Scotland', cat: 'Pipes & drums', cost: 'paid', start: '2027-08-13', tags: 'pipe-band', features: '', past: false };

test('the free filter hides Date TBA cards that are not free', () => {
  const tba = [
    { cost: 'free', name: 'Tartans and Tunes' },
    { cost: 'unknown', name: 'Montreal parade' },
    { cost: 'paid', name: 'Dinner' },
  ];
  const shown = tba.filter((e) => eventMatches(e, { freeOnly: true, past: true }));
  assert.deepEqual(shown.map((e) => e.name), ['Tartans and Tunes']);
  const all = tba.filter((e) => eventMatches(e, { freeOnly: false, past: true }));
  assert.equal(all.length, 3);
});

test('an empty country still matches every country', () => {
  assert.equal(eventMatches(canada, {}), true);
  assert.equal(eventMatches(usa, {}), true);
  assert.equal(eventMatches({ ...usa, past: '1' }, {}), false);
  assert.equal(eventMatches({ ...usa, past: '1' }, { past: true }), true);
});

test('month, province, and type narrow a card', () => {
  assert.equal(eventMatches(canada, { month: '2027-07' }), true);
  assert.equal(eventMatches(canada, { month: '2027-06' }), false);
  assert.equal(eventMatches(canada, { region: 'AB', cat: 'Highland Games' }), true);
  assert.equal(eventMatches(canada, { region: 'ON' }), false);
  assert.equal(eventMatches({ start_date: '2027-05-21', country: 'Canada' }, { month: '2027-05' }), true);
});

test('Canada is the default list and international events sit apart', () => {
  const filters = blankFilters();
  assert.equal(listHome(canada, filters), 'main');
  assert.equal(listHome(usa, filters), 'abroad');
  assert.equal(eventInList(canada, filters, 'main'), true);
  assert.equal(eventInList(usa, filters, 'main'), false);
  assert.equal(eventInList(usa, filters, 'abroad'), true);
  assert.equal(eventInList(worlds, { ...filters, cat: 'Highland Games' }, 'abroad'), false);
  assert.equal(eventInList(usa, { ...filters, month: '2027-06' }, 'abroad'), true);
  assert.equal(filtersForList(filters, 'main').country, 'Canada');
});

test('a province filter hides events outside Canada until it is cleared', () => {
  const filters = { ...blankFilters(), region: 'AB', includeIntl: true };
  assert.equal(eventInList(canada, filters, 'main'), true);
  assert.equal(eventInList(usa, filters, 'main'), false);
  assert.equal(eventInList(usa, filters, 'abroad'), false);
  assert.equal(listHome(usa, filters), 'abroad');
});

test('include events outside Canada moves them into the main list', () => {
  const filters = { ...blankFilters(), includeIntl: true };
  assert.equal(listHome(usa, filters), 'main');
  assert.equal(eventInList(usa, filters, 'main'), true);
  assert.equal(eventInList(worlds, filters, 'abroad'), false);
  assert.equal(filtersForList(filters, 'main').country, '');
});

test('an older country link still opens that country', () => {
  const filters = filtersFromSearch('?country=USA&region=Oregon');
  assert.equal(filters.country, 'USA');
  assert.equal(filters.region, 'Oregon');
  assert.equal(eventInList(usa, filters, 'main'), true);
  assert.equal(eventInList(canada, filters, 'main'), false);
  assert.equal(eventInList(worlds, filters, 'abroad'), false);
});

test('province, type, and month round-trip in the query string', () => {
  const filters = {
    ...blankFilters(),
    region: 'AB',
    cat: 'Highland Games',
    month: '2027-05',
  };
  assert.equal(searchFromFilters(filters), '?prov=AB&type=highland-games&month=2027-05');
  assert.deepEqual(filtersFromSearch(searchFromFilters(filters)), filters);
  assert.equal(categoryFromTypeParam('pipe-band'), 'Pipes & drums');
  assert.equal(categoryFromTypeParam('Parades'), 'Parades');
  assert.equal(categoryFromTypeParam('Highland Games'), 'Highland Games');
  assert.equal(filtersFromSearch('?type=Parades&country=Canada&region=ON').cat, 'Parades');
  assert.equal(filtersFromSearch('?type=Parades&country=Canada&region=ON').region, 'ON');
  assert.equal(filtersFromSearch('?month=May').month, '');
  assert.equal(searchFromFilters({ ...blankFilters(), country: 'Canada', freeOnly: false }), '');
});

test('active chips and the empty state use plain labels', () => {
  const filters = {
    ...blankFilters(),
    region: 'AB',
    cat: 'Ceilidhs',
    month: '2027-01',
    freeOnly: true,
    tags: ['ceilidh'],
    includeIntl: true,
  };
  const chips = activeChips(filters, { region: { AB: 'Alberta' }, month: { '2027-01': 'January 2027' }, tags: { ceilidh: 'Ceilidh' } });
  assert.deepEqual(chips.map((c) => c.label), ['Alberta', 'Ceilidhs', 'January 2027', 'Ceilidh', 'Free only', 'Outside Canada included']);
  assert.equal(resultLabel(1), '1 event');
  assert.equal(resultLabel(23), '23 events');
  assert.equal(emptyMessage(0, 0), 'No events match those filters. Try another province, type, or month.');
  assert.match(emptyMessage(0, 2), /Worth the trip/);
  assert.equal(emptyMessage(4, 2), '');
});

test('Canadian bands competing is only shown when the row already says so', () => {
  const intl = verified.filter((e) => e.country !== 'Canada');
  const linked = intl.filter((e) => canadianConnection(e)).map((e) => e.name).sort();
  assert.deepEqual(linked, [
    'Pacific Northwest Scottish Highland Games',
    'Portland Highland Games',
    'Skagit Valley Highland Games',
    'World Pipe Band Championships',
  ]);
  assert.equal(canadianConnection({ country: 'Canada', notes: 'BCPA schedule', source_url: 'https://bcpipers.org/x' }), '');
  assert.equal(canadianConnection({ country: 'UK', notes: '', source_url: 'https://www.cowalgathering.com/' }), '');
  assert.equal(canadianConnection(verified.find((e) => e.name === 'World Pipe Band Championships')), 'Canadian bands competing');
});

test('the events page offers province, type, month, and a reset', () => {
  const page = readFileSync(new URL('../src/pages/events/index.astro', import.meta.url), 'utf8');
  assert.match(page, /id="f-prov"/);
  assert.match(page, /id="f-cat"/);
  assert.match(page, /id="f-month"/);
  assert.match(page, /id="f-intl"/);
  assert.match(page, /id="f-free"/);
  assert.match(page, /Free only/);
  assert.match(page, /Clear all/);
  assert.match(page, /Worth the trip: international events/);
  assert.match(page, /eventInList/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /f-open/);
});
