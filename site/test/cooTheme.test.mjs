import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MASTER_GAIN,
  STEPS_PER_BAR,
  STEPS_PER_BEAT,
  VOICES,
  expandTune,
  midiToHz,
  stepSeconds,
} from '../src/lib/cooSynth.js';
import { FORM, PARTS, TEMPO_BPM, TITLE, prepareTheme } from '../src/lib/cooTheme.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
// G major: C D E F# G A B.
const G_MAJOR = new Set([0, 2, 4, 6, 7, 9, 11]);

test('every note is a real G-major pitch and the voices share the bar grid', () => {
  for (const [name, part] of Object.entries(PARTS)) {
    const melodySteps = part.melody.reduce((sum, note) => sum + note[1], 0);
    const bassSteps = part.bass.length * STEPS_PER_BEAT;
    assert.equal(melodySteps, bassSteps, name);
    assert.equal(melodySteps % STEPS_PER_BAR, 0, name);
    assert.ok(melodySteps >= STEPS_PER_BAR, name);
    for (const [midi, steps] of part.melody) {
      assert.equal(Number.isInteger(midi), true, `${name} ${midi}`);
      assert.equal(Number.isInteger(steps), true, `${name} ${steps}`);
      assert.ok(steps > 0, `${name} ${steps}`);
      assert.ok(midi >= 60 && midi <= 84, `${name} ${midi}`);
      assert.ok(G_MAJOR.has(midi % 12), `${name} ${midi}`);
    }
    for (const midi of part.bass) {
      assert.equal(Number.isInteger(midi), true, `${name} bass ${midi}`);
      assert.ok(midi >= 36 && midi <= 72, `${name} bass ${midi}`);
      assert.ok(G_MAJOR.has(midi % 12), `${name} bass ${midi}`);
    }
  }

  const tune = expandTune(FORM, PARTS);
  let at = 0;
  for (const note of tune.melody) {
    assert.equal(note.at, at);
    assert.ok(note.steps > 0);
    assert.equal(note.voice, 'melody');
    at += note.steps;
  }
  assert.equal(at, tune.totalSteps);
  at = 0;
  for (const note of tune.bass) {
    assert.equal(note.at, at);
    assert.equal(note.steps, STEPS_PER_BEAT);
    assert.equal(note.voice, 'bass');
    at += note.steps;
  }
  assert.equal(at, tune.totalSteps);
  assert.equal(tune.melody[0].midi, 67);
  assert.ok(tune.melody.some((note) => note.steps === 3 && tune.melody[tune.melody.indexOf(note) + 1]?.steps === 1));
});

test('the loop is between 8 and 16 bars', () => {
  const tune = expandTune(FORM, PARTS);
  const bars = tune.totalSteps / STEPS_PER_BAR;
  assert.equal(Number.isInteger(bars), true);
  assert.ok(bars >= 8 && bars <= 16, String(bars));
  assert.deepEqual(FORM, ['A', 'A', 'B', 'B']);

  const ready = prepareTheme();
  assert.equal(ready.title, TITLE);
  assert.equal(ready.title, 'Coo theme');
  assert.equal(ready.id, 'coo-theme');
  assert.equal(ready.bpm, TEMPO_BPM);
  assert.equal(ready.step, stepSeconds(TEMPO_BPM));
  assert.equal(ready.cycleSeconds, bars * STEPS_PER_BAR * stepSeconds(TEMPO_BPM));
  assert.ok(TEMPO_BPM >= 96 && TEMPO_BPM <= 132);
  assert.ok(ready.cycleSeconds >= 8 && ready.cycleSeconds <= 20, String(ready.cycleSeconds));
});

test('playback gain stays within a modest limit', () => {
  assert.ok(MASTER_GAIN > 0 && MASTER_GAIN <= 0.25);
  assert.equal(VOICES.melody.type, 'square');
  assert.equal(VOICES.bass.type, 'triangle');
  assert.ok(VOICES.melody.gain > 0 && VOICES.melody.gain < 1);
  assert.ok(VOICES.bass.gain > 0 && VOICES.bass.gain < 1);
  assert.ok(VOICES.melody.gain * MASTER_GAIN < 0.1);
  assert.ok(VOICES.bass.gain * MASTER_GAIN < 0.1);
  assert.ok((VOICES.melody.gain + VOICES.bass.gain) * MASTER_GAIN < 0.2);
  assert.equal(midiToHz(69), 440);
});

test('the corner coo plays this one theme and does not cycle tunes', () => {
  const widget = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  const html = widget.split('<script>')[0];
  const css = widget.split('<style>')[1] || '';

  assert.match(html, /aria-label="Bring out Ceilidh to dance"/);
  assert.match(html, /data-coo-tune>Coo theme</);
  assert.match(html, /coo-stop">stop<\/span> <span class="coo-tune-out" data-coo-tune>Coo theme</);
  assert.match(widget, /Tuck Ceilidh away and stop \$\{TITLE\}/);
  assert.match(widget, /from '\.\.\/lib\/cooSynth\.js'/);
  assert.match(widget, /from '\.\.\/lib\/cooTheme\.js'/);
  assert.doesNotMatch(widget, /nextTuneIndex|tuneIndex|DANCE_TUNES|prepareTune/);
  assert.match(widget, /data-hide-corner-coo/);
  assert.match(widget, /webkitAudioContext/);
  assert.match(widget, /ctx\.resume\(\)/);
  assert.doesNotMatch(widget, /await ctx\.resume|addEventListener\('click', async/);
  assert.equal(/localStorage|sessionStorage/.test(widget), false);

  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none/);
  assert.match(css, /html\[data-hide-corner-coo\]/);
  assert.match(css, /steps\(10,\s*end\)/);
  assert.match(css, /coo-fling-2x 1s steps\(10, end\)/);
});
