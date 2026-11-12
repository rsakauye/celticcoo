import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AMBER_CENTS,
  ANTICIPATE_CENTS,
  DEFAULT_LOW_A,
  DEFAULT_OUTPUT_LEVEL,
  DEMO_START_CENTS,
  DROP_GRACE_MS,
  GREEN_CENTS,
  MIC_CONSTRAINTS,
  PERFECT_CENTS,
  PERFECT_HOLD_MS,
  PRESETS,
  STEPS,
  beatAdvice,
  centsBetween,
  clampLowA,
  cooMood,
  cooPose,
  createLockHold,
  createPitchTracker,
  describeReading,
  detectPitch,
  detuneHz,
  droneTargets,
  estimateBeatRate,
  formatCents,
  isLocked,
  lockReference,
  meterZone,
  outputGain,
  slideAdvice,
  steadyPitch,
} from '../src/lib/droneTuner.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function synth(freq, sampleRate, seconds, { harmonics = [1, 0.55, 0.28, 0.14, 0.08], snrDb = 28, seed = 1 } = {}) {
  const n = Math.round(sampleRate * seconds);
  const x = new Float64Array(n);
  let sigPow = 0;
  for (const amp of harmonics) sigPow += 0.5 * amp * amp;
  const noiseRms = Math.sqrt(sigPow) / 10 ** (snrDb / 20);
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) s += harmonics[h] * Math.sin(2 * Math.PI * freq * (h + 1) * t);
    x[i] = s + gaussian(rng) * noiseRms;
  }
  return x;
}

function absCents(measured, truth) {
  return Math.abs(1200 * Math.log2(measured / truth));
}

function assertCents(measured, truth, limit, label) {
  const cents = absCents(measured, truth);
  assert.ok(cents < limit, `${label}: ${measured.toFixed(4)} Hz is ${cents.toFixed(3)} cents from ${truth} Hz`);
}

test('cents math is zero on the target, 1200 on an octave, and signed', () => {
  assert.equal(centsBetween(480, 480), 0);
  assert.ok(Math.abs(centsBetween(240, 120) - 1200) < 1e-9);
  assert.ok(Math.abs(centsBetween(120, 240) + 1200) < 1e-9);
  const sharp = detuneHz(240, 3);
  assert.ok(Math.abs(centsBetween(sharp, 240) - 3) < 1e-9);
  const flat = detuneHz(120, -3);
  assert.ok(Math.abs(centsBetween(flat, 120) + 3) < 1e-9);
  assert.equal(centsBetween(0, 240), null);
  assert.equal(centsBetween(240, -1), null);
});

test('tenor is low A / 2 and bass is low A / 4, with the nearest drone named', () => {
  assert.deepEqual(PRESETS, [466, 470, 475, 480, 485]);
  assert.equal(DEFAULT_LOW_A, 480);
  for (const lowA of PRESETS) {
    const targets = droneTargets(lowA);
    assert.equal(targets.tenor, lowA / 2);
    assert.equal(targets.bass, lowA / 4);
  }
  const tenor = describeReading(240.7, 480);
  assert.equal(tenor.targetId, 'tenor');
  assert.equal(tenor.targetHz, 240);
  assert.ok(Math.abs(tenor.cents - centsBetween(240.7, 240)) < 1e-9);
  assert.equal(tenor.zone, 'close');
  const bass = describeReading(119.5, 480);
  assert.equal(bass.targetId, 'bass');
  assert.equal(bass.targetHz, 120);
  assert.equal(bass.zone, 'close');
  const chanter = describeReading(480, 480, { includeChanter: true });
  assert.equal(chanter.targetId, 'chanter');
  assert.equal(chanter.zone, 'good');
});

test('the meter is green within 3 cents, amber within 10, and red beyond', () => {
  assert.equal(GREEN_CENTS, 3);
  assert.equal(AMBER_CENTS, 10);
  for (const cents of [0, 3, -3]) assert.equal(meterZone(cents), 'good', String(cents));
  for (const cents of [3.01, 10, -10]) assert.equal(meterZone(cents), 'close', String(cents));
  for (const cents of [10.01, -40, 28]) assert.equal(meterZone(cents), 'off', String(cents));
  assert.equal(meterZone(null), 'none');
  assert.match(formatCents(0), /in tune/i);
  assert.match(formatCents(4), /sharp/);
  assert.match(formatCents(-4), /flat/);
});

