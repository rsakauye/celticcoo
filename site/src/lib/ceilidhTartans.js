// Ceilidh's kilt is Fraser of Lovat. The sprite paths are fixed.
// There is no tartan picker and no saved choice.
export const CEILIDH_TARTAN = {
  slug: 'fraser-of-lovat',
  name: 'Fraser of Lovat',
  fling: 'img/ceilidh-fling-strip.png',
  fling_frames: 10,
  ears: 'tartans/fraser-of-lovat/ceilidh-coo-ears-covered-strip.png',
  ears_frames: 4,
};

export function defaultTartan() {
  return CEILIDH_TARTAN;
}
