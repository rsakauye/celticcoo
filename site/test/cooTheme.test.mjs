import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MASTER_GAIN, VOICES, midiToHz, stepSeconds } from '../src/lib/cooSynth.js';
import {
  BARS,
  BASS,
  BEATS_PER_BAR,
  HOOK,
  STEPS_PER_BEAT,
  TEMPO_BPM,
  TITLE,
  WHISTLE,
  prepareTheme,
} from '../src/lib/cooTheme.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');

// Whistle, hook, and bass, quantized from the theme loop: start step, MIDI, steps.
const WHISTLE_EXPORT = '0:81:2,2:85:2,4:88:1,5:88:3,8:90:2,10:88:2,12:85:4,32:83:2,34:86:2,36:91:1,37:88:3,40:86:2,42:83:2,44:86:4,64:81:2,66:85:2,68:88:1,69:85:3,72:88:2,74:90:2,76:93:4,96:91:2,98:90:2,100:88:1,101:86:3,104:85:2,106:86:2,108:83:4,128:93:4,132:88:4,136:91:1,137:88:3,140:93:8,160:90:2,162:88:2,164:86:1,165:88:3,168:85:2,170:83:2,172:81:8,192:93:4,196:88:4,200:91:1,201:88:3,204:93:8,224:90:2,226:88:2,228:86:1,229:88:3,232:85:2,234:83:2,236:81:8';
const HOOK_EXPORT = '128:81:4,132:76:4,136:79:1,137:76:3,140:81:8,160:78:2,162:76:2,164:74:1,165:76:3,168:73:2,170:71:2,172:69:8,192:81:4,196:76:4,200:79:1,201:76:3,204:81:8,224:78:2,226:76:2,228:74:1,229:76:3,232:73:2,234:71:2,236:69:8';
const BASS_EXPORT = '0:45:1,2:57:1,4:45:1,6:57:1,8:45:1,10:57:1,12:45:1,14:57:1,16:45:1,18:57:1,20:45:1,22:57:1,24:45:1,26:57:1,28:45:1,30:57:1,32:43:1,34:55:1,36:43:1,38:55:1,40:43:1,42:55:1,44:43:1,46:55:1,48:38:1,50:50:1,52:38:1,54:50:1,56:38:1,58:50:1,60:38:1,62:50:1,64:45:1,66:57:1,68:45:1,70:57:1,72:45:1,74:57:1,76:45:1,78:57:1,80:42:1,82:54:1,84:42:1,86:54:1,88:42:1,90:54:1,92:42:1,94:54:1,96:38:1,98:50:1,100:38:1,102:50:1,104:38:1,106:50:1,108:38:1,110:50:1,112:40:1,114:52:1,116:40:1,118:52:1,120:40:1,122:52:1,124:40:1,126:52:1,128:45:1,130:57:1,132:45:1,134:57:1,136:45:1,138:57:1,140:52:1,142:57:1,144:43:1,146:55:1,148:43:1,150:55:1,152:43:1,154:55:1,156:50:1,158:55:1,160:38:1,162:50:1,164:38:1,166:50:1,168:40:1,170:52:1,172:47:1,174:52:1,176:45:1,178:57:1,180:45:1,182:57:1,184:45:1,186:57:1,188:52:1,190:57:1,192:45:1,194:57:1,196:45:1,198:57:1,200:45:1,202:57:1,204:52:1,206:57:1,208:43:1,210:55:1,212:43:1,214:55:1,216:43:1,218:55:1,220:50:1,222:55:1,224:38:1,226:50:1,228:38:1,230:50:1,232:40:1,234:52:1,236:47:1,238:52:1,240:45:1,242:57:1,244:45:1,246:57:1,248:45:1,250:57:1,252:52:1,254:57:1';

function sig(notes) {
  return notes.map((note) => `${note.at}:${note.midi}:${note.steps}`).join(',');
}

test('whistle, hook, and bass pitches match the theme loop', () => {
  assert.equal(sig(WHISTLE), WHISTLE_EXPORT);
  assert.equal(sig(HOOK), HOOK_EXPORT);
  assert.equal(sig(BASS), BASS_EXPORT);
  assert.equal(WHISTLE[0].midi, 81);
  for (const note of HOOK) {
    const lead = WHISTLE.find((item) => item.at === note.at);
    assert.equal(lead.midi - note.midi, 12, String(note.at));
  }
  const ready = prepareTheme();
  const total = BARS * BEATS_PER_BAR * STEPS_PER_BEAT;
  for (const note of [...ready.expanded.melody, ...ready.expanded.bass]) {
    assert.equal(Number.isInteger(note.midi), true);
    assert.ok(note.steps > 0);
    assert.ok(note.at >= 0);
    assert.ok(note.at + note.steps <= total, `${note.midi} at ${note.at}`);
  }
});

test('the loop is the export length, played at 120 BPM', () => {
  assert.equal(BARS, 16);
  assert.equal(BEATS_PER_BAR, 4);
  assert.equal(TEMPO_BPM, 120);
  const ready = prepareTheme();
  const steps = BARS * BEATS_PER_BAR * STEPS_PER_BEAT;
  assert.equal(ready.expanded.totalSteps, steps);
  assert.equal(ready.step, stepSeconds(TEMPO_BPM));
  assert.equal(ready.cycleSeconds, steps * stepSeconds(TEMPO_BPM));
  assert.equal(ready.cycleSeconds, 32);
  assert.equal(ready.title, TITLE);
  assert.equal(ready.title, 'Coo theme');
  const last = Math.max(...ready.expanded.melody.map((note) => note.at + note.steps));
  assert.ok(last <= steps);
  assert.ok(last > steps - BEATS_PER_BAR * STEPS_PER_BEAT);
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

test('the Coo theme keeps its own cues beside the traditional tunes', () => {
  const widget = readFileSync(join(site, 'src/components/CeilidhCoo.astro'), 'utf8');
  const css = widget.split('<style>')[1] || '';

  assert.match(widget, /Bring out Ceilidh to dance'/);
  assert.match(widget, /Tuck Ceilidh away and stop Coo theme/);
  assert.match(widget, /from '\.\.\/lib\/cooSynth\.js'/);
  assert.match(widget, /from '\.\.\/lib\/cooTheme\.js'/);
  assert.match(widget, /from '\.\.\/lib\/danceTunes\.js'/);
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
  assert.match(css, /--coo-pad:/);
  assert.match(css, /padding-right:\s*var\(--coo-pad\)/);
});
