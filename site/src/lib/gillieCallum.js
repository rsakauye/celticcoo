// Gillie Callum (Ghillie Chaluim), the traditional Sword Dance tune.
// Public domain. This is an original chiptune written for this site: a
// brisk dotted snap in A mixolydian (the bagpipe scale), with the repeated
// notes and upward leaps of a sword dance. It is not a transcription, and
// no MIDI file, website setting, or recording was copied. The bass is an
// original tonic-and-dominant part.
//
// Melody, one 2/4 bar per line. ">" is the dotted snap. "a" is the high A.
//
//   A: A>A A C# | E>E E C# | A>A A C# | E2 E2 |
//      A>A A C# | E>E E C# | A C# E C# | A2 A2 ||
//   B: E>E E G | a>a a G | E>E E G | a2 G2 |
//      E G a G | E>E E C# | a G E C# | A2 A2 ||
//
// Form is AABB. Durations are sixteenth notes, same grid as Highland Laddie.

export const TEMPO_BPM = 126;

const A_MELODY = [
  [69, 3], [69, 1], [69, 2], [73, 2],
  [76, 3], [76, 1], [76, 2], [73, 2],
  [69, 3], [69, 1], [69, 2], [73, 2],
  [76, 4], [76, 4],
  [69, 3], [69, 1], [69, 2], [73, 2],
  [76, 3], [76, 1], [76, 2], [73, 2],
  [69, 2], [73, 2], [76, 2], [73, 2],
  [69, 4], [69, 4],
];

const B_MELODY = [
  [76, 3], [76, 1], [76, 2], [79, 2],
  [81, 3], [81, 1], [81, 2], [79, 2],
  [76, 3], [76, 1], [76, 2], [79, 2],
  [81, 4], [79, 4],
  [76, 2], [79, 2], [81, 2], [79, 2],
  [76, 3], [76, 1], [76, 2], [73, 2],
  [81, 2], [79, 2], [76, 2], [73, 2],
  [69, 4], [69, 4],
];

const A_BASS = [45, 52, 45, 52, 45, 52, 45, 52, 45, 52, 45, 52, 45, 52, 45, 45];
const B_BASS = [52, 45, 52, 45, 52, 45, 45, 43, 52, 45, 52, 49, 45, 43, 52, 45];

export const PARTS = {
  A: { melody: A_MELODY, bass: A_BASS },
  B: { melody: B_MELODY, bass: B_BASS },
};
