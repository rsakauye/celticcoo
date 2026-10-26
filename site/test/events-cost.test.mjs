import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { category, CATEGORY_EMOJI, TAG_LABEL, events, tba } from '../src/lib/data.js';
import { eventJsonLd } from '../src/lib/eventLd.js';
import { eventMatches, filtersFromSearch, searchFromFilters } from '../src/lib/eventFilters.js';

const DATA = [
  new URL('../../data/events_2027.json', import.meta.url),
  new URL('../../data/events_2027_pending.json', import.meta.url),
  new URL('../../data/events_manual.json', import.meta.url),
];

const EXISTING = {
  'Burns Supper': 'Burns Night',
  'Celtic festival': 'Festivals',
  'Celtic music festival': 'Celtic music',
  'Celtic music school': 'Celtic music',
  'Christmas market': 'Markets',
  'Gaelic festival': 'Gaelic language',
  'Heavy events championship': 'Heavy events',
  'Highland Games': 'Highland Games',
  'Highland dance championship': 'Highland dance',
  'Irish music festival': 'Celtic music',
  'Irish/Celtic festival': 'Festivals',
  'Military tattoo': 'Military tattoo',
  'Pipe band major': 'Pipes & drums',
  'Piping/drumming competition': 'Pipes & drums',
  'Scottish festival': 'Festivals',
};

test('new cultural types map to the new categories, ahead of dance and festivals', () => {
  assert.equal(category('Parade'), 'Parades');
  assert.equal(category("St. Patrick's Parade"), 'Parades');
  assert.equal(category('Ceilidh'), 'Ceilidhs');
  assert.equal(category('Harvest Ceili'), 'Ceilidhs');
  assert.equal(category('Performance (concert)'), 'Performances & demos');
  assert.equal(category('Performance & demo'), 'Performances & demos');
  assert.equal(category("Cultural celebration (St. Patrick's Day)"), 'Cultural celebrations');
  assert.equal(category('Cultural celebration (Tartan Day)'), 'Cultural celebrations');
  assert.equal(category("Cultural celebration (Kirkin' o' the Tartan)"), 'Cultural celebrations');
  assert.equal(category('Cultural festival'), 'Cultural celebrations');
  assert.equal(category("St. Patrick's Dinner & Dance"), 'Cultural celebrations');
  assert.notEqual(category("St. Patrick's Dinner & Dance"), 'Highland dance');
  assert.notEqual(category('Performance (concert)'), 'Festivals');
});

test('existing event types keep their categories', () => {
  for (const [type, expected] of Object.entries(EXISTING)) {
    assert.equal(category(type), expected, type);
  }
});

test('every category the calendar can produce has an icon', () => {
  const types = [
    ...Object.keys(EXISTING),
    'Parade', 'Ceilidh', 'Performance (concert)', 'Cultural celebration (Tartan Day)',
  ];
  for (const type of types) {
    const name = category(type);
    assert.equal(typeof CATEGORY_EMOJI[name], 'string', name);
  }
  for (const e of [...events, ...tba]) {
    assert.equal(typeof CATEGORY_EMOJI[e.category], 'string', `${e.name} → ${e.category}`);
    assert.ok(['free', 'paid', 'unknown'].includes(e.cost), e.name);
  }
});

test('free and paid rows quote the organizer, and every researched tag has a quote', () => {
  const researched = JSON.parse(fs.readFileSync(DATA[0], 'utf8'));
  const pending = JSON.parse(fs.readFileSync(DATA[1], 'utf8'));
  const manual = JSON.parse(fs.readFileSync(DATA[2], 'utf8'));
  for (const e of [...researched, ...pending, ...manual]) {
    assert.equal(e.verify, undefined, e.name);
    assert.equal(JSON.stringify(e).includes('@'), false, e.name);
    if (e.cost !== undefined) assert.ok(['free', 'paid', 'unknown'].includes(e.cost), e.name);
    if (e.cost === 'free' || e.cost === 'paid') {
      assert.equal(typeof e.cost_quote, 'string', e.name);
      assert.ok(e.cost_quote.trim(), `${e.name} needs a cost quote`);
    }
  }
  for (const e of researched) {
    for (const tag of e.tags || []) {
      assert.equal(typeof TAG_LABEL[tag], 'string', `${e.name} tag ${tag}`);
      assert.equal(typeof e.tag_quotes?.[tag], 'string', `${e.name} tag ${tag}`);
      assert.ok(e.tag_quotes[tag].trim(), `${e.name} tag ${tag}`);
    }
  }
  assert.equal(TAG_LABEL.parade, 'Parade');
  assert.equal(TAG_LABEL['tartan-day'], 'Tartan Day');
  assert.equal(TAG_LABEL['st-patricks'], "St. Patrick's");
});

