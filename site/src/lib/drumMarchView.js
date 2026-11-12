// Draws the march (see drumMarch.js) on a small canvas at art size. CSS scales it up
// with nearest-neighbour, so the page pays for 256×96 pixels a frame and nothing more.
// The canvas is decoration: the meter and the readout beside it carry the same result
// in words. The colours below are the sprite's own outline and cream, part of the art.

import {
  ANIMS,
  CHARACTER,
  CUES,
  CUE_CELL,
  CUE_Y,
  FX_Y,
  HIT_LINE_X,
  HIT_LINE_Y,
  LAYERS,
  STAGE_W,
} from './drumMarch.js';

const INK = 'rgb(59 36 22)';
const PAPER = 'rgb(246 234 214)';
// 5×7 letters for the sticking, drawn above each cue.
const GLYPHS = {
  R: ['1111.', '1...1', '1...1', '1111.', '1.1..', '1..1.', '1...1'],
  L: ['1....', '1....', '1....', '1....', '1....', '1....', '11111'],
};

function load(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function reducedMotion() {
  const media = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return Boolean(media) || document.documentElement.getAttribute('data-a11y-motion') === 'reduce';
}

export function mountMarchView(canvas) {
  const g = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (!g) return null;
  const base = canvas.dataset.art || '';
  const art = { layers: [], character: null, cues: null };
  let last = { scroll: 0, anim: 'idle', frame: 0, fx: null, cues: [] };

  function cell(name, x, y, alpha = 1) {
    const c = CUES[name];
    if (!c || !art.cues) return;
    g.globalAlpha = alpha;
    g.drawImage(art.cues, c.col * CUE_CELL.w + c.inner.x, c.inner.y, c.inner.w, c.inner.h, x - (c.inner.w >> 1), y, c.inner.w, c.inner.h);
    g.globalAlpha = 1;
  }

  function letter(hand, cx, y, alpha) {
    const rows = GLYPHS[hand];
    if (!rows) return;
    g.globalAlpha = alpha;
    g.fillStyle = PAPER;
    g.fillRect(cx - 4, y - 1, 9, 9);
    g.fillStyle = INK;
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i += 1) if (row[i] === '1') g.fillRect(cx - 2 + i, y + r, 1, 1);
    });
    g.globalAlpha = 1;
  }

  function layer(i, scroll) {
    const img = art.layers[i];
    if (!img) return;
    const off = Math.floor(scroll * LAYERS[i].parallax) % STAGE_W;
    g.drawImage(img, -off, 0);
    if (off) g.drawImage(img, STAGE_W - off, 0);
  }

  function draw(view) {
    if (view) last = view;
    const v = last;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < 4; i += 1) layer(i, v.scroll);
    cell('hit-line', HIT_LINE_X, HIT_LINE_Y);
    for (const cue of v.cues) {
      cell(cue.kind, cue.x, CUE_Y, cue.alpha);
      letter(cue.hand, cue.x + 1, CUE_Y - 10, cue.alpha);
    }
    if (art.character) {
      const a = ANIMS[v.anim] || ANIMS.idle;
      g.drawImage(art.character, v.frame * CHARACTER.w, a.row * CHARACTER.h, CHARACTER.w, CHARACTER.h, CHARACTER.x, CHARACTER.y, CHARACTER.w, CHARACTER.h);
    }
    layer(4, v.scroll);
    if (v.fx) cell(v.fx, HIT_LINE_X, FX_Y);
  }

  const ready = Promise.all([
    ...LAYERS.map((l) => load(`${base}${l.name}.png`)),
    load(`${base}ceilidh-drum-character.png`),
    load(`${base}cues-and-fx.png`),
  ]).then((imgs) => {
    art.layers = imgs.slice(0, LAYERS.length);
    art.character = imgs[LAYERS.length];
    art.cues = imgs[LAYERS.length + 1];
    draw();
  });

  return { draw, ready };
}
