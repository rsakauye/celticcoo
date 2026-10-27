import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CEILIDH_TARTAN, defaultTartan } from '../src/lib/ceilidhTartans.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const root = join(site, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

test('Ceilidh wears Fraser of Lovat and nothing else', () => {
  assert.equal(defaultTartan(), CEILIDH_TARTAN);
  assert.equal(CEILIDH_TARTAN.slug, 'fraser-of-lovat');
  assert.equal(CEILIDH_TARTAN.name, 'Fraser of Lovat');
  assert.equal(CEILIDH_TARTAN.fling, 'tartans/fraser-of-lovat/ceilidh-coo-strip.png');
  assert.equal(CEILIDH_TARTAN.ears, 'tartans/fraser-of-lovat/ceilidh-coo-ears-covered-strip.png');
  assert.equal(Object.keys(CEILIDH_TARTAN).some((key) => /storage|choice|enabled/i.test(key)), false);

  const folders = readdirSync(join(site, 'public/tartans'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(folders, ['fraser-of-lovat']);
  for (const file of ['ceilidh-coo-strip.png', 'ceilidh-coo-ears-covered-strip.png']) {
    const png = readFileSync(join(site, 'public/tartans/fraser-of-lovat', file));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});

test('the corner coo, the tuner, and the hero render Fraser of Lovat with no picker', () => {
  const coo = read(join(site, 'src/components/CeilidhCoo.astro'));
  const tune = read(join(site, 'src/pages/tune/index.astro'));
  const home = read(join(site, 'src/pages/index.astro'));
  const html = coo.split('<script>')[0];

  assert.match(coo, /defaultTartan\(\)\.fling/);
  assert.match(html, /data-ceilidh-dance/);
  assert.match(tune, /defaultTartan\(\)\.fling/);
  assert.match(tune, /defaultTartan\(\)\.ears/);
  assert.match(tune, /data-ceilidh-dance/);
  assert.match(tune, /data-ceilidh-ears/);
  assert.match(home, /wearing a Fraser of Lovat bow/);
  assert.doesNotMatch(`${coo}\n${tune}\n${home}`, /TartanPicker|data-tartan-|tartan-trigger|tartan-panel|tartan-chip|Pick Ceilidh's tartan|localStorage|sessionStorage|URLSearchParams|ceilidh-tartan/);

  const sources = walk(join(site, 'src')).concat(walk(join(site, 'public')).filter((path) => path.endsWith('.js')));
  for (const path of sources) {
    const text = read(path);
    assert.equal(text.includes('TartanPicker'), false, path);
    assert.equal(text.includes('data-tartan-'), false, path);
    assert.equal(text.includes('ceilidh-tartan'), false, path);
    assert.equal(text.includes('tartan-panel'), false, path);
  }
  assert.equal(existsSync(join(site, 'src/components/TartanPicker.astro')), false);
  assert.equal(existsSync(join(site, 'src/data/ceilidh-tartans.json')), false);
});

test("starting or stopping the dance never opens another panel", () => {
  // The picker used to listen for clicks on the same button that starts and
  // stops the dance. That second listener opened the tartan panel whenever
  // it was closed, so tucking Ceilidh away or bringing her out also opened
  // the picker, and closing one control tripped the other.
  const coo = read(join(site, 'src/components/CeilidhCoo.astro'));
  const html = coo.split('<script>')[0];
  const script = coo.split('<script>')[1].split('</script>')[0];
  const css = coo.split('<style>')[1] || '';

  assert.equal((html.match(/<button\b/g) || []).length, 1);
  assert.match(html, /<button[^>]*data-coo-toggle[\s\S]*data-ceilidh-dance[\s\S]*coo-stop[\s\S]*<\/button>/);
  assert.doesNotMatch(html, /<button[\s\S]*<button/);
  assert.doesNotMatch(html, /<(label|details|dialog|summary)\b/);
  assert.doesNotMatch(html, /aria-haspopup|aria-controls|role="dialog"|popover/);

  const clicks = script.match(/addEventListener\(\s*['"]click['"]/g) || [];
  assert.deepEqual(clicks, ["addEventListener('click'"]);
  const handler = script.slice(script.indexOf("addEventListener('click'"));
  assert.match(handler, /bringOut\(\)/);
  assert.match(handler, /tuck\(\)/);
  assert.doesNotMatch(handler, /tartan|openPanel|dialog|popover|aria-expanded|showModal|querySelector\(/);

  const sources = walk(join(site, 'src')).concat(walk(join(site, 'public')).filter((path) => path.endsWith('.js')));
  for (const path of sources) {
    if (path.endsWith('CeilidhCoo.astro')) continue;
    const text = read(path);
    assert.equal(text.includes('data-coo-toggle'), false, path);
    assert.equal(text.includes('openPanel'), false, path);
  }

  assert.match(css, /--peek-w:\s*30px/);
  assert.match(css, /--peek-h:\s*44px/);
  assert.match(css, /--peek-x:\s*-74px/);
  assert.match(css, /--peek-y:\s*-2px/);
  assert.match(css, /--peek-w:\s*70px/);
  assert.match(css, /--peek-h:\s*88px/);
  assert.match(css, /--peek-x:\s*-84px/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /z-index:\s*25/);
  assert.doesNotMatch(css, /tartan-panel|tartan-backdrop|tartan-trigger|z-index:\s*9[0-9]/);
});

test('the ears check expects only the Fraser of Lovat strips', () => {
  const script = read(join(root, 'scripts/make_ceilidh_ears.py'));
  assert.match(script, /fraser-of-lovat/);
  assert.doesNotMatch(script, /at least 8/);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }
}

async function withPage(width, height, run) {
  const chromeBin = ['/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find((path) => existsSync(path));
  const port = 9300 + width;
  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/chrome-ceilidh-${port}-${process.pid}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let cdp;
    for (let i = 0; i < 40; i += 1) {
      try {
        const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json());
        const ws = new WebSocket(version.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve);
          ws.addEventListener('error', reject);
        });
        cdp = new Cdp(ws);
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!cdp) throw new Error('chrome did not open a debugging port');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    await run(page);
  } finally {
    chrome.kill();
  }
}

async function evalPage(page, expression) {
  const result = await page('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'page evaluation failed');
  return result.result.value;
}

test('clicking the dance control does not open another panel', async (t) => {
  const chromeBin = ['/usr/bin/google-chrome', '/usr/local/bin/google-chrome'].find((path) => existsSync(path));
  if (!chromeBin) {
    t.skip('chrome is not installed');
    return;
  }
  try {
    const response = await fetch('http://127.0.0.1:4321/');
    if (!response.ok) throw new Error('not ok');
  } catch {
    t.skip('the site is not running');
    return;
  }

  const state = `(() => {
    const openDialog = [...document.querySelectorAll('dialog')].some((el) => el.open);
    const expanded = [...document.querySelectorAll('[aria-expanded="true"]')].map((el) => el.getAttribute('aria-label') || el.className);
    const panels = [...document.querySelectorAll('[role="dialog"], [popover], [data-tartan-panel], [data-tartan-open], .tartan-sheet, .tartan-panel')].length;
    const dance = document.querySelector('[data-ceilidh-dance]');
    const stage = document.querySelector('.coo-window');
    const box = stage ? stage.getBoundingClientRect() : null;
    const top = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
    const hero = document.querySelector('.hero > img');
    const heroBox = hero ? hero.getBoundingClientRect() : null;
    const overlaps = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      out: document.querySelector('[data-ceilidh-coo]')?.hasAttribute('data-out') || false,
      pressed: document.querySelector('[data-coo-toggle]')?.getAttribute('aria-pressed'),
      src: dance ? dance.getAttribute('src') : '',
      stored: localStorage.getItem('ceilidh-tartan'),
      openDialog,
      expanded,
      panels,
      headCovered: top ? !top.closest('[data-coo-toggle]') : true,
      headHeight: box ? box.height : 0,
      coversHero: overlaps(box, heroBox),
    };
  })()`;

  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await withPage(width, height, async (page) => {
      await page('Page.navigate', { url: 'http://127.0.0.1:4321/?tartan=calgary' });
      await sleep(800);
      await evalPage(page, `localStorage.setItem('ceilidh-tartan', 'calgary')`);
      await page('Page.reload');
      await sleep(800);
      const tucked = await evalPage(page, state);
      assert.equal(tucked.out, false, `tucked ${width}`);
      assert.equal(tucked.pressed, 'false', `pressed ${width}`);
      assert.match(tucked.src, /fraser-of-lovat\/ceilidh-coo-strip\.png$/, `src ${width}`);
      assert.equal(tucked.stored, 'calgary', `stored value is ignored ${width}`);
      assert.equal(tucked.openDialog, false, `dialog ${width}`);
      assert.deepEqual(tucked.expanded, [], `expanded ${width}`);
      assert.equal(tucked.panels, 0, `panels ${width}`);
      assert.equal(tucked.headCovered, false, `head covered ${width}`);
      assert.equal(tucked.coversHero, false, `covers hero ${width}`);
      assert.ok(tucked.headHeight >= (width > 500 ? 80 : 40), `head height ${width}`);

      await evalPage(page, `document.querySelector('[data-coo-toggle]').click()`);
      await sleep(500);
      const dancing = await evalPage(page, state);
      assert.equal(dancing.out, true, `dancing ${width}`);
      assert.equal(dancing.pressed, 'true', `dancing pressed ${width}`);
      assert.match(dancing.src, /fraser-of-lovat\/ceilidh-coo-strip\.png$/);
      assert.equal(dancing.openDialog, false, `dialog while dancing ${width}`);
      assert.deepEqual(dancing.expanded, [], `expanded while dancing ${width}`);
      assert.equal(dancing.panels, 0, `panel while dancing ${width}`);
      assert.equal(dancing.headCovered, false, `head covered while dancing ${width}`);
      assert.ok(dancing.headHeight >= (width > 500 ? 180 : 120), `standing height ${width}`);

      await evalPage(page, `document.querySelector('[data-coo-toggle]').click()`);
      await sleep(500);
      const stopped = await evalPage(page, state);
      assert.equal(stopped.out, false, `stopped ${width}`);
      assert.equal(stopped.pressed, 'false', `stopped pressed ${width}`);
      assert.equal(stopped.openDialog, false, `dialog after stop ${width}`);
      assert.deepEqual(stopped.expanded, [], `expanded after stop ${width}`);
      assert.equal(stopped.panels, 0, `panel after stop ${width}`);
      assert.match(stopped.src, /fraser-of-lovat\/ceilidh-coo-strip\.png$/);
      assert.equal(stopped.stored, 'calgary');
    });
  }
});
