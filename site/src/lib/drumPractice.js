// On-device drum practice math: rudiment grids, onset detection on a stream
// of transient levels, latency estimation, and hit scoring.
// Nothing in this file touches the network, the microphone, or storage.
// The browser half is drumPracticePage.js. The level formula is repeated in
// public/drum-worklet.js, which cannot import from the bundle.

export { MIC_CONSTRAINTS } from './droneTuner.js';

export const BPM_MIN = 40;
export const BPM_MAX = 200;
export const DEFAULT_BPM = 90;
export const BEATS_PER_BAR = 4;
export const COUNT_IN_BEATS = 4;

// Timing windows in milliseconds either side of the grid.
export const PERFECT_MS = 25;
export const GOOD_MS = 60;
export const OK_MS = 110;
export const OFFSET_MIN_MS = -250;
export const OFFSET_MAX_MS = 250;

export const GRADES = ['perfect', 'good', 'ok'];

// Strokes are shown for sticking only. A microphone hears that a hit
// happened, not which hand made it, so only timing is scored.
export const RUDIMENTS = [
  {
    id: 'quarters',
    title: 'Steady quarters',
    perBeat: 1,
    strokes: 'R L R L',
    note: 'One stroke on every click. Start here.',
  },
  {
    id: 'singles',
    title: 'Single strokes',
    perBeat: 2,
    strokes: 'R L R L R L R L',
    note: 'Two strokes per click, hands alternating.',
  },
  {
    id: 'doubles',
    title: 'Double strokes',
    perBeat: 4,
    strokes: 'R R L L R R L L',
    note: 'Four strokes per click, two to a hand.',
  },
  {
    id: 'paradiddle',
    title: 'Paradiddle',
    perBeat: 4,
    strokes: 'R L R R L R L L',
    note: 'Four strokes per click. The accent switches hands every time.',
  },
  {
    id: 'triplets',
    title: 'Triplets',
    perBeat: 3,
    strokes: 'R L R  L R L',
    note: 'Three strokes per click, as in 6/8 marches.',
  },
];

export function clampBpm(bpm) {
  const n = Number(bpm);
  if (!Number.isFinite(n)) return DEFAULT_BPM;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));
}

export function clampOffsetMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return 0;
  return Math.min(OFFSET_MAX_MS, Math.max(OFFSET_MIN_MS, Math.round(n)));
}

export function beatSeconds(bpm) {
  return 60 / clampBpm(bpm);
}

export function rudimentById(id) {
  return RUDIMENTS.find((r) => r.id === id) || RUDIMENTS[0];
}

/**
 * The sticking of a rudiment, one entry per stroke: which hand, and whether it is accented.
 * Only the paradiddle has accents today: the first stroke of each group of four.
 */
export function sticking(rudiment) {
  const hands = String((rudiment && rudiment.strokes) || '').split(/\s+/).filter((h) => h === 'R' || h === 'L');
  const accents = rudiment && rudiment.id === 'paradiddle';
  return hands.map((hand, i) => ({ hand, accent: Boolean(accents) && i % 4 === 0 }));
}

/** Times of every expected stroke, `bars` bars long, starting at `start`. */
export function gridTimes(start, bpm, perBeat, bars) {
  const step = beatSeconds(bpm) / perBeat;
  const total = bars * BEATS_PER_BAR * perBeat;
  const out = [];
  for (let i = 0; i < total; i += 1) out.push(start + i * step);
  return out;
}

/** Click times, one per beat, with the first beat of each bar flagged. */
export function clickTimes(start, bpm, beats) {
  const step = beatSeconds(bpm);
  const out = [];
  for (let i = 0; i < beats; i += 1) {
    out.push({ at: start + i * step, accent: i % BEATS_PER_BAR === 0 });
  }
  return out;
}

/**
 * Transient level of one block of samples: RMS of the first difference.
 * A high-pass of this kind follows a stick strike far better than raw
 * loudness, and ignores low rumble, room hum, and a held tone.
 */
export function blockLevel(block, prev = 0) {
  if (!block || block.length === 0) return { level: 0, last: prev };
  let sum = 0;
  let last = prev;
  for (let i = 0; i < block.length; i += 1) {
    const d = block[i] - last;
    sum += d * d;
    last = block[i];
  }
  return { level: Math.sqrt(sum / block.length), last };
}

export const SENSITIVITY_DEFAULT = 50;

/** Slider 0 to 100 to a trigger ratio. Higher sensitivity means a lower ratio. */
export function sensitivityToRatio(sensitivity) {
  const s = Math.min(100, Math.max(0, Number(sensitivity)));
  const v = Number.isFinite(s) ? s : SENSITIVITY_DEFAULT;
  return 6 - (v / 100) * 4;
}

/**
 * Onset detector over a stream of block levels. Feed it `push(level, time)`
 * in time order. It returns the onset time, or null.
 * The floor follows the room, slowly. A hit is a level well above that floor
 * that is also rising, and a refractory gap stops one strike ringing into two.
 */