test('slide advice tells the piper which way the top section goes', () => {
  assert.equal(slideAdvice(12), 'Too sharp. Slide the top section up. A longer drone sounds lower.');
  assert.equal(slideAdvice(-12), 'Too flat. Slide the top section down. A shorter drone sounds higher.');
  assert.doesNotMatch(`${slideAdvice(12)} ${slideAdvice(-12)}`, /UP|DOWN/);
  assert.match(slideAdvice(1), /leave the tuning slide/i);
  assert.match(slideAdvice(null), /tuning slide/i);
});

test('reference volume defaults near maximum and stays inside the limiter range', () => {
  assert.equal(DEFAULT_OUTPUT_LEVEL, 90);
  assert.ok(outputGain(90) > 0.7, `default gain ${outputGain(90)}`);
  assert.ok(outputGain(90) > outputGain(40) * 4);
  assert.ok(outputGain(100) <= 0.95);
  assert.equal(outputGain(0), 0);
  assert.equal(outputGain(Number.NaN), 0);
});

test('Ceilidh dances once the lock has held, and winces when a drone is far off or beating hard', () => {
  // In tune is not enough on its own any more: the lock has to have held first.
  assert.equal(cooMood({ cents: 1.2, stable: true, beatHz: 0, confidence: 0.9 }), 'listen');
  assert.equal(cooMood({ cents: 1.2, stable: true, beatHz: 0, confidence: 0.9, held: true }), 'dance');
  // Inside the grace period she keeps dancing through a small dip.
  assert.equal(cooMood({ cents: 5, stable: false, beatHz: 0, confidence: 0.9, held: true }), 'dance');
  // The wince always wins, held or not.
  assert.equal(cooMood({ cents: 30, stable: true, beatHz: 0, confidence: 0.9, held: true }), 'wince');
  assert.equal(cooMood({ cents: 2, stable: true, beatHz: 4, confidence: 0.9, held: true }), 'wince');
  assert.equal(cooMood({ cents: null, confidence: 0, held: true }), 'wait');
  assert.equal(cooMood({ cents: 1.2, stable: false, beatHz: 0, confidence: 0.9 }), 'listen');
  assert.equal(cooMood({ cents: 8, stable: true, beatHz: 0.4, confidence: 0.9 }), 'listen');
  assert.equal(cooMood({ cents: 30, stable: true, beatHz: 0, confidence: 0.9 }), 'wince');
  assert.equal(cooMood({ cents: -26, stable: false, beatHz: null, confidence: 0.8 }), 'wince');
  assert.equal(cooMood({ cents: 2, stable: true, beatHz: 4, confidence: 0.9 }), 'wince');
  assert.equal(cooMood({ cents: null, confidence: 0 }), 'wait');
  assert.match(beatAdvice({ hz: 3.5, confidence: 0.8, locked: false }), /slowing/);
  assert.match(beatAdvice({ hz: 0, confidence: 0.8, locked: true }), /no wobble/i);
});

test('the circle dance waits for a 1.5 second lock and forgives a 250 ms dip', () => {
  assert.equal(GREEN_CENTS, 3);
  assert.equal(PERFECT_CENTS, GREEN_CENTS);
  assert.equal(ANTICIPATE_CENTS, AMBER_CENTS);
  assert.equal(PERFECT_HOLD_MS, 1500);
  assert.equal(DROP_GRACE_MS, 250);

  assert.equal(isLocked({ cents: 3, stable: true, beatHz: 0, confidence: 0.9 }), true);
  assert.equal(isLocked({ cents: -3.1, stable: true, beatHz: 0, confidence: 0.9 }), false);
  assert.equal(isLocked({ cents: 1, stable: false, beatHz: 0, confidence: 0.9 }), false);
  assert.equal(isLocked({ cents: 1, stable: true, beatHz: 2.5, confidence: 0.9 }), false);
  assert.equal(isLocked({ cents: 1, stable: true, beatHz: null, confidence: 0 }), false);
  assert.equal(isLocked({ cents: null, stable: true, confidence: 0.9 }), false);

  const hold = createLockHold();
  assert.equal(hold.update(true, 1000), false);
  assert.equal(hold.update(true, 2499), false, 'not yet 1.5 s');
  assert.equal(hold.update(true, 2500), true, '1.5 s of lock starts the dance');
  assert.equal(hold.held, true);
  // A dip of 250 ms or less does not stop her.
  assert.equal(hold.update(false, 2600), true);
  assert.equal(hold.update(false, 2850), true, 'still inside the grace period');
  assert.equal(hold.update(true, 2900), true, 'back in the lock');
  // A longer dip does, and the hold starts again from nothing.
  assert.equal(hold.update(false, 3000), true);
  assert.equal(hold.update(false, 3251), false, 'past the grace period');
  assert.equal(hold.update(true, 3300), false);
  assert.equal(hold.update(true, 4799), false);
  assert.equal(hold.update(true, 4800), true);

  // Before the hold is met, any break restarts the count.
  const early = createLockHold();
  early.update(true, 0);
  early.update(true, 1400);
  early.update(false, 1450);
  assert.equal(early.update(true, 1500), false);
  assert.equal(early.update(true, 2999), false);
  assert.equal(early.update(true, 3000), true);
  early.reset();
  assert.equal(early.held, false);
  assert.equal(early.update(true, 3100), false);

  // The length of the hold is a setting, not a number buried in the code.
  const quick = createLockHold({ holdMs: 200, graceMs: 50 });
  quick.update(true, 0);
  assert.equal(quick.update(true, 200), true);
  assert.equal(quick.update(false, 210), true);
  assert.equal(quick.update(false, 261), false);
});

