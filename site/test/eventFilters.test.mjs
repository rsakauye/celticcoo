import test from 'node:test';
import assert from 'node:assert/strict';
import { eventMatches } from '../src/lib/eventFilters.js';

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
