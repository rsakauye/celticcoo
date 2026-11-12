// Ceilidh's march on the drum practice page: the game state behind the canvas.
// She steps forward on a stroke that lands, stumbles on a miss or an extra hit, and
// beat cues travel toward a hit line in front of her drum.
// This file only keeps time and decides what to draw. It reads no audio and scores
// nothing: the grades come from the scorer in drumPractice.js, unchanged. The drawing
// is in drumMarchView.js. Nothing here touches the network, the microphone, or storage.
// Sizes are in art pixels. The art and its frame map are Darkroom's.

export const STAGE_W = 256;
export const STAGE_H = 96;
export const FPS = 10;
export const STEP_PX = 8;
export const LOOKAHEAD_BEATS = 2;
export const HIT_LINE_X = 108;
export const CUE_SPAWN_X = 230;
export const STEP_GRADES = ['perfect', 'good', 'ok'];
export const STUMBLE_GRADES = ['miss', 'stray'];

// Character sheet: 80×64 frames, one animation per row.
export const CHARACTER = { w: 80, h: 64, x: 28, y: STAGE_H - 64 - 4 };
export const ANIMS = {
  idle: { row: 0, frames: 1 },
  march: { row: 1, frames: 6 },
  'strike-r': { row: 2, frames: 3 },
  'strike-l': { row: 3, frames: 3 },
  stumble: { row: 4, frames: 6 },
  recover: { row: 5, frames: 3 },
};

// Cue and flash sheet: 32×48 cells in one row. `inner` is the drawn part of a cell.
export const CUE_CELL = { w: 32, h: 48 };
export const CUES = {
  'cue-beat': { col: 0, inner: { x: 4, y: 16, w: 24, h: 32 } },
  'cue-accent': { col: 1, inner: { x: 4, y: 16, w: 24, h: 32 } },
  // cue-flam (col 2), cue-roll (col 3) and cue-diamond (col 4) are in the sheet for later
  // rudiments. Nothing draws them: the page has no flam or roll to detect.
  'hit-line': { col: 5, inner: { x: 8, y: 0, w: 16, h: 48 } },
  'fx-perfect': { col: 6, inner: { x: 0, y: 16, w: 32, h: 32 } },
  'fx-good': { col: 7, inner: { x: 0, y: 16, w: 32, h: 32 } },
  'fx-ok': { col: 8, inner: { x: 0, y: 16, w: 32, h: 32 } },
  'fx-miss': { col: 9, inner: { x: 0, y: 16, w: 32, h: 32 } },
  'fx-stray': { col: 10, inner: { x: 0, y: 16, w: 32, h: 32 } },
};
export const CUE_Y = 40;
export const HIT_LINE_Y = STAGE_H - 48 - 8;
export const FX_Y = 36;

// Back to front. Parallax 0 does not scroll. The hit line, cues and character are
// drawn between `field` and `foreground`.
export const LAYERS = [
  { name: 'sky', parallax: 0 },
  { name: 'far-hills', parallax: 0.25 },
  { name: 'mid-hills', parallax: 0.5 },
  { name: 'field', parallax: 1 },
  { name: 'foreground', parallax: 1.5 },
];

const STRIKE_S = ANIMS['strike-r'].frames / FPS;
const STUMBLE_S = ANIMS.stumble.frames / FPS;
const RECOVER_S = ANIMS.recover.frames / FPS;
const CONTACT_S = 1 / FPS; // frame 1 of a strike is the contact frame
const FX_S = 0.25;
const MISS_FADE_S = 0.25;
const STILL_STUMBLE_S = 0.3;
const STILL_FX_S = 0.1;

/** Where a cue sits for a stroke due at `at`. Null while it is still off stage. */
export function cueX(at, now, leadSeconds) {
  const left = at - now;
  if (!(leadSeconds > 0) || left > leadSeconds) return null;
  // A stroke that is due waits at the line until it is scored. It never passes through her.
  if (left <= 0) return HIT_LINE_X;
  return Math.round(HIT_LINE_X + (CUE_SPAWN_X - HIT_LINE_X) * (left / leadSeconds));
}

