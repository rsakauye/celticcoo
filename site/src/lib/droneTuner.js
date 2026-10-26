// On-device Highland drone tuner math.
// Pitch is the McLeod pitch method (normalized square difference), with a
// fractional-lag search and a power check that rejects octave-up errors.
// Beats come from the amplitude of a heterodyned fundamental or harmonic.
// Nothing in this file touches the network, the microphone, or storage.

export const PITCH_MIN_HZ = 80;
export const PITCH_MAX_HZ = 600;
export const DEFAULT_LOW_A = 480;
export const PRESETS = [466, 470, 475, 480, 485];
export const LOW_A_MIN = 430;
export const LOW_A_MAX = 510;
export const GREEN_CENTS = 3;
export const AMBER_CENTS = 10;
export const METER_CENTS = 50;
export const WINCE_CENTS = 25;
export const HEAVY_BEAT_HZ = 2.5;
export const DEMO_START_CENTS = 28;

// Required false, not "ideal": the phone must not retune a drone the way it
// retunes a voice. The page retries with softer constraints only if a browser
// rejects these outright.
export const MIC_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 1 },
  },
  video: false,
};

export const STEPS = [
  {
    id: 'ref',
    title: 'Set the chanter',
    body: 'Pick the band’s low A, or play low A for 2 seconds and lock it. Tenors tune to half of that. The bass tunes to a quarter.',
  },
  {
    id: 'tenor1',
    title: 'Tenor 1',
    body: 'Stop the other drones. Sound the first tenor and slide it onto low A / 2.',
  },
  {
    id: 'tenor2',
    title: 'Tenor 2',
    body: 'Sound both tenors. Tune the second to the first. Beats slowing means getting closer. No wobble means locked.',
  },
  {
    id: 'bass',
    title: 'Bass',
    body: 'Sound the bass with the tenors. Tune it to low A / 4. Beats slowing means getting closer. No wobble means locked.',
  },
];

const CLARITY_RATIO = 0.93;
const MIN_CLARITY = 0.5;
const OCTAVE_POWER_RATIO = 1.35;
const MIN_OCTAVE_CLARITY = 0.55;

export function droneTargets(lowA) {
  return { lowA, tenor: lowA / 2, bass: lowA / 4 };
}

export function centsBetween(hz, targetHz) {
  if (!Number.isFinite(hz) || !Number.isFinite(targetHz) || hz <= 0 || targetHz <= 0) return null;
  return 1200 * Math.log2(hz / targetHz);
}

export function detuneHz(targetHz, cents) {
  return targetHz * 2 ** (cents / 1200);
}

export function meterZone(cents) {
  if (!Number.isFinite(cents)) return 'none';
  const abs = Math.abs(cents);
  if (abs <= GREEN_CENTS) return 'good';
  if (abs <= AMBER_CENTS) return 'close';
  return 'off';
}

export function formatHz(hz) {
  if (!Number.isFinite(hz)) return '—';
  return `${hz.toFixed(1)} Hz`;
}

/** Slider position for demo and by-ear. Near the top, so a phone is audible. */
export const DEFAULT_OUTPUT_LEVEL = 90;

/**
 * Master gain for the reference tones. The square makes the lower half of the
 * slider quiet and the default (near max) loud. The page runs this into a
 * compressor, so 1.0 is not required to avoid clipping.
 */
export function outputGain(levelPercent) {
  const raw = Number(levelPercent);
  if (!Number.isFinite(raw)) return 0;
  const t = Math.min(1, Math.max(0, raw / 100));
  return t * t * 0.95;
}

export function formatCents(cents) {
  if (!Number.isFinite(cents)) return 'No pitch yet';
  const abs = Math.abs(cents);
  if (abs < 0.35) return 'In tune';
  const n = abs.toFixed(1);
  return cents > 0 ? `${n} cents sharp` : `${n} cents flat`;
}

