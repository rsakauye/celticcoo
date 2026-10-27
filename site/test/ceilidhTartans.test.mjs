import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_KEY,
  TARTANS,
  applyTartan,
  defaultTartan,
  enabledTartans,
  kiltPeekWanted,
  readTartan,
  swatchBackground,
  tartanView,
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

function swatchEl() {
  return {
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = value; },
    },
  };
}

function textEl() {
  return { textContent: '' };
}

function choiceEl(slug) {
  return {
    attrs: { 'data-tartan-choice': slug },
    setAttribute(name, value) { this.attrs[name] = value; },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
  };
}

test('the swatch updates when the tartan changes', () => {
  const storage = memory();
  const swatch = swatchEl();
  const name = textEl();
  const opener = choiceEl('fraser-of-lovat');
  const calgary = choiceEl('calgary');
  const lovat = choiceEl('fraser-of-lovat');
  const nodes = { swatches: [swatch], names: [name], openers: [opener], choices: [lovat, calgary] };

  applyTartan(readTartan(storage), nodes);
  const first = swatch.style.props['--swatch'];
  assert.equal(first, swatchBackground(defaultTartan()));
  assert.match(first, /#B82E26 0px 3px, #fff 3px 4px/);
  assert.equal(name.textContent, 'Fraser of Lovat');

  applyTartan(writeTartanId('calgary', storage), nodes);
  assert.equal(name.textContent, 'Calgary');
  assert.equal(swatch.style.props['--swatch'], swatchBackground(readTartan(storage)));
  assert.notEqual(swatch.style.props['--swatch'], first);
  assert.match(swatch.style.props['--swatch'], /#E0A526/);
  assert.equal(calgary.getAttribute('aria-pressed'), 'true');
  assert.equal(lovat.getAttribute('aria-pressed'), 'false');
  assert.match(opener.getAttribute('aria-label'), /Kilt tartan, Calgary\. Choose a tartan\./);
});

test('the swatch on load follows the tartan saved in storage', () => {
  const storage = memory([[STORAGE_KEY, 'menzies']]);
  const swatch = swatchEl();
  const name = textEl();
  const loaded = readTartan(storage);
  applyTartan(loaded, { swatches: [swatch], names: [name] });
  assert.equal(loaded.slug, 'menzies');
  assert.equal(name.textContent, 'Menzies');
  assert.equal(swatch.style.props['--swatch'], tartanView(loaded).swatch);
  assert.match(swatch.style.props['--swatch'], /#78BAE6/);
  assert.notEqual(swatch.style.props['--swatch'], swatchBackground(defaultTartan()));

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const fallback = swatchEl();
  applyTartan(readTartan(blocked), { swatches: [fallback] });
  assert.equal(fallback.style.props['--swatch'], swatchBackground(defaultTartan()));
});

test('each kilt has its own swatch stripe, and a tucked change can peek', () => {
  const swatches = enabledTartans().map((tartan) => swatchBackground(tartan));
  assert.equal(new Set(swatches).size, swatches.length);
  assert.ok(swatches.every((swatch) => swatch.startsWith('repeating-linear-gradient(90deg, ')));
  for (const tartan of enabledTartans()) {
    assert.ok(tartan.threads.length >= 8);
    assert.equal(swatchBackground(tartan), tartanView(tartan).swatch);
  }

  assert.equal(kiltPeekWanted({ tucked: true, reduceMotion: false }), true);
  assert.equal(kiltPeekWanted({ tucked: true, reduceMotion: true }), false);
  assert.equal(kiltPeekWanted({ tucked: false, reduceMotion: false }), false);

  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  const coo = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  assert.match(picker, /data-tartan-swatch/);
  assert.match(picker, /--swatch:\$\{view\.swatch\}/);
  assert.match(picker, /applyTartan\(tartan,/);
  assert.match(picker, /paint\(readTartan\(storage\)\)/);
  assert.match(picker, /peekKilt\(\)/);
  assert.match(picker, /showTartanName\(tartan\.name\)/);
  assert.match(picker, /aria-live="polite"/);
  assert.match(picker, /max-width: 719px/);
  assert.match(picker, /prefers-reduced-motion: reduce/);
  assert.match(picker, /kiltPeekWanted\(/);
  assert.match(picker, /try \{ return localStorage\.getItem\(key\); \} catch \{ return null; \}/);
  assert.match(picker, /try \{ localStorage\.setItem\(key, value\); \} catch/);
  assert.doesNotMatch(picker, /repeating-linear-gradient\(90deg, #B82E26 0 3px/);
  assert.match(coo, /data-kilt-peek/);
  const boot = picker.slice(picker.lastIndexOf('paint('));
  assert.match(boot, /readTartan\(storage\)/);
  assert.doesNotMatch(boot, /peekKilt|showTartanName/);
});
