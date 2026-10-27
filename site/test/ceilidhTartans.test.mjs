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
    assert.equal(found.short_label, row.short_label);
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
  assert.match(picker, /max-width: 640px/);
  assert.match(picker, /prefers-reduced-motion: reduce/);
  assert.match(picker, /try \{ return localStorage\.getItem\(key\); \} catch \{ return null; \}/);
  assert.match(picker, /try \{ localStorage\.setItem\(key, value\); \} catch/);
  assert.doesNotMatch(picker, /repeating-linear-gradient/);
  assert.doesNotMatch(picker, /border-radius:\s*50%/);
  assert.doesNotMatch(picker, /data-kilt-peek|peekKilt|showTartanName/);
  assert.doesNotMatch(coo, /data-kilt-peek/);
  const boot = picker.slice(picker.lastIndexOf('paint('));
  assert.match(boot, /readTartan\(storage\)/);
  assert.match(picker, /aria-expanded/);
  assert.match(picker, /Escape/);
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

const SHORT_LABELS = {
  'fraser-of-lovat': 'Lovat',
  calgary: 'Calgary',
  fraser: 'Fraser',
  'fraser-hunting': 'Fraser Hunting',
  government: 'Government',
  menzies: 'Menzies',
  'logan-1819': 'Logan 1819',
  macgillivray: 'MacGillivray',
};