export function slideAdvice(cents) {
  if (!Number.isFinite(cents)) {
    return 'Sound a drone. The meter will say which way to move the tuning slide.';
  }
  if (Math.abs(cents) <= GREEN_CENTS) {
    return 'In tune. Leave the tuning slide where it is.';
  }
  if (cents > 0) {
    return 'Too sharp. Slide the top section up. A longer drone sounds lower.';
  }
  return 'Too flat. Slide the top section down. A shorter drone sounds higher.';
}

export function beatAdvice(result) {
  if (!result || !Number.isFinite(result.confidence) || result.confidence < 0.35) {
    return 'When two drones sound together, their beats show up here.';
  }
  if (result.locked || result.hz < 0.45) {
    return 'No wobble. That is locked. Beats slowing means getting closer.';
  }
  const rate = result.hz < 10 ? result.hz.toFixed(1) : result.hz.toFixed(0);
  return `${rate} beats per second. Beats slowing means getting closer. No wobble means locked.`;
}

export function describeReading(hz, lowA, { includeChanter = false } = {}) {
  if (!Number.isFinite(hz) || hz <= 0 || !Number.isFinite(lowA) || lowA <= 0) return null;
  const targets = droneTargets(lowA);
  const choices = [
    { id: 'bass', label: 'Bass drone', hz: targets.bass },
    { id: 'tenor', label: 'Tenor drone', hz: targets.tenor },
  ];
  if (includeChanter) choices.push({ id: 'chanter', label: 'Chanter low A', hz: targets.lowA });
  let best = null;
  for (const choice of choices) {
    const cents = centsBetween(hz, choice.hz);
    const abs = Math.abs(cents);
    if (!best || abs < best.abs) best = { ...choice, cents, abs };
  }
  return {
    hz,
    targetId: best.id,
    targetLabel: best.label,
    targetHz: best.hz,
    cents: best.cents,
    zone: meterZone(best.cents),
  };
}

export function cooMood({ cents, stable = false, beatHz = null, confidence = 0 } = {}) {
  if (!Number.isFinite(cents) || !(confidence > 0)) return 'wait';
  const heavy = Number.isFinite(beatHz) && beatHz >= HEAVY_BEAT_HZ;
  if (Math.abs(cents) > WINCE_CENTS || heavy) return 'wince';
  if (Math.abs(cents) <= GREEN_CENTS && stable && !heavy) return 'dance';
  return 'listen';
}

export function clampLowA(hz) {
  if (!Number.isFinite(hz)) return null;
  if (hz < LOW_A_MIN || hz > LOW_A_MAX) return null;
  return Math.round(hz * 10) / 10;
}

// Median of confident low-A readings. Outlier drones (an octave down) are ignored.
export function lockReference(readings, { minHz = 430, maxHz = 560, minCount = 5, minConfidence = 0.6 } = {}) {
  const freqs = [];
  for (const reading of readings) {
    if (!reading || !(reading.confidence >= minConfidence)) continue;
    const hz = reading.frequency;
    if (hz >= minHz && hz <= maxHz) freqs.push(hz);
  }
  if (freqs.length < minCount) return null;
  freqs.sort((a, b) => a - b);
  return clampLowA(freqs[Math.floor(freqs.length / 2)]);
}