test('the sprite pose follows the mood: idle, a lean when close, the circle when held', () => {
  assert.equal(cooPose('wait', null), 'idle');
  assert.equal(cooPose('listen', 18), 'idle');
  assert.equal(cooPose('listen', 10), 'anticipate');
  assert.equal(cooPose('listen', -2), 'anticipate');
  assert.equal(cooPose('dance', 1), 'circle');
  assert.equal(cooPose('wince', 40), 'idle');
});

test('a 2 second low A locks the reference and drones do not', () => {
  const readings = [];
  for (let i = 0; i < 4; i++) readings.push({ frequency: 240.2, confidence: 0.9 });
  for (let i = 0; i < 8; i++) readings.push({ frequency: 477.2 + (i % 3) * 0.05, confidence: 0.86 });
  readings.push({ frequency: 900, confidence: 0.99 });
  readings.push({ frequency: 476, confidence: 0.2 });
  const locked = lockReference(readings);
  assert.ok(locked, 'expected a lock');
  assertCents(locked, 477.2, 1, 'locked low A');
  assert.equal(clampLowA(400), null);
  assert.equal(clampLowA(480.04), 480);
});

test('the tracker holds a steady pitch and ignores a one-frame octave jump', () => {
  const tracker = createPitchTracker();
  let last = null;
  for (let i = 0; i < 5; i++) last = tracker.push({ frequency: 240.1, confidence: 0.9 });
  assert.equal(last.stable, true);
  assertCents(last.frequency, 240.1, 0.2, 'tracked tenor');
  const flipped = tracker.push({ frequency: 480.2, confidence: 0.95 });
  assertCents(flipped.frequency, 240.1, 0.2, 'octave flip ignored');
});

test('steady pitches with harmonics and noise stay within 1 cent', () => {
  const cases = [
    [119.5, 48000, 11],
    [240.7, 48000, 12],
    [480, 48000, 13],
    [119.5, 44100, 21],
    [240.7, 44100, 22],
    [480, 44100, 23],
  ];
  for (const [freq, sampleRate, seed] of cases) {
    const samples = synth(freq, sampleRate, 1.4, { snrDb: 28, seed });
    const est = steadyPitch(samples, sampleRate);
    assert.ok(est, `no pitch for ${freq} Hz at ${sampleRate}`);
    assert.ok(est.frames >= 5, `only ${est.frames} frames for ${freq}`);
    assertCents(est.frequency, freq, 1, `${freq} Hz @ ${sampleRate}`);
  }
});

test('a strong second harmonic does not pull the fundamental up an octave', () => {
  const bass = synth(119.5, 48000, 1.2, { harmonics: [1, 0.85, 0.4, 0.2], snrDb: 32, seed: 7 });
  const tenor = synth(240.7, 48000, 1.2, { harmonics: [1, 0.7, 0.35, 0.18], snrDb: 32, seed: 8 });
  const lowA = synth(480, 48000, 1.2, { harmonics: [1, 0.6, 0.25], snrDb: 32, seed: 9 });
  for (const [samples, freq, name] of [[bass, 119.5, 'bass'], [tenor, 240.7, 'tenor'], [lowA, 480, 'low A']]) {
    const det = detectPitch(samples.subarray(0, 24000), 48000);
    assert.ok(det, name);
    assertCents(det.frequency, freq, 1, name);
    assert.ok(Math.abs(Math.log2(det.frequency / freq)) < 0.2, `${name} octave error ${det.frequency}`);
  }
});

