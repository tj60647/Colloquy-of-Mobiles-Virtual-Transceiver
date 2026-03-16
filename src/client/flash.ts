/**
 * flash.ts – Flash Transmitter
 *
 * Broadcasts one of the 8 dictionary words by toggling the phone's rear
 * camera torch (flashlight) at a selectable rate (20 Hz default, 40 Hz option).
 *
 * Uses the Web Torch API:
 *   track.applyConstraints({ advanced: [{ torch: true/false }] })
 *
 * Browser support: Chrome on Android. iOS Safari does not expose torch.
 */

import {
  AUDIO_TONE_FREQS,
  DICT_WORDS,
  DICT_LABELS,
  SEGMENT_MS,
  LISTEN_LEN,
  TX_CYCLE_LEN,
  getTransmitBit,
  type DictWord,
} from '../shared/dictionary.js';

// ── Tone frequencies ──────────────────────────────────────────────────────────

const TONE_FREQS = AUDIO_TONE_FREQS;
const TOTAL_SEGMENTS = TX_CYCLE_LEN;
const TRANSMITTER_CONFIG_URL = '/config/transmitter.config.json';
const TRANSMITTER_CONFIG_STORAGE_KEY = 'vcl.transmitter.config.v1';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const indicator    = document.getElementById('torch-indicator')!;
const statusEl     = document.getElementById('status')!;
const startBtn     = document.getElementById('start-btn') as HTMLButtonElement;
const wordGrid     = document.getElementById('word-grid')!;
const patternBar   = document.getElementById('pattern-bar')!;
const loopCount    = document.getElementById('loop-count')!;
const effectiveHzWrapEl = document.getElementById('effective-hz-wrap') as HTMLDivElement;
const effectiveHzGraphEl = document.getElementById('effective-hz-graph') as HTMLCanvasElement;
const effectiveHzTextEl = document.getElementById('effective-hz-text')!;
const camPreview   = document.getElementById('cam-preview') as HTMLVideoElement;
const modeFlashBtn = document.getElementById('mode-flash') as HTMLButtonElement;
const modeSoundBtn = document.getElementById('mode-sound') as HTMLButtonElement;
const invertToggle = document.getElementById('invert-toggle') as HTMLInputElement;
const rateToggle = document.getElementById('rate-toggle') as HTMLInputElement;
const rateDisplay = document.getElementById('rate-display')!;
const freqSection  = document.getElementById('freq-section')!;
const freqSlider   = document.getElementById('freq-slider') as HTMLInputElement;
const freqDisplay  = document.getElementById('freq-display')!;

// ── State ─────────────────────────────────────────────────────────────────────

type TransmitMode = 'flash' | 'sound';

let mode:         TransmitMode = 'flash';
let selectedFreqIdx            = 0;

let torchTrack:  MediaStreamTrack | null = null;
let torchStream: MediaStream | null      = null;
let flashSimulated = false;
let running      = false;
let timeoutId:   ReturnType<typeof setTimeout> | null = null;
let startTime    = 0;
let loops        = 0;
let selectedWord: DictWord = 'I_O';
let invertTransmission = false;
let txRateHz: 20 | 40 = 20;
let lastTickWallTs = 0;
let lastProcessedSegmentCount = -1;
let effectiveHz = 0;
const effectiveHzHistory: number[] = [];

const EFFECTIVE_GRAPH_MIN_HZ = 10;
const EFFECTIVE_GRAPH_MAX_HZ = 50;
const RATE_DEBUG_WINDOW_MS = 30_000;

type TickStat = { wallTs: number; dtMs: number; instHz: number };
const tickStats: TickStat[] = [];
let lastDebugLogWallTs = 0;
let debugRunStartWallTs = 0;

function setEffectiveHzText(hz: number): void {
  effectiveHzTextEl.textContent = hz > 0 ? `effective: ${hz.toFixed(1)} Hz` : 'effective: --.- Hz';
}

function resetEffectiveHzGraph(): void {
  effectiveHzHistory.length = 0;
  drawEffectiveHzGraph();
}

