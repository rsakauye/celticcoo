import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_KEY,
  TARTANS,
  defaultTartan,
  enabledTartans,
  readTartan,
  writeTartanId,
} from '../src/lib/ceilidhTartans.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');

function memory(initial) {
  const data = new Map(initial);
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

test('Ceilidh wears Fraser of Lovat unless the visitor chose another tartan', () => {
  assert.equal(defaultTartan().slug, 'fraser-of-lovat');
  assert.equal(defaultTartan().default, true);
  const storage = memory();
  assert.equal(readTartan(storage).slug, 'fraser-of-lovat');
  assert.equal(storage.getItem(STORAGE_KEY), 'fraser-of-lovat');
});

test('the chosen tartan is remembered in browser storage', () => {
  const storage = memory();
  assert.equal(writeTartanId('calgary', storage).slug, 'calgary');
  assert.equal(storage.getItem(STORAGE_KEY), 'calgary');
  assert.equal(readTartan(storage).slug, 'calgary');
  assert.equal(readTartan(storage).name, 'Calgary');
});

test('an unknown or disabled stored id falls back to Fraser of Lovat', () => {
  const unknown = memory([[STORAGE_KEY, 'nope']]);
  assert.equal(readTartan(unknown).slug, 'fraser-of-lovat');
  assert.equal(unknown.getItem(STORAGE_KEY), 'fraser-of-lovat');

  const disabled = memory([[STORAGE_KEY, 'mackinnon']]);
  assert.equal(readTartan(disabled).slug, 'fraser-of-lovat');
  assert.equal(writeTartanId('mackinnon', disabled).slug, 'fraser-of-lovat');
  assert.equal(disabled.getItem(STORAGE_KEY), 'fraser-of-lovat');
});

test('the picker lists only the enabled tartans from the config', () => {
  const catalog = JSON.parse(readFileSync(join(site, 'src/data/ceilidh-tartans.json'), 'utf8'));
  const listed = enabledTartans();
  assert.deepEqual(listed.map((tartan) => tartan.slug), catalog.map((tartan) => tartan.slug));
  assert.equal(listed.length, 8);
  for (const row of catalog) {
    const found = TARTANS.find((tartan) => tartan.slug === row.slug);
    assert.equal(found.name, row.name);
    assert.equal(found.meaning, row.meaning);
    assert.equal(found.enabled, true);
  }
  assert.equal(TARTANS.some((tartan) => tartan.slug === 'mackinnon' && tartan.enabled === false), true);
  assert.equal(listed.some((tartan) => tartan.slug === 'mackinnon'), false);

  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  assert.match(picker, /enabledTartans\(/);
  assert.match(picker, /These are simplified pixel versions of each tartan\./);
  assert.doesNotMatch(picker, /mackinnon/i);
  assert.doesNotMatch(picker, /alberta/i);
});
