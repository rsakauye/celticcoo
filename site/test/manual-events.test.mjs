import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { events, burns, regionName, mergeManualEvents, manualBurnsRows, sourceLinkLabel, dateConfirmLine, normCost, decorateEvent } from '../src/lib/data.js';

const NAME = 'Scottish Society of Ottawa Burns Supper';
const manual = JSON.parse(fs.readFileSync(new URL('../../data/events_manual.json', import.meta.url), 'utf8'));
const researched = fs.readFileSync(new URL('../../data/events_2027.json', import.meta.url), 'utf8');

test('the organizer-submitted Burns Supper is on the calendar once, in Ontario', () => {
  const matches = events.filter((e) => e.name === NAME);
  assert.equal(matches.length, 1);
  const event = matches[0];
  assert.equal(event.start_date, '2027-01-30');
  assert.equal(event.end_date, '2027-01-30');
  assert.equal(event.city, 'Ottawa');
  assert.equal(event.region, 'ON');
  assert.equal(event.regionLabel, 'Ontario');
  assert.equal(event.country, 'Canada');
  assert.equal(event.isCanada, true);
  assert.equal(event.category, 'Burns Night');
  assert.equal(event.type, 'Burns Supper');
  assert.equal(event.source_url, 'https://ottscot.ca/');
  assert.equal(event.source_kind, 'organizer');
  assert.equal(event.note, 'Venue not announced.');
  assert.equal(event.organizer[0].name, 'The Scottish Society of Ottawa');
  assert.equal(sourceLinkLabel(event.source_kind), "Organizer's site");
  assert.match(dateConfirmLine(event.source_kind), /host submitted this date/i);
  assert.equal(researched.includes(NAME), false);
});

test('the same supper is on the Burns Night list as confirmed by the host, with no venue', () => {
  const matches = burns.filter((b) => b.name === NAME);
  assert.equal(matches.length, 1);
  const supper = matches[0];
  assert.equal(supper.date, '2027-01-30');
  assert.equal(supper.city, 'Ottawa');
  assert.equal(supper.province, 'ON');
  assert.equal(supper.regionLabel, 'Ontario');
  assert.equal(supper.host, 'The Scottish Society of Ottawa');
  assert.equal(supper.confirmed, true);
  assert.match(supper.status, /^confirmed/i);
  assert.match(supper.when, /Jan/);
  assert.match(supper.when, /30/);
  assert.match(supper.when, /2027/);
  assert.equal(supper.source_url, 'https://ottscot.ca/');
  const page = fs.readFileSync(new URL('../src/pages/burns-night/index.astro', import.meta.url), 'utf8');
  assert.equal(page.includes(supper.id), false);
});

test('province labels are not limited to Alberta', () => {
  assert.equal(regionName('ON'), 'Ontario');
  assert.equal(regionName('AB'), 'Alberta');
  const regions = new Set(events.filter((e) => e.isCanada).map((e) => e.region));
  assert.ok(regions.has('ON'));
  assert.ok(regions.has('AB'));
  assert.ok(regions.size > 1);
});

test('a researched event with the same name and date is not listed twice', () => {
  const verified = [{
    name: NAME,
    start_date: '2027-01-30',
    city: 'Ottawa',
    province_or_region: 'ON',
    country: 'Canada',
  }];
  const merged = mergeManualEvents(verified, manual);
  assert.equal(merged.filter((e) => e.name === NAME).length, 1);
  assert.equal(merged[0].city, 'Ottawa');
});

test('manual rows keep their province, and only Burns suppers join the Burns list', () => {
  const games = {
    name: 'Ottawa Highland Games',
    start_date: '2027-08-01',
    city: 'Ottawa',
    province_or_region: 'ON',
    country: 'Canada',
    type: 'Highland Games',
    source_kind: 'organizer',
    source_url: 'https://example.test/games',
  };
  const merged = mergeManualEvents([], [games, { name: 'No date' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].province_or_region, 'ON');
  assert.equal(manualBurnsRows([games]).length, 0);
  const [supper] = manualBurnsRows(manual);
  assert.equal(supper.province, 'ON');
  assert.equal(supper.status, 'confirmed (date from organizer)');
});

test('cost passes through, and an invalid value becomes unknown', () => {
  const row = decorateEvent({
    name: 'Sample parade',
    start_date: '2027-03-14',
    city: 'Toronto',
    province_or_region: 'ON',
    country: 'Canada',
    type: 'Parade',
    cost: 'free',
    cost_quote: 'A free community celebration',
    cost_source: 'https://example.test/parade',
    notes: '',
  });
  assert.equal(row.cost, 'free');
  assert.equal(row.cost_quote, 'A free community celebration');
  assert.equal(row.cost_source, 'https://example.test/parade');
  assert.equal(row.category, 'Parades');
  assert.equal(normCost({ cost: 'paid' }), 'paid');
  assert.equal(normCost({ cost: '  Unknown ' }), 'unknown');
  assert.equal(normCost({ cost: 'complimentary' }), 'unknown');
  assert.equal(normCost({ cost: 'nope', offers: { price: 0 } }), 'unknown');
  assert.equal(normCost({}), 'unknown');
  assert.equal(normCost({ cost: '' }), 'unknown');
  assert.equal(normCost({ offers: { price: 0 } }), 'free');
  assert.equal(normCost({ offers: { price: 12 } }), 'paid');
  assert.equal(normCost({ cost: 'unknown', offers: { price: 0 } }), 'unknown');
  const priced = decorateEvent({
    name: 'Priced concert',
    start_date: '2027-11-27',
    city: 'Calgary',
    province_or_region: 'AB',
    country: 'Canada',
    type: 'Performance (concert)',
    offers: { url: 'https://example.test/tickets', price: 59.85, priceCurrency: 'CAD' },
    notes: '',
  });
  assert.equal(priced.cost, 'paid');
  assert.equal(priced.category, 'Performances & demos');
});

test('the public record has no personal contact details', () => {
  const blob = JSON.stringify({ manual, event: events.find((e) => e.name === NAME), supper: burns.find((b) => b.name === NAME) });
  assert.equal(/jennifer/i.test(blob), false);
  assert.equal(/@/.test(blob), false);
  assert.equal(/phone/i.test(blob), false);
  assert.equal(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(blob), false);
});
