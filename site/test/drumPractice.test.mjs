import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_BPM,
  MIC_CONSTRAINTS,
  OK_MS,
  RUDIMENTS,
  beatSeconds,
  blockLevel,
  clampBpm,
  clampOffsetMs,
  clickTimes,
  createOnsetDetector,
  createScorer,
  estimateLatency,
  formatOffset,
  gradeOffset,
  gridTimes,
  leanAdvice,
  rudimentById,
  sensitivityToRatio,
  summarize,
} from '../src/lib/drumPractice.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');

const RATE = 48000;
const BLOCK = 128;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Room noise plus decaying noise bursts (stick strikes) at the given times. */
function synth(seconds, strikes, { noise = 0.003, hum = 0.01, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const n = Math.floor(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = (rand() * 2 - 1) * noise + hum * Math.sin((2 * Math.PI * 60 * i) / RATE);
  }
  for (const at of strikes) {
    const start = Math.floor(at * RATE);
    for (let i = 0; i < 0.08 * RATE && start + i < n; i += 1) {
      out[start + i] += (rand() * 2 - 1) * 0.5 * Math.exp(-i / (0.012 * RATE));
    }
  }
  return out;
}

function detect(signal, options) {
  const detector = createOnsetDetector(options);
  const found = [];
  let prev = 0;
  for (let i = 0; i + BLOCK <= signal.length; i += BLOCK) {
    const { level, last } = blockLevel(signal.subarray(i, i + BLOCK), prev);
    prev = last;
    const t = detector.push(level, i / RATE);
    if (t !== null) found.push(t);
  }
  return found;
}

test('bpm and offset clamp to sane ranges', () => {
  assert.equal(clampBpm(10), BPM_MIN);
  assert.equal(clampBpm(999), BPM_MAX);
  assert.equal(clampBpm('abc'), DEFAULT_BPM);
  assert.equal(clampBpm(90.4), 90);
  assert.equal(clampOffsetMs(900), 250);
  assert.equal(clampOffsetMs(-900), -250);
  assert.equal(clampOffsetMs(NaN), 0);
  assert.equal(beatSeconds(120), 0.5);
});

test('grid has one time per stroke and respects subdivision', () => {
  const quarters = gridTimes(1, 120, 1, 2);
  assert.equal(quarters.length, 8);
  assert.equal(quarters[1] - quarters[0], 0.5);
  const doubles = gridTimes(0, 120, 4, 1);
  assert.equal(doubles.length, 16);
  assert.ok(Math.abs(doubles[1] - 0.125) < 1e-9);
  const triplets = gridTimes(0, 60, 3, 1);
  assert.ok(Math.abs(triplets[1] - 1 / 3) < 1e-9);
});

test('clicks flag the first beat of each bar', () => {
  const clicks = clickTimes(0, 60, 8);
  assert.deepEqual(clicks.map((c) => c.accent), [true, false, false, false, true, false, false, false]);
});

test('rudiments are well formed and lookup falls back', () => {
  const ids = new Set();
  for (const r of RUDIMENTS) {
    assert.ok(!ids.has(r.id));
    ids.add(r.id);
    assert.ok(r.title && r.note && r.strokes);
    assert.ok(Number.isInteger(r.perBeat) && r.perBeat >= 1);
    // The sticking is one repeating cycle, so it must divide a bar's strokes evenly.
    const cycle = r.strokes.split(/\s+/).filter(Boolean).length;
    assert.equal((r.perBeat * 4) % cycle, 0, r.id);
  }
  assert.equal(rudimentById('nope').id, RUDIMENTS[0].id);
});

test('block level ignores a held low tone and follows a strike', () => {
  const hum = synth(0.2, [], { noise: 0, hum: 0.2 });
  const strike = synth(0.2, [0.05], { noise: 0, hum: 0 });
  let humMax = 0;
  let strikeMax = 0;
  let prev = 0;
  for (let i = 0; i + BLOCK <= hum.length; i += BLOCK) {
    const r = blockLevel(hum.subarray(i, i + BLOCK), prev);
    prev = r.last;
    humMax = Math.max(humMax, r.level);
  }
  prev = 0;
  for (let i = 0; i + BLOCK <= strike.length; i += BLOCK) {
    const r = blockLevel(strike.subarray(i, i + BLOCK), prev);
    prev = r.last;
    strikeMax = Math.max(strikeMax, r.level);
  }
  assert.ok(humMax < 0.01, `hum level ${humMax}`);
  assert.ok(strikeMax > 0.1, `strike level ${strikeMax}`);
  assert.deepEqual(blockLevel(new Float32Array(0), 0.5), { level: 0, last: 0.5 });
});

test('onset detector finds strikes within a few milliseconds', () => {
  const strikes = [0.5, 1.0, 1.5, 2.0, 2.5];
  const found = detect(synth(3, strikes), {});
  assert.equal(found.length, strikes.length);
  found.forEach((t, i) => {
    assert.ok(Math.abs(t - strikes[i]) < 0.008, `onset ${i} at ${t}, wanted ${strikes[i]}`);
  });
});

test('onset detector keeps both strokes of a fast double and merges a ringing hit', () => {
  const fast = detect(synth(1.5, [0.5, 0.62]), {});
  assert.equal(fast.length, 2);
  const ring = detect(synth(1.5, [0.5, 0.52]), {});
  assert.equal(ring.length, 1);
});

test('onset detector stays quiet on room noise and a steady hum', () => {
  assert.equal(detect(synth(3, [], { noise: 0.004, hum: 0.05 }), {}).length, 0);
});

test('sensitivity maps to a falling trigger ratio', () => {
  assert.ok(sensitivityToRatio(0) > sensitivityToRatio(50));
  assert.ok(sensitivityToRatio(50) > sensitivityToRatio(100));
  assert.ok(sensitivityToRatio(100) > 1);
  assert.equal(sensitivityToRatio('x'), sensitivityToRatio(50));
  const quiet = detect(synth(2, [0.5, 1.0], { noise: 0.003 }), { ratio: sensitivityToRatio(100) });
  assert.equal(quiet.length, 2);
});

test('detector ignores bad input', () => {
  const d = createOnsetDetector();
  assert.equal(d.push(NaN, 1), null);
  assert.equal(d.push(0.5, Infinity), null);
});

test('latency is the median click to onset delay, and needs enough hits', () => {
  const clicks = [1, 2, 3, 4, 5];
  const onsets = [1.081, 2.079, 3.083, 4.08, 5.082];
  assert.equal(estimateLatency(clicks, onsets), 81);
  assert.equal(estimateLatency(clicks, [1.08, 2.08]), null);
  assert.equal(estimateLatency(clicks, [1.9, 2.9, 3.9, 4.9, 5.9]), null);
});

test('grades follow the windows', () => {
  assert.equal(gradeOffset(0), 'perfect');
  assert.equal(gradeOffset(-25), 'perfect');
  assert.equal(gradeOffset(40), 'good');
  assert.equal(gradeOffset(-100), 'ok');
  assert.equal(gradeOffset(OK_MS + 1), null);
});

test('scorer claims each stroke once and counts strays and misses', () => {
  const s = createScorer({ expected: [1, 2, 3, 4] });
  assert.equal(s.hit(1.01).grade, 'perfect');
  assert.equal(s.hit(1.02).grade, 'stray');
  assert.equal(s.hit(2.05).grade, 'good');
  assert.equal(s.hit(2.9).offsetMs, -100);
  assert.deepEqual(s.sweep(5), [3]);
  assert.equal(s.stats.miss, 1);
  assert.equal(s.stats.stray, 1);
  const sum = s.summary();
  assert.equal(sum.total, 4);
  assert.equal(sum.hits, 3);
});

test('scorer takes more expected strokes as the metronome runs on', () => {
  const s = createScorer();
  assert.equal(s.hit(1).grade, 'stray');
  s.expect([2, 3]);
  assert.equal(s.hit(3.01).index, 1);
  assert.deepEqual(s.sweep(9), [0]);
});

test('scorer subtracts latency before judging', () => {
  const s = createScorer({ expected: [1, 2], latencyMs: 80 });
  assert.equal(s.hit(1.08).offsetMs, 0);
  s.setLatencyMs(0);
  assert.equal(s.hit(2.08).offsetMs, 80);
});

test('scorer sweep respects latency so late audio is not a miss', () => {
  const s = createScorer({ expected: [1], latencyMs: 200 });
  assert.deepEqual(s.sweep(1.25), []);
  assert.deepEqual(s.sweep(1.32), [0]);
});

test('summary reports lean only with enough hits', () => {
  const stats = { perfect: 0, good: 4, ok: 0, miss: 0, stray: 0 };
  assert.equal(summarize(stats, [40, 38, 42, 41], 4).lean, 'dragging');
  assert.equal(summarize(stats, [-40, -38, -42, -41], 4).lean, 'rushing');
  assert.equal(summarize(stats, [-2, 3, 1, -1], 4).lean, 'centered');
  assert.equal(summarize(stats, [40, 40], 4).lean, 'centered');
  assert.equal(summarize({ perfect: 0, good: 0, ok: 0, miss: 0, stray: 0 }, [], 0).accuracy, 0);
});

test('advice and offset text read plainly', () => {
  assert.match(leanAdvice({ hits: 2 }), /few more bars/);
  assert.match(leanAdvice({ hits: 10, lean: 'rushing', meanMs: -30, spread: 10 }), /30 ms early/);
  assert.match(leanAdvice({ hits: 10, lean: 'dragging', meanMs: 30, spread: 10 }), /30 ms late/);
  assert.match(leanAdvice({ hits: 10, lean: 'centered', meanMs: 0, spread: 50 }), /spread is wide/);
  assert.equal(formatOffset(0), 'on the beat');
  assert.equal(formatOffset(-12), '12 ms early');
  assert.equal(formatOffset(7), '7 ms late');
});

test('microphone stays raw and never records', () => {
  assert.equal(MIC_CONSTRAINTS.audio.echoCancellation, false);
  assert.equal(MIC_CONSTRAINTS.audio.noiseSuppression, false);
  assert.equal(MIC_CONSTRAINTS.audio.autoGainControl, false);
  for (const file of ['src/lib/drumPractice.js', 'src/lib/drumPracticePage.js', 'public/drum-worklet.js']) {
    const text = readFileSync(join(site, file), 'utf8');
    assert.doesNotMatch(text, /MediaRecorder|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie/, file);
  }
});
