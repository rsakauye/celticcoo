import test from 'node:test';
import assert from 'node:assert/strict';
import { DANCE_TUNES } from '../src/lib/danceTunes.js';
import { TITLE } from '../src/lib/cooTheme.js';
import { advanceTuneIndex, createTuneSession, loadTune } from '../src/lib/tunePlaylist.js';

test('each traditional tune and the Coo theme start and stop on their own', () => {
  const session = createTuneSession();
  const started = [];
  for (let n = 0; n < DANCE_TUNES.length + 1; n += 1) {
    const on = session.start();
    assert.deepEqual(on.playing, [loadTune(n).id]);
    assert.match(on.labels.status, /is playing\.$/);
    assert.equal((on.labels.status.match(/is playing/g) || []).length, 1);
    started.push(on.labels.name);
    const off = session.stop();
    assert.deepEqual(off.playing, []);
    assert.match(off.labels.status, /is next, and the music is muted\.$/);
  }
  assert.deepEqual(started, [...DANCE_TUNES.map((tune) => tune.title), TITLE]);
  assert.equal(session.index(), 0);
});

test('the Coo theme uses its own cues', () => {
  let index = 0;
  const session = createTuneSession();
  while (!session.start().labels.name.includes('Coo')) {
    session.stop();
    index += 1;
    assert.ok(index < 6);
  }
  const on = session.start();
  assert.deepEqual(on.playing, ['coo-theme']);
  assert.equal(on.labels.aria, 'Tuck Ceilidh away and stop Coo theme');
  const off = session.stop();
  assert.equal(off.labels.aria, 'Bring out Ceilidh to dance to Highland Laddie');
  assert.equal(off.labels.name, 'Highland Laddie');
});

test('starting another tune never leaves two playing', () => {
  const session = createTuneSession();
  const first = session.start();
  const again = session.start();
  assert.deepEqual(again.playing, first.playing);
  assert.equal(again.playing.length, 1);
  session.stop();
  const second = session.start();
  assert.equal(second.playing.length, 1);
  assert.notEqual(second.playing[0], first.playing[0]);
  const replaced = session.start();
  assert.deepEqual(replaced.playing, second.playing);
  assert.equal(replaced.playing.length, 1);
  assert.deepEqual([0, 1, 2, 3].map((index) => advanceTuneIndex(index)), [1, 2, 3, 0]);
});