test('verified cultural listings use the cost and category the organizer supports', () => {
  const dated = Object.fromEntries(events.map((e) => [e.name, e]));
  const pending = Object.fromEntries(tba.map((e) => [e.name, e]));

  const ets = dated['ETS Pipes and Drums Ceilidh Night'];
  assert.equal(ets.start_date, '2026-11-07');
  assert.equal(ets.category, 'Ceilidhs');
  assert.equal(ets.cost, 'paid');
  assert.match(ets.cost_quote, /Meal with an alcoholic beverage/);
  assert.equal(ets.offers, undefined);

  const christmas = dated['A Celtic Family Christmas with Natalie MacMaster & Donnell Leahy'];
  assert.equal(christmas.start_date, '2026-11-26');
  assert.equal(christmas.category, 'Performances & demos');
  assert.equal(christmas.cost, 'unknown');
  assert.equal((christmas.tags || []).includes('family-friendly'), false);

  const tenors = dated['The Celtic Tenors: A Celtic Christmas'];
  assert.equal(tenors.category, 'Performances & demos');
  assert.equal(tenors.cost, 'paid');
  assert.equal(tenors.offers.price, 59.85);
  assert.equal(tenors.offers.priceCurrency, 'CAD');
  assert.equal(tenors.offers.availability, 'InStock');
  assert.equal('validFrom' in tenors.offers, false);
  assert.equal(tenors.organizer[0].url, 'https://gatewayyyc.com/');
  const tenorsLd = eventJsonLd(tenors);
  assert.equal('isAccessibleForFree' in tenorsLd, false);
  assert.equal(tenorsLd.offers.availability, 'https://schema.org/InStock');
  assert.equal(tenorsLd.offers.price, 59.85);

  const toronto = dated["Toronto St. Patrick's Parade"];
  assert.equal(toronto.start_date, '2027-03-14');
  assert.equal(toronto.category, 'Parades');
  assert.equal(toronto.cost, 'free');
  assert.match(toronto.cost_quote, /free community celebration/);
  assert.equal(toronto.offers, undefined);
  const torontoLd = eventJsonLd(toronto);
  assert.equal(torontoLd.isAccessibleForFree, true);
  assert.deepEqual(torontoLd.offers, {
    '@type': 'Offer',
    url: 'https://www.stpatrickstoronto.com/',
    price: 0,
    priceCurrency: 'CAD',
    availability: 'https://schema.org/InStock',
  });
  assert.ok(toronto.tags.includes('parade'));
  assert.ok(toronto.tags.includes('st-patricks'));

  const tartan = dated['National Tartan Day on Parliament Hill'];
  assert.equal(tartan.start_date, '2027-04-11');
  assert.equal(tartan.category, 'Cultural celebrations');
  assert.equal(tartan.cost, 'unknown');
  assert.equal(tartan.cost_quote, '');

  assert.equal(dated["Ottawa St. Patrick's Parade"], undefined);
  const ottawa = pending["Ottawa St. Patrick's Parade"];
  assert.equal(ottawa.category, 'Parades');
  assert.equal(ottawa.cost, 'unknown');

  const dinner = pending["St. Patrick's Dinner & Dance (Edmonton Irish Sports and Social Society)"];
  assert.equal(dinner.category, 'Cultural celebrations');
  assert.notEqual(dinner.category, 'Highland dance');

  assert.equal(pending['Tartans and Tunes (Flagstaff Scottish Club)'].cost, 'free');
  const festival = pending['National Bank Tattoo Festival (free pipe band and Highland dance shows)'];
  assert.equal(festival.cost, 'free');
  assert.equal(festival.category, 'Performances & demos');
  assert.equal(pending["Montreal St. Patrick's Parade"].cost, 'unknown');
  assert.equal(pending["St. Patrick's Day at the Irish Cultural Centre"].category, 'Cultural celebrations');

  const names = [...events, ...tba].map((e) => e.name).join('\n');
  assert.equal(/kirkin/i.test(names), false);
  assert.equal(/heritage festival/i.test(names), false);
  assert.equal(/canada day parade/i.test(names), false);
});

