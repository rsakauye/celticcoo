import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_ALPHABET,
  assignShortCodes,
  assignSlugs,
  createRng,
  mintShortCode,
  redirectLines,
  suggestSlug,
} from '../index.js';

const pack = {
  fillers: ['the', 'of', 'and', 'a', 'an', 'city'],
  suffixPhrases: [['social', 'club'], ['pipe', 'band'], ['pipes', 'and', 'drums']],
  suffixWords: ['society', 'association', 'club', 'inc', 'ltd', 'canada'],
  maxSlugLength: 30,
  collisionField: 'city',
  collisionSkip: ['national'],
  shortCodeLength: 4,
  alphabet: DEFAULT_ALPHABET,
  shortPrefix: '/g/',
  profilePrefix: '/groups/',
  retiredCodes: ['zzzz'],
};

test('a slug is deterministic and drops fillers and suffixes', () => {
  assert.equal(DEFAULT_ALPHABET.length, 31);
  assert.equal(/[0o1li]/.test(DEFAULT_ALPHABET), false);
  assert.equal(suggestSlug('Sláinte Social Club', pack), 'slainte');
  assert.equal(suggestSlug('Sláinte Social Club', pack), suggestSlug('Sláinte Social Club', pack));
  assert.equal(suggestSlug('City of Calgary Pipe Band', pack), 'calgary');
  assert.notEqual(suggestSlug('Royal Scottish Country Dance Society Calgary Branch', pack), 'rscds-calgary');
  assert.deepEqual(
    assignSlugs([{ name: 'Royal Scottish Country Dance Society Calgary Branch', city: 'Calgary', slug: 'rscds-calgary' }], pack),
    ['rscds-calgary'],
  );
  assert.deepEqual(assignSlugs([
    { name: 'Harbour Pipe Band', city: 'Calgary' },
    { name: 'Harbour Pipe Band', city: 'Edmonton' },
  ], pack), ['harbour', 'harbour-edmonton']);
  assert.deepEqual(assignSlugs([{ name: 'Renamed', city: 'Calgary', slug: 'slainte' }], pack), ['slainte']);
});

test('short codes stay inside the alphabet, stay unique, and do not change once stored', () => {
  const first = assignShortCodes([
    { name: 'One' },
    { name: 'Two' },
    { name: 'Three' },
  ], pack, createRng(20261027));
  const again = assignShortCodes([
    { name: 'One' },
    { name: 'Two' },
    { name: 'Three' },
  ], pack, createRng(20261027));
  assert.deepEqual(again, first);
  assert.equal(new Set(first).size, first.length);
  for (const code of first) {
    assert.equal(code.length, 4);
    assert.equal([...code].every((char) => DEFAULT_ALPHABET.includes(char)), true);
  }
  assert.deepEqual(assignShortCodes([
    { name: 'Renamed', code: 'k7mp' },
    { name: 'Other', code: 'k7mp' },
  ], pack, () => 0), ['k7mp', 'k7mp']);
  const minted = mintShortCode({ ...pack, retiredCodes: [] }, createRng(1));
  assert.equal(minted.length, 4);
  const kept = assignShortCodes([{ name: 'Kept', code: first[0] }, { name: 'New' }], pack, createRng(99));
  assert.equal(kept[0], first[0]);
  assert.notEqual(kept[1], 'zzzz');
  assert.equal(kept[1].length, 4);
});

test('static redirects cover every code in every letter case', () => {
  const records = [
    { slug: 'slainte', code: 'k7mp' },
    { slug: 'calgary', code: 'ab23' },
  ];
  const lines = redirectLines(records, pack);
  assert.equal(lines.length, 8 + 4);
  assert.ok(lines.includes('/g/k7mp /groups/slainte/ 301'));
  assert.ok(lines.includes('/g/K7MP /groups/slainte/ 301'));
  assert.ok(lines.includes('/g/ab23 /groups/calgary/ 301'));
  assert.ok(lines.includes('/g/AB23 /groups/calgary/ 301'));
  assert.equal(lines.every((line) => line.endsWith(' 301')), true);
  const src = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
  assert.equal(/celtic|coo|highland|pipe band/i.test(src), false);
});
