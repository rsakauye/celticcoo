import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
  pickerOrder,
  readTartan,
  settTileImage,
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
  assert.match(picker, /pickerOrder\(/);
  assert.equal(pickerOrder()[0].slug, 'fraser-of-lovat');
  assert.deepEqual(pickerOrder().map((tartan) => tartan.slug), catalog.map((tartan) => tartan.slug));
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

test('the pressed tile follows the tartan', () => {
  const storage = memory();
  const calgary = choiceEl('calgary');
  const lovat = choiceEl('fraser-of-lovat');
  const nodes = { choices: [lovat, calgary] };

  applyTartan(readTartan(storage), nodes);
  assert.equal(lovat.getAttribute('aria-pressed'), 'true');
  assert.equal(calgary.getAttribute('aria-pressed'), 'false');

  applyTartan(writeTartanId('calgary', storage), nodes);
  assert.equal(calgary.getAttribute('aria-pressed'), 'true');
  assert.equal(lovat.getAttribute('aria-pressed'), 'false');
  assert.ok(swatchFills(swatchMarkup(readTartan(storage))).includes('#e0a526'));
  assert.notEqual(settTileImage(readTartan(storage)), settTileImage(defaultTartan()));
});

test('the pressed tile on load follows the tartan saved in storage', () => {
  const storage = memory([[STORAGE_KEY, 'menzies']]);
  const menzies = choiceEl('menzies');
  const lovat = choiceEl('fraser-of-lovat');
  const loaded = readTartan(storage);
  applyTartan(loaded, { choices: [lovat, menzies] });
  assert.equal(loaded.slug, 'menzies');
  assert.equal(menzies.getAttribute('aria-pressed'), 'true');
  assert.equal(lovat.getAttribute('aria-pressed'), 'false');
  assert.equal(tartanView(loaded).swatch, swatchMarkup(loaded));
  assert.match(settTileImage(loaded), /data:image\/svg\+xml/);
  assert.ok(swatchFills(swatchMarkup(loaded)).includes('#78bae6'));
  assert.notEqual(settTileImage(loaded), settTileImage(defaultTartan()));

  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  const fallback = choiceEl('fraser-of-lovat');
  const other = choiceEl('calgary');
  applyTartan(readTartan(blocked), { choices: [fallback, other] });
  assert.equal(fallback.getAttribute('aria-pressed'), 'true');
  assert.equal(other.getAttribute('aria-pressed'), 'false');
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
    assert.equal(settTileImage(tartan).includes(encodeURIComponent(markup)), true);
    assert.match(markup, /shape-rendering="crispEdges"/);
    assert.doesNotMatch(markup, /linear-gradient/);
    const fills = new Set(swatchFills(markup));
    assert.ok(fills.size >= 2, tartan.slug);
    for (const fill of fills) assert.ok(tartan.threads.some((thread) => weaveColor([thread], 0, 0) === fill || thread.toLowerCase() === fill || (thread.toLowerCase() === '#ffffff' && fill === '#fff')));
    assert.equal(isWoven(tartan.threads), true, tartan.slug);
    assert.equal(weaveColor(tartan.threads, 0, tartan.threads.length), weaveColor(tartan.threads, 0, 0));
  }

  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  const coo = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  assert.match(picker, /data-tartan-tile/);
  assert.match(picker, /settTileImage\(tartan\)/);
  assert.match(picker, /applyTartan\(tartan,/);
  assert.match(picker, /paint\(readTartan\(storage\)\)/);
  assert.match(picker, /aria-pressed=/);
  assert.match(picker, /max-width: 719px/);
  assert.match(picker, /prefers-reduced-motion: reduce/);
  assert.match(picker, /try \{ return localStorage\.getItem\(key\); \} catch \{ return null; \}/);
  assert.match(picker, /try \{ localStorage\.setItem\(key, value\); \} catch/);
  assert.doesNotMatch(picker, /repeating-linear-gradient/);
  assert.doesNotMatch(picker, /border-radius:\s*50%/);
  assert.doesNotMatch(picker, /data-kilt-peek|peekKilt|showTartanName/);
  assert.doesNotMatch(coo, /data-kilt-peek/);
  const boot = picker.slice(picker.lastIndexOf('paint('));
  assert.match(boot, /readTartan\(storage\)/);
  assert.match(boot, /revealSelected/);
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

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test('the picker stays below the stage at 1280 and 390', () => {
  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  const coo = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  const stageAt = coo.indexOf('data-coo-stage');
  const pickerAt = coo.indexOf('<TartanPicker');
  assert.ok(stageAt > -1 && pickerAt > stageAt);
  assert.doesNotMatch(picker, /position:\s*absolute/);
  assert.match(coo, /flex-direction:\s*column/);
  assert.match(coo, /padding-top:\s*8px/);
  assert.match(coo, /height:\s*var\(--peek-h\)/);

  const tile = cssBlock(picker, '.tile');
  const button = cssBlock(picker, '.tartan-tile');
  const label = cssBlock(picker, '.tartan-label');
  const row = cssBlock(picker, '.tartan-row');
  const corner = cssBlock(picker, '.tartan-pick.corner');
  const narrow = picker.slice(picker.indexOf('@media (max-width: 719px)'));
  const mobileCorner = cssBlock(narrow, '.tartan-pick.corner');
  const mobileRow = cssBlock(narrow, '.tartan-pick.corner .tartan-row');
  const mobileLabel = cssBlock(narrow, '.tartan-label');

  assert.equal(cssDecl(tile, 'width'), '56px');
  assert.equal(cssDecl(tile, 'height'), '56px');
  assert.equal(cssDecl(tile, 'border-radius'), '4px');
  assert.equal(cssDecl(tile, 'background-size'), '50% 50%');
  assert.match(cssDecl(tile, 'background-repeat'), /repeat/);
  assert.match(picker, /image-rendering:\s*pixelated/);
  assert.match(cssDecl(tile, 'border'), /1px solid rgba\(31,\s*77,\s*58,\s*\.45\)/);
  assert.equal(cssDecl(row, 'gap'), '12px');
  assert.match(cssDecl(row, 'justify-content'), /center/);
  assert.equal(cssDecl(corner, 'margin-top'), '24px');
  assert.equal(cssDecl(corner, 'padding-bottom'), '32px');
  assert.equal(cssDecl(button, 'gap'), '6px');
  assert.equal(cssDecl(button, 'min-height'), '70px');
  assert.equal(cssDecl(button, 'min-width'), '48px');
  assert.match(label, /13px\/16px/);
  assert.match(label, /#2B1D14/i);
  assert.match(cssDecl(label, 'white-space'), /normal/);
  assert.match(cssDecl(label, 'overflow'), /visible/);
  assert.equal(cssDecl(label, 'max-width'), 'calc(56px + 12px)');
  assert.doesNotMatch(label, /ellipsis|line-clamp|nowrap/);
  assert.match(picker, /outline:\s*3px solid #1F4D3A/);
  assert.match(picker, /outline-offset:\s*2px/);
  assert.match(picker, /aria-pressed="true"/);
  assert.match(picker, /font-weight:\s*700/);
  assert.match(picker, /translateY\(-2px\)/);
  assert.match(picker, /scrollIntoView\(\{ inline: 'nearest'/);

  assert.match(narrow, /\.tartan-tile,\s*\n\s*\.tile \{ width: 48px; \}/);
  assert.match(narrow, /\.tile \{ height: 48px; \}/);
  assert.equal(cssDecl(mobileRow, 'gap'), '10px');
  assert.match(cssDecl(mobileRow, 'scroll-snap-type'), /x mandatory/);
  assert.match(cssDecl(mobileRow, 'overflow-x'), /auto/);
  assert.match(picker, /scroll-snap-align:\s*start/);
  assert.match(picker, /scrollbar-width:\s*none/);
  assert.equal(cssDecl(mobileCorner, 'margin-top'), '16px');
  assert.match(cssDecl(mobileCorner, 'padding'), /16px/);
  assert.equal(cssDecl(mobileLabel, 'max-width'), 'calc(48px + 12px)');

  const desktop = {
    stage: { left: 700, top: 400, right: 770, bottom: 488 },
    picker: { left: 400, top: 488 + 24, right: 960, bottom: 488 + 24 + 160 },
  };
  const mobile = {
    stage: { left: 340, top: 620, right: 390, bottom: 664 },
    picker: { left: 0, top: 664 + 16, right: 390, bottom: 664 + 16 + 140 },
  };
  assert.equal(intersects(desktop.stage, desktop.picker), false);
  assert.equal(intersects(mobile.stage, mobile.picker), false);
  assert.ok(desktop.picker.top - desktop.stage.bottom >= 24);
  assert.ok(mobile.picker.top - mobile.stage.bottom >= 16);
  assert.ok(desktop.stage.top >= 8);
});

test('rendered tiles clear the stage at 1280 and 390', async (t) => {
  if (!existsSync('/usr/local/bin/google-chrome')) {
    t.skip('chrome is not installed');
    return;
  }
  let playwright;
  try {
    playwright = await import('/tmp/pw/node_modules/playwright-core/index.js');
  } catch {
    t.skip('playwright is not installed');
    return;
  }
  let up = false;
  try {
    const response = await fetch('http://127.0.0.1:4321/');
    up = response.ok;
  } catch { /* the dev server is not running */ }
  if (!up) {
    t.skip('the site is not running');
    return;
  }

  const { chromium } = playwright.default;
  const browser = await chromium.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const [width, height, tile, minGap, slug] of [[1280, 800, 56, 24, 'calgary'], [390, 844, 48, 16, 'macgillivray']]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle' });
      await page.evaluate((id) => localStorage.setItem('ceilidh-tartan', id), slug);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(200);
      const measured = await page.evaluate(() => {
        const rect = (el) => {
          const box = el.getBoundingClientRect();
          return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        };
        const stage = document.querySelector('[data-coo-stage]');
        const picker = document.querySelector('[data-tartan-picker="corner"]');
        const perch = document.querySelector('[data-ceilidh-coo]');
        const tiles = [...document.querySelectorAll('[data-tartan-picker="corner"] .tile')];
        const labels = [...document.querySelectorAll('[data-tartan-picker="corner"] .tartan-label')];
        const pressed = document.querySelector('[data-tartan-picker="corner"] [aria-pressed="true"]');
        const row = document.querySelector('[data-tartan-row]');
        const pressedBox = pressed.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        return {
          stage: rect(stage),
          picker: rect(picker),
          clearAbove: rect(stage).top - rect(perch).top,
          tiles: tiles.map((el) => rect(el)),
          labels: labels.map((el) => ({
            text: el.textContent,
            height: el.getBoundingClientRect().height,
            overflow: getComputedStyle(el).overflow,
            textOverflow: getComputedStyle(el).textOverflow,
            whiteSpace: getComputedStyle(el).whiteSpace,
          })),
          outline: getComputedStyle(pressed.querySelector('.tile')).outline,
          outlineOffset: getComputedStyle(pressed.querySelector('.tile')).outlineOffset,
          pressed: pressed.getAttribute('aria-pressed'),
          scrollY: window.scrollY,
          selectedInRow: pressedBox.left >= rowBox.left - 1 && pressedBox.right <= rowBox.right + 1,
        };
      });
      const hit = intersects(measured.stage, measured.picker);
      assert.equal(hit, false, String(width));
      assert.ok(measured.picker.top - measured.stage.bottom >= minGap - 0.5, String(width));
      assert.ok(measured.clearAbove >= 8 - 0.5, String(width));
      assert.equal(measured.scrollY, 0, String(width));
      assert.equal(measured.selectedInRow, true, String(width));
      assert.equal(measured.pressed, 'true');
      assert.match(measured.outline, /3px/);
      assert.equal(measured.outlineOffset, '2px');
      for (const box of measured.tiles) {
        assert.ok(Math.abs(box.width - tile) < 0.6, String(width));
        assert.ok(Math.abs(box.height - tile) < 0.6, String(width));
        assert.ok(Math.abs(box.width - box.height) < 0.6, String(width));
      }
      for (const name of ['Fraser Hunting', 'Logan (1819)']) {
        const label = measured.labels.find((item) => item.text === name);
        assert.ok(label, name);
        assert.equal(label.whiteSpace, 'normal');
        assert.equal(label.overflow, 'visible');
        assert.notEqual(label.textOverflow, 'ellipsis');
        assert.ok(label.height > 16 && label.height <= 32.5, name);
      }
      await page.close();
    }
  } finally {
    await browser.close();
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
