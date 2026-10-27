import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_KEY,
  SWATCH_REPEATS,
  SWATCH_THREAD_PX,
  TARTANS,
  applyTartan,
  defaultTartan,
  enabledTartans,
  kiltPeekWanted,
  readTartan,
  swatchMarkup,
  tartanView,
  weaveColor,
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
  return { innerHTML: '' };
}

function swatchFills(markup) {
  return [...markup.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]);
}

function isWoven(threads) {
  const n = threads.length;
  let across = false;
  let down = false;
  for (let y = 0; y < n; y += 1) {
    const first = weaveColor(threads, 0, y);
    for (let x = 1; x < n; x += 1) if (weaveColor(threads, x, y) !== first) across = true;
  }
  for (let x = 0; x < n; x += 1) {
    const first = weaveColor(threads, x, 0);
    for (let y = 1; y < n; y += 1) if (weaveColor(threads, x, y) !== first) down = true;
  }
  return across && down;
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
  const first = swatch.innerHTML;
  assert.equal(first, swatchMarkup(defaultTartan()));
  assert.equal(name.textContent, 'Fraser of Lovat');

  applyTartan(writeTartanId('calgary', storage), nodes);
  assert.equal(name.textContent, 'Calgary');
  assert.equal(swatch.innerHTML, swatchMarkup(readTartan(storage)));
  assert.notEqual(swatch.innerHTML, first);
  assert.ok(swatchFills(swatch.innerHTML).includes('#e0a526'));
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
  assert.equal(swatch.innerHTML, tartanView(loaded).swatch);
  assert.equal(swatch.innerHTML, swatchMarkup(loaded));
  assert.ok(swatchFills(swatch.innerHTML).includes('#78bae6'));
  assert.notEqual(swatch.innerHTML, swatchMarkup(defaultTartan()));

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const fallback = swatchEl();
  applyTartan(readTartan(blocked), { swatches: [fallback] });
  assert.equal(fallback.innerHTML, swatchMarkup(defaultTartan()));
});

test('each swatch is the woven sett, not one colour or a stripe', () => {
  assert.equal(SWATCH_REPEATS, 1);
  assert.equal(SWATCH_THREAD_PX, 2);
  const swatches = enabledTartans().map((tartan) => swatchMarkup(tartan));
  assert.equal(new Set(swatches).size, swatches.length);
  for (const tartan of enabledTartans()) {
    const markup = swatchMarkup(tartan);
    const px = tartan.threads.length * SWATCH_REPEATS * SWATCH_THREAD_PX;
    assert.equal(markup, tartanView(tartan).swatch);
    assert.match(markup, new RegExp(`viewBox="0 0 ${px} ${px}"`));
    assert.match(markup, new RegExp(`width="${px}" height="${px}"`));
    assert.ok(px <= 26, tartan.slug);
    assert.ok(px >= tartan.threads.length, tartan.slug);
    assert.match(markup, /shape-rendering="crispEdges"/);
    assert.doesNotMatch(markup, /linear-gradient/);
    const fills = new Set(swatchFills(markup));
    assert.ok(fills.size >= 2, tartan.slug);
    for (const fill of fills) assert.ok(tartan.threads.some((thread) => weaveColor([thread], 0, 0) === fill || thread.toLowerCase() === fill || (thread.toLowerCase() === '#ffffff' && fill === '#fff')));
    assert.equal(isWoven(tartan.threads), true, tartan.slug);
    assert.equal(weaveColor(tartan.threads, 0, tartan.threads.length), weaveColor(tartan.threads, 0, 0));
  }

  assert.equal(kiltPeekWanted({ tucked: true, reduceMotion: false }), true);
  assert.equal(kiltPeekWanted({ tucked: true, reduceMotion: true }), false);
  assert.equal(kiltPeekWanted({ tucked: false, reduceMotion: false }), false);

  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  const coo = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  assert.match(picker, /data-tartan-swatch/);
  assert.match(picker, /set:html=\{view\.swatch\}/);
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

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, selector);
  return match[1];
}

function cssDecl(block, prop) {
  const match = block.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  assert.ok(match, prop);
  return match[1].trim();
}

function swatchBox(button) {
  const contentHeight = button.height - button.border * 2 - button.paddingTop - button.paddingBottom;
  const top = button.border + button.paddingTop + (contentHeight - button.swatch) / 2;
  const left = button.border + button.paddingLeft;
  return {
    left,
    top,
    right: left + button.swatch,
    bottom: top + button.swatch,
  };
}

