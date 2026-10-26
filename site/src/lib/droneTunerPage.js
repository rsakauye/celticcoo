// Browser half of the drone tuner. Audio is created on a tap, analysed here,
// and never stored or uploaded. iOS only unlocks sound if resume() runs in
// the gesture itself, before any await.

import {
  DEMO_START_CENTS,
  GREEN_CENTS,
  MIC_CONSTRAINTS,
  beatAdvice,
  cooMood,
  createPitchTracker,
  describeReading,
  detectPitch,
  detuneHz,
  droneTargets,
  estimateBeatRate,
  formatCents,
  formatHz,
  lockReference,
  slideAdvice,
} from './droneTuner.js';

const PITCH_SECONDS = 0.48;
const BEAT_SECONDS = 2.6;

export function mountTuner(root) {
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const q = (sel) => root.querySelector(sel);
  const meter = q('[data-meter]');
  const readout = q('[data-readout]');
  const needle = q('[data-needle]');
  const strobe = q('[data-strobe]');
  const centsEl = q('[data-cents-text]');
  const hzEl = q('[data-hz]');
  const targetEl = q('[data-target]');
  const adviceEl = q('[data-advice]');
  const beatEl = q('[data-beat]');
  const moodEl = q('[data-mood-text]');
  const mascot = q('[data-tune-coo]');
  const live = q('[data-live]');
  const errorEl = q('[data-error]');
  const startBtn = q('[data-start]');
  const demoBtn = q('[data-demo]');
  const earBtn = q('[data-ear]');
  const captureBtn = q('[data-capture]');
  const captureNote = q('[data-capture-note]');
  const lowAInput = q('[data-low-a]');
  const detune = q('[data-detune]');
  const detuneOut = q('[data-detune-out]');
  const level = q('[data-level]');
  const demoPanel = q('[data-demo-panel]');
  const presetButtons = [...root.querySelectorAll('[data-preset]')];
  const stepButtons = [...root.querySelectorAll('[data-step]')];

  let ctx = null;
  let unlocked = false;
  let pitchProc = null;
  let beatProc = null;
  let silent = null;
  let keeper = null;
  let pitchRing = null;
  let beatRing = null;
  let pitchBuf = null;
  let beatBuf = null;
  let pitchIn = null;
  let beatIn = null;
  let micStream = null;
  let micNode = null;
  let demo = null;
  let byEar = null;
  let mode = 'idle';
  let lowA = Number(lowAInput && lowAInput.value) || 480;
  let step = 0;
  let looping = false;
  let dirty = false;
  let lastPitchAt = 0;
  let lastBeatAt = 0;
  let lastAnnounce = 0;
  let lastSpoken = '';
  let lastBeat = null;
  let lastReading = null;
  let lastTracked = null;
  let capturing = null;
  let captureTimer = 0;
  let micPending = false;
  const tracker = createPitchTracker();

  function setError(message) {
    if (!errorEl) return;
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function announce(text) {
    if (live && text && text !== lastSpoken) {
      live.textContent = text;
      lastSpoken = text;
    }
  }

  function levelGain() {
    const raw = level ? Number(level.value) : 40;
    const t = Number.isFinite(raw) ? raw / 100 : 0.4;
    return 0.02 + t * 0.14;
  }

  function ensureContext() {
    if (!AudioCtx) return null;
    try {
      if (!ctx) {
        ctx = new AudioCtx();
        silent = ctx.createGain();
        silent.gain.value = 0;
        silent.connect(ctx.destination);
        const rate = ctx.sampleRate || 48000;
        pitchRing = createRing(Math.ceil(rate * 1.2));
        beatRing = createRing(Math.ceil(rate * (BEAT_SECONDS + 0.4)));
        pitchBuf = new Float32Array(Math.ceil(rate * (PITCH_SECONDS + 0.05)));
        beatBuf = new Float32Array(Math.ceil(rate * (BEAT_SECONDS + 0.05)));
        pitchProc = makeProcessor(ctx, pitchRing);
        beatProc = makeProcessor(ctx, beatRing);
        pitchProc.connect(silent);
        beatProc.connect(silent);
        // Keeps the processors running before the mic or the demo is attached.
        // The gain is zero, so this oscillator is never heard.
        const keep = ctx.createOscillator();
        const keepGain = ctx.createGain();
        keepGain.gain.value = 0;
        keep.connect(keepGain);
        keepGain.connect(pitchProc);
        keepGain.connect(beatProc);
        keep.start();
        keeper = keep;
      }
      // iOS leaves a new context suspended. resume() has to run in this turn.
      ctx.resume();
      if (!unlocked) {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start(0);
        unlocked = true;
      }
      if (!looping) {
        looping = true;
        requestAnimationFrame(loop);
      }
      return ctx;
    } catch (err) {
      setError('This browser blocked Web Audio, so the tuner cannot listen or play a reference.');
      return null;
    }
  }

  function makeProcessor(audio, ring) {
    const size = 4096;
    const proc = audio.createScriptProcessor
      ? audio.createScriptProcessor(size, 1, 1)
      : audio.createJavaScriptNode(size, 1, 1);
    proc.onaudioprocess = (event) => {
      ring.push(event.inputBuffer.getChannelData(0));
      event.outputBuffer.getChannelData(0).fill(0);
      dirty = true;
    };
    return proc;
  }

  function feed(proc, current, next) {
    if (current === next) return current;
    if (current) {
      try { current.disconnect(proc); } catch (e) { /* already gone */ }
    }
    if (next) next.connect(proc);
    return next;
  }

  function makeReed(frequency, cutoff) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.65;
    const gain = ctx.createGain();
    gain.gain.value = 0.55;
    osc.connect(filter);
    filter.connect(gain);
    return { osc, filter, gain };
  }

  function applyLevel() {
    const gain = levelGain();
    const now = ctx ? ctx.currentTime : 0;
    if (demo) demo.master.gain.setTargetAtTime(gain, now, 0.03);
    if (byEar) byEar.master.gain.setTargetAtTime(gain * 0.7, now, 0.03);
  }

  function stopDemo() {
    if (!demo) return;
    const gone = demo;
    demo = null;
    const now = ctx.currentTime;
    try {
      gone.master.gain.cancelScheduledValues(now);
      gone.master.gain.setValueAtTime(Math.max(gone.master.gain.value, 0.0001), now);
      gone.master.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    } catch (e) { /* context already closed */ }
    window.setTimeout(() => {
      try { gone.ref.osc.stop(); } catch (e) { /* already stopped */ }
      try { gone.live.osc.stop(); } catch (e) { /* already stopped */ }
      try { gone.pitchTap.disconnect(); } catch (e) { /* already stopped */ }
      try { gone.mix.disconnect(); } catch (e) { /* already stopped */ }
      try { gone.master.disconnect(); } catch (e) { /* already stopped */ }
    }, 60);
    if (pitchIn === gone.pitchTap) pitchIn = null;
    if (beatIn === gone.mix) beatIn = null;
  }

  function stopByEar() {
    if (!byEar) return;
    const gone = byEar;
    byEar = null;
    const now = ctx.currentTime;
    try {
      gone.master.gain.cancelScheduledValues(now);
      gone.master.gain.setValueAtTime(Math.max(gone.master.gain.value, 0.0001), now);
      gone.master.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    } catch (e) { /* context already closed */ }
    window.setTimeout(() => {
      try { gone.tenor.osc.stop(); } catch (e) { /* already stopped */ }
      try { gone.bass.osc.stop(); } catch (e) { /* already stopped */ }
      try { gone.master.disconnect(); } catch (e) { /* already stopped */ }
    }, 60);
    if (earBtn) {
      earBtn.setAttribute('aria-pressed', 'false');
      earBtn.textContent = 'By-ear mode';
    }
  }

  function stopMic() {
    if (micNode) {
      try { micNode.disconnect(); } catch (e) { /* already stopped */ }
      if (pitchIn === micNode) pitchIn = null;
      if (beatIn === micNode) beatIn = null;
      micNode = null;
    }
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop();
      micStream = null;
    }
  }

  function resetRings() {
    if (pitchRing) pitchRing.reset();
    if (beatRing) beatRing.reset();
    tracker.reset();
    lastBeat = null;
    lastReading = null;
    lastTracked = null;
  }

  function startDemo() {
    if (!ensureContext()) {
      setError('This browser cannot play sound, so demo mode is unavailable.');
      return;
    }
    setError('');
    stopMic();
    stopByEar();
    stopDemo();
    const targets = droneTargets(lowA);
    const cents = detune ? Number(detune.value) : DEMO_START_CENTS;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    const mix = ctx.createGain();
    mix.connect(master);
    const ref = makeReed(targets.tenor, 1100);
    const live = makeReed(detuneHz(targets.tenor, cents), 1100);
    ref.gain.connect(mix);
    live.gain.connect(mix);
    const pitchTap = ctx.createGain();
    live.gain.connect(pitchTap);
    pitchIn = feed(pitchProc, pitchIn, pitchTap);
    beatIn = feed(beatProc, beatIn, mix);
    ref.osc.start();
    live.osc.start();
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(levelGain(), now + 0.04);
    demo = { master, mix, ref, live, pitchTap };
    mode = 'demo';
    resetRings();
    if (demoPanel) demoPanel.hidden = false;
    if (demoBtn) {
      demoBtn.setAttribute('aria-pressed', 'true');
      demoBtn.textContent = 'Stop demo';
    }
    if (startBtn) {
      startBtn.setAttribute('aria-pressed', 'false');
      startBtn.textContent = 'Start tuning';
    }
    if (centsEl) centsEl.textContent = 'Listening…';
    announce('Demo mode. Two tenor drones are playing. Drag detune toward the middle.');
    renderDetuneLabel();
  }

  function leaveDemo() {
    stopDemo();
    if (mode === 'demo') mode = 'idle';
    if (demoPanel) demoPanel.hidden = true;
    if (demoBtn) {
      demoBtn.setAttribute('aria-pressed', 'false');
      demoBtn.textContent = 'Try demo mode';
    }
    renderIdle();
  }

  async function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error('no-mic');
      err.code = 'no-mic';
      throw err;
    }
    const softer = {
      audio: {
        echoCancellation: { ideal: false },
        noiseSuppression: { ideal: false },
        autoGainControl: { ideal: false },
      },
      video: false,
    };
    let last = null;
    for (const constraints of [MIC_CONSTRAINTS, softer, { audio: true }]) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        last = err;
      }
    }
    throw last || new Error('mic');
  }

  async function startMic() {
    if (!ensureContext()) {
      setError('This browser cannot open the microphone.');
      return;
    }
    if (micPending) return;
    micPending = true;
    setError('');
    stopDemo();
    if (demoPanel) demoPanel.hidden = true;
    if (demoBtn) {
      demoBtn.setAttribute('aria-pressed', 'false');
      demoBtn.textContent = 'Try demo mode';
    }
    if (startBtn) startBtn.textContent = 'Waiting for the microphone…';
    try {
      const stream = await openMic();
      if (mode === 'demo') {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      stopMic();
      micStream = stream;
      micNode = ctx.createMediaStreamSource(stream);
      pitchIn = feed(pitchProc, pitchIn, micNode);
      beatIn = feed(beatProc, beatIn, micNode);
      mode = 'mic';
      resetRings();
      if (startBtn) {
        startBtn.setAttribute('aria-pressed', 'true');
        startBtn.textContent = 'Stop tuning';
      }
      if (centsEl) centsEl.textContent = 'Listening…';
      announce('Listening. Sound one drone at a time, close to the phone.');
    } catch (err) {
      mode = byEar ? mode : 'idle';
      if (startBtn) {
        startBtn.setAttribute('aria-pressed', 'false');
        startBtn.textContent = 'Start tuning';
      }
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setError(denied
        ? 'The microphone is blocked. You can still use demo mode, or by-ear mode with headphones.'
        : 'The microphone did not open. You can still use demo mode.');
    } finally {
      micPending = false;
    }
  }

  function stopListening() {
    stopMic();
    if (mode === 'mic') mode = 'idle';
    if (startBtn) {
      startBtn.setAttribute('aria-pressed', 'false');
      startBtn.textContent = 'Start tuning';
    }
    window.clearInterval(captureTimer);
    capturing = null;
    if (captureNote) captureNote.textContent = '';
    renderIdle();
  }

  function startByEar() {
    if (mode === 'demo') {
      announce('Demo already plays a reference drone. Stop demo before by-ear mode.');
      return;
    }
    if (!ensureContext()) {
      setError('This browser cannot play a reference drone.');
      return;
    }
    if (byEar) {
      stopByEar();
      announce('By-ear reference stopped.');
      return;
    }
    const targets = droneTargets(lowA);
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    const tenor = makeReed(targets.tenor, 1000);
    const bass = makeReed(targets.bass, 650);
    tenor.gain.gain.value = 0.42;
    bass.gain.gain.value = 0.58;
    tenor.gain.connect(master);
    bass.gain.connect(master);
    tenor.osc.start();
    bass.osc.start();
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(levelGain() * 0.7, now + 0.05);
    byEar = { master, tenor, bass };
    if (earBtn) {
      earBtn.setAttribute('aria-pressed', 'true');
      earBtn.textContent = 'Stop by-ear';
    }
    announce('By-ear reference is playing. Tenor at low A over 2, bass at low A over 4. Headphones keep it out of the meter.');
  }

  function syncSynths() {
    if (!ctx) return;
    const targets = droneTargets(lowA);
    const now = ctx.currentTime;
    if (byEar) {
      byEar.tenor.osc.frequency.setTargetAtTime(targets.tenor, now, 0.04);
      byEar.bass.osc.frequency.setTargetAtTime(targets.bass, now, 0.04);
    }
    if (demo) {
      const cents = detune ? Number(detune.value) : 0;
      demo.ref.osc.frequency.setTargetAtTime(targets.tenor, now, 0.03);
      demo.live.osc.frequency.setTargetAtTime(detuneHz(targets.tenor, cents), now, 0.03);
    }
  }

  function setLowA(hz) {
    if (!Number.isFinite(hz)) return;
    lowA = hz;
    if (lowAInput) lowAInput.value = String(Math.round(hz * 10) / 10);
    for (const button of presetButtons) {
      const match = Number(button.dataset.preset) === Math.round(hz);
      button.setAttribute('aria-pressed', match ? 'true' : 'false');
    }
    syncSynths();
    if (lastTracked) renderPitch(lastTracked);
  }

  function renderDetuneLabel() {
    if (!detuneOut || !detune) return;
    detuneOut.textContent = formatCents(Number(detune.value));
  }

  function renderIdle() {
    if (mascot) mascot.dataset.mood = 'wait';
    if (moodEl) moodEl.textContent = 'Ceilidh is waiting for a drone.';
    if (centsEl) centsEl.textContent = 'No pitch yet';
    if (hzEl) hzEl.textContent = '—';
    if (targetEl) targetEl.textContent = 'Sound a tenor or the bass';
    if (adviceEl) adviceEl.textContent = slideAdvice(null);
    if (beatEl) beatEl.textContent = beatAdvice(null);
    if (meter) {
      meter.dataset.zone = 'none';
      meter.dataset.dir = 'locked';
      meter.setAttribute('aria-valuenow', '0');
      meter.setAttribute('aria-valuetext', 'No pitch yet');
      meter.style.setProperty('--cents', '0');
    }
    if (readout) readout.dataset.zone = 'none';
    if (needle) needle.style.left = '50%';
  }

  function moodCopy(mood) {
    if (mood === 'dance') return 'Ceilidh is dancing. That drone is locked.';
    if (mood === 'wince') return 'Ceilidh has her hooves over her ears. Still a way off.';
    if (mood === 'listen') return 'Ceilidh is listening. Keep sliding.';
    return 'Ceilidh is waiting for a drone.';
  }

  function renderPitch(tracked) {
    const includeChanter = Boolean(capturing) || step === 0;
    const reading = tracked && Number.isFinite(tracked.frequency)
      ? describeReading(tracked.frequency, lowA, { includeChanter })
      : null;
    lastReading = reading;
    const beatHz = lastBeat ? (lastBeat.locked ? 0 : lastBeat.hz) : null;
    const confidence = reading ? (tracked.confidence || 0.8) : 0;
    const mood = cooMood({
      cents: reading ? reading.cents : null,
      stable: Boolean(tracked && tracked.stable && reading),
      beatHz: lastBeat && lastBeat.confidence >= 0.35 ? beatHz : null,
      confidence,
    });
    if (mascot) mascot.dataset.mood = reading ? mood : 'wait';
    if (moodEl) moodEl.textContent = reading ? moodCopy(mood) : moodCopy('wait');
    if (!reading) {
      if (centsEl) centsEl.textContent = 'Listening…';
      if (adviceEl && !capturing) adviceEl.textContent = slideAdvice(null);
      if (meter) {
        meter.dataset.zone = 'none';
        meter.setAttribute('aria-valuetext', 'Listening, no steady pitch yet');
      }
      if (readout) readout.dataset.zone = 'none';
      return;
    }
    const shown = Math.max(-50, Math.min(50, reading.cents));
    const dir = reading.cents > 0.8 ? 'sharp' : reading.cents < -0.8 ? 'flat' : 'locked';
    if (readout) readout.dataset.zone = reading.zone;
    if (meter) {
      meter.dataset.zone = reading.zone;
      meter.dataset.dir = dir;
      meter.style.setProperty('--cents', shown.toFixed(2));
      meter.setAttribute('aria-valuenow', shown.toFixed(1));
      meter.setAttribute('aria-valuetext', `${formatCents(reading.cents)}. ${reading.targetLabel}, target ${formatHz(reading.targetHz)}.`);
    }
    if (strobe) {
      const mag = Math.abs(reading.cents);
      strobe.style.animationDuration = `${Math.min(1.5, Math.max(0.22, 7 / Math.max(mag, 0.8))).toFixed(2)}s`;
    }
    if (needle) needle.style.left = `${50 + (shown / 50) * 50}%`;
    if (centsEl) centsEl.textContent = formatCents(reading.cents);
    if (hzEl) hzEl.textContent = formatHz(reading.hz);
    if (targetEl) targetEl.textContent = `${reading.targetLabel} · target ${formatHz(reading.targetHz)}`;
    if (adviceEl) adviceEl.textContent = slideAdvice(reading.cents);
    const now = performance.now();
    const spoken = `${formatCents(reading.cents)}. ${reading.targetLabel}. ${slideAdvice(reading.cents)}`;
    if (now - lastAnnounce > 1600 && spoken !== lastSpoken) {
      lastAnnounce = now;
      announce(spoken);
    }
  }

  function renderBeat() {
    if (beatEl) beatEl.textContent = beatAdvice(lastBeat);
  }

  function beatTarget() {
    const targets = droneTargets(lowA);
    if (lastReading && lastReading.targetId === 'bass') return targets.bass;
    if (lastReading && lastReading.targetId === 'chanter') return targets.lowA;
    if (step === 3) return targets.bass;
    return targets.tenor;
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!dirty || !ctx) return;
    const now = performance.now();
    const active = mode === 'mic' || mode === 'demo' || capturing;
    if (!active) {
      dirty = false;
      return;
    }
    if (now - lastPitchAt > 110 && pitchRing.filled() > ctx.sampleRate * 0.28) {
      lastPitchAt = now;
      const n = Math.min(pitchBuf.length, Math.round(ctx.sampleRate * PITCH_SECONDS), pitchRing.filled());
      pitchRing.copyLatest(pitchBuf, n);
      const det = detectPitch(pitchBuf.subarray(0, n), ctx.sampleRate);
      if (capturing) capturing.readings.push(det || { frequency: 0, confidence: 0 });
      lastTracked = tracker.push(det);
      renderPitch(lastTracked);
    }
    if (now - lastBeatAt > 420 && beatRing.filled() > ctx.sampleRate * 1.05) {
      lastBeatAt = now;
      const n = Math.min(beatBuf.length, Math.round(ctx.sampleRate * BEAT_SECONDS), beatRing.filled());
      beatRing.copyLatest(beatBuf, n);
      lastBeat = estimateBeatRate(beatBuf.subarray(0, n), ctx.sampleRate, { targetHz: beatTarget() });
      renderBeat();
      if (lastTracked) renderPitch(lastTracked);
    }
    dirty = false;
  }

  function beginCaptureWindow() {
    window.clearInterval(captureTimer);
    capturing = { until: performance.now() + 2000, readings: [] };
    if (captureBtn) captureBtn.disabled = true;
    captureTimer = window.setInterval(() => {
      if (!capturing) return;
      const left = Math.max(0, capturing.until - performance.now());
      if (captureNote) captureNote.textContent = `Listening for low A… ${Math.ceil(left / 1000)} s`;
      if (left <= 0) finishCapture();
    }, 100);
  }

  function finishCapture() {
    window.clearInterval(captureTimer);
    const readings = capturing ? capturing.readings : [];
    capturing = null;
    if (captureBtn) captureBtn.disabled = false;
    const locked = lockReference(readings);
    if (!locked) {
      if (captureNote) captureNote.textContent = 'No steady low A yet. Hold a steady low A a little closer and try again.';
      announce('No steady low A yet.');
      return;
    }
    setLowA(locked);
    if (captureNote) captureNote.textContent = `Low A locked at ${locked.toFixed(1)} Hz.`;
    announce(`Low A locked at ${locked.toFixed(1)} hertz.`);
  }

  function onStart() {
    if (mode === 'mic') stopListening();
    else startMic();
  }

  function onDemo() {
    if (mode === 'demo') leaveDemo();
    else startDemo();
  }

  function onCapture() {
    ensureContext();
    if (mode === 'demo') {
      if (captureNote) captureNote.textContent = 'Set from chanter uses the microphone. Stop demo, then play low A.';
      return;
    }
    if (mode !== 'mic') {
      startMic().then(() => {
        if (mode === 'mic') beginCaptureWindow();
      });
      return;
    }
    beginCaptureWindow();
  }

  function showStep(next) {
    step = Math.max(0, Math.min(stepButtons.length - 1, next));
    stepButtons.forEach((button, index) => {
      const on = index === step;
      button.setAttribute('aria-current', on ? 'step' : 'false');
      button.classList.toggle('is-current', on);
    });
  }

  if (startBtn) startBtn.addEventListener('click', onStart);
  if (demoBtn) demoBtn.addEventListener('click', onDemo);
  if (earBtn) earBtn.addEventListener('click', startByEar);
  if (captureBtn) captureBtn.addEventListener('click', onCapture);
  if (level) level.addEventListener('input', () => { if (ctx) applyLevel(); });
  if (detune) {
    detune.addEventListener('input', () => {
      renderDetuneLabel();
      syncSynths();
      tracker.reset();
      lastTracked = null;
      // Drop the old wobble, or Ceilidh keeps wincing at a beat that already stopped.
      lastBeat = null;
      if (beatRing) beatRing.reset();
      if (beatEl) beatEl.textContent = 'Listening for beats…';
    });
  }
  if (lowAInput) {
    lowAInput.addEventListener('change', () => {
      const hz = Number(lowAInput.value);
      if (hz < 430 || hz > 510) {
        lowAInput.setAttribute('aria-invalid', 'true');
        lowAInput.value = String(lowA);
        return;
      }
      lowAInput.removeAttribute('aria-invalid');
      setLowA(Math.round(hz * 10) / 10);
    });
  }
  for (const button of presetButtons) {
    button.addEventListener('click', () => setLowA(Number(button.dataset.preset)));
  }
  stepButtons.forEach((button, index) => {
    button.addEventListener('click', () => showStep(index));
  });
  const prev = q('[data-step-prev]');
  const next = q('[data-step-next]');
  if (prev) prev.addEventListener('click', () => showStep(step - 1));
  if (next) next.addEventListener('click', () => showStep(step + 1));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && (mode !== 'idle' || byEar)) ctx.resume();
  });
  window.addEventListener('pagehide', () => {
    stopMic();
    stopDemo();
    stopByEar();
  });

  renderDetuneLabel();
  renderIdle();
  showStep(0);
}

function createRing(capacity) {
  const data = new Float32Array(capacity);
  let write = 0;
  let filled = 0;
  return {
    filled: () => filled,
    reset() {
      write = 0;
      filled = 0;
    },
    push(chunk) {
      for (let i = 0; i < chunk.length; i++) {
        data[write] = chunk[i];
        write += 1;
        if (write === capacity) write = 0;
      }
      filled = Math.min(capacity, filled + chunk.length);
    },
    copyLatest(target, n) {
      const count = Math.min(n, filled, target.length);
      let start = write - count;
      if (start < 0) start += capacity;
      for (let i = 0; i < count; i++) {
        let idx = start + i;
        if (idx >= capacity) idx -= capacity;
        target[i] = data[idx];
      }
      return count;
    },
  };
}
