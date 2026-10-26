// Seann Triubhas, the traditional Highland dance tune (public domain).
// Original chiptune written for this site: a gentler stepping melody in
// A mixolydian, still on the dotted march grid, at a slower tempo than the
// sword dance. Not a transcription. No MIDI file, website setting, or
// recording was copied. The bass is an original part on the pipe scale.
//
// Melody, one 2/4 bar per line. ">" is the dotted snap. "a" is the high A.
//
//   A: E>D C A | G E D2 | C>D E G | a2 A2 |
//      E>D C A | G E D C | B A G E | A2 A2 ||
//   B: C>D E a | G E C2 | D>E G a | E2 E2 |
//      C E a G | E>D C A | G E D C | A2 A2 ||
//
// Form is AABB. Durations are sixteenth notes, same grid as Highland Laddie.

export const TEMPO_BPM = 104;

const A_MELODY = [
  [76, 3], [74, 1], [73, 2], [69, 2],
  [67, 2], [64, 2], [62, 4],
  [73, 3], [74, 1], [76, 2], [79, 2],
  [81, 4], [69, 4],
  [76, 3], [74, 1], [73, 2], [69, 2],
  [67, 2], [64, 2], [62, 2], [61, 2],
  [71, 2], [69, 2], [67, 2], [64, 2],
  [69, 4], [69, 4],
];

const B_MELODY = [
  [73, 3], [74, 1], [76, 2], [81, 2],
  [79, 2], [76, 2], [73, 4],
  [74, 3], [76, 1], [79, 2], [81, 2],
  [76, 4], [76, 4],
  [73, 2], [76, 2], [81, 2], [79, 2],
  [76, 3], [74, 1], [73, 2], [69, 2],
  [67, 2], [64, 2], [62, 2], [61, 2],
  [69, 4], [69, 4],
];

const A_BASS = [45, 52, 45, 50, 49, 52, 45, 45, 45, 52, 43, 49, 47, 45, 52, 45];
const B_BASS = [49, 45, 43, 49, 50, 52, 45, 52, 49, 45, 52, 45, 43, 50, 52, 45];

export const PARTS = {
  A: { melody: A_MELODY, bass: A_BASS },
  B: { melody: B_MELODY, bass: B_BASS },
};