test('silence and noise do not invent a drone', () => {
  assert.equal(detectPitch(new Float64Array(16000), 48000), null);
  const noise = synth(0.0001, 48000, 1, { harmonics: [0], snrDb: 0, seed: 4 });
  for (let i = 0; i < noise.length; i++) noise[i] = gaussian(mulberry32(99 + i)) * 0.2;
  const est = steadyPitch(noise, 48000, { minConfidence: 0.85 });
  assert.equal(est, null);
});

test('two drones a few hertz apart report that beat, and one drone is locked', () => {
  const sampleRate = 48000;
  const seconds = 3;
  const n = sampleRate * seconds;
  const target = 240;
  const beat = 3.5;
  const pair = new Float64Array(n);
  const harmonicPair = new Float64Array(n);
  const alone = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const a = Math.sin(2 * Math.PI * target * t);
    const b = Math.sin(2 * Math.PI * (target + beat) * t);
    pair[i] = a + b;
    harmonicPair[i] = a + 0.45 * Math.sin(2 * Math.PI * target * 2 * t) + b + 0.45 * Math.sin(2 * Math.PI * (target + beat) * 2 * t);
    alone[i] = a;
  }
  const heard = estimateBeatRate(pair, sampleRate, { targetHz: target });
  assert.equal(heard.locked, false);
  assert.ok(heard.confidence > 0.45, `pair confidence ${heard.confidence}`);
  assert.ok(Math.abs(heard.hz - beat) < 0.2, `pair beat ${heard.hz}`);

  const stacked = estimateBeatRate(harmonicPair, sampleRate, { targetHz: target });
  assert.equal(stacked.locked, false);
  assert.ok(Math.abs(stacked.hz - beat) < 0.25, `harmonic beat ${stacked.hz}`);

  const slow = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    slow[i] = Math.sin(2 * Math.PI * 120 * t) + Math.sin(2 * Math.PI * 121.5 * t);
  }
  const bassBeats = estimateBeatRate(slow, sampleRate, { targetHz: 120 });
  assert.ok(Math.abs(bassBeats.hz - 1.5) < 0.2, `bass beat ${bassBeats.hz}`);

  const locked = estimateBeatRate(alone, sampleRate, { targetHz: target });
  assert.equal(locked.locked, true, `alone looked like ${locked.hz} Hz`);
  assert.equal(locked.hz, 0);
});

test('demo detune is the same cents the meter measures, and the mic is unprocessed', () => {
  const target = droneTargets(480).tenor;
  const hz = detuneHz(target, DEMO_START_CENTS);
  const reading = describeReading(hz, 480);
  assert.equal(reading.targetId, 'tenor');
  assert.ok(Math.abs(reading.cents - DEMO_START_CENTS) < 1e-6);
  assert.equal(MIC_CONSTRAINTS.audio.echoCancellation, false);
  assert.equal(MIC_CONSTRAINTS.audio.noiseSuppression, false);
  assert.equal(MIC_CONSTRAINTS.audio.autoGainControl, false);
  assert.equal(MIC_CONSTRAINTS.video, false);
  assert.deepEqual(STEPS.map((step) => step.id), ['ref', 'tenor1', 'tenor2', 'bass']);
});

