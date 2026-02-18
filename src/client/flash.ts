/**
 * flash.ts – Flash Transmitter
 *
 * Broadcasts one of the 8 dictionary words by toggling the phone's rear
 * camera torch (flashlight) at 40 Hz (25 ms per segment).
 *
 * Uses the Web Torch API:
 *   track.applyConstraints({ advanced: [{ torch: true/false }] })
 *
 * Browser support: Chrome on Android. iOS Safari does not expose torch.
 */

import {
  DICTIONARY,
  DICT_WORDS,
  DICT_LABELS,
  SEGMENT_MS,
  PATTERN_LEN,
  type DictWord,
} from '../shared/dictionary.js';

// ── Tone frequencies ──────────────────────────────────────────────────────────

const TONE_FREQS = [1760, 1976, 2093, 2349, 2637] as const;
const LISTEN_SEGMENTS = PATTERN_LEN;
const TOTAL_SEGMENTS = PATTERN_LEN + LISTEN_SEGMENTS;

// ── DOM refs ─────────────────────────────────────────────────────────────────

const indicator    = document.getElementById('torch-indicator')!;
const statusEl     = document.getElementById('status')!;
const startBtn     = document.getElementById('start-btn') as HTMLButtonElement;
const wordGrid     = document.getElementById('word-grid')!;
const patternBar   = document.getElementById('pattern-bar')!;
const loopCount    = document.getElementById('loop-count')!;
const camPreview   = document.getElementById('cam-preview') as HTMLVideoElement;
const modeFlashBtn = document.getElementById('mode-flash') as HTMLButtonElement;
const modeSoundBtn = document.getElementById('mode-sound') as HTMLButtonElement;
const invertToggle = document.getElementById('invert-toggle') as HTMLInputElement;
const rateToggle = document.getElementById('rate-toggle') as HTMLSelectElement;
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
let txRateHz: 20 | 40 = 40;

const canUseMediaDevices =
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getUserMedia === 'function' &&
  (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

const likelyTorchDevice = /Android/i.test(navigator.userAgent);

type AudioContextCtor = new () => AudioContext;
const AudioContextClass = (window.AudioContext ?? (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;

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
}

// ── Mode switch ───────────────────────────────────────────────────────────────

function setMode(m: TransmitMode): void {
  if (m === 'flash' && !canUseMediaDevices) {
    mode = 'sound';
    modeFlashBtn.classList.remove('active');
    modeSoundBtn.classList.add('active');
    freqSection.style.display = 'flex';
    indicator.textContent = '🔊';
    startBtn.textContent = 'Start Tone';
    setStatus('Flash mode unavailable here (HTTPS/camera API required). Switched to sound mode.', true);
    return;
  }

  if (running) stop();
  mode = m;
  modeFlashBtn.classList.toggle('active', m === 'flash');
  modeSoundBtn.classList.toggle('active', m === 'sound');
  freqSection.style.display = m === 'sound' ? 'flex' : 'none';
  indicator.textContent    = m === 'flash' ? '💡' : '🔊';
  startBtn.textContent     = m === 'flash' ? 'Start Flashing' : 'Start Tone';
  setStatus('Select a word and tap Start.');
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

rateToggle?.addEventListener('change', () => {
  txRateHz = rateToggle.value === '20' ? 20 : 40;
  if (running) {
    restartLoop();
  }
});

// ── Frequency selector ────────────────────────────────────────────────────────

freqSlider.addEventListener('input', () => {
  selectedFreqIdx = parseInt(freqSlider.value, 10);
  freqDisplay.textContent = `${TONE_FREQS[selectedFreqIdx]} Hz`;
  if (oscillator && audioCtx) {
    oscillator.frequency.setValueAtTime(TONE_FREQS[selectedFreqIdx], audioCtx.currentTime);
  }
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
  const pattern = DICTIONARY[word];
  for (let i = 0; i < TOTAL_SEGMENTS; i++) {
    const isListening = i >= PATTERN_LEN;
    const isOn = !isListening && getTxOn(pattern, i);
    segEls[i].className =
      'seg' +
      (isOn ? ' on' : '') +
      (isListening ? ' listening' : '') +
      (i === activeSeg ? ' active' : '');
  }
}

function getTxOn(pattern: readonly number[], idx: number): boolean {
  const bitOn = pattern[idx] === 1;
  return invertTransmission ? !bitOn : bitOn;
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

  const segmentMs = getSegmentMs();
  const totalMs   = segmentMs * TOTAL_SEGMENTS;
  const elapsed    = performance.now() - startTime;
  const posInLoop  = elapsed % totalMs;
  const segIdx     = Math.floor(posInLoop / segmentMs);
  const pattern    = DICTIONARY[selectedWord];
  const inListenWindow = segIdx >= PATTERN_LEN;
  const patternIdx = segIdx < PATTERN_LEN ? segIdx : segIdx - PATTERN_LEN;
  const torchOn    = !inListenWindow && getTxOn(pattern, patternIdx);

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
  const newLoops = Math.floor(elapsed / totalMs);
  if (newLoops !== loops) {
    loops = newLoops;
    loopCount.textContent = `Loop ${loops + 1}`;
  }

  loopCount.textContent = `Loop ${loops + 1} · ${inListenWindow ? 'LISTEN' : 'TX'} · ${txRateHz}Hz`;

  // Schedule next tick at the start of the next segment
  const nextBoundaryMs = (segIdx + 1) * segmentMs;
  const timeUntilNext  = nextBoundaryMs - posInLoop;
  timeoutId = setTimeout(tick, Math.max(1, timeUntilNext));
}

function startLoop(): void {
  startTime = performance.now();
  loops     = 0;
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
  modeFlashBtn.disabled = true;
  setMode('sound');
} else if (!likelyTorchDevice) {
  setMode('sound');
  setStatus('Sound mode selected by default. Flash mode is mainly supported on Android Chrome.');
}

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