function pushEffectiveHz(hz: number): void {
  if (!Number.isFinite(hz) || hz <= 0) return;

  effectiveHzHistory.push(hz);
  const maxSamples = 1_500;
  if (effectiveHzHistory.length > maxSamples) {
    effectiveHzHistory.splice(0, effectiveHzHistory.length - maxSamples);
  }

  drawEffectiveHzGraph();
}

function drawEffectiveHzGraph(): void {
  const ctx = effectiveHzGraphEl.getContext('2d');
  if (!ctx) return;

  const cssWidth = Math.max(1, Math.floor(effectiveHzWrapEl.clientWidth));
  const cssHeight = Math.max(1, Math.floor(effectiveHzWrapEl.clientHeight));
  const dpr = window.devicePixelRatio || 1;

  const pxWidth = Math.max(1, Math.floor(cssWidth * dpr));
  const pxHeight = Math.max(1, Math.floor(cssHeight * dpr));

  if (effectiveHzGraphEl.width !== pxWidth || effectiveHzGraphEl.height !== pxHeight) {
    effectiveHzGraphEl.width = pxWidth;
    effectiveHzGraphEl.height = pxHeight;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pxWidth, pxHeight);
  ctx.scale(dpr, dpr);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(0, 2, cssWidth, Math.max(1, cssHeight - 4));

  const drawGuide = (hz: number): void => {
    const clamped = Math.max(EFFECTIVE_GRAPH_MIN_HZ, Math.min(EFFECTIVE_GRAPH_MAX_HZ, hz));
    const gy = 2 + (Math.max(2, cssHeight - 4) - 1)
      - ((clamped - EFFECTIVE_GRAPH_MIN_HZ) / (EFFECTIVE_GRAPH_MAX_HZ - EFFECTIVE_GRAPH_MIN_HZ))
        * (Math.max(2, cssHeight - 4) - 1);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(cssWidth, gy);
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  drawGuide(20);
  drawGuide(40);

  if (effectiveHzHistory.length < 2) return;

  const plotHeight = Math.max(2, cssHeight - 4);
  const plotTop = 2;
  const range = EFFECTIVE_GRAPH_MAX_HZ - EFFECTIVE_GRAPH_MIN_HZ;
  const maxPoints = Math.max(2, cssWidth);
  const values = effectiveHzHistory.length > maxPoints
    ? effectiveHzHistory.slice(effectiveHzHistory.length - maxPoints)
    : effectiveHzHistory;

  ctx.beginPath();
  for (let i = 0; i < values.length; i++) {
    const hz = Math.max(EFFECTIVE_GRAPH_MIN_HZ, Math.min(EFFECTIVE_GRAPH_MAX_HZ, values[i]));
    const nx = values.length <= 1 ? 0 : i / (values.length - 1);
    const x = nx * (cssWidth - 1);
    const y = plotTop + (plotHeight - 1) - ((hz - EFFECTIVE_GRAPH_MIN_HZ) / range) * (plotHeight - 1);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(0, 229, 255, 0.70)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function logRateDebugWindow(nowWallTs: number): void {
  const cutoff = nowWallTs - RATE_DEBUG_WINDOW_MS;
  while (tickStats.length && tickStats[0].wallTs < cutoff) {
    tickStats.shift();
  }

  if (tickStats.length < 10) return;
  if (debugRunStartWallTs === 0 || nowWallTs - debugRunStartWallTs < RATE_DEBUG_WINDOW_MS) return;
  if (lastDebugLogWallTs > 0 && nowWallTs - lastDebugLogWallTs < RATE_DEBUG_WINDOW_MS) return;

  const hzValues = tickStats.map((s) => s.instHz);
  const dtValues = tickStats.map((s) => s.dtMs);
  const sortedHz = [...hzValues].sort((a, b) => a - b);
  const sortedDt = [...dtValues].sort((a, b) => a - b);

  const meanHz = hzValues.reduce((sum, v) => sum + v, 0) / hzValues.length;
  const targetHz = txRateHz;
  const targetDt = 1000 / targetHz;
  const meanDt = dtValues.reduce((sum, v) => sum + v, 0) / dtValues.length;
  const p95Dt = sortedDt[Math.floor((sortedDt.length - 1) * 0.95)];
  const p50Hz = sortedHz[Math.floor((sortedHz.length - 1) * 0.50)];
  const p95Hz = sortedHz[Math.floor((sortedHz.length - 1) * 0.95)];
  const minHz = sortedHz[0];
  const maxHz = sortedHz[sortedHz.length - 1];

  console.info(
    `[tx-rate] 30s n=${tickStats.length} target=${targetHz.toFixed(1)}Hz ` +
    `mean=${meanHz.toFixed(2)}Hz p50=${p50Hz.toFixed(2)}Hz p95=${p95Hz.toFixed(2)}Hz ` +
    `min=${minHz.toFixed(2)}Hz max=${maxHz.toFixed(2)}Hz ` +
    `meanDt=${meanDt.toFixed(2)}ms p95Dt=${p95Dt.toFixed(2)}ms targetDt=${targetDt.toFixed(2)}ms`,
  );

  lastDebugLogWallTs = nowWallTs;
}

const canUseMediaDevices =
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function' &&
  (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

const likelyTorchDevice = /Android/i.test(navigator.userAgent);

type AudioContextCtor = new () => AudioContext;
const AudioContextClass = (window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;

type TransmitterControlMap = Record<string, string | boolean>;

interface TransmitterConfigPayload {
  controls?: TransmitterControlMap;
  selectedWord?: DictWord;
  mode?: TransmitMode;
}

const TRANSMITTER_CONTROL_IDS = [
  'invert-toggle',
  'rate-toggle',
  'freq-slider',
] as const;

async function loadTransmitterFileConfig(): Promise<TransmitterConfigPayload> {
  try {
    const res = await fetch(TRANSMITTER_CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) return {};
    return (await res.json()) as TransmitterConfigPayload;
  } catch {
    return {};
  }
}

function loadTransmitterLocalConfig(): TransmitterConfigPayload {
  try {
    const raw = localStorage.getItem(TRANSMITTER_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as TransmitterConfigPayload;
  } catch {
    return {};
  }
}

function collectTransmitterControls(): TransmitterControlMap {
  const out: TransmitterControlMap = {};
  for (const id of TRANSMITTER_CONTROL_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLButtonElement | null;
    if (!el) continue;

    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox') out[id] = el.checked;
      else out[id] = el.value;
    }
  }
  return out;
}

function persistTransmitterConfig(): void {
  const payload: TransmitterConfigPayload = {
    controls: collectTransmitterControls(),
    selectedWord,
    mode,
  };
  localStorage.setItem(TRANSMITTER_CONFIG_STORAGE_KEY, JSON.stringify(payload));
}

function applyTransmitterControls(controls: TransmitterControlMap): void {
  if (typeof controls['invert-toggle'] === 'boolean') {
    invertToggle.checked = Boolean(controls['invert-toggle']);
    invertToggle.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (typeof controls['rate-toggle'] !== 'undefined') {
    rateToggle.value = String(controls['rate-toggle']);
    rateToggle.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (typeof controls['freq-slider'] !== 'undefined') {
    freqSlider.value = String(controls['freq-slider']);
    freqSlider.dispatchEvent(new Event('input', { bubbles: true }));
  }

}

// ── Audio state ───────────────────────────────────────────────────────────────

let audioCtx:   AudioContext | null   = null;
let oscillator: OscillatorNode | null = null;
let gainNode:   GainNode | null       = null;

// ── Build word selector ───────────────────────────────────────────────────────

const wordBtns = new Map<DictWord, HTMLButtonElement>();

for (const word of DICT_WORDS) {
  const btn = document.createElement('button');
  btn.className = 'word-btn';
  btn.innerHTML = `<strong>${word}</strong><span>${DICT_LABELS[word]}</span>`;
  btn.addEventListener('click', () => selectWord(word));
  wordGrid.appendChild(btn);
  wordBtns.set(word, btn);
}

function selectWord(word: DictWord): void {
  selectedWord = word;
  wordBtns.forEach((btn, w) => btn.classList.toggle('selected', w === word));
  renderPatternBar(word, -1);
  if (running) restartLoop();
  persistTransmitterConfig();
}

// ── Mode switch ───────────────────────────────────────────────────────────────

function setMode(m: TransmitMode): void {
  if (running) stop();
  mode = m;
  modeFlashBtn.classList.toggle('active', m === 'flash');
  modeSoundBtn.classList.toggle('active', m === 'sound');
  freqSection.style.display = m === 'sound' ? 'flex' : 'none';
  indicator.textContent    = m === 'flash' ? '💡' : '🔊';
  startBtn.textContent     = m === 'flash' ? 'Start Flashing' : 'Start Tone';
  setStatus('Select a word and tap Start.');
  persistTransmitterConfig();
}

modeFlashBtn.addEventListener('click', () => setMode('flash'));
modeSoundBtn.addEventListener('click', () => setMode('sound'));
invertToggle?.addEventListener('change', () => {
  invertTransmission = invertToggle.checked;
  if (running) {
    restartLoop();
  } else {
    renderPatternBar(selectedWord, -1);
  }
});

rateToggle?.addEventListener('input', () => {
  txRateHz = rateToggle.value === '1' ? 20 : 40;
  rateDisplay.textContent = `${txRateHz} Hz`;
  if (running) {
    restartLoop();
  }
  persistTransmitterConfig();
});

// ── Frequency selector ────────────────────────────────────────────────────────

freqSlider.addEventListener('input', () => {
  selectedFreqIdx = parseInt(freqSlider.value, 10);
  freqDisplay.textContent = `${TONE_FREQS[selectedFreqIdx]} Hz`;
  if (oscillator && audioCtx) {
    oscillator.frequency.setValueAtTime(TONE_FREQS[selectedFreqIdx], audioCtx.currentTime);
  }
  persistTransmitterConfig();
});

// ── Pattern bar ───────────────────────────────────────────────────────────────

const segEls: HTMLDivElement[] = [];

// Build once
for (let i = 0; i < TOTAL_SEGMENTS; i++) {
  const d = document.createElement('div');
  d.className = 'seg';
  patternBar.appendChild(d);
  segEls.push(d);
}

function renderPatternBar(word: DictWord, activeSeg: number): void {
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    const isListening = i >= LISTEN_LEN;
    const isOn = getTransmitBit(word, i, invertTransmission);
    segEls[i].className =
      'seg' +
      (isOn ? ' on' : '') +
      (isListening ? ' listening' : '') +
      (i === activeSeg ? ' active' : '');
  }
}

selectWord('I_O');

// ── Torch helpers ─────────────────────────────────────────────────────────────

async function acquireTorch(): Promise<boolean> {
  try {
    setStatus('[1/4] Requesting camera permission…');
    torchStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });

    setStatus('[2/4] Permission granted – reading tracks…');
    camPreview.srcObject = torchStream;
    camPreview.classList.add('visible');
    const tracks = torchStream.getVideoTracks();
    console.log('[flash] track count:', tracks.length);
    if (tracks.length === 0) throw new Error('No video track returned');
    torchTrack = tracks[0];
    console.log('[flash] track label:', torchTrack.label);
    console.log('[flash] track settings:', JSON.stringify(torchTrack.getSettings?.() ?? {}));

    setStatus(`[3/4] Track: "${torchTrack.label || 'unnamed'}" – checking torch capability…`);

    // getCapabilities() is Chrome-only; iOS Safari doesn't have it.
    let caps: { torch?: boolean } = {};
    if (typeof torchTrack.getCapabilities === 'function') {
      caps = torchTrack.getCapabilities() as { torch?: boolean };
      console.log('[flash] capabilities:', JSON.stringify(caps));
      setStatus(`[4/4] Capabilities: ${JSON.stringify(caps)}`);
    } else {
      console.log('[flash] getCapabilities() unavailable (likely iOS Safari)');
      setStatus('[4/4] getCapabilities() not available on this browser (iOS Safari?)');
    }

    if (!caps.torch) {
      const detail = typeof torchTrack.getCapabilities === 'function'
        ? `caps=${JSON.stringify(caps)}`
        : 'getCapabilities() missing';
      setStatus(`Torch not supported (${detail}). Use Chrome on Android.`, true);
      torchStream.getTracks().forEach(t => t.stop());
      torchStream = null;
      torchTrack  = null;
      camPreview.srcObject = null;
      camPreview.classList.remove('visible');
      return false;
    }

    return true;
  } catch (e) {
    console.error('[flash] acquireTorch error:', e);
    setStatus(`Camera error: ${String(e)}`, true);
    return false;
  }
}

async function setTorch(on: boolean): Promise<void> {
  if (!torchTrack) return;
  try {
    // 'torch' is not in the standard TS lib yet; cast required
    await torchTrack.applyConstraints({
      advanced: [{ torch: on } as MediaTrackConstraintSet],
    });
  } catch {
    // Silently ignore if the hardware doesn't support torch
  }
}

function releaseTorch(): void {
  if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
  void setTorch(false);
  if (torchStream) {
    torchStream.getTracks().forEach(t => t.stop());
    torchStream = null;
    torchTrack  = null;
  }
  camPreview.srcObject = null;
  camPreview.classList.remove('visible');
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

function startAudio(): void {
  if (!AudioContextClass) {
    throw new Error('Web Audio is not supported in this browser.');
  }

  audioCtx  = new AudioContextClass();
  // Browsers often start the context suspended due to autoplay policy;
  // resume() unlocks it — must be called synchronously in the user-gesture handler.
  void audioCtx.resume();
  gainNode  = audioCtx.createGain();
  gainNode.gain.value = 0;
  gainNode.connect(audioCtx.destination);
  oscillator = audioCtx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = TONE_FREQS[selectedFreqIdx];
  oscillator.connect(gainNode);
  oscillator.start();
}

function setTone(on: boolean): void {
  if (!gainNode || !audioCtx) return;
  gainNode.gain.setTargetAtTime(on ? 0.6 : 0, audioCtx.currentTime, 0.002);
}

function stopAudio(): void {
  if (oscillator) {
    try { oscillator.stop(); } catch { /* already stopped */ }
    oscillator.disconnect();
    oscillator = null;
  }
  if (gainNode) { gainNode.disconnect(); gainNode = null; }
  if (audioCtx)  { void audioCtx.close(); audioCtx = null; }
}

// ── Precision timing loop ─────────────────────────────────────────────────────

function getSegmentMs(): number {
  return txRateHz === 40 ? SEGMENT_MS : SEGMENT_MS * 2;
}

function tick(): void {
  if (!running) return;

  const now = performance.now();
  const segmentMs = getSegmentMs();
  const totalMs   = segmentMs * TOTAL_SEGMENTS;
  const elapsed    = now - startTime;
  const segmentCount = Math.floor(elapsed / segmentMs);
  const nextBoundaryFromNow = (segmentCount + 1) * segmentMs - elapsed;

  if (segmentCount === lastProcessedSegmentCount) {
    timeoutId = setTimeout(tick, Math.max(1, nextBoundaryFromNow));
    return;
  }

  if (lastTickWallTs > 0) {
    const dt = now - lastTickWallTs;
    if (dt > 0) {
      const instHz = 1000 / dt;
      effectiveHz = effectiveHz === 0 ? instHz : (0.18 * instHz + 0.82 * effectiveHz);
      tickStats.push({ wallTs: now, dtMs: dt, instHz });
      logRateDebugWindow(now);
      setEffectiveHzText(effectiveHz);
      pushEffectiveHz(effectiveHz);
    }
  }
  lastTickWallTs = now;
  lastProcessedSegmentCount = segmentCount;

  const posInLoop  = elapsed % totalMs;
  const segIdx     = segmentCount % TOTAL_SEGMENTS;
  const inListenWindow = segIdx >= LISTEN_LEN;
  const torchOn    = getTransmitBit(selectedWord, segIdx, invertTransmission);

  // Update output
  if (mode === 'flash') {
    void setTorch(torchOn);
    indicator.classList.toggle('on', torchOn);
    indicator.classList.remove('sound-on');
  } else {
    setTone(torchOn);
    indicator.classList.toggle('sound-on', torchOn);
    indicator.classList.remove('on');
  }
  renderPatternBar(selectedWord, segIdx);

  // Update loop counter
  const newLoops = Math.floor(segmentCount / TOTAL_SEGMENTS);
  if (newLoops !== loops) {
    loops = newLoops;
    loopCount.textContent = `Loop ${loops + 1}`;
  }

  loopCount.textContent = `Loop ${loops + 1} · ${inListenWindow ? 'LISTEN' : 'TX'} · ${txRateHz}Hz`;

  // Schedule next tick at the start of the next segment
  timeoutId = setTimeout(tick, Math.max(1, nextBoundaryFromNow));
}

function startLoop(): void {
  const now = performance.now();
  startTime = now;
  loops     = 0;
  lastTickWallTs = 0;
  lastProcessedSegmentCount = -1;
  effectiveHz = 0;
  tickStats.length = 0;
  lastDebugLogWallTs = 0;
  debugRunStartWallTs = now;
  setEffectiveHzText(0);
  resetEffectiveHzGraph();
  loopCount.textContent = 'Loop 1';
  tick();
}

function restartLoop(): void {
  if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
  startLoop();
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  if (running) {
    stop();
  } else {
    await start();
  }
});

async function start(): Promise<void> {
  if (mode === 'flash') {
    setStatus('Requesting camera access…');
    startBtn.disabled = true;
    flashSimulated = false;

    const ok = await acquireTorch();
    if (!ok) {
      flashSimulated = true;
      setStatus('Torch unavailable on this device. Running simulated flash mode (icon only).', true);
    }
  } else {
    try {
      startAudio();
    } catch (err) {
      setStatus(String(err), true);
      return;
    }
  }

  running = true;
  startBtn.disabled = false;
  startBtn.textContent = 'Stop';
  startBtn.classList.add('running');
  if (mode === 'flash' && flashSimulated) {
    setStatus(`Simulated flash broadcasting: ${selectedWord}`);
  } else {
    setStatus(`Broadcasting: ${selectedWord}`);
  }
  startLoop();
}

function stop(): void {
  running = false;
  if (mode === 'flash') {
    releaseTorch();
  } else {
    if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
    setTone(false);
    stopAudio();
    indicator.classList.remove('sound-on');
  }
  indicator.classList.remove('on');
  renderPatternBar(selectedWord, -1);
  loopCount.textContent = '';
  setEffectiveHzText(0);
  resetEffectiveHzGraph();
  startBtn.textContent = mode === 'flash' ? 'Start Flashing' : 'Start Tone';
  startBtn.classList.remove('running');
  setStatus('Stopped.');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg: string, isError = false): void {
  statusEl.textContent = msg;
  statusEl.className   = isError ? 'err' : '';
}

if (!canUseMediaDevices) {
  setStatus('Flash may require HTTPS on this device/browser. If it fails, switch to sound mode.', true);
} else if (!likelyTorchDevice) {
  setMode('sound');
  setStatus('Sound mode selected by default. Flash mode is mainly supported on Android Chrome.');
}

void (async () => {
  const fileCfg = await loadTransmitterFileConfig();
  const localCfg = loadTransmitterLocalConfig();
  const mergedControls = { ...(fileCfg.controls ?? {}), ...(localCfg.controls ?? {}) };
  applyTransmitterControls(mergedControls);

  const restoredMode = (localCfg.mode ?? fileCfg.mode);
  if (restoredMode === 'sound' || restoredMode === 'flash') {
    setMode(restoredMode);
  }

  const mergedWord = (localCfg.selectedWord ?? fileCfg.selectedWord) as DictWord | undefined;
  if (mergedWord && DICT_WORDS.includes(mergedWord)) {
    selectWord(mergedWord);
  }
})();

// Stop cleanly on page hide (e.g. phone locks, tab switches)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) stop();
});

window.addEventListener('beforeunload', () => {
  if (running) stop();
  releaseTorch();
  stopAudio();
});

window.addEventListener('pagehide', () => {
  if (running) stop();
  releaseTorch();
  stopAudio();
});

window.addEventListener('resize', () => {
  drawEffectiveHzGraph();
});

setEffectiveHzText(0);
drawEffectiveHzGraph();
