// Shared chiptune voice and timing for the corner coo.
// The tune itself lives in cooTheme.js. Both voices share one sixteenth-note clock.

export const MASTER_GAIN = 0.18;
export const VOICES = {
  melody: { type: 'square', gain: 0.34 },
  bass: { type: 'triangle', gain: 0.4 },
};

// A 2/4 bar is two beats, and each beat is four sixteenth notes.
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 8;

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function stepSeconds(bpm) {
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

/** Expand a form into absolute step times. Both voices share one clock. */
export function expandTune(form, parts) {
  const melody = [];
  const bass = [];
  let at = 0;
  for (const name of form) {
    const part = parts[name];
    if (!part) throw new Error(`Unknown tune part: ${name}`);
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

export function cycleDurationSeconds(tune, bpm) {
  return tune.totalSteps * stepSeconds(bpm);
}
