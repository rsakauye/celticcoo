// The corner coo plays one tune at a time. Stop and start walks the traditional
// tunes, then the Coo theme, then back to the first.

import { DANCE_TUNES, nextTuneIndex, prepareTune } from './danceTunes.js';
import { TITLE, prepareTheme } from './cooTheme.js';

export function isCooTheme(index) {
  return index === DANCE_TUNES.length;
}

export function advanceTuneIndex(index) {
  if (isCooTheme(index)) return 0;
  const tuneIndex = index;
  const next = nextTuneIndex(tuneIndex);
  if (index === DANCE_TUNES.length - 1) return DANCE_TUNES.length;
  return next;
}

export function loadTune(index) {
  return isCooTheme(index) ? prepareTheme() : prepareTune(index);
}

export function labelsFor(index, on) {
  const coo = isCooTheme(index);
  const name = coo ? TITLE : DANCE_TUNES[index].title;
  return {
    name,
    aria: on
      ? (coo ? 'Tuck Ceilidh away and stop Coo theme' : `Tuck Ceilidh away and stop ${name}`)
      : (coo ? 'Bring out Ceilidh to dance' : `Bring out Ceilidh to dance to ${name}`),
    status: on
      ? `Ceilidh is out and dancing. ${name} is playing.`
      : `Ceilidh is tucked away. ${name} is next, and the music is muted.`,
  };
}

/** One slot. Starting again replaces whatever is already playing. */
export function createTuneSession() {
  let index = 0;
  let playing = null;
  return {
    index() { return index; },
    playingIds() { return playing ? [playing.id] : []; },
    start() {
      const tune = loadTune(index);
      playing = { id: tune.id, title: tune.title };
      return { playing: this.playingIds(), labels: labelsFor(index, true) };
    },
    stop() {
      playing = null;
      index = advanceTuneIndex(index);
      return { playing: this.playingIds(), labels: labelsFor(index, false) };
    },
  };
}
