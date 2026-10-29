import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DANCE_TUNES, nextTuneIndex, prepareTune } from '../src/lib/danceTunes.js';
import { FORM, STEPS_PER_BAR, expandTune } from '../src/lib/highlandLaddie.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
// A mixolydian, the bagpipe scale: A B C# D E F# G.
const PIPE = new Set([1, 2, 4, 6, 7, 9, 11]);

test('stopping and starting rotates Highland Laddie, Ghillie Callum, Seann Triubhas', () => {
  assert.deepEqual(
    DANCE_TUNES.map((tune) => tune.id),
    ['highland-laddie', 'ghillie-callum', 'seann-triubhas'],
  );
  assert.deepEqual(
    DANCE_TUNES.map((tune) => tune.title),
    ['Highland Laddie', 'Ghillie Callum', 'Seann Triubhas'],
  );
  assert.equal(nextTuneIndex(0), 1);
  assert.equal(nextTuneIndex(1), 2);
  assert.equal(nextTuneIndex(2), 0);

  let index = 0;
  const played = [];
  for (let n = 0; n < 4; n++) {
    played.push(prepareTune(index).id);
    index = nextTuneIndex(index);
  }
  assert.deepEqual(played, [
    'highland-laddie',
    'ghillie-callum',
    'seann-triubhas',
    'highland-laddie',
  ]);
});

test('Ghillie Callum and Seann Triubhas sit on the same grid, in the pipe scale', () => {
  for (const index of [1, 2]) {
    const tune = DANCE_TUNES[index];
    for (const [name, part] of Object.entries(tune.parts)) {
      const melodySteps = part.melody.reduce((sum, note) => sum + note[1], 0);
      const bassSteps = part.bass.length * 4;
      assert.equal(melodySteps, bassSteps, `${tune.id} ${name}`);
      assert.equal(melodySteps % STEPS_PER_BAR, 0, `${tune.id} ${name}`);
    }
    const expanded = expandTune(FORM, tune.parts);
    assert.equal(expanded.melody[0].at, 0);
    assert.equal(expanded.melody.at(-1).midi, 69, tune.id);
    assert.equal(expanded.bass.at(-1).midi, 45, tune.id);
    for (const note of [...expanded.melody, ...expanded.bass]) {
      assert.ok(note.midi >= 40 && note.midi <= 84, `${tune.id} ${note.midi}`);
      assert.ok(PIPE.has(note.midi % 12), `${tune.id} ${note.midi}`);
    }
    const ready = prepareTune(index);
    assert.ok(ready.cycleSeconds > 20 && ready.cycleSeconds < 50, String(ready.cycleSeconds));
    assert.equal(ready.title, tune.title);
  }
  assert.ok(DANCE_TUNES[1].bpm > DANCE_TUNES[2].bpm);
});

test('the new arrangements point at no external audio', () => {
  for (const file of ['ghillieCallum.js', 'seannTriubhas.js', 'danceTunes.js']) {
    const src = readFileSync(join(site, 'src/lib', file), 'utf8');
    assert.equal(/https?:\/\//.test(src), false, file);
    assert.equal(/\.(mid|midi|wav|mp3|ogg|flac)\b/i.test(src), false, file);
  }
});

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

// "Gillie" not already part of "Ghillie": the g is not preceded by h.
const MISSPELLED = /(?<!h)gillie callum/i;

test('site/src spells the sword dance Ghillie Callum', () => {
  assert.equal(DANCE_TUNES[1].title, 'Ghillie Callum');
  assert.equal(DANCE_TUNES[1].id, 'ghillie-callum');
  const srcRoot = join(site, 'src');
  const hits = [];
  let spelled = false;
  for (const file of filesUnder(srcRoot)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('Ghillie Callum')) spelled = true;
    if (MISSPELLED.test(text)) hits.push(file.slice(srcRoot.length + 1));
  }
  assert.equal(spelled, true);
  assert.deepEqual(hits, []);
});