export function createMarch({ reducedMotion = false } = {}) {
  let still = Boolean(reducedMotion);
  let cues = new Map();
  let scroll = 0;
  let target = 0;
  let speed = 0;
  let action = null; // { name: 'strike-r' | 'strike-l' | 'stumble', start }
  let fx = null; // { kind, start }
  let lastFrame = null;
  let marchStart = null;

  function reset() {
    cues = new Map();
    scroll = 0;
    target = 0;
    speed = 0;
    action = null;
    fx = null;
    lastFrame = null;
    marchStart = null;
  }

  function stumbling(now) {
    if (!action || action.name !== 'stumble') return false;
    return now - action.start < (still ? STILL_STUMBLE_S : STUMBLE_S + RECOVER_S);
  }

  function stumble(now, kind) {
    fx = { kind, start: now };
    // One stumble at a time. A second misfire during it is not queued.
    if (stumbling(now)) return;
    action = { name: 'stumble', start: now };
    target = scroll; // no step while she is off balance
  }

  return {
    reset,
    setReducedMotion(on) {
      still = Boolean(on);
    },
    /** Strokes the scorer now expects: [{ index, at, hand, accent }]. */
    expect(strokes) {
      for (const s of strokes) cues.set(s.index, { at: s.at, hand: s.hand, accent: Boolean(s.accent), state: 'pending', doneAt: 0 });
    },
    /** A scored hit, straight from scorer.hit(). `strokeSeconds` is the gap between strokes. */
    hit(result, now, strokeSeconds = 0.5) {
      if (!result) return;
      if (!STEP_GRADES.includes(result.grade)) {
        if (result.grade === 'stray') stumble(now, 'fx-stray');
        return;
      }
      const cue = cues.get(result.index);
      cues.delete(result.index);
      const kind = `fx-${result.grade}`;
      if (still || stumbling(now)) {
        fx = { kind, start: now };
        return;
      }
      // Fast strokes cut the strike short. Start those on the contact frame so it still shows.
      const rushed = action && action.name.startsWith('strike') && now - action.start < STRIKE_S;
      const start = rushed ? now - CONTACT_S : now;
      action = { name: cue && cue.hand === 'L' ? 'strike-l' : 'strike-r', start };
      fx = { kind, start: start + CONTACT_S };
      target += STEP_PX;
      // Cover one step in one stroke gap, so steady playing reads as steady marching.
      speed = STEP_PX / Math.min(0.6, Math.max(0.1, strokeSeconds));
    },
    /** Expected strokes that went unplayed, straight from scorer.sweep(). */
    miss(indices, now) {
      let any = false;
      for (const index of indices) {
        const cue = cues.get(index);
        if (cue) {
          cue.state = 'miss';
          cue.doneAt = now;
        }
        any = true;
      }
      if (any) stumble(now, 'fx-miss');
    },
    /**
     * What to draw at `now`. `lead` is how long a cue takes to cross the stage, in seconds.
     * `preview` lists strokes that are coming but not yet handed to the scorer.
     */
    frame(now, { lead = 1, preview = [] } = {}) {
      const dt = lastFrame === null ? 0 : Math.max(0, Math.min(0.25, now - lastFrame));
      lastFrame = now;

      let anim = 'idle';
      let frame = 0;
      if (action) {
        const f = Math.floor((now - action.start) * FPS + 1e-6);
        if (action.name === 'stumble') {
          if (still) {
            if (now - action.start < STILL_STUMBLE_S) {
              anim = 'stumble';
              frame = 3;
            } else action = null;
          } else if (f < ANIMS.stumble.frames) {
            anim = 'stumble';
            frame = Math.max(0, f);
          } else if (f < ANIMS.stumble.frames + ANIMS.recover.frames) {
            anim = 'recover';
            frame = f - ANIMS.stumble.frames;
          } else action = null;
        } else if (f < ANIMS[action.name].frames) {
          anim = action.name;
          frame = Math.max(0, f);
        } else action = null;
      }

      if (still) {
        scroll = 0;
        target = 0;
      } else if (anim !== 'stumble' && anim !== 'recover' && scroll < target) {
        scroll = Math.min(target, scroll + speed * dt);
      }
      if (!action) {
        if (!still && scroll < target) {
          if (marchStart === null) marchStart = now;
          anim = 'march';
          frame = Math.floor((now - marchStart) * FPS) % ANIMS.march.frames;
        } else marchStart = null;
      }

      let flash = null;
      if (fx) {
        const age = now - fx.start;
        if (age >= (still ? STILL_FX_S : FX_S)) fx = null;
        else if (age >= 0) flash = fx.kind;
      }

      const shown = [];
      for (const [index, cue] of cues) {
        if (cue.state === 'miss') {
          const age = now - cue.doneAt;
          if (age >= MISS_FADE_S) {
            cues.delete(index);
            continue;
          }
          if (!still) shown.push({ x: HIT_LINE_X, kind: cue.accent ? 'cue-accent' : 'cue-beat', hand: cue.hand, alpha: 1 - age / MISS_FADE_S, at: cue.at });
          continue;
        }
        shown.push({ x: cueX(cue.at, now, lead), kind: cue.accent ? 'cue-accent' : 'cue-beat', hand: cue.hand, alpha: 1, at: cue.at });
      }
      for (const s of preview) {
        shown.push({ x: cueX(s.at, now, lead), kind: s.accent ? 'cue-accent' : 'cue-beat', hand: s.hand, alpha: 1, at: s.at });
      }
      let list = shown.filter((c) => c.x !== null).sort((a, b) => b.at - a.at);
      if (still) {
        // No moving lane: one icon at the line names the next stroke, swapped in place.
        const next = list.length ? list[list.length - 1] : null;
        list = next ? [{ ...next, x: HIT_LINE_X }] : [];
      }

      return {
        scroll: Math.floor(scroll),
        anim,
        frame,
        fx: flash,
        cues: list.map(({ x, kind, hand, alpha }) => ({ x, kind, hand, alpha })),
      };
    },
  };
}
