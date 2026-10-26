import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORM,
  MASTER_GAIN,
  PARTS,
  STEPS_PER_BAR,
  TEMPO_BPM,
  VOICES,
  cycleDurationSeconds,
  expandTune,
  midiToHz,
  stepSeconds,
} from '../src/lib/highlandLaddie.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const D_MAJOR = new Set([1, 2, 4, 6, 7, 9, 11]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test('each strain sits on the march grid and the voices match', () => {
  for (const [name, part] of Object.entries(PARTS)) {
    const melodySteps = part.melody.reduce((sum, note) => sum + note[1], 0);
    const bassSteps = part.bass.length * 4;
    assert.equal(melodySteps, bassSteps, name);
    assert.equal(melodySteps % STEPS_PER_BAR, 0, name);
    assert.ok(melodySteps >= STEPS_PER_BAR * 4, name);
  }
});

test('AABB loops back onto the tonic with no gap in the clock', () => {
  assert.deepEqual(FORM, ['A', 'A', 'B', 'B']);
  const tune = expandTune();
  assert.equal(tune.totalSteps % STEPS_PER_BAR, 0);
  assert.equal(tune.melody[0].midi, 62);
  assert.equal(tune.melody.at(-1).midi, 62);
  assert.equal(tune.bass.at(-1).midi, 50);
  let at = 0;
  for (const note of tune.melody) {
    assert.equal(note.at, at);
    assert.ok(note.steps > 0);
    at += note.steps;
  }
  assert.equal(at, tune.totalSteps);
  at = 0;
  for (const note of tune.bass) {
    assert.equal(note.at, at);
    at += note.steps;
  }
  assert.equal(at, tune.totalSteps);
  const high = tune.melody.some((note) => note.midi === 74);
  assert.equal(high, true);
});

test('the setting stays in D major, at a march tempo, and at a modest volume', () => {
  const tune = expandTune();
  for (const note of [...tune.melody, ...tune.bass]) {
    assert.ok(note.midi >= 40 && note.midi <= 79, String(note.midi));
    assert.ok(D_MAJOR.has(note.midi % 12), String(note.midi));
  }
  assert.ok(TEMPO_BPM >= 96 && TEMPO_BPM <= 126);
  assert.equal(VOICES.melody.type, 'square');
  assert.equal(VOICES.bass.type, 'triangle');
  assert.ok(MASTER_GAIN <= 0.25);
  assert.ok(VOICES.melody.gain * MASTER_GAIN < 0.1);
  assert.ok(VOICES.bass.gain * MASTER_GAIN < 0.1);
  const seconds = cycleDurationSeconds(tune);
  assert.ok(seconds > 20 && seconds < 45, String(seconds));
});

test('pitch and step timing use standard MIDI tuning', () => {
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(62) - 293.6647679174076) < 1e-9);
  assert.equal(stepSeconds(), 60 / TEMPO_BPM / 4);
});

test('the arrangement file points at no external audio', () => {
  const src = readFileSync(join(site, 'src/lib/highlandLaddie.js'), 'utf8');
  assert.equal(/https?:\/\//.test(src), false);
  assert.equal(/\.(mid|midi|wav|mp3|ogg|flac)\b/i.test(src), false);
});

test('the dancing coo is on the home hero only, tucked until tapped, and quiet until then', () => {
  const widget = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  const home = readFileSync(join(site, 'src/pages/index.astro'), 'utf8');
  const layout = readFileSync(join(site, 'src/layouts/Base.astro'), 'utf8');
  const html = widget.split('<script>')[0];
  const css = widget.split('<style>')[1] || '';

  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="Bring out Ceilidh to dance to Highland Laddie"/);
  assert.match(html, /data-coo-tune>Highland Laddie</);
  assert.doesNotMatch(html, /data-out/);
  assert.match(widget, /Tuck Ceilidh away and stop \$\{name\}/);
  assert.match(widget, /let tuneIndex = 0/);
  assert.match(widget, /tuneIndex = nextTuneIndex\(tuneIndex\)/);
  const bring = widget.slice(widget.indexOf('function bringOut'), widget.indexOf('function tuck'));
  assert.doesNotMatch(bring, /nextTuneIndex/);
  assert.match(widget, /webkitAudioContext/);
  assert.match(widget, /ctx\.resume\(\)/);
  assert.doesNotMatch(widget, /await ctx\.resume|addEventListener\('click', async/);
  assert.equal(/localStorage|sessionStorage/.test(widget), false);
  assert.equal(/https?:\/\//.test(widget), false);

  // iOS paints a steps() background-position slide as one frozen frame.
  // The dance has to be a transform with both endpoints written out.
  assert.match(css, /steps\(10,\s*end\)/);
  assert.match(css, /image-rendering:\s*pixelated/);
  assert.match(css, /from \{ transform: translate3d\(0, 0, 0\); \}/);
  assert.match(css, /to \{ transform: translate3d\(-1280px, 0, 0\); \}/);
  assert.match(css, /to \{ transform: translate3d\(-1920px, 0, 0\); \}/);
  assert.doesNotMatch(css, /background-position\s*:/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none/);
  assert.match(css, /\[data-out\][\s\S]*coo-fling-2x/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /safe-area-inset-right/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /pointer-events:\s*auto/);

  assert.match(home, /<section class="hero">[\s\S]*<CeilidhCoo \/>[\s\S]*<\/section>/);
  assert.match(home, /\.hero > img \{ order:-1/);
  assert.doesNotMatch(home, /wrap-reverse/);
  assert.doesNotMatch(home, /slot="mascot"/);
  assert.doesNotMatch(layout, /name="mascot"/);

  const pages = walk(join(site, 'src/pages')).filter((path) => path.endsWith('.astro'));
  const users = pages.filter((path) => readFileSync(path, 'utf8').includes('CeilidhCoo'));
  assert.deepEqual(users.map((path) => path.slice(site.length)), ['/src/pages/index.astro']);

  const png = readFileSync(join(site, 'public/ceilidh-coo-strip.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 640);
  assert.equal(png.readUInt32BE(20), 64);
  assert.ok(png.length < 12000);
});
