// Kilt choices for Ceilidh. Meanings for the eight shown tartans are copied
// from site/src/data/ceilidh-tartans.json. MacKinnon stays in the list and
// is not shown until its strips are added.
export const STORAGE_KEY = 'ceilidh-tartan';

export const TARTANS = [
  {
    "slug": "fraser-of-lovat",
    "name": "Fraser of Lovat",
    "default": true,
    "meaning": "The Lovat Frasers of Beauly, the clan behind the Calgary Frasers band name.",
    "str_ref": 1264,
    "fling": "tartans/fraser-of-lovat/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/fraser-of-lovat/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "calgary",
    "name": "Calgary",
    "default": false,
    "meaning": "Calgary's own tartan: red for the Stampede, blue for the Bow and Elbow, gold for the prairie, black for oil and gas, white for the White Hat.",
    "str_ref": 477,
    "fling": "tartans/calgary/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/calgary/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "fraser",
    "name": "Fraser (red)",
    "default": false,
    "meaning": "The classic red Fraser sett from 1842, the most popular Fraser tartan today.",
    "str_ref": 1247,
    "fling": "tartans/fraser/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/fraser/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "fraser-hunting",
    "name": "Fraser Hunting",
    "default": false,
    "meaning": "The Fraser hunting sett in browns and greens, worn by the Lovat Scouts.",
    "str_ref": 1258,
    "fling": "tartans/fraser-hunting/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/fraser-hunting/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "government",
    "name": "Government (Black Watch)",
    "default": false,
    "meaning": "The 1739 Government tartan, root of many clan setts and worn by anyone.",
    "str_ref": 277,
    "fling": "tartans/government/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/government/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "menzies",
    "name": "Menzies",
    "default": false,
    "meaning": "Clan Menzies of Castle Menzies at Weem, near Aberfeldy, in red and green.",
    "str_ref": 2920,
    "fling": "tartans/menzies/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/menzies/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "logan-1819",
    "name": "Logan (1819)",
    "default": false,
    "meaning": "Wilsons of Bannockburn pattern No. 119 from 1819, later the Logan clan tartan.",
    "str_ref": 2185,
    "fling": "tartans/logan-1819/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/logan-1819/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "macgillivray",
    "name": "MacGillivray",
    "default": false,
    "meaning": "Clan MacGillivray of Clan Chattan, from Wilsons of Bannockburn's 1819 pattern book.",
    "str_ref": 2440,
    "fling": "tartans/macgillivray/ceilidh-coo-strip.png",
    "fling_frames": 10,
    "fling_ms": 100,
    "ears": "tartans/macgillivray/ceilidh-coo-ears-covered-strip.png",
    "ears_frames": 4,
    "ears_ms": 120,
    "enabled": true
  },
  {
    "slug": "mackinnon",
    "name": "MacKinnon",
    "default": false,
    "enabled": false,
    "meaning": ""
  }
];

export function enabledTartans(list = TARTANS) {
  return list.filter((tartan) => tartan.enabled && tartan.fling && tartan.ears);
}

export function defaultTartan(list = TARTANS) {
  const enabled = enabledTartans(list);
  return enabled.find((tartan) => tartan.default) || enabled[0];
}

export function resolveTartan(stored, list = TARTANS) {
  const found = enabledTartans(list).find((tartan) => tartan.slug === stored);
  return found || defaultTartan(list);
}

export function readTartan(storage, list = TARTANS) {
  let stored = null;
  try {
    stored = storage.getItem(STORAGE_KEY);
  } catch {
    return defaultTartan(list);
  }
  const tartan = resolveTartan(stored, list);
  if (stored !== tartan.slug) {
    try { storage.setItem(STORAGE_KEY, tartan.slug); } catch { /* keep the fallback on screen */ }
  }
  return tartan;
}

export function writeTartanId(id, storage, list = TARTANS) {
  const tartan = resolveTartan(id, list);
  storage.setItem(STORAGE_KEY, tartan.slug);
  return tartan;
}
