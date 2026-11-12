import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANIMS,
  CHARACTER,
  CUES,
  CUE_CELL,
  CUE_SPAWN_X,
  HIT_LINE_X,
  LAYERS,
  LOOKAHEAD_BEATS,
  STAGE_H,
  STAGE_W,
  STEP_GRADES,
  STEP_PX,
  STUMBLE_GRADES,
  createMarch,
  cueX,
} from '../src/lib/drumMarch.js';
import { GOOD_MS, OK_MS, PERFECT_MS, RUDIMENTS, createOnsetDetector, createScorer, rudimentById, sticking } from '../src/lib/drumPractice.js';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..');
const read = (file) => readFileSync(join(site, file), 'utf8');
const png = (file) => {
  const b = readFileSync(join(site, 'public/img/drum-march', file));
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

/** Plays the march forward in 20 ms frames and returns every frame drawn. */
function run(march, from, to, opts) {
  const out = [];
  for (let t = from; t <= to + 1e-9; t += 0.02) out.push({ t, ...march.frame(t, opts) });
  return out;
}
const names = (frames) => [...new Set(frames.map((f) => `${f.anim}-${f.frame}`))];

test('the art is the size the frame map says it is', () => {
  const rows = Object.keys(ANIMS).length;
  const cols = Math.max(...Object.values(ANIMS).map((a) => a.frames));
  assert.deepEqual(png('ceilidh-drum-character.png'), { w: cols * CHARACTER.w, h: rows * CHARACTER.h });
  assert.deepEqual(png('cues-and-fx.png'), { w: 11 * CUE_CELL.w, h: CUE_CELL.h });
  for (const layer of LAYERS) assert.deepEqual(png(`${layer.name}.png`), { w: STAGE_W, h: STAGE_H }, layer.name);
  assert.deepEqual(LAYERS.map((l) => [l.name, l.parallax]), [['sky', 0], ['far-hills', 0.25], ['mid-hills', 0.5], ['field', 1], ['foreground', 1.5]]);
  assert.deepEqual(ANIMS.march, { row: 1, frames: 6 });
  assert.deepEqual(ANIMS.stumble, { row: 4, frames: 6 });
  for (const c of Object.values(CUES)) assert.ok(c.inner.x + c.inner.w <= CUE_CELL.w && c.inner.y + c.inner.h <= CUE_CELL.h);
  // She stands in the left third, with the hit line just in front of the drum.
  assert.ok(CHARACTER.x + CHARACTER.w / 2 < STAGE_W / 3);
  assert.equal(HIT_LINE_X, CHARACTER.x + CHARACTER.w);
});

test('sticking comes from the written rudiment, and only the paradiddle has accents', () => {
  const hands = (id) => sticking(rudimentById(id)).map((s) => s.hand).join('');
  assert.equal(hands('quarters'), 'RLRL');
  assert.equal(hands('singles'), 'RLRLRLRL');
  assert.equal(hands('doubles'), 'RRLLRRLL');
  assert.equal(hands('paradiddle'), 'RLRRLRLL');
  assert.equal(hands('triplets'), 'RLRLRL');
  for (const r of RUDIMENTS) {
    const accents = sticking(r).map((s, i) => (s.accent ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(accents, r.id === 'paradiddle' ? [0, 4] : [], r.id);
  }
  assert.deepEqual(sticking(null), []);
});

test('a cue arrives at the hit line when its stroke is due and never passes it', () => {
  assert.equal(cueX(10, 8, 2), CUE_SPAWN_X);
  assert.equal(cueX(10, 9, 2), Math.round((CUE_SPAWN_X + HIT_LINE_X) / 2));
  assert.equal(cueX(10, 10, 2), HIT_LINE_X);
  assert.equal(cueX(10, 10.1, 2), HIT_LINE_X, 'a due stroke waits at the line');
  assert.equal(cueX(10, 7.9, 2), null, 'not on stage yet');
  // The same stroke at a slower tempo: the lead is longer, the arrival is the same.
  assert.equal(cueX(10, 7, 3), CUE_SPAWN_X);
  assert.equal(cueX(10, 10, 3), HIT_LINE_X);
  assert.equal(LOOKAHEAD_BEATS, 2);
});

test('she steps forward on perfect, good and ok, with the hand from the sticking', () => {
  assert.deepEqual(STEP_GRADES, ['perfect', 'good', 'ok']);
  assert.deepEqual(STUMBLE_GRADES, ['miss', 'stray']);
  for (const grade of STEP_GRADES) {
    const march = createMarch();
    march.expect([{ index: 0, at: 1, hand: 'L', accent: false }]);
    assert.ok(run(march, 0.5, 0.98, { lead: 2 }).every((f) => f.anim === 'idle'));
    march.hit({ grade, offsetMs: 0, index: 0 }, 1, 0.5);
    const frames = run(march, 1, 2, { lead: 2 });
    assert.deepEqual(names(frames).slice(0, 3), ['strike-l-0', 'strike-l-1', 'strike-l-2'], grade);
    // The flash fires on the contact frame, then goes.
    assert.equal(frames.find((f) => f.fx).fx, `fx-${grade}`);
    assert.equal(frames.find((f) => f.fx).anim + frames.find((f) => f.fx).frame, 'strike-l1');
    assert.equal(frames.at(-1).fx, null);
    // One step is 8 art pixels, and she ends standing.
    assert.equal(frames.at(-1).scroll, STEP_PX);
    assert.equal(frames.at(-1).anim, 'idle');
    assert.ok(frames.some((f) => f.anim === 'march'), 'the march loop plays while the ground moves');
    assert.equal(frames.at(-1).cues.length, 0, 'the cue is gone once it is hit');
  }
  const right = createMarch();
  right.expect([{ index: 0, at: 1, hand: 'R', accent: true }]);
  assert.deepEqual(right.frame(0.5, { lead: 2 }).cues, [{ x: cueX(1, 0.5, 2), kind: 'cue-accent', hand: 'R', alpha: 1 }]);
  right.hit({ grade: 'good', offsetMs: 30, index: 0 }, 1, 0.5);
  assert.equal(right.frame(1.05, { lead: 2 }).anim, 'strike-r');
});

test('steady playing scrolls the ground one step per stroke', () => {
  const march = createMarch();
  let scroll = 0;
  for (let i = 0; i < 8; i += 1) {
    const at = 1 + i * 0.5;
    march.expect([{ index: i, at, hand: i % 2 ? 'L' : 'R', accent: false }]);
    march.hit({ grade: 'perfect', offsetMs: 0, index: i }, at, 0.5);
    const frames = run(march, at, at + 0.48, { lead: 2 });
    assert.ok(frames.at(-1).scroll >= scroll);
    scroll = frames.at(-1).scroll;
  }
  assert.equal(run(march, 5, 6, { lead: 2 }).at(-1).scroll, 8 * STEP_PX);
});

test('a miss stumbles, recovers, takes no step, and its cue fades at the line', () => {
  const march = createMarch();
  march.expect([{ index: 0, at: 1, hand: 'R', accent: false }]);
  assert.equal(march.frame(1.1, { lead: 2 }).cues[0].x, HIT_LINE_X);
  march.miss([0], 1.12);
  const frames = run(march, 1.12, 2.3, { lead: 2 });
  assert.deepEqual(names(frames), [
    'stumble-0', 'stumble-1', 'stumble-2', 'stumble-3', 'stumble-4', 'stumble-5',
    'recover-0', 'recover-1', 'recover-2', 'idle-0',
  ]);
  assert.equal(frames[0].fx, 'fx-miss');
  assert.ok(frames.every((f) => f.scroll === 0));
  const shown = frames.filter((f) => f.cues.length);
  assert.ok(shown.length > 0 && shown.every((f) => f.cues[0].x === HIT_LINE_X), 'a missed cue never passes through her');
  assert.ok(shown.at(-1).cues[0].alpha < shown[0].cues[0].alpha);
  assert.equal(frames.at(-1).cues.length, 0);
});

test('an extra hit stumbles too, stumbles do not queue, and a hit mid-stumble takes no step', () => {
  const march = createMarch();
  march.hit({ grade: 'stray', offsetMs: null, index: -1 }, 1, 0.5);
  assert.equal(march.frame(1, {}).fx, 'fx-stray');
  assert.equal(march.frame(1.35, {}).anim + march.frame(1.35, {}).frame, 'stumble3');
  march.hit({ grade: 'stray', offsetMs: null, index: -1 }, 1.4, 0.5);
  assert.equal(march.frame(1.45, {}).anim + march.frame(1.45, {}).frame, 'stumble4', 'the second stray did not restart it');
  march.expect([{ index: 0, at: 1.5, hand: 'R', accent: false }]);
  march.hit({ grade: 'perfect', offsetMs: 0, index: 0 }, 1.5, 0.5);
  const frames = run(march, 1.5, 3, {});
  assert.ok(frames.every((f) => !f.anim.startsWith('strike')));
  assert.equal(frames.at(-1).scroll, 0);
  assert.equal(frames.at(-1).anim, 'idle');
});

test('fast strokes cut the strike short and still show the contact frame', () => {
  const march = createMarch();
  march.expect([0, 1, 2].map((i) => ({ index: i, at: 1 + i * 0.125, hand: 'R', accent: false })));
  march.hit({ grade: 'ok', offsetMs: 0, index: 0 }, 1, 0.125);
  assert.equal(march.frame(1.02, {}).frame, 0);
  march.hit({ grade: 'ok', offsetMs: 0, index: 1 }, 1.125, 0.125);
  assert.equal(march.frame(1.13, {}).anim + march.frame(1.13, {}).frame, 'strike-r1');
  march.hit({ grade: 'ok', offsetMs: 0, index: 2 }, 1.25, 0.125);
  assert.equal(march.frame(1.26, {}).frame, 1);
  assert.equal(run(march, 1.26, 2.5, {}).at(-1).scroll, 3 * STEP_PX);
});

test('coming strokes show as cues before the scorer has them', () => {
  const march = createMarch();
  const view = march.frame(0, { lead: 2, preview: [{ at: 1, hand: 'R', accent: false }, { at: 1.5, hand: 'L', accent: true }, { at: 9, hand: 'R', accent: false }] });
  assert.deepEqual(view.cues.map((c) => c.hand + c.kind), ['Lcue-accent', 'Rcue-beat'], 'nearest cue is drawn last, on top');
});

test('reduced motion: no scroll, no lane, one still for a stumble, one icon for the next stroke', () => {
  const march = createMarch({ reducedMotion: true });
  march.expect([{ index: 0, at: 1, hand: 'R', accent: false }, { index: 1, at: 1.5, hand: 'L', accent: false }]);
  assert.deepEqual(march.frame(0.2, { lead: 2 }).cues, [{ x: HIT_LINE_X, kind: 'cue-beat', hand: 'R', alpha: 1 }]);
  march.hit({ grade: 'perfect', offsetMs: 0, index: 0 }, 1, 0.5);
  const hit = run(march, 1, 1.4, { lead: 2 });
  assert.ok(hit.every((f) => f.anim === 'idle' && f.scroll === 0));
  assert.equal(hit[0].fx, 'fx-perfect');
  assert.ok(hit.filter((f) => f.fx).length <= 6, 'the flash is about one frame long');
  assert.deepEqual(hit.at(-1).cues, [{ x: HIT_LINE_X, kind: 'cue-beat', hand: 'L', alpha: 1 }]);
  march.miss([1], 1.62);
  const miss = run(march, 1.62, 2.2, { lead: 2 });
  assert.deepEqual(names(miss), ['stumble-3', 'idle-0']);
  assert.ok(miss.filter((f) => f.anim === 'stumble').length <= 16, 'held for about 300 ms');
  assert.ok(miss.every((f) => f.scroll === 0 && f.cues.length === 0));
  // The switch can change mid-session.
  march.setReducedMotion(false);
  march.expect([{ index: 2, at: 3, hand: 'R', accent: false }]);
  march.hit({ grade: 'good', offsetMs: 0, index: 2 }, 3, 0.5);
  assert.equal(march.frame(3.05, {}).anim, 'strike-r');
});

test('reset puts her back at the start', () => {
  const march = createMarch();
  march.expect([{ index: 0, at: 1, hand: 'R', accent: false }]);
  march.hit({ grade: 'perfect', offsetMs: 0, index: 0 }, 1, 0.5);
  run(march, 1, 2, {});
  march.reset();
  assert.deepEqual(march.frame(0, {}), { scroll: 0, anim: 'idle', frame: 0, fx: null, cues: [] });
});

test('the march hooks the one scored path and leaves the scorer and detector alone', () => {
  const client = read('src/lib/drumPracticePage.js');
  // Microphone and pad both end in onOnset, and that is where the march hears about a hit.
  assert.match(client, /const result = state\.scorer\.hit\(time\);\s*march\.hit\(result, state\.ctx\.currentTime, beatSeconds\(bpm\(\)\) \/ rudiment\(\)\.perBeat\);/);
  assert.match(client, /const missed = state\.scorer\.sweep\(now\);\s*if \(missed\.length\) \{\s*march\.miss\(missed, now\);/);
  assert.match(client, /hands\[\(state\.stick \+ i\) % hands\.length\]/);
  assert.equal(client.split('march.hit(').length - 1, 1);
  // Timing windows and the detector defaults are what they were.
  assert.deepEqual([PERFECT_MS, GOOD_MS, OK_MS], [25, 60, 110]);
  const detector = createOnsetDetector();
  assert.equal(detector.push(0.5, 1), 1);
  assert.equal(detector.push(5, 1.049), null, 'refractory is still 50 ms');
  // The scorer's results carry the index the march keys its cues on.
  const scorer = createScorer({ expected: [1, 1.5] });
  assert.deepEqual(scorer.hit(1.01), { grade: 'perfect', offsetMs: 10, index: 0 });
  assert.deepEqual(scorer.sweep(2), [1]);
  for (const file of ['src/lib/drumMarch.js', 'src/lib/drumMarchView.js']) {
    assert.doesNotMatch(read(file), /getUserMedia|AudioContext|createOnsetDetector|createScorer|https?:\/\//, file);
  }
});

test('the march canvas is decoration with a fixed box, and honours both reduced-motion switches', () => {
  const page = read('src/pages/drum/index.astro');
  const view = read('src/lib/drumMarchView.js');
  assert.match(page, /<canvas class="march" data-march data-art=\{marchArt\} width="256" height="96" aria-hidden="true"><\/canvas>/);
  assert.match(page, /\.march \{[^}]*aspect-ratio: 8 \/ 3/);
  assert.match(page, /\.march \{[^}]*image-rendering: pixelated/);
  assert.match(page, /\.march \{[^}]*width: min\(100%, 512px\)/);
  assert.match(view, /prefers-reduced-motion: reduce/);
  assert.match(view, /data-a11y-motion/);
  assert.match(view, /imageSmoothingEnabled = false/);
  assert.match(read('src/lib/drumPracticePage.js'), /march\.setReducedMotion\(reducedMotion\(\)\)/);
});
