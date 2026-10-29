// Home-page dance tunes, in the order a visitor hears them.
// The first play is Highland Laddie. Each stop-then-start advances one step
// and then repeats. The index lives in memory, so a reload starts over.

import { PARTS as GHILLIE_PARTS, TEMPO_BPM as GHILLIE_BPM } from './ghillieCallum.js';
import {
  FORM,
  PARTS as LADDIE_PARTS,
  TEMPO_BPM as LADDIE_BPM,
  cycleDurationSeconds,
  expandTune,
  stepSeconds,
} from './highlandLaddie.js';
import { PARTS as SEANN_PARTS, TEMPO_BPM as SEANN_BPM } from './seannTriubhas.js';

export const DANCE_TUNES = [
  { id: 'highland-laddie', title: 'Highland Laddie', bpm: LADDIE_BPM, parts: LADDIE_PARTS },
  { id: 'ghillie-callum', title: 'Ghillie Callum', bpm: GHILLIE_BPM, parts: GHILLIE_PARTS },
  { id: 'seann-triubhas', title: 'Seann Triubhas', bpm: SEANN_BPM, parts: SEANN_PARTS },
];

export function nextTuneIndex(index) {
  return (index + 1) % DANCE_TUNES.length;
}

/** Notes, step length, and cycle length for the tune at `index`. */
export function prepareTune(index) {
  const tune = DANCE_TUNES[index];
  const expanded = expandTune(FORM, tune.parts);
  return {
    id: tune.id,
    title: tune.title,
    bpm: tune.bpm,
    expanded,
    step: stepSeconds(tune.bpm),
    cycleSeconds: cycleDurationSeconds(expanded, tune.bpm),
  };
}
