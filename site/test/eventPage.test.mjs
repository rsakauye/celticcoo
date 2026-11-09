import test from 'node:test';
import assert from 'node:assert/strict';
import { eventPlaceLine, eventNearby } from '../src/lib/eventPage.js';

const provinces = ['AB', 'BC', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'National'];

test('the place line is city and province, with the venue when the record has one', () => {
  assert.equal(eventPlaceLine({ city: 'Calgary', regionLabel: 'Alberta', country: 'Canada' }), 'Calgary, Alberta');
  assert.equal(eventPlaceLine({
    venue: 'Spruce Meadows',
    city: 'Calgary',
    regionLabel: 'Alberta',
    country: 'Canada',
  }), 'Spruce Meadows, Calgary, Alberta');
  assert.equal(eventPlaceLine({
    venue: '   ',
    city: 'Calgary',
    regionLabel: 'Alberta',
    country: 'Canada',
    note: 'Topaz Park',
  }), 'Calgary, Alberta');
  assert.equal(eventPlaceLine({
    city: 'Glasgow',
    regionLabel: 'Scotland',
    country: 'UK',
  }), 'Glasgow, Scotland, UK');
});

test('nearby links use the groups province filter, or plain groups when that province is not listed', () => {
  const alberta = eventNearby({
    region: 'AB',
    regionLabel: 'Alberta',
    start_date: '2027-07-24',
    end_date: '2027-07-25',
  }, provinces);
  assert.equal(alberta.groupsPath, 'groups/?province=AB');
  assert.equal(alberta.groupsLabel, 'Clubs and lessons in Alberta');
  assert.deepEqual(alberta.guides, []);

  const abroad = eventNearby({
    region: 'Scotland',
    regionLabel: 'Scotland',
    start_date: '2027-06-01',
    end_date: '2027-06-02',
  }, provinces);
  assert.equal(abroad.groupsPath, 'groups/');
  assert.equal(abroad.groupsLabel, 'Clubs and lessons');
  assert.deepEqual(abroad.guides, []);
});

test('a January date links to the Burns Night guide, and late November links to St Andrew\'s Day', () => {
  const burns = eventNearby({
    region: 'ON',
    regionLabel: 'Ontario',
    start_date: '2027-01-30',
    end_date: '2027-01-30',
  }, provinces);
  assert.equal(burns.groupsPath, 'groups/?province=ON');
  assert.deepEqual(burns.guides, [{ href: 'burns-night/', label: 'Burns Night guide' }]);

  const andrew = eventNearby({
    region: 'AB',
    regionLabel: 'Alberta',
    start_date: '2026-11-21',
    end_date: '2026-11-21',
  }, provinces);
  assert.deepEqual(andrew.guides, [{ href: 'st-andrews-day/', label: "St Andrew's Day guide" }]);

  const earlyNovember = eventNearby({
    region: 'AB',
    regionLabel: 'Alberta',
    start_date: '2026-11-07',
    end_date: '2026-11-07',
  }, provinces);
  assert.deepEqual(earlyNovember.guides, []);

  const spansLateNovember = eventNearby({
    region: 'AB',
    regionLabel: 'Alberta',
    start_date: '2026-11-13',
    end_date: '2026-12-06',
  }, provinces);
  assert.deepEqual(spansLateNovember.guides, [{ href: 'st-andrews-day/', label: "St Andrew's Day guide" }]);

  const february = eventNearby({
    region: 'AB',
    regionLabel: 'Alberta',
    start_date: '2027-02-01',
    end_date: '2027-02-01',
  }, provinces);
  assert.deepEqual(february.guides, []);
});