test('the swatch sits inside the pill at desktop and mobile widths', () => {
  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  const open = cssBlock(picker, '.tartan-open');
  const swatch = cssBlock(picker, '.swatch');
  const narrow = picker.slice(picker.indexOf('@media (max-width: 719px)'));
  const mobile = cssBlock(narrow, '.tartan-pick.corner .tartan-open');

  assert.equal(cssDecl(open, 'height'), '44px');
  assert.equal(cssDecl(open, 'min-height'), '44px');
  assert.equal(cssDecl(open, 'border'), '3px solid var(--green, #1f4d3a)');
  assert.equal(cssDecl(open, 'gap'), '8px');
  assert.equal(cssDecl(open, 'padding'), '5px 14px 5px 5px');
  assert.equal(cssDecl(swatch, 'width'), '28px');
  assert.equal(cssDecl(swatch, 'height'), '28px');
  assert.equal(cssDecl(swatch, 'border-radius'), '50%');
  assert.match(cssDecl(swatch, 'overflow'), /hidden/);
  assert.match(cssDecl(swatch, 'border'), /1px solid/);
  assert.match(picker, /image-rendering:\s*pixelated/);
  assert.equal(cssDecl(mobile, 'width'), '44px');
  assert.equal(cssDecl(mobile, 'padding'), '5px');
  assert.doesNotMatch(mobile, /max-width:\s*3rem/);

  const shared = { height: 44, border: 3, swatch: 28, paddingTop: 5, paddingBottom: 5, paddingLeft: 5 };
  for (const [width, button] of [
    ['desktop', { ...shared, width: 220, paddingRight: 14 }],
    ['mobile', { ...shared, width: 44, paddingRight: 5 }],
  ]) {
    const box = swatchBox(button);
    const inner = {
      left: button.border,
      top: button.border,
      right: button.width - button.border,
      bottom: button.height - button.border,
    };
    assert.ok(box.left >= inner.left, width);
    assert.ok(box.top >= inner.top, width);
    assert.ok(box.right <= inner.right, width);
    assert.ok(box.bottom <= inner.bottom, width);
    assert.equal(box.left - inner.left, 5, width);
    assert.equal(box.top - inner.top, (inner.bottom - inner.top - 28) / 2, width);
  }
});

function decodeIndexedPng(buf) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let palette = Buffer.alloc(0);
  let transparent = Buffer.alloc(0);
  const parts = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    offset += 4;
    const type = buf.toString('ascii', offset, offset + 4);
    offset += 4;
    const data = buf.subarray(offset, offset + length);
    offset += length + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparent = data;
    else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const pixels = [];
  let cursor = 0;
  let previous = Buffer.alloc(width);
  const paeth = (left, up, upLeft) => {
    const estimate = left + up - upLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const diagonal = Math.abs(estimate - upLeft);
    if (leftDistance <= upDistance && leftDistance <= diagonal) return left;
    return upDistance <= diagonal ? up : upLeft;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const row = Buffer.alloc(width);
    for (let x = 0; x < width; x += 1) {
      const value = raw[cursor];
      cursor += 1;
      const left = x ? row[x - 1] : 0;
      const up = previous[x];
      const upLeft = x ? previous[x - 1] : 0;
      let index = value;
      if (filter === 1) index = (value + left) & 255;
      else if (filter === 2) index = (value + up) & 255;
      else if (filter === 3) index = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) index = (value + paeth(left, up, upLeft)) & 255;
      row[x] = index;
    }
    previous = row;
    for (let x = 0; x < width; x += 1) {
      const index = row[x];
      const alpha = index < transparent.length ? transparent[index] : 255;
      pixels.push([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], alpha]);
    }
  }
  return { width, height, pixels };
}

test('the swatch sett is the same weave as the kilt sprite', () => {
  const skip = new Set(['3b2414', '55321e', 'f6ecd6', 'cf692b', 'e8964f', '96481e']);
  const poses = [[0, 0], [-1, -1], [-3, -2], [-2, -1], [0, 0], [0, 0], [-1, 1], [-3, 2], [-2, 1], [0, 0]];
  for (const tartan of enabledTartans()) {
    const image = decodeIndexedPng(readFileSync(join(site, 'public/tartans', tartan.slug, 'ceilidh-coo-strip.png')));
    let matched = 0;
    for (let frame = 0; frame < poses.length; frame += 1) {
      const [dy, swing] = poses[frame];
      const top = 42 + dy;
      const hem = 51 + dy;
      const pleats = new Set([27, 31, 35, 39].map((x) => x + Math.floor(swing / 2)));
      for (let y = top + 2; y < hem; y += 1) {
        const t = (y - top) / (hem - top);
        const left = 24 + ((22 + swing) - 24) * t;
        const right = 40 + ((42 + swing) - 40) * t;
        for (let x = 0; x < 64; x += 1) {
          if (x <= left + 0.5 || x >= right - 0.5) continue;
          if (pleats.has(x) && y >= hem - 3) continue;
          if (x >= 29 && x <= 36 && y >= top + 2 && y <= top + 8) continue;
          const pixel = image.pixels[y * image.width + frame * 64 + x];
          if (!pixel || pixel[3] < 200) continue;
          const found = pixel.slice(0, 3).map((part) => part.toString(16).padStart(2, '0')).join('');
          if (skip.has(found)) continue;
          const woven = weaveColor(tartan.threads, x, y, 24, top).replace('#', '');
          const full = woven.length === 3 ? woven.split('').map((part) => part + part).join('') : woven;
          assert.equal(full, found, tartan.slug);
          matched += 1;
        }
      }
    }
    assert.ok(matched > 300, tartan.slug);
  }
});
