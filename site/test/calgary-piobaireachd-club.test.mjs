import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { events, burns, sourceLinkLabel } from '../src/lib/data.js';
import { eventMatches } from '../src/lib/eventFilters.js';

const NAME = '2026 Calgary Piobaireachd Club';
const manualText = fs.readFileSync(new URL('../../data/events_manual.json', import.meta.url), 'utf8');

test('the hand-curated Calgary Piobaireachd Club night is on the calendar once, in Alberta', () => {
  const matches = events.filter((e) => e.name === NAME);
  assert.equal(matches.length, 1);
  const event = matches[0];
  assert.equal(event.start_date, '2026-11-21');
  assert.equal(event.end_date, '2026-11-21');
  assert.equal(event.city, 'Calgary');
  assert.equal(event.region, 'AB');
  assert.equal(event.regionLabel, 'Alberta');
  assert.equal(event.country, 'Canada');
  assert.equal(event.isCanada, true);
  assert.equal(event.source_kind, 'official');
  assert.equal(event.source_url, 'https://facebook.com/events/s/2026-calgary-piobaireachd-club/1709751024100978/');
  assert.equal(sourceLinkLabel(event.source_kind), 'Official site');
  assert.equal(event.organizer[0].name, 'Calgary Piobaireachd Club');
  assert.equal(event.organizer[0].url, undefined);
});

test('it is filed under Performances & demos, with the venue, time, dress, and door price', () => {
  const event = events.find((e) => e.name === NAME);
  assert.equal(event.type, 'Performance (concert)');
  assert.equal(event.category, 'Performances & demos');
  assert.match(event.note, /Mewata Armouries/);
  assert.match(event.note, /Mewata Jr Ranks Mess/);
  assert.match(event.note, /801 11 St SW/);
  assert.match(event.note, /7-10 pm/);
  assert.match(event.note, /5\$ at the door/);
  assert.match(event.note, /casual dress/i);
  assert.equal(event.cost, 'paid');
  assert.equal(event.cost_quote, '5$ at the door');
  assert.equal(event.offers, undefined);
});

test('the Alberta and November filters include it', () => {
  const event = events.find((e) => e.name === NAME);
  const card = {
    country: event.country,
    region: event.region,
    cat: event.category,
    features: (event.features || []).join(' '),
    past: event.end_date < event.start_date ? '1' : undefined,
    tags: (event.tags || []).join(' '),
    cost: event.cost,
    start: event.start_date,
  };
  assert.equal(eventMatches(card, { country: 'Canada', region: 'AB' }), true);
  assert.equal(eventMatches(card, { country: 'Canada', region: 'ON' }), false);
  assert.equal(eventMatches(card, { country: 'Canada', month: '2026-11' }), true);
  assert.equal(eventMatches(card, { country: 'Canada', month: '2026-12' }), false);
  assert.equal(eventMatches(card, { country: 'Canada', cat: 'Performances & demos' }), true);
  assert.equal(eventMatches(card, { country: 'Canada', freeOnly: true }), false);
});

test('it is not on the Burns Night list', () => {
  assert.equal(burns.some((b) => b.name === NAME), false);
});

test('the listing has no personal name, email, phone number, or postal code', () => {
  const event = events.find((e) => e.name === NAME);
  const blob = JSON.stringify(event) + manualText;
  assert.doesNotMatch(blob, /Zachary/i);
  assert.doesNotMatch(blob, /Dwyer/i);
  assert.doesNotMatch(blob, /Steve/i);
  assert.doesNotMatch(manualText, /@/);
  assert.doesNotMatch(manualText, /\b\d{3}[.\-\s]\d{3}[.\-\s]\d{4}\b/);
  assert.doesNotMatch(manualText, /\bP\.?O\.? ?Box\b/i);
  assert.doesNotMatch(manualText, /T2P 2C4/);
});