export function createPitchTracker({ window = 5, minConfidence = 0.72 } = {}) {
  const buf = [];
  let hold = null;
  let holdAge = 0;
  return {
    reset() {
      buf.length = 0;
      hold = null;
      holdAge = 0;
    },
    push(det) {
      holdAge += 1;
      const stale = () => (hold && holdAge < 6 ? { ...hold, held: true } : { frequency: null, confidence: 0, stable: false, held: false });
      if (!det || !(det.confidence >= minConfidence) || !Number.isFinite(det.frequency)) return stale();
      const hz = det.frequency;
      if (buf.length >= 3) {
        const med = median(buf);
        const ratio = hz / med;
        const octaveFlip = (ratio > 1.9 && ratio < 2.1) || (ratio > 0.475 && ratio < 0.525);
        if (octaveFlip) return stale();
      }
      buf.push(hz);
      if (buf.length > window) buf.shift();
      const med = median(buf);
      let spread = 0;
      for (const value of buf) spread = Math.max(spread, Math.abs(centsBetween(value, med)));
      const stable = buf.length >= 4 && spread <= 4;
      hold = { frequency: med, confidence: det.confidence, stable, held: false, spread };
      holdAge = 0;
      return hold;
    },
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function decimationFactor(sampleRate) {
  let factor = 1;
  while (sampleRate / (factor + 1) >= 15000) factor += 1;
  return factor;
}

function lowpassFir(taps, cutoffFrac) {
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * cutoffFrac : Math.sin(2 * Math.PI * cutoffFrac * x) / (Math.PI * x);
    const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * win;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

function applyFirDecimate(x, h, factor) {
  const taps = h.length;
  const outLen = Math.floor((x.length - taps + 1) / factor);
  const y = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = i * factor;
    let acc = 0;
    for (let k = 0; k < taps; k++) acc += h[k] * x[start + k];
    y[i] = acc;
  }
  return y;
}

function prepare(input, sampleRate) {
  const x0 = new Float64Array(input.length);
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = +input[i];
    if (!Number.isFinite(v)) return null;
    x0[i] = v;
    sum += v;
  }
  const mean = sum / x0.length;
  let energy = 0;
  for (let i = 0; i < x0.length; i++) {
    x0[i] -= mean;
    energy += x0[i] * x0[i];
  }
  if (energy / x0.length < 1e-8) return null;
  const factor = decimationFactor(sampleRate);
  if (factor === 1) return { x: x0, sampleRate };
  const fir = lowpassFir(63, 0.42 / factor);
  const y = applyFirDecimate(x0, fir, factor);
  if (y.length < 256) return { x: x0, sampleRate };
  let yMean = 0;
  for (let i = 0; i < y.length; i++) yMean += y[i];
  yMean /= y.length;
  for (let i = 0; i < y.length; i++) y[i] -= yMean;
  return { x: y, sampleRate: sampleRate / factor };
}

function prefixSquares(x) {
  const prefix = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) prefix[i + 1] = prefix[i] + x[i] * x[i];
  return prefix;
}

function nsdfAt(x, prefix, tau) {
  const n = x.length;
  if (tau < 1 || tau > n - 2) return 0;
  const i0 = Math.floor(tau);
  const frac = tau - i0;
  if (frac < 1e-6) {
    const len = n - i0;
    let acf = 0;
    for (let i = 0; i < len; i++) acf += x[i] * x[i + i0];
    const m = prefix[len] + (prefix[n] - prefix[i0]);
    return m > 0 ? (2 * acf) / m : 0;
  }
  const len = n - i0 - 1;
  let acf = 0;
  let e2 = 0;
  const a = 1 - frac;
  for (let i = 0; i < len; i++) {
    const y = x[i + i0] * a + x[i + i0 + 1] * frac;
    acf += x[i] * y;
    e2 += y * y;
  }
  const m = prefix[len] + e2;
  return m > 0 ? (2 * acf) / m : 0;
}

function goertzelPower(x, sampleRate, freq) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function refineTau(x, prefix, tau) {
  let lo = Math.max(1.05, tau - 0.8);
  let hi = Math.min(x.length - 2.05, tau + 0.8);
  for (let i = 0; i < 16; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (nsdfAt(x, prefix, m1) < nsdfAt(x, prefix, m2)) lo = m1;
    else hi = m2;
  }
  return (lo + hi) / 2;
}