test('the tuner page is linked from Tools, still noindex, and off the sitemap', () => {
  const astro = readFileSync(join(site, 'src/pages/tune/index.astro'), 'utf8');
  const client = readFileSync(join(site, 'src/lib/droneTunerPage.js'), 'utf8');
  const page = `${astro}\n${client}`;
  const layout = readFileSync(join(site, 'src/layouts/Base.astro'), 'utf8');
  const nav = readFileSync(join(site, 'src/lib/nav.js'), 'utf8');
  const sitemap = readFileSync(join(site, 'src/pages/sitemap.xml.js'), 'utf8');
  const home = readFileSync(join(site, 'src/pages/index.astro'), 'utf8');
  assert.match(page, /noindex=\{true\}/);
  assert.match(nav, /href: 'tune\/'/);
  assert.match(nav, /Drone tuner/);
  assert.match(layout, /SiteNav/);
  assert.match(page, /Artificial intelligence\. Tuning the drones anyway\./);
  assert.match(page, /analyzed on your device only/i);
  assert.match(page, /Nothing is sent or saved/i);
  assert.match(page, /defaultTartan\(\)/);
  assert.match(page, /data-ceilidh-dance/);
  assert.match(page, /data-ceilidh-ears/);
  assert.match(page, /defaultTartan\(\)\.tuner/);
  assert.match(page, /steps\(12,\s*end\)/);
  assert.doesNotMatch(page, /tune-fling|steps\(10/);
  assert.match(page, /steps\(4,\s*end\)/);
  assert.match(page, /tune-wince-2x/);
  assert.match(page, /translate3d\(-512px, 0, 0\)/);
  assert.match(page, /translate3d\(-768px, 0, 0\)/);
  assert.match(page, /from \{ transform: translate3d\(0, 0, 0\); \}/);
  assert.match(page, /One tenor is already in tune/);
  assert.match(page, /A longer drone sounds lower/);
  assert.match(page, /A shorter drone sounds higher/);
  assert.match(page, /Use one earbud for the reference drone/);
  assert.match(page, /silent mode/);
  assert.match(page, /audioSession/);
  assert.match(page, /'playback'/);
  assert.match(page, /createDynamicsCompressor/);
  assert.match(page, /tabular-nums/);
  assert.match(page, /position:\s*fixed/);
  assert.match(page, /data-ceilidh-coo/);
  assert.match(page, /hideCornerCoo/);
  assert.match(layout, /data-hide-corner-coo/);
  assert.match(page, /aria-live="polite"/);
  assert.doesNotMatch(page, /One drone sits on the tenor/);
  assert.doesNotMatch(page, /tune-ears/);
  assert.doesNotMatch(page, /\p{Extended_Pictographic}/u);
  assert.match(page, /prefers-reduced-motion:\s*reduce/);
  assert.match(page, /data-a11y-motion=reduce/);
  assert.match(page, /image-rendering:\s*pixelated/);
  const earsPng = readFileSync(join(site, 'public/tartans/fraser-of-lovat/ceilidh-coo-ears-covered-strip.png'));
  assert.equal(earsPng.readUInt32BE(16), 256);
  assert.equal(earsPng.readUInt32BE(20), 64);
  assert.match(page, /MIC_CONSTRAINTS/);
  assert.match(page, /ctx\.resume\(\)/);
  assert.match(page, /webkitAudioContext/);
  assert.match(page, /By-ear/);
  // Mobile-first layout: options sit in tabs, not a long page of cards.
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tabpanel"/);
  assert.match(page, /ArrowRight/);
  // The turn is frames 2 to 13 of the 14-frame sheet, at 1x, 2x and 3x.
  assert.match(page, /@keyframes tune-circle-1x \{\s*from \{ transform: translate3d\(-128px, 0, 0\); \}\s*to \{ transform: translate3d\(-896px, 0, 0\); \}/);
  assert.match(page, /@keyframes tune-circle-2x \{\s*from \{ transform: translate3d\(-256px, 0, 0\); \}\s*to \{ transform: translate3d\(-1792px, 0, 0\); \}/);
  assert.match(page, /@keyframes tune-circle-3x \{\s*from \{ transform: translate3d\(-384px, 0, 0\); \}\s*to \{ transform: translate3d\(-2688px, 0, 0\); \}/);
  const sheet = readFileSync(join(site, 'public/img/ceilidh-tuner-dance-sheet.png'));
  assert.equal(sheet.readUInt32BE(16), 896);
  assert.equal(sheet.readUInt32BE(20), 64);
  assert.match(astro, /width="896" height="64" data-ceilidh-dance/);
  // The sprite is decoration: the mood line beside it carries the words.
  assert.match(astro, /data-tune-coo data-mood="wait" data-pose="idle" aria-hidden="true"/);
  assert.match(client, /createLockHold\(\)/);
  assert.match(client, /lockHold\.update\(isLocked\(heard\), performance\.now\(\)\)/);
  assert.match(client, /mascot\.dataset\.pose = cooPose\(mood, heard\.cents\)/);
  assert.match(page, /aria-disabled/);
  assert.doesNotMatch(astro, /data-ear aria-pressed|data-start aria-pressed|data-demo aria-pressed/);
  assert.match(page, /echoCancellation/);
  assert.doesNotMatch(page, /CeilidhCoo/);
  assert.doesNotMatch(page, /https?:\/\//);
  assert.doesNotMatch(page, /localStorage|sessionStorage|MediaRecorder/);
  assert.doesNotMatch(page, /fetch\(|XMLHttpRequest|indexedDB|sendBeacon|FormData/);
  assert.match(page, />Flat</);
  assert.match(page, />Sharp</);
  assert.doesNotMatch(home, /tune\//);
  assert.doesNotMatch(sitemap, /tune\//);
  const lib = readFileSync(join(site, 'src/lib/droneTuner.js'), 'utf8');
  assert.match(lib, /cents sharp/);
  assert.match(lib, /cents flat/);
  assert.doesNotMatch(lib, /https?:\/\//);
  assert.doesNotMatch(lib, /localStorage|sessionStorage|indexedDB|MediaRecorder|sendBeacon/);
});

test('a valid Low A, from the box or a preset, clears an earlier range error', () => {
  const client = readFileSync(join(site, 'src/lib/droneTunerPage.js'), 'utf8');
  const body = client.match(/function setLowA\(hz\) \{[\s\S]*?\n  \}\n/);
  assert.ok(body, 'setLowA is present');
  assert.match(body[0], /removeAttribute\('aria-invalid'\)/);
  assert.match(body[0], /lowAErr\.hidden = true/);
});

test('the tabs use the cream token, and a small phone on its side gets a rail, not a bottom bar', () => {
  const astro = readFileSync(join(site, 'src/pages/tune/index.astro'), 'utf8');
  assert.doesNotMatch(astro, /#f3ecdf/i);
  assert.match(astro, /\.tabs \{[^}]*background: var\(--cream\)/);
  const rail = astro.match(/\/\* Phone held sideways \(any width[\s\S]*?@media \(max-height: 500px\) and \(orientation: landscape\) \{[\s\S]*?\n  \}\n/);
  assert.ok(rail, 'the phone landscape rule is present');
  assert.match(rail[0], /\.tune-actions \{[^}]*right: 0/);
  assert.match(rail[0], /padding-right: calc\(9rem/);
  assert.match(rail[0], /position: fixed/);
});

test('a phone held sideways gets the 1x sprite, so the readout stays on screen', () => {
  const astro = readFileSync(join(site, 'src/pages/tune/index.astro'), 'utf8');
  const land = astro.match(/\/\* Phone held sideways: keep[\s\S]*?\n  \}\n/);
  assert.ok(land, 'the landscape readout rule is present');
  assert.match(land[0], /--frame: 64px/);
  assert.match(land[0], /tune-circle-1x/);
});

test('reduced motion swaps the turn for stills, from the system setting or the site switch', () => {
  const astro = readFileSync(join(site, 'src/pages/tune/index.astro'), 'utf8');
  const media = astro.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}\n/);
  assert.ok(media, 'the reduced-motion rule is present');
  assert.match(media[0], /\[data-pose="anticipate"\] \.tune-strip \{ transform: none; \}/);
  assert.match(media[0], /\[data-pose="circle"\] \.tune-strip \{\s*animation: none !important;\s*transform: translate3d\(calc\(var\(--frame\) \* -3\), 0, 0\);/);
  assert.match(astro, /html\[data-a11y-motion=reduce\]\) \.tune-coo\[data-pose="anticipate"\] \.tune-strip \{ transform: none; \}/);
  assert.match(astro, /html\[data-a11y-motion=reduce\]\) \.tune-coo\[data-pose="circle"\] \.tune-strip \{\s*animation: none !important;\s*transform: translate3d\(calc\(var\(--frame\) \* -3\), 0, 0\);/);
});

test('the tuner names its meter colours once, as tokens', () => {
  const astro = readFileSync(join(site, 'src/pages/tune/index.astro'), 'utf8');
  const styles = astro.slice(astro.indexOf('<style>'));
  for (const hex of ['#8d2a2a', '#7a4e0d', '#1a120c', '#b7dfc8', '#4a3a2e', '#f3ecdf']) {
    assert.ok(styles.split(hex).length - 1 <= 1, `${hex} is written at most once`);
  }
});
