// Highland Laddie, a traditional Scottish quick march (public domain).
// Original chiptune setting in D major, written for this site from the tune
// as commonly played: a pentatonic march skeleton (1–3–5–6) with a dotted
// march snap. No MIDI file, transcription, recording, or external source
// was copied. The bass is an original tonic-and-dominant march part.
//
// Melody, one 2/4 bar per line. ">" is the march snap (dotted eighth +
// sixteenth). Lowercase d is the octave above.
//
//   A: D>D D F# | A>D F# D | D>D D F# | A B A2 |
//      D>D D F# | A>D F# D | A B A F# | D2 D2 ||
//   B: A>A A B | A F# D F# | A>A A B | A F# D2 |
//      d A A B | A F# D F# | d A B A | F# D D2 ||
//
// Form is AABB, then the cycle loops. Durations below are sixteenth notes.
// A quarter note is 4 steps; a 2/4 bar is 8 steps.

export const TEMPO_BPM = 120;
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 8;
export const FORM = ['A', 'A', 'B', 'B'];

// Peak gains before the master. Square waves are harsh, so both stay small.
export const MASTER_GAIN = 0.18;
export const VOICES = {
  melody: { type: 'square', gain: 0.34 },
  bass: { type: 'triangle', gain: 0.4 },
};

const A_MELODY = [
  [62, 3], [62, 1], [62, 2], [66, 2],
  [69, 3], [62, 1], [66, 2], [62, 2],
  [62, 3], [62, 1], [62, 2], [66, 2],
  [69, 2], [71, 2], [69, 4],
  [62, 3], [62, 1], [62, 2], [66, 2],
  [69, 3], [62, 1], [66, 2], [62, 2],
  [69, 2], [71, 2], [69, 2], [66, 2],
  [62, 4], [62, 4],
];

const B_MELODY = [
  [69, 3], [69, 1], [69, 2], [71, 2],
  [69, 2], [66, 2], [62, 2], [66, 2],
  [69, 3], [69, 1], [69, 2], [71, 2],
  [69, 2], [66, 2], [62, 4],
  [74, 2], [69, 2], [69, 2], [71, 2],
  [69, 2], [66, 2], [62, 2], [66, 2],
  [74, 2], [69, 2], [71, 2], [69, 2],
  [66, 2], [62, 2], [62, 4],
];

// One MIDI number per quarter-note beat. 0 would be a rest.
const A_BASS = [50, 45, 50, 45, 50, 45, 50, 57, 50, 45, 50, 45, 57, 50, 50, 50];
const B_BASS = [57, 50, 45, 50, 57, 50, 45, 50, 50, 45, 57, 50, 50, 45, 50, 50];

export const PARTS = {
  A: { melody: A_MELODY, bass: A_BASS },
  B: { melody: B_MELODY, bass: B_BASS },
};

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function stepSeconds(bpm = TEMPO_BPM) {
  return 60 / bpm / STEPS_PER_BEAT;
}

function lay(notes, at, voice) {
  const out = [];
  let cursor = 0;
  for (const note of notes) {
    const midi = voice === 'bass' ? note : note[0];
    const steps = voice === 'bass' ? STEPS_PER_BEAT : note[1];
    out.push({ midi, steps, at: at + cursor, voice });
    cursor += steps;
  }
  return { notes: out, steps: cursor };
}

/** Expand FORM into absolute step times. Both voices share one clock. */
export function expandTune(form = FORM) {
  const melody = [];
  const bass = [];
  let at = 0;
  for (const name of form) {
    const part = PARTS[name];
    if (!part) throw new Error(`Unknown Highland Laddie part: ${name}`);
    const lead = lay(part.melody, at, 'melody');
    const low = lay(part.bass, at, 'bass');
    if (lead.steps !== low.steps) {
      throw new Error(`Part ${name} melody and bass are different lengths`);
    }
    if (lead.steps % STEPS_PER_BAR !== 0) {
      throw new Error(`Part ${name} is not a whole number of bars`);
    }
    melody.push(...lead.notes);
    bass.push(...low.notes);
    at += lead.steps;
  }
  return { melody, bass, totalSteps: at };
}

export function cycleDurationSeconds(tune = expandTune()) {
  return tune.totalSteps * stepSeconds();
}