export function detectPitch(input, sampleRate, opts = {}) {
  if (!input || input.length < 128 || !Number.isFinite(sampleRate) || sampleRate < 2000) return null;
  const minHz = opts.minHz ?? PITCH_MIN_HZ;
  const maxHz = opts.maxHz ?? PITCH_MAX_HZ;
  const prepared = prepare(input, sampleRate);
  if (!prepared) return null;
  const { x } = prepared;
  const sr = prepared.sampleRate;
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(x.length - 3, Math.ceil(sr / minHz));
  if (tauMax <= tauMin + 2) return null;

  const prefix = prefixSquares(x);
  const nsdf = new Float64Array(tauMax + 2);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    nsdf[tau] = nsdfAt(x, prefix, tau);
  }

  const peaks = [];
  for (let tau = tauMin + 1; tau < tauMax; tau++) {
    if (nsdf[tau] > 0 && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1] && nsdf[tau] > nsdf[tau - 1]) {
      peaks.push(tau);
    }
  }
  if (!peaks.length) return null;

  let maxVal = 0;
  for (const tau of peaks) if (nsdf[tau] > maxVal) maxVal = nsdf[tau];
  if (maxVal < MIN_CLARITY) return null;
  const gate = maxVal * CLARITY_RATIO;
  let chosen = 0;
  for (const tau of peaks) {
    if (nsdf[tau] >= gate) {
      chosen = tau;
      break;
    }
  }
  if (!chosen) return null;

  let tau = refineTau(x, prefix, chosen);
  let freq = sr / tau;
  let clarity = nsdf[chosen];

  // Octave-up errors land on a harmonic. Only step downward, and only when
  // that lower frequency really has more power and a clear period.
  for (let hop = 0; hop < 3; hop++) {
    const down = freq / 2;
    if (down < minHz) break;
    const pDown = goertzelPower(x, sr, down);
    const pHere = goertzelPower(x, sr, freq);
    if (!(pDown > pHere * OCTAVE_POWER_RATIO)) break;
    const tauDown = sr / down;
    if (tauDown > tauMax) break;
    const downClarity = nsdfAt(x, prefix, tauDown);
    if (downClarity < MIN_OCTAVE_CLARITY) break;
    freq = sr / refineTau(x, prefix, tauDown);
    clarity = downClarity;
  }

  if (freq < minHz || freq > maxHz) return null;
  clarity = Math.max(clarity, nsdfAt(x, prefix, sr / freq));
  if (clarity < MIN_CLARITY) return null;
  return { frequency: freq, confidence: Math.min(1, clarity) };
}

export function steadyPitch(samples, sampleRate, opts = {}) {
  const win = Math.min(samples.length, opts.window ?? Math.round(sampleRate * 0.5));
  const hop = opts.hop ?? Math.round(sampleRate * 0.08);
  const minConfidence = opts.minConfidence ?? 0.55;
  if (win < 128 || samples.length < win) return null;
  const readings = [];
  for (let i = 0; i + win <= samples.length; i += hop) {
    const det = detectPitch(samples.subarray(i, i + win), sampleRate, opts);
    if (det && det.confidence >= minConfidence) readings.push(det.frequency);
  }
  if (readings.length < 3) return null;
  const frequency = median(readings);
  let spread = 0;
  for (const hz of readings) spread = Math.max(spread, Math.abs(centsBetween(hz, frequency)));
  return { frequency, frames: readings.length, spread };
}

function heterodynePower(x, sampleRate, freq, cutoff, outRate) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  const b = 1 - a;
  const keepEvery = Math.max(1, Math.round(sampleRate / outRate));
  const out = [];
  let i1 = 0;
  let i2 = 0;
  let i3 = 0;
  let i4 = 0;
  let q1 = 0;
  let q2 = 0;
  let q3 = 0;
  let q4 = 0;
  const omega = (2 * Math.PI * freq) / sampleRate;
  let cos = 1;
  let sin = 0;
  const stepCos = Math.cos(omega);
  const stepSin = Math.sin(omega);
  for (let n = 0; n < x.length; n++) {
    const iv = x[n] * cos;
    const qv = x[n] * sin;
    const nextCos = cos * stepCos - sin * stepSin;
    const nextSin = sin * stepCos + cos * stepSin;
    cos = nextCos;
    sin = nextSin;
    i1 = a * i1 + b * iv;
    i2 = a * i2 + b * i1;
    i3 = a * i3 + b * i2;
    i4 = a * i4 + b * i3;
    q1 = a * q1 + b * qv;
    q2 = a * q2 + b * q1;
    q3 = a * q3 + b * q2;
    q4 = a * q4 + b * q3;
    if (n % keepEvery === 0) out.push(i4 * i4 + q4 * q4);
  }
  return { samples: Float64Array.from(out), sampleRate: sampleRate / keepEvery };
}