export function createOnsetDetector({
  ratio = sensitivityToRatio(SENSITIVITY_DEFAULT),
  minLevel = 0.006,
  refractory = 0.05,
  floorRate = 0.02,
} = {}) {
  let floor = minLevel / 2;
  let previous = 0;
  let lastOnset = -Infinity;
  let ratioNow = ratio;

  return {
    setRatio(next) {
      if (Number.isFinite(next) && next > 1) ratioNow = next;
    },
    get floor() {
      return floor;
    },
    reset() {
      floor = minLevel / 2;
      previous = 0;
      lastOnset = -Infinity;
    },
    push(level, time) {
      if (!Number.isFinite(level) || !Number.isFinite(time)) return null;
      const trigger = Math.max(minLevel, floor * ratioNow);
      const rising = level > previous * 1.4 + 1e-9;
      let onset = null;
      if (level > trigger && rising && time - lastOnset >= refractory) {
        onset = time;
        lastOnset = time;
      }
      // Learn the room only from quiet blocks, so a hit does not raise the floor.
      if (level <= trigger) floor += (level - floor) * floorRate;
      previous = level;
      return onset;
    },
  };
}

/** Median delay from each click to the first onset that follows it. */
export function estimateLatency(clicks, onsets, { maxDelay = 0.35 } = {}) {
  const delays = [];
  for (const click of clicks) {
    const hit = onsets.find((o) => o >= click && o - click <= maxDelay);
    if (hit !== undefined) delays.push(hit - click);
  }
  if (delays.length < 3) return null;
  delays.sort((a, b) => a - b);
  const mid = delays.length >> 1;
  const median = delays.length % 2 ? delays[mid] : (delays[mid - 1] + delays[mid]) / 2;
  return Math.round(median * 1000);
}

export function gradeOffset(offsetMs) {
  const abs = Math.abs(offsetMs);
  if (abs <= PERFECT_MS) return 'perfect';
  if (abs <= GOOD_MS) return 'good';
  if (abs <= OK_MS) return 'ok';
  return null;
}

/**
 * Scores hits against expected stroke times. Each expected stroke can be
 * claimed once, by the closest hit inside the OK window. A hit that claims
 * nothing is a stray. An expected stroke nobody claims becomes a miss once
 * `sweep(now)` has passed its window.
 */
export function createScorer({ expected = [], latencyMs = 0 } = {}) {
  const slots = expected.map((at) => ({ at, state: 'open' }));
  const stats = { perfect: 0, good: 0, ok: 0, miss: 0, stray: 0 };
  const offsets = [];
  let latency = clampOffsetMs(latencyMs);

  function bump(grade) {
    stats[grade] += 1;
  }

  return {
    stats,
    setLatencyMs(ms) {
      latency = clampOffsetMs(ms);
    },
    /** Add more expected strokes, in time order, as the metronome runs on. */
    expect(times) {
      for (const at of times) slots.push({ at, state: 'open' });
    },
    hit(time) {
      const t = time - latency / 1000;
      let best = -1;
      let bestAbs = Infinity;
      for (let i = 0; i < slots.length; i += 1) {
        if (slots[i].state !== 'open') continue;
        const abs = Math.abs(t - slots[i].at) * 1000;
        if (abs < bestAbs) {
          bestAbs = abs;
          best = i;
        }
        if (slots[i].at - t > OK_MS / 1000) break;
      }
      if (best < 0 || bestAbs > OK_MS) {
        bump('stray');
        return { grade: 'stray', offsetMs: null, index: -1 };
      }
      const offsetMs = Math.round((t - slots[best].at) * 1000);
      const grade = gradeOffset(offsetMs);
      slots[best].state = grade;
      offsets.push(offsetMs);
      bump(grade);
      return { grade, offsetMs, index: best };
    },
    sweep(now) {
      const missed = [];
      for (let i = 0; i < slots.length; i += 1) {
        const slot = slots[i];
        if (slot.state === 'open' && now - latency / 1000 - slot.at > OK_MS / 1000) {
          slot.state = 'miss';
          bump('miss');
          missed.push(i);
        }
      }
      return missed;
    },
    summary() {
      return summarize(stats, offsets, slots.length);
    },
  };
}

export function summarize(stats, offsets, total) {
  const hits = stats.perfect + stats.good + stats.ok;
  const mean = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;
  const variance = offsets.length
    ? offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length
    : 0;
  const spread = Math.round(Math.sqrt(variance));
  const meanMs = Math.round(mean);
  let lean = 'centered';
  if (offsets.length >= 4) {
    if (meanMs > 12) lean = 'dragging';
    else if (meanMs < -12) lean = 'rushing';
  }
  return {
    total,
    hits,
    accuracy: total ? Math.round((hits / total) * 100) : 0,
    meanMs,
    spread,
    lean,
    stray: stats.stray,
  };
}

export function leanAdvice(summary) {
  if (summary.hits < 4) return 'Play a few more bars and the page will tell you which way you lean.';
  if (summary.lean === 'rushing') return `You are landing ${Math.abs(summary.meanMs)} ms early. Let the click arrive before you strike.`;
  if (summary.lean === 'dragging') return `You are landing ${summary.meanMs} ms late. Think of the stroke leaving the stick a touch sooner.`;
  if (summary.spread > 35) return 'On average you are centered, but the spread is wide. Slow the click down until it tightens.';
  return 'Centered and steady. Nudge the click up a few beats per minute.';
}

export function formatOffset(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms === 0) return 'on the beat';
  return ms > 0 ? `${ms} ms late` : `${Math.abs(ms)} ms early`;
}
