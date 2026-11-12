// Browser half of drum practice. Audio is created on a tap, analysed here,
// and never stored or uploaded. iOS only unlocks sound if resume() runs in
// the gesture itself, before any await. The microphone is optional: the pad
// button and the space bar work as stand-in drumsticks.

import {
  BEATS_PER_BAR,
  COUNT_IN_BEATS,
  MIC_CONSTRAINTS,
  OK_MS,
  SENSITIVITY_DEFAULT,
  beatSeconds,
  clampBpm,
  clampOffsetMs,
  createOnsetDetector,
  createScorer,
  estimateLatency,
  formatOffset,
  gridTimes,
  leanAdvice,
  rudimentById,
  sensitivityToRatio,
  sticking,
} from './drumPractice.js';
import { LOOKAHEAD_BEATS, createMarch } from './drumMarch.js';
import { mountMarchView, reducedMotion } from './drumMarchView.js';

const LOOKAHEAD = 0.15;
const TICK_MS = 25;
const MAX_TICKS = 16;
const CALIBRATION_CLICKS = 8;
const CALIBRATION_GAP = 0.5;

export function mountDrum(root) {
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const q = (sel) => root.querySelector(sel);
  const startBtn = q('[data-start]');
  const padBtn = q('[data-pad]');
  const calibrateBtn = q('[data-calibrate]');
  const bpmInput = q('[data-bpm]');
  const bpmOut = q('[data-bpm-out]');
  const bpmDown = q('[data-bpm-down]');
  const bpmUp = q('[data-bpm-up]');
  const rudimentSelect = q('[data-rudiment]');
  const strokesEl = q('[data-strokes]');
  const noteEl = q('[data-rudiment-note]');
  const offsetInput = q('[data-offset]');
  const offsetOut = q('[data-offset-out]');
  const sensInput = q('[data-sens]');
  const levelInput = q('[data-level]');
  const meterTrack = q('[data-ticks]');
  const meter = q('[data-meter]');
  const lastEl = q('[data-last]');
  const countEl = q('[data-count]');
  const adviceEl = q('[data-advice]');
  const statusEl = q('[data-status]');
  const errorEl = q('[data-error]');
  const live = q('[data-live]');
  const beatCue = q('[data-beatcue]');
  const beatText = q('[data-beat-text]');
  const beatCells = [...root.querySelectorAll('[data-beat]')];
  const worklet = root.dataset.worklet;
  // Ceilidh's march. It is an extra view of the same scored hits: the scorer, the
  // detector and the timing windows are not touched by it.
  const march = createMarch();
  const marchView = mountMarchView(q('[data-march]'));

  const state = {
    ctx: null,
    stream: null,
    source: null,
    node: null,
    sink: null,
    timer: 0,
    running: false,
    micOn: false,
    nextBeat: 0,
    countInEnd: 0,
    beatIndex: 0,
    scorer: null,
    detector: createOnsetDetector(),
    calibration: null,
    bars: 0,
    lastAnnounce: 0,
    beatQueue: [],
    expected: 0,
    stick: 0,
    frame: 0,
  };

  function setError(text) {
    if (!errorEl) return;
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function announce(text) {
    if (live) live.textContent = text;
  }

  function bpm() {
    return clampBpm(bpmInput ? bpmInput.value : 90);
  }

  function offsetMs() {
    return clampOffsetMs(offsetInput ? offsetInput.value : 0);
  }

  function rudiment() {
    return rudimentById(rudimentSelect ? rudimentSelect.value : '');
  }

  function showBpm() {
    if (bpmOut) bpmOut.textContent = `${bpm()} BPM`;
  }

  function showOffset() {
    if (offsetOut) offsetOut.textContent = `${offsetMs()} ms`;
    if (state.scorer) state.scorer.setLatencyMs(offsetMs());
  }

  function showRudiment() {
    const r = rudiment();
    if (strokesEl) strokesEl.textContent = r.strokes;
    if (noteEl) noteEl.textContent = r.note;
  }

  function applySensitivity() {
    state.detector.setRatio(sensitivityToRatio(sensInput ? sensInput.value : SENSITIVITY_DEFAULT));
  }

  // ---- Click --------------------------------------------------------------

  function click(at, accent, loud = false) {
    const ctx = state.ctx;
    if (!ctx) return;
    const level = (levelInput ? Number(levelInput.value) : 60) / 100;
    const gain = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1320 : 880;
    const peak = Math.max(0.0001, (loud ? 0.5 : 0.28) * level * level + (loud ? 0.05 : 0));
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  // ---- Scheduler ----------------------------------------------------------

  function tick() {
    const ctx = state.ctx;
    if (!ctx || !state.running) return;
    const now = ctx.currentTime;

    if (state.calibration) {
      const cal = state.calibration;
      while (cal.scheduled < CALIBRATION_CLICKS && cal.start + cal.scheduled * CALIBRATION_GAP < now + LOOKAHEAD) {
        const at = cal.start + cal.scheduled * CALIBRATION_GAP;
        click(at, true, true);
        cal.clicks.push(at);
        cal.scheduled += 1;
      }
      if (now > cal.start + CALIBRATION_CLICKS * CALIBRATION_GAP + 0.6) finishCalibration();
      return;
    }

    while (state.nextBeat < now + LOOKAHEAD) {
      const countIn = state.beatIndex < COUNT_IN_BEATS;
      click(state.nextBeat, state.beatIndex % BEATS_PER_BAR === 0);
      if (!countIn) {
        const r = rudiment();
        const times = gridTimes(state.nextBeat, bpm(), r.perBeat, 1 / BEATS_PER_BAR);
        state.scorer.expect(times);
        // The hand shown comes from the written sticking. The microphone cannot tell hands apart.
        const hands = sticking(r);
        march.expect(times.map((at, i) => ({ index: state.expected + i, at, ...hands[(state.stick + i) % hands.length] })));
        state.expected += times.length;
        state.stick += times.length;
      }
      state.beatQueue.push({ at: state.nextBeat, beat: state.beatIndex % BEATS_PER_BAR, countIn });
      state.beatIndex += 1;
      state.nextBeat += beatSeconds(bpm());
      if (!countIn && (state.beatIndex - COUNT_IN_BEATS) % BEATS_PER_BAR === 0) onBar();
    }

    paintBeat(now);
    const missed = state.scorer.sweep(now);
    if (missed.length) {
      march.miss(missed, now);
      paintSummary();
    }
  }

  // ---- March --------------------------------------------------------------

  // Strokes on the next beats that the scheduler has not handed to the scorer yet. They
  // are worked out afresh on every frame, so a tempo or rudiment change moves them at once.
  function comingStrokes() {
    const r = rudiment();
    const hands = sticking(r);
    const beat = beatSeconds(bpm());
    const out = [];
    let n = state.stick;
    for (let b = 0; b <= LOOKAHEAD_BEATS; b += 1) {
      if (state.beatIndex + b < COUNT_IN_BEATS) continue;
      for (const at of gridTimes(state.nextBeat + b * beat, bpm(), r.perBeat, 1 / BEATS_PER_BAR)) {
        out.push({ at, ...hands[n % hands.length] });
        n += 1;
      }
    }
    return out;
  }

  function paintMarch() {
    state.frame = 0;
    if (!marchView || !state.ctx || !state.running || state.calibration) return;
    march.setReducedMotion(reducedMotion());
    marchView.draw(march.frame(state.ctx.currentTime, {
      lead: LOOKAHEAD_BEATS * beatSeconds(bpm()),
      preview: comingStrokes(),
    }));
    state.frame = window.requestAnimationFrame(paintMarch);
  }

  function restMarch() {
    if (state.frame) window.cancelAnimationFrame(state.frame);
    state.frame = 0;
    march.reset();
    if (marchView) marchView.draw(march.frame(0));
  }

  // The beat cue never flashes. One small marker steps along four cells and a line of
  // text names the beat, so the metronome has a visual that stays inside the WCAG
  // three-flashes rule. Nothing is animated, so reduced motion needs no special case.
  // It is hidden from screen readers because the status line already speaks.
  function paintBeat(now) {
    let due = null;
    while (state.beatQueue.length && state.beatQueue[0].at <= now) due = state.beatQueue.shift();
    if (!due) return;
    beatCells.forEach((cell, i) => {
      if (i === due.beat) cell.setAttribute('data-on', '1');
      else cell.removeAttribute('data-on');
    });
    if (beatText) {
      beatText.textContent = `${due.countIn ? 'Count-in' : 'Beat'} ${due.beat + 1} of ${BEATS_PER_BAR}`;
    }
  }

  function clearBeat() {
    state.beatQueue = [];
    beatCells.forEach((cell) => cell.removeAttribute('data-on'));
    if (beatText) beatText.textContent = '';
  }

  function onBar() {
    state.bars += 1;
    if (state.bars - state.lastAnnounce >= 4) {
      state.lastAnnounce = state.bars;
      const s = state.scorer.summary();
      announce(`${s.accuracy} percent of strokes landed. ${leanAdvice(s)}`);
    }
  }

  // ---- Hits ---------------------------------------------------------------

  function onOnset(time) {
    if (state.calibration) {
      state.calibration.onsets.push(time);
      return;
    }
    if (!state.running || !state.scorer) return;
    if (time < state.countInEnd) return;
    const result = state.scorer.hit(time);
    march.hit(result, state.ctx.currentTime, beatSeconds(bpm()) / rudiment().perBeat);
    paintHit(result);
    paintSummary();
  }

  function paintHit(result) {
    if (!meterTrack) return;
    const tickEl = document.createElement('span');
    tickEl.className = `tick ${result.grade}`;
    if (result.offsetMs === null) {
      tickEl.style.left = '50%';
    } else {
      const pct = 50 + Math.max(-1, Math.min(1, result.offsetMs / OK_MS)) * 50;
      tickEl.style.left = `${pct}%`;
    }
    meterTrack.appendChild(tickEl);
    while (meterTrack.children.length > MAX_TICKS) meterTrack.removeChild(meterTrack.firstChild);
    if (lastEl) {
      lastEl.textContent = result.grade === 'stray' ? 'Extra hit' : `${capital(result.grade)} · ${formatOffset(result.offsetMs)}`;
    }
    if (meter) meter.dataset.grade = result.grade;
  }

  function paintSummary() {
    if (!state.scorer) return;
    const s = state.scorer.summary();
    const st = state.scorer.stats;
    if (countEl) {
      countEl.textContent = `${st.perfect} perfect · ${st.good} good · ${st.ok} ok · ${st.miss} missed · ${st.stray} extra`;
    }
    if (adviceEl) adviceEl.textContent = leanAdvice(s);
  }

  function capital(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ---- Audio setup --------------------------------------------------------

  async function openMic() {
    const attempts = [MIC_CONSTRAINTS, { audio: true, video: false }];
    let lastError = null;
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastError = err;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) break;
      }
    }
    throw lastError;
  }

  async function attachMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !state.ctx.audioWorklet) {
      throw new Error('unsupported');
    }
    state.stream = await openMic();
    await state.ctx.audioWorklet.addModule(worklet);
    state.source = state.ctx.createMediaStreamSource(state.stream);
    state.node = new AudioWorkletNode(state.ctx, 'drum-levels', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    state.node.port.onmessage = (event) => {
      const pairs = event.data;
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const onset = state.detector.push(pairs[i + 1], pairs[i]);
        if (onset !== null) onOnset(onset);
      }
    };
    // The worklet's output is silent. It is connected so browsers keep it running.
    state.sink = state.ctx.createGain();
    state.sink.gain.value = 0;
    state.source.connect(state.node).connect(state.sink).connect(state.ctx.destination);
    state.micOn = true;
  }

  function defaultOffset() {
    const ctx = state.ctx;
    const ms = ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
    return clampOffsetMs(ms);
  }

  async function begin(useMic) {
    if (!AudioCtx) {
      setError('This browser cannot play sound.');
      return false;
    }
    setError('');
    // resume() has to run inside the tap, before any await.
    state.ctx = new AudioCtx({ latencyHint: 'interactive' });
    state.ctx.resume();
    state.detector.reset();
    applySensitivity();
    if (useMic) {
      setStatus('Waiting for the microphone…');
      try {
        await attachMic();
      } catch (err) {
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        setError(denied
          ? 'The microphone is blocked. You can still practise with the pad button or the space bar.'
          : 'The microphone did not open. You can still practise with the pad button or the space bar.');
        await teardown();
        setStatus('Ready.');
        return false;
      }
      if (offsetInput && offsetInput.dataset.touched !== '1') {
        offsetInput.value = String(defaultOffset());
        showOffset();
      }
    }
    return true;
  }

  async function teardown() {
    window.clearInterval(state.timer);
    state.timer = 0;
    state.running = false;
    state.calibration = null;
    restMarch();
    try {
      if (state.node) state.node.port.onmessage = null;
      if (state.source) state.source.disconnect();
      if (state.node) state.node.disconnect();
      if (state.sink) state.sink.disconnect();
    } catch (err) {
      // Already disconnected.
    }
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    if (state.ctx && state.ctx.state !== 'closed') {
      try {
        await state.ctx.close();
      } catch (err) {
        // Closing twice is harmless.
      }
    }
    state.ctx = null;
    state.stream = null;
    state.source = null;
    state.node = null;
    state.sink = null;
    state.micOn = false;
  }

  // ---- Start, stop, calibrate --------------------------------------------

  async function startPractice(useMic) {
    if (state.running) return;
    const ok = await begin(useMic);
    if (!ok) return;
    state.scorer = createScorer({ expected: [], latencyMs: offsetMs() });
    state.beatIndex = 0;
    state.bars = 0;
    state.lastAnnounce = 0;
    state.beatQueue = [];
    state.expected = 0;
    state.stick = 0;
    march.reset();
    state.nextBeat = state.ctx.currentTime + 0.3;
    state.countInEnd = state.nextBeat + COUNT_IN_BEATS * beatSeconds(bpm()) - OK_MS / 1000;
    state.running = true;
    if (meterTrack) meterTrack.textContent = '';
    paintSummary();
    state.timer = window.setInterval(tick, TICK_MS);
    tick();
    paintMarch();
    syncButtons();
    setStatus(useMic ? 'Listening. Four clicks to count you in.' : 'Pad mode. Tap the pad or press space. Four clicks to count you in.');
    announce('Count-in started.');
  }

  async function stopPractice() {
    const finished = state.scorer ? state.scorer.summary() : null;
    await teardown();
    syncButtons();
    setStatus('Stopped. The microphone is off.');
    if (finished && finished.total) {
      announce(`Stopped. ${finished.accuracy} percent of strokes landed.`);
      if (adviceEl) adviceEl.textContent = leanAdvice(finished);
    }
  }

  async function calibrate() {
    if (state.running) await stopPractice();
    const ok = await begin(true);
    if (!ok) return;
    state.calibration = { clicks: [], onsets: [], scheduled: 0, start: state.ctx.currentTime + 0.4 };
    state.running = true;
    state.timer = window.setInterval(tick, TICK_MS);
    syncButtons();
    setStatus('Measuring. Keep the room quiet and the phone volume up.');
  }

  async function finishCalibration() {
    const cal = state.calibration;
    state.calibration = null;
    state.running = false;
    window.clearInterval(state.timer);
    const ms = estimateLatency(cal.clicks, cal.onsets);
    await teardown();
    syncButtons();
    if (ms === null) {
      setStatus('Did not hear the clicks.');
      setError('The microphone did not pick up the click. Turn the volume up and take headphones off for this test, or set the offset by hand.');
      return;
    }
    setError('');
    offsetInput.value = String(clampOffsetMs(ms));
    offsetInput.dataset.touched = '1';
    showOffset();
    setStatus(`Heard the click. Round trip ${ms} ms, offset set. Use wired headphones to practise so the click does not score for you.`);
    announce(`Latency measured at ${ms} milliseconds.`);
  }

  function syncButtons() {
    const active = state.running && !state.calibration;
    // The label swaps between Start and Stop. It is the only state signal. A pressed-state
    // attribute on top would make a screen reader say "Stop, toggle button, pressed".
    if (startBtn) startBtn.textContent = active && state.micOn ? 'Stop' : 'Start with microphone';
    if (padBtn) padBtn.textContent = active && !state.micOn ? 'Stop' : 'Practise with the pad';
    if (calibrateBtn) calibrateBtn.disabled = state.running;
    if (beatCue) beatCue.hidden = !active;
    if (!active) clearBeat();
    root.dataset.padMode = active && !state.micOn ? '1' : '0';
  }

  // ---- Controls -----------------------------------------------------------

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (state.running && state.micOn) stopPractice();
      else if (!state.running) startPractice(true);
    });
  }
  if (padBtn) {
    padBtn.addEventListener('click', () => {
      if (state.running && !state.micOn) stopPractice();
      else if (!state.running) startPractice(false);
    });
  }
  if (calibrateBtn) calibrateBtn.addEventListener('click', calibrate);

  const padTarget = q('[data-tap]');
  function tap() {
    if (state.running && !state.micOn && state.ctx) onOnset(state.ctx.currentTime);
  }
  if (padTarget) {
    // Pointer events cover mouse, pen and touch once. preventDefault stops the browser
    // sending a second, compatibility mouse event after a touch. touch-action: none on
    // the pad (see the page CSS) stops a tap from scrolling or zooming the page.
    padTarget.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      tap();
    });
    // Keyboard: Enter on the focused pad is a stroke. Space is handled below for every focus.
    padTarget.addEventListener('keydown', (event) => {
      if (event.code !== 'Enter' || event.repeat) return;
      event.preventDefault();
      tap();
    });
  }

  // In pad mode the space bar is the stand-in stick, wherever focus is. A focused button
  // would otherwise click itself when Space is released, and Start or Stop would flip
  // mid-session. So the key is claimed on keydown, and its keyup is cancelled too: some
  // browsers fire the click on keyup. Text fields, sliders and menus keep their own Space.
  let spaceClaimed = false;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (!(state.running && !state.micOn)) return;
    event.preventDefault();
    if (event.repeat) return;
    spaceClaimed = true;
    tap();
  });
  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space' || !spaceClaimed) return;
    spaceClaimed = false;
    event.preventDefault();
  });

  function nudgeBpm(delta) {
    bpmInput.value = String(clampBpm(bpm() + delta));
    showBpm();
  }
  if (bpmInput) bpmInput.addEventListener('input', showBpm);
  if (bpmDown) bpmDown.addEventListener('click', () => nudgeBpm(-1));
  if (bpmUp) bpmUp.addEventListener('click', () => nudgeBpm(1));
  if (rudimentSelect) {
    rudimentSelect.addEventListener('change', () => {
      state.stick = 0; // a new rudiment starts its sticking from the first stroke
      showRudiment();
    });
  }
  if (offsetInput) {
    offsetInput.addEventListener('input', () => {
      offsetInput.dataset.touched = '1';
      showOffset();
    });
  }
  if (sensInput) sensInput.addEventListener('input', applySensitivity);

  window.addEventListener('pagehide', () => {
    if (state.running) teardown();
  });

  showBpm();
  showOffset();
  showRudiment();
  syncButtons();
}