function envelopeRate(env, envRate, minHz, maxHz) {
  const skip = Math.min(Math.max(0, env.length - 16), Math.round(envRate * 0.22));
  if (env.length - skip < 24) return null;
  const y = env.subarray(skip);
  let mean = 0;
  for (let i = 0; i < y.length; i++) mean += y[i];
  mean /= y.length;
  if (!(mean > 0)) return null;
  let varSum = 0;
  const centered = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) {
    centered[i] = y[i] - mean;
    varSum += centered[i] * centered[i];
  }
  const mod = Math.sqrt(varSum / y.length) / mean;
  const power = mean;
  if (mod < 0.07) return { hz: 0, confidence: 0.8, mod, power, locked: true };

  const prefix = prefixSquares(centered);
  const tauMin = Math.max(2, Math.floor(envRate / maxHz));
  const tauMax = Math.min(centered.length - 3, Math.ceil(envRate / minHz));
  if (tauMax <= tauMin + 2) return null;
  const nsdf = new Float64Array(tauMax + 2);
  let maxVal = 0;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    const value = nsdfAt(centered, prefix, tau);
    nsdf[tau] = value;
    if (value > maxVal) maxVal = value;
  }
  if (maxVal < 0.4) return { hz: 0, confidence: maxVal, mod, power, locked: mod < 0.12 };
  const gate = maxVal * 0.9;
  let chosen = 0;
  for (let tau = tauMin + 1; tau < tauMax; tau++) {
    if (nsdf[tau] >= gate && nsdf[tau] >= nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1] && nsdf[tau] > nsdf[tau - 1]) {
      chosen = tau;
      break;
    }
  }
  if (!chosen) return { hz: 0, confidence: maxVal, mod, power, locked: false };
  const tau = refineTau(centered, prefix, chosen);
  const hz = envRate / tau;
  if (hz < minHz || hz > maxHz) return { hz: 0, confidence: maxVal, mod, power, locked: false };
  return { hz, confidence: Math.min(1, nsdf[chosen]), mod, power, locked: false };
}

export function estimateBeatRate(samples, sampleRate, opts = {}) {
  if (!samples || samples.length < sampleRate * 0.6 || !Number.isFinite(sampleRate)) {
    return { hz: 0, confidence: 0, locked: false };
  }
  const targetHz = opts.targetHz;
  if (!Number.isFinite(targetHz) || targetHz <= 0) return { hz: 0, confidence: 0, locked: false };
  const minHz = opts.minHz ?? 0.4;
  const maxHz = opts.maxHz ?? 12;
  const outRate = 200;
  let bestBeat = null;
  let strongest = null;
  for (const harmonic of [1, 2, 3]) {
    const carrier = targetHz * harmonic;
    if (carrier >= sampleRate * 0.45) continue;
    const env = heterodynePower(samples, sampleRate, carrier, Math.max(28, maxHz * 1.8), outRate);
    const est = envelopeRate(env.samples, env.sampleRate, minHz, maxHz * harmonic);
    if (!est || !(est.power > 0)) continue;
    if (!strongest || est.power > strongest.power) strongest = { ...est, harmonic };
    if (!est.locked && est.mod >= 0.08 && est.confidence >= 0.45) {
      const candidate = {
        hz: est.hz / harmonic,
        confidence: est.confidence,
        power: est.power,
        mod: est.mod,
      };
      if (!bestBeat || candidate.power > bestBeat.power) bestBeat = candidate;
    }
  }
  if (bestBeat && (!strongest || bestBeat.power >= strongest.power * 0.2)) {
    return { hz: bestBeat.hz, confidence: bestBeat.confidence, locked: false };
  }
  if (strongest && strongest.mod < 0.08) return { hz: 0, confidence: strongest.confidence, locked: true };
  return { hz: 0, confidence: strongest ? strongest.confidence : 0, locked: false };
}
