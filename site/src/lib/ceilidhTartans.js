// Kilt choices for Ceilidh. Meanings for the eight shown tartans are copied
// from site/src/data/ceilidh-tartans.json. MacKinnon stays in the list and
// is not shown until its strips are added.
// threads is the sett, one entry per thread, used for both warp and weft.
// weaveColor is the twill the kilt sprite is drawn with, so the swatch and
// the kilt share one pattern.
export const STORAGE_KEY = 'ceilidh-tartan';

export const TARTANS = [
  {
    "slug": "fraser-of-lovat",
    "name": "Fraser of Lovat",
    "short_label": "Lovat",
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
    "short_label": "Calgary",
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
    "short_label": "Fraser",
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
    "short_label": "Fraser Hunting",
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
    "short_label": "Government",
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
    "short_label": "Menzies",
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
    "short_label": "Logan 1819",
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
    "short_label": "MacGillivray",
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

// Fraser of Lovat first, then the rest in the catalog order.
export function pickerOrder(list = TARTANS) {
  const enabled = enabledTartans(list);
  return [...enabled.filter((tartan) => tartan.default), ...enabled.filter((tartan) => !tartan.default)];
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

// One sett. The tile repeats it, two across, at two CSS pixels per thread.
export const SWATCH_REPEATS = 1;
export const SWATCH_THREAD_PX = 2;

export function weaveColor(threads, x, y, originX = 0, originY = 0) {
  const n = threads.length;
  const hex = (value) => {
    const raw = String(value).trim().toLowerCase();
    if (raw === '#fff' || raw === '#ffffff') return '#fff';
    return raw;
  };
  const at = (index) => hex(threads[((index % n) + n) % n]);
  const warp = at(x - originX);
  const weft = at(y - originY);
  if (warp === weft) return warp;
  const even = (x + y) % 2 === 0;
  if (warp === '#fff' || weft === '#fff') return even ? '#fff' : (warp === '#fff' ? weft : warp);
  return even ? warp : weft;
}

export function swatchMarkup(tartan, repeats = SWATCH_REPEATS) {
  const threads = tartan?.threads;
  if (!threads?.length) return '';
  const size = threads.length * repeats;
  const px = size * SWATCH_THREAD_PX;
  const rects = [];
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      const fill = weaveColor(threads, x, y);
      let end = x + 1;
      while (end < size && weaveColor(threads, end, y) === fill) end += 1;
      const x0 = x * SWATCH_THREAD_PX;
      const y0 = y * SWATCH_THREAD_PX;
      rects.push(`<rect x="${x0}" y="${y0}" width="${(end - x) * SWATCH_THREAD_PX}" height="${SWATCH_THREAD_PX}" fill="${fill}"/>`);
      x = end;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

export function settTileImage(tartan) {
  const svg = swatchMarkup(tartan);
  if (!svg) return 'none';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function tartanView(tartan) {
  return {
    slug: tartan.slug,
    name: tartan.name,
    shortLabel: tartan.short_label || tartan.name,
    swatch: swatchMarkup(tartan),
    tile: settTileImage(tartan),
    label: tartan.short_label || tartan.name,
  };
}

// Marks the pressed tile. Callers pass the tartan from readTartan (page load)
// or writeTartanId (a new pick). The stage size does not change.
export function applyTartan(tartan, nodes = {}) {
  const view = tartanView(tartan);
  for (const el of nodes.choices || []) {
    el.setAttribute('aria-pressed', el.getAttribute('data-tartan-choice') === view.slug ? 'true' : 'false');
  }
  return view;
}
