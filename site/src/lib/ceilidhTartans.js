// Kilt choices for Ceilidh. Meanings for the eight shown tartans are copied
// from site/src/data/ceilidh-tartans.json. MacKinnon stays in the list and
// is not shown until its strips are added.
// threads is the warp stripe on that kilt, one entry per pixel. The picker
// swatch repeats the same stripe.
export const STORAGE_KEY = 'ceilidh-tartan';

export const TARTANS = [
  {
    "slug": "fraser-of-lovat",
    "name": "Fraser of Lovat",
    "threads": ["#B82E26", "#B82E26", "#B82E26", "#fff", "#B82E26", "#B82E26", "#B82E26", "#1F4D3A", "#20284E", "#1F4D3A"],
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
    "threads": ["#B82E26", "#B82E26", "#B82E26", "#B82E26", "#20284E", "#781A22", "#fff", "#781A22", "#20284E", "#E0A526", "#20284E", "#20284E"],
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
    "threads": ["#B82E26", "#B82E26", "#B82E26", "#B82E26", "#1F4D3A", "#B82E26", "#B82E26", "#1F4D3A", "#1F4D3A", "#20284E", "#20284E", "#1F4D3A"],
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
    "threads": ["#8A6230", "#8A6230", "#8A6230", "#1F4D3A", "#1F4D3A", "#20284E", "#8A6230", "#20284E", "#1F4D3A", "#1F4D3A", "#8A6230", "#B82E26"],
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
    "threads": ["#20284E", "#20284E", "#20284E", "#18161A", "#1F4D3A", "#1F4D3A", "#18161A", "#1F4D3A", "#1F4D3A", "#18161A", "#20284E", "#18161A"],
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
    "threads": ["#B82E26", "#B82E26", "#B82E26", "#B82E26", "#1F4D3A", "#1F4D3A", "#1F4D3A", "#fff", "#78BAE6", "#B82E26"],
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
    "threads": ["#18161A", "#18161A", "#18161A", "#B82E26", "#18161A", "#B82E26", "#1F4D3A", "#1F4D3A", "#1F4D3A", "#B82E26"],
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
    "threads": ["#B82E26", "#B82E26", "#B82E26", "#B82E26", "#C4A068", "#B82E26", "#1F4D3A", "#1F4D3A", "#20284E", "#20284E"],
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

export function swatchBackground(tartan) {
  const threads = tartan?.threads;
  if (!threads?.length) return '';
  const stops = [];
  let start = 0;
  while (start < threads.length) {
    let end = start + 1;
    while (end < threads.length && threads[end].toLowerCase() === threads[start].toLowerCase()) end += 1;
    const color = threads[start].toLowerCase() === '#ffffff' ? '#fff' : threads[start];
    stops.push(`${color} ${start}px ${end}px`);
    start = end;
  }
  return `repeating-linear-gradient(90deg, ${stops.join(', ')})`;
}

export function tartanView(tartan) {
  return {
    slug: tartan.slug,
    name: tartan.name,
    swatch: swatchBackground(tartan),
    label: `Kilt tartan, ${tartan.name}. Choose a tartan.`,
  };
}

// Updates the open button, its swatch, and the pressed choice. Callers pass
// the tartan from readTartan (page load) or writeTartanId (a new pick).
export function applyTartan(tartan, nodes = {}) {
  const view = tartanView(tartan);
  for (const el of nodes.swatches || []) el.style.setProperty('--swatch', view.swatch);
  for (const el of nodes.names || []) el.textContent = view.name;
  for (const el of nodes.openers || []) el.setAttribute('aria-label', view.label);
  for (const el of nodes.choices || []) {
    el.setAttribute('aria-pressed', el.getAttribute('data-tartan-choice') === view.slug ? 'true' : 'false');
  }
  return view;
}

// A tucked Coo only shows her head. Peek at the kilt after a pick, unless the
// visitor asked for less motion.
export function kiltPeekWanted({ tucked, reduceMotion }) {
  return Boolean(tucked) && !reduceMotion;
}