test('the tartan picker opens from the name tag, not the hero flow', () => {
  const picker = readFileSync(join(site, 'src/components/TartanPicker.astro'), 'utf8');
  const coo = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  const catalog = JSON.parse(readFileSync(join(site, 'src/data/ceilidh-tartans.json'), 'utf8'));
  for (const row of catalog) assert.equal(row.short_label, SHORT_LABELS[row.slug], row.slug);
  assert.match(picker, /\{tartan\.short_label\}/);
  assert.match(picker, /aria-label=\{tartan\.name\}/);
  assert.match(picker, /title=\{tartan\.name\}/);
  assert.match(picker, /data-tartan-current/);
  assert.match(coo, /data-tartan-open/);
  assert.match(coo, /aria-expanded="false"/);
  assert.match(coo, /aria-controls="tartan-panel-corner"/);
  assert.match(coo, /aria-label="Pick Ceilidh's tartan"/);
  assert.match(coo, /class="tartan-chip"/);
  assert.match(coo, /tartan-caret/);
  assert.match(picker, /aria-label="Close"/);
  assert.match(picker, /Pick Ceilidh's tartan/);
  assert.doesNotMatch(picker, /tartan-row|scroll-snap|scrollIntoView/);
  assert.match(coo, /padding-bottom: calc\(4\.5rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(coo, /bottom: calc\(0\.35rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(coo, /flex-direction:\s*column/);

  const panel = cssBlock(picker, '.tartan-panel');
  const grid = cssBlock(picker, '.tartan-grid');
  const tile = cssBlock(picker, '.tile');
  const label = cssBlock(picker, '.tartan-label');
  const current = cssBlock(picker, '.tartan-current');
  const close = cssBlock(picker, '.tartan-close');
  const narrow = picker.slice(picker.indexOf('@media (max-width: 640px)'));
  const mobileGrid = cssBlock(narrow, '.tartan-grid');
  const sheet = cssBlock(narrow, '.tartan-panel');

  assert.equal(cssDecl(panel, 'width'), '324px');
  assert.equal(cssDecl(panel, 'padding'), '16px');
  assert.equal(cssDecl(panel, 'border-radius'), '12px');
  assert.match(cssDecl(panel, 'background'), /#FFFDF8/i);
  assert.match(cssDecl(panel, 'border'), /1px solid rgba\(31,\s*77,\s*58,\s*\.2\)/);
  assert.match(cssDecl(panel, 'box-shadow'), /0 8px 24px rgba\(0,\s*0,\s*0,\s*\.18\)/);
  assert.match(cssDecl(grid, 'grid-template-columns'), /repeat\(4,\s*minmax\(0,\s*64px\)\)/);
  assert.equal(cssDecl(grid, 'column-gap'), '12px');
  assert.equal(cssDecl(grid, 'row-gap'), '14px');
  assert.equal(cssDecl(tile, 'width'), '56px');
  assert.equal(cssDecl(tile, 'height'), '56px');
  assert.equal(cssDecl(tile, 'border-radius'), '4px');
  assert.equal(cssDecl(tile, 'background-size'), '50% 50%');
  assert.match(picker, /image-rendering:\s*pixelated/);
  assert.match(cssDecl(tile, 'border'), /1px solid rgba\(31,\s*77,\s*58,\s*\.45\)/);
  assert.match(picker, /outline:\s*3px solid #1F4D3A/);
  assert.match(picker, /outline-offset:\s*2px/);
  assert.match(label, /12px\/15px/);
  assert.match(label, /#2B1D14/i);
  assert.match(cssDecl(label, 'overflow-wrap'), /normal/);
  assert.match(cssDecl(label, 'text-align'), /center/);
  assert.match(cssDecl(label, 'width'), /100%/);
  assert.doesNotMatch(label, /ellipsis|line-clamp/);
  assert.match(current, /13px/);
  assert.match(current, /#2B1D14/i);
  assert.match(cssDecl(current, 'white-space'), /nowrap/);
  assert.equal(cssDecl(close, 'width'), '44px');
  assert.equal(cssDecl(close, 'height'), '44px');
  assert.match(picker, /svg \{ display: block; width: 16px; height: 16px; \}/);
  assert.match(sheet, /border-radius:\s*16px 16px 0 0/);
  assert.match(sheet, /max-height:\s*60vh/);
  assert.match(sheet, /safe-area-inset-bottom/);
  assert.match(sheet, /transform:\s*translateY\(100%\)/);
  assert.match(sheet, /transition:\s*transform 200ms ease/);
  assert.match(picker, /background:\s*rgba\(0, 0, 0, \.35\)/);
  assert.equal(cssDecl(mobileGrid, 'column-gap'), 'calc((100% - 256px) / 3)');
  assert.equal(cssDecl(mobileGrid, 'row-gap'), '14px');
  assert.match(narrow, /\.tartan-grid \.tile \{ width: 64px; height: 64px; \}/);
  assert.match(narrow, /top:\s*8px/);
  assert.match(narrow, /width:\s*36px/);
  assert.match(narrow, /height:\s*4px/);
  assert.match(picker, /prefers-reduced-motion: reduce/);
  assert.match(picker, /opacity:\s*0/);
  assert.match(coo, /min-height:\s*44px/);
  assert.match(coo, /width:\s*14px/);
  assert.match(coo, /margin-right:\s*6px/);
  assert.match(picker, /z-index:\s*80/);
  assert.match(picker, /z-index:\s*70/);
  assert.match(coo, /z-index:\s*91/);
});

test('the open and closed picker clears the hero at 1280 and 390', async (t) => {
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
    const readLayout = (page) => page.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const visible = (el) => !!el && el.getClientRects().length > 0;
      const panel = document.getElementById('tartan-panel-corner');
      const copy = [...document.querySelectorAll('.hero h1, .hero .lede, .hero .meet, .hero .stats')].filter(visible).map(rect);
      const tiles = [...document.querySelectorAll('#tartan-panel-corner .tartan-tile')].filter(visible);
      const labels = tiles.map((cell) => {
        const label = cell.querySelector('.tartan-label');
        const style = getComputedStyle(label);
        return {
          text: label.textContent,
          title: cell.getAttribute('title'),
          label: cell.getAttribute('aria-label'),
          height: label.getBoundingClientRect().height,
          scrollWidth: label.scrollWidth,
          clientWidth: label.clientWidth,
          cell: rect(cell),
          box: rect(label),
          weight: style.fontWeight,
          wrap: style.overflowWrap,
        };
      });
      const nav = [...document.querySelectorAll('nav, .tune-actions')].filter((el) => {
        const style = getComputedStyle(el);
        return visible(el) && (style.position === 'fixed' || style.position === 'sticky') && rect(el).top > window.innerHeight * 0.5;
      }).map(rect);
      return {
        open: !panel.hidden,
        expanded: document.querySelector('[aria-controls="tartan-panel-corner"]')?.getAttribute('aria-expanded'),
        stage: rect(document.querySelector('[data-coo-stage]')),
        heroCow: rect(document.querySelector('.hero > img')),
        panel: visible(panel) ? rect(panel) : null,
        copy,
        tiles: tiles.map(rect),
        labels,
        nav,
        current: document.querySelector('[data-tartan-current]')?.textContent || '',
        triggerHeight: rect(document.querySelector('[aria-controls="tartan-panel-corner"]'))?.height || 0,
      };
    });

    for (const [width, height, tileSize] of [[1280, 1100, 56], [390, 844, 64]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.addInitScript(() => localStorage.setItem('ceilidh-tartan', 'fraser-of-lovat'));
      await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(200);
      const closed = await readLayout(page);
      assert.equal(closed.open, false, `closed ${width}`);
      assert.equal(closed.expanded, width > 640 ? 'false' : closed.expanded);
      assert.equal(closed.panel, null, `closed panel ${width}`);
      for (const block of closed.copy) assert.equal(intersects(closed.stage, block), false, `closed sprite vs copy ${width}`);
      if (closed.heroCow) assert.equal(intersects(closed.stage, closed.heroCow), false, `closed sprite vs hero cow ${width}`);

      if (width > 640) await page.locator('[data-tartan-open]').click();
      else await page.locator('[data-tartan-open]').evaluate((el) => el.click());
      await page.waitForTimeout(280);
      const opened = await readLayout(page);
      assert.equal(opened.open, true, `open ${width}`);
      assert.equal(opened.expanded, 'true', `expanded ${width}`);
      assert.ok(opened.panel, `panel ${width}`);
      if (width > 640) assert.equal(intersects(opened.panel, opened.stage), false, `panel vs sprite ${width}`);
      const stack = await page.evaluate(() => ({
        sprite: Number(getComputedStyle(document.querySelector('[data-coo-toggle]')).zIndex),
        panel: Number(getComputedStyle(document.getElementById('tartan-panel-corner')).zIndex),
      }));
      assert.ok(stack.sprite > stack.panel, `sprite stacks above the panel ${width}`);
      if (opened.heroCow) assert.equal(intersects(opened.panel, opened.heroCow), false, `panel vs hero cow ${width}`);
      if (width > 640) {
        for (const block of opened.copy) assert.equal(intersects(opened.panel, block), false, `panel vs copy ${width}`);
      } else {
        assert.ok(opened.panel.top >= opened.heroCow.bottom - 1, 'the sheet leaves the hero coo uncovered');
        assert.ok(opened.panel.height <= height * 0.6 + 1, 'sheet max-height');
      }
      for (const bar of opened.nav) assert.equal(intersects(opened.panel, bar), false, `panel vs nav ${width}`);
      assert.equal(opened.tiles.length, 8, `tiles ${width}`);
      for (let i = 0; i < opened.tiles.length; i += 1) {
        for (let j = i + 1; j < opened.tiles.length; j += 1) {
          assert.equal(intersects(opened.tiles[i], opened.tiles[j]), false, `tiles overlap ${width}`);
        }
        const box = opened.tiles[i];
        assert.ok(Math.abs(box.width - (width > 640 ? 64 : box.width)) < 1 || width <= 640, `cell ${width}`);
      }
      const tileBoxes = await page.locator('#tartan-panel-corner .tile').evaluateAll((els) => els.map((el) => {
        const box = el.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }));
      for (const box of tileBoxes) {
        assert.ok(Math.abs(box.width - tileSize) < 1.2, `tile width ${width}`);
        assert.ok(Math.abs(box.height - tileSize) < 1.2, `tile height ${width}`);
      }
      for (const label of opened.labels) {
        assert.equal(label.wrap, 'normal', label.text);
        assert.ok(label.box.left >= label.cell.left - 1 && label.box.right <= label.cell.right + 1, label.text);
        assert.ok(label.cell.width <= 64.6, `${label.text} cell grew to ${label.cell.width}`);
        const spill = Math.max(0, label.scrollWidth - label.clientWidth) / 2;
        assert.ok(spill <= 6, `${label.text} spills ${spill}px into the next tile`);
        assert.ok(label.height <= 30.5, `${label.text} is taller than two lines`);
        assert.equal(label.label, label.title);
      }
      assert.equal(opened.labels.map((label) => label.text).join('|'), 'Lovat|Calgary|Fraser|Fraser Hunting|Government|Menzies|Logan 1819|MacGillivray');
      assert.equal(opened.current, 'Fraser of Lovat');
      if (width > 640) {
        assert.ok(Math.abs(opened.panel.width - 324) < 1.5, 'panel width');
        assert.ok(opened.triggerHeight >= 44, 'trigger height');
        const tag = await page.locator('[data-tartan-open]').boundingBox();
        const above = tag.y - opened.panel.bottom;
        const below = opened.panel.top - (tag.y + tag.height);
        assert.ok(Math.abs(above - 8) < 3 || Math.abs(below - 8) < 3, `anchor gap above ${above} below ${below}`);
        assert.ok(Math.abs(opened.panel.right - (tag.x + tag.width)) < 3, 'right aligned to the name tag');
        assert.ok(opened.panel.left >= 16 && opened.panel.right <= width - 16, 'clamped');
        assert.equal(intersects(opened.panel, { left: tag.x, top: tag.y, right: tag.x + tag.width, bottom: tag.y + tag.height }), false);
      } else {
        assert.ok(opened.panel.left <= 1 && opened.panel.right >= width - 1, 'full width sheet');
        assert.ok(opened.panel.height <= height * 0.6 + 1, 'max 60vh');
        const gap = opened.labels.length > 1 ? opened.tiles[1].left - opened.tiles[0].right : 0;
        assert.ok(gap > 20, `column gap ${gap}`);
      }
      await page.close();
    }

    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle' });
    const trigger = page.locator('[data-tartan-open]');
    for (let i = 0; i < 40 && await trigger.evaluate((el) => el !== document.activeElement); i += 1) {
      await page.keyboard.press('Tab');
    }
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    const inside = await page.evaluate(() => {
      const panel = document.getElementById('tartan-panel-corner');
      return panel.contains(document.activeElement);
    });
    assert.equal(inside, true);
    const before = await page.evaluate(() => document.activeElement.getAttribute('data-tartan-choice'));
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => document.activeElement.getAttribute('data-tartan-choice'));
    assert.notEqual(after, before);
    await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() => document.getElementById('tartan-panel-corner').contains(document.activeElement));
    assert.equal(stillInside, true);
    await page.locator('[data-tartan-close]').focus();
    await page.keyboard.press('Shift+Tab');
    const wrapped = await page.evaluate(() => document.getElementById('tartan-panel-corner').contains(document.activeElement));
    assert.equal(wrapped, true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
    await trigger.click();
    await page.waitForTimeout(50);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
    await page.locator('[data-tartan-choice="calgary"]').click();
    assert.match(await page.locator('[data-ceilidh-dance]').first().getAttribute('src'), /calgary/);
    assert.equal(await page.locator('[data-tartan-current]').first().textContent(), 'Calgary');
    assert.equal(await page.locator('#tartan-panel-corner').evaluate((el) => el.hidden), false);
    await page.locator('.hero h1').click();
    await page.waitForTimeout(50);
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    await page.locator('[data-coo-toggle]').click();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#tartan-panel-corner').evaluate((el) => el.hidden), false);
    await page.close();

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle' });
    await phone.locator('[data-coo-toggle]').click();
    await phone.waitForTimeout(50);
    assert.equal(await phone.locator('#tartan-panel-corner').evaluate((el) => el.hidden), false);
    await phone.close();
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
