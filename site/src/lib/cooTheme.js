// Coo theme. An original dance tune written for this site, in G major.
// Cheerful 2/4 with a Scotch snap (dotted eighth + sixteenth). The loop is
// AABB, four bars to a part, sixteen bars in all. Durations are sixteenth
// notes. A quarter note is 4 steps, and a bar is 8 steps.
//
//   A: G>B D G | E>D B G | D>F# G B | A G G2 |
//   B: B>D G E | E>C B A | G>B D B | A B D2 |

import { cycleDurationSeconds, expandTune, stepSeconds } from './cooSynth.js';

export const TITLE = 'Coo theme';
export const TEMPO_BPM = 120;
export const FORM = ['A', 'A', 'B', 'B'];

const A_MELODY = [
  [67, 3], [71, 1], [74, 2], [79, 2],
  [76, 3], [74, 1], [71, 2], [67, 2],
  [74, 3], [78, 1], [79, 2], [71, 2],
  [69, 2], [67, 2], [67, 4],
];

const B_MELODY = [
  [71, 3], [74, 1], [79, 2], [76, 2],
  [76, 3], [72, 1], [71, 2], [69, 2],
  [67, 3], [71, 1], [74, 2], [71, 2],
  [69, 2], [71, 2], [74, 4],
];

// One MIDI number per quarter-note beat.
const A_BASS = [55, 50, 55, 50, 55, 50, 50, 55];
const B_BASS = [55, 50, 52, 50, 55, 50, 57, 50];

export const PARTS = {
  A: { melody: A_MELODY, bass: A_BASS },
  B: { melody: B_MELODY, bass: B_BASS },
};

/** Notes, step length, and cycle length for the one theme the coo plays. */
export function prepareTheme() {
  const expanded = expandTune(FORM, PARTS);
  return {
    id: 'coo-theme',
    title: TITLE,
    bpm: TEMPO_BPM,
    expanded,
    step: stepSeconds(TEMPO_BPM),
    cycleSeconds: cycleDurationSeconds(expanded, TEMPO_BPM),
  };
}