test('ticket offers keep only the price, stock, and on-sale date the listing published', () => {
  const dated = Object.fromEntries(events.map((e) => [e.name, e]));
  const blackthorn = dated['A Celebration of Robbie Burns with Blackthorn'];
  assert.equal(blackthorn.cost, 'paid');
  assert.equal(blackthorn.offers.price, 34.35);
  assert.equal(blackthorn.offers.priceCurrency, 'CAD');
  assert.equal(blackthorn.offers.availability, 'InStock');
  assert.equal(blackthorn.offers.validFrom, '2026-06-20');
  const corner = dated['Burns Night at Cornerstone Music Cafe'];
  assert.equal(corner.offers.price, 91.86);
  assert.equal(corner.offers.priceCurrency, 'CAD');
  assert.equal('availability' in corner.offers, false);
  assert.equal(corner.offers.validFrom, '2026-11-15');
  const tattoo = dated['Royal Edinburgh Military Tattoo'];
  assert.equal(tattoo.offers.availability, 'InStock');
  assert.equal('price' in tattoo.offers, false);
  const worlds = dated['World Pipe Band Championships'];
  assert.equal(worlds.offers.availability, 'InStock');
  assert.equal('price' in worlds.offers, false);
  const braemar = dated['Braemar Gathering'];
  assert.equal(braemar.offers.validFrom, '2027-02-01');
  assert.equal('price' in braemar.offers, false);
  assert.equal('availability' in braemar.offers, false);
  const tea = dated['Burns Supper at Tea On West'];
  assert.equal(tea.city, 'Port Colborne');
  assert.equal(tea.organizer[0].url, 'https://teaonwest.ca/');
  assert.equal(dated['Robert Burns Dinner, Barrie Legion'].organizer[0].url, 'https://barrielegion147.ca/');
  const glengarry = dated['Glengarry Highland Games (North American Pipe Band Championships)'];
  assert.equal(glengarry.organizer[1].name, 'Kenyon Agricultural Society');
  assert.equal(glengarry.organizer[1].url, 'https://www.glengarryhighlandgames.com/');
  const campbell = dated['Campbell River Highland Gathering'];
  assert.equal(campbell.organizer[0].name, 'Campbell River Salmon Festival');
  assert.equal(campbell.organizer[0].url, 'https://crsalmonfestival.com/');
  assert.equal(campbell.offers, undefined);
  assert.equal('url' in dated['ETS Pipes and Drums Ceilidh Night'].organizer[0], false);
  assert.equal(dated['A Celtic Family Christmas with Natalie MacMaster & Donnell Leahy'].organizer[0].url, 'https://www.livenation.com/');
});

test('Free only keeps free events and writes ?free=1', () => {
  const free = { cost: 'free', cat: 'Parades', country: 'Canada', region: 'ON', features: '', past: false, tags: 'parade st-patricks' };
  const paid = { ...free, cost: 'paid', cat: 'Performances & demos', tags: 'music' };
  const unknown = { ...free, cost: 'unknown', cat: 'Cultural celebrations' };
  assert.equal(eventMatches(free, { freeOnly: true }), true);
  assert.equal(eventMatches(paid, { freeOnly: true }), false);
  assert.equal(eventMatches(unknown, { freeOnly: true }), false);
  assert.equal(eventMatches(paid, { freeOnly: false }), true);
  assert.equal(eventMatches(free, { freeOnly: true, cat: 'Parades' }), true);
  assert.equal(eventMatches(free, { freeOnly: true, cat: 'Ceilidhs' }), false);
  assert.equal(eventMatches({ ...paid, past: '1' }, { freeOnly: false, past: false }), false);
  assert.equal(eventMatches({ ...paid, past: '1' }, { freeOnly: false, past: true }), true);

  const parsed = filtersFromSearch('?free=1&type=Parades&country=Canada&tags=parade,irish');
  assert.equal(parsed.freeOnly, true);
  assert.equal(parsed.cat, 'Parades');
  assert.deepEqual(parsed.tags, ['parade', 'irish']);
  assert.equal(eventMatches(free, { ...parsed, past: false, feat: '', region: '' }), true);
  assert.equal(eventMatches(paid, parsed), false);
  assert.equal(searchFromFilters({ freeOnly: true, country: 'Canada', cat: 'Parades', tags: ['parade'] }), '?country=Canada&type=Parades&tags=parade&free=1');
  assert.equal(searchFromFilters({ freeOnly: false, country: 'Canada' }).includes('free'), false);

  const page = fs.readFileSync(new URL('../src/pages/events/index.astro', import.meta.url), 'utf8');
  const card = fs.readFileSync(new URL('../src/components/EventCard.astro', import.meta.url), 'utf8');
  assert.match(page, /id="f-free"/);
  assert.match(page, /Free only/);
  assert.match(page, /eventMatches/);
  assert.match(page, /data-cost=\{e\.cost\}/);
  assert.match(page, /pill free/);
  assert.match(card, /data-cost=\{e\.cost\}/);
  assert.match(card, /pill free/);
});
