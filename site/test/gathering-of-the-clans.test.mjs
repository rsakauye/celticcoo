import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { events, burns } from '../src/lib/data.js';

const NAME = 'Gathering of the Clans';
const manualText = fs.readFileSync(new URL('../../data/events_manual.json', import.meta.url), 'utf8');

test('the organizer-submitted Gathering of the Clans is on the calendar once, in Nova Scotia', () => {
  const matches = events.filter((e) => e.name === NAME);
  assert.equal(matches.length, 1);
  const event = matches[0];
  assert.equal(event.start_date, '2027-07-01');
  assert.equal(event.end_date, '2027-07-01');
  assert.equal(event.city, 'Pugwash');
  assert.equal(event.region, 'NS');
  assert.equal(event.regionLabel, 'Nova Scotia');
  assert.equal(event.country, 'Canada');
  assert.equal(event.isCanada, true);
  assert.equal(event.source_kind, 'organizer');
  assert.equal(event.organizer[0].name, 'Village of Pugwash');
});

test('it is filed under Highland Games, not Parades, and carries the organizer start time', () => {
  const event = events.find((e) => e.name === NAME);
  assert.equal(event.type, 'Highland Games');
  assert.equal(event.category, 'Highland Games');
  assert.match(event.note, /7:30 a\.m\./);
  assert.equal(event.cost, 'unknown');
});

test('it is not on the Burns Night list', () => {
  assert.equal(burns.some((b) => b.name === NAME), false);
});

test('the manual events file holds no email address, phone number, or postal address', () => {
  assert.doesNotMatch(manualText, /@/);
  assert.doesNotMatch(manualText, /\b\d{3}[.\-\s]\d{3}[.\-\s]\d{4}\b/);
  assert.doesNotMatch(manualText, /\bP\.?O\.? ?Box\b/i);
});
