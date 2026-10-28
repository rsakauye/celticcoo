// Short original placeholder for the corner widget.
// A few notes, looped. It is not a named march.

export const THEME_TITLE = 'Coo theme';
export const MASTER_GAIN = 0.12;
export const VOICES = {
  melody: { type: 'square', gain: 0.28 },
  bass: { type: 'triangle', gain: 0.32 },
};

export function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function prepareCooTheme() {
  const bpm = 96;
  const step = 60 / bpm / 2;
  const melodyNotes = [60, 64, 67, 64, 62, 65, 69, 65];
  const bassNotes = [48, 48, 43, 43];
  const melody = melodyNotes.map((midi, i) => ({ midi, at: i, steps: 1 }));
  const bass = bassNotes.map((midi, i) => ({ midi, at: i * 2, steps: 2 }));
  return {
    id: 'coo-theme',
    title: THEME_TITLE,
    bpm,
    expanded: { melody, bass },
    step,
    cycleSeconds: melody.length * step,
  };
}
