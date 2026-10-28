import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEAD_NUDGE, createHeadNudge } from '../src/lib/headNudge.js';

const widget = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/components/CeilidhCoo.astro'), 'utf8');

function harness({ reducedMotion = false, initiallyHidden = false } = {}) {
  let now = 0;
  const timers = [];
  let shakes = 0;
  const nudge = createHeadNudge({
    reducedMotion,
    initiallyHidden,
    now: () => now,
    schedule(fn, ms) {
      const id = timers.length;
      timers.push({ id, fn, at: now + ms, cancelled: false, fired: false });
      return id;
    },
    cancel(id) {
      timers[id].cancelled = true;
    },
    onShake() {
      shakes += 1;
    },
  });
  return {
    nudge,
    timers,
    setNow(ms) { now = ms; },
    now: () => now,
    shakes: () => shakes,
    pending() {
      return timers.filter((timer) => !timer.cancelled && !timer.fired);
    },
    fireNext() {
      const next = timers.find((timer) => !timer.cancelled && !timer.fired);
      assert.ok(next, 'a shake was scheduled');
      now = next.at;
      next.fired = true;
      next.fn();
      return next;
    },
  };
}

test('the head shake waits, then repeats, and stops after four', () => {
  assert.equal(HEAD_NUDGE.firstMs, 8000);
  assert.equal(HEAD_NUDGE.everyMs, 30000);
  assert.equal(HEAD_NUDGE.shakeMs, 600);
  assert.equal(HEAD_NUDGE.maxShakes, 4);

  const run = harness();
  run.nudge.start();
  const first = run.pending();
  assert.equal(first.length, 1);
  assert.equal(first[0].at, 8000);

  run.fireNext();
  assert.equal(run.shakes(), 1);
  assert.equal(run.pending()[0].at, 8000 + 30000);

  run.fireNext();
  run.fireNext();
  run.fireNext();
  assert.equal(run.shakes(), 4);
  assert.equal(run.nudge.count(), 4);
  assert.deepEqual(run.pending(), []);
});

test('hiding the tab pauses the head shake and showing it resumes the wait', () => {
  const run = harness();
  run.nudge.start();
  run.setNow(3000);
  run.nudge.setHidden(true);
  assert.equal(run.timers[0].cancelled, true);
  assert.deepEqual(run.pending(), []);

  run.setNow(20000);
  run.nudge.setHidden(false);
  const resumed = run.pending();
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].at, 20000 + 5000);
  run.fireNext();
  assert.equal(run.shakes(), 1);
});

test('the first tap cancels every later head shake', () => {
  const run = harness();
  run.nudge.start();
  run.fireNext();
  assert.equal(run.shakes(), 1);
  run.nudge.stop();
  assert.deepEqual(run.pending(), []);
  run.nudge.setHidden(false);
  run.nudge.start();
  assert.deepEqual(run.pending(), []);
  assert.equal(run.shakes(), 1);
});

test('reduced motion never schedules a head shake', () => {
  const run = harness({ reducedMotion: true });
  run.nudge.start();
  run.nudge.setHidden(false);
  assert.equal(run.timers.length, 0);
  assert.equal(run.shakes(), 0);
});

test('a hidden tab does not shake until it is visible again', () => {
  const run = harness({ initiallyHidden: true });
  run.nudge.start();
  assert.deepEqual(run.pending(), []);
  run.setNow(8000);
  run.nudge.setHidden(false);
  assert.equal(run.pending()[0].at, 16000);
});

test('the phone idle control uses the existing Coo head and hides the sprite', () => {
  const css = widget.split('<style>')[1] || '';
  assert.match(widget, /from '\.\.\/lib\/headNudge\.js'/);
  assert.match(widget, /coo\.svg/);
  assert.match(widget, /data-coo-head/);
  assert.match(widget, /nudge\.stop\(\)/);
  assert.match(widget, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /border-radius:\s*50%/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /coo-head-shake \.6s/);
  assert.match(css, /max-width:\s*719px[\s\S]*display:\s*none/);
  assert.match(css, /\.coo-perch:not\(\[data-out\]\) \.coo-window,\s*\.coo-perch:not\(\[data-out\]\) \.coo-cue \{\s*display:\s*none;\s*\}/);
});
