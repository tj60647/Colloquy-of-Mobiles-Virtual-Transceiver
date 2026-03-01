import { AUDIO_TONE_FREQS } from '../shared/dictionary.js';
import { RollingStatsBuffer } from '../shared/samplePipeline.js';
import { TickOrchestrator } from '../shared/tickOrchestrator.js';
import {
  MetricsPanelRenderer,
  PositiveZEventChartRenderer,
  ZScoreChartRenderer,
} from './backgroundStatsRenderers.js';

const HISTORY = 220;
const SIGNAL_MIN_Y = 0;
const SIGNAL_MAX_Y = 255;
const Z_MIN_Y = -4;
const Z_MAX_Y = 4;
const SPECTROGRAM_MAX_HZ = 3000;

class AudioSpectrumSource {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private freqData = new Uint8Array(0);
  private lastSpectrum = new Uint8Array(0);

  async initialize(): Promise<void> {
    if (this.analyser) return;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('Microphone APIs are not available in this browser.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });

    this.audioCtx = new AudioContext();
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.12;

    this.sourceNode.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.lastSpectrum = new Uint8Array(160);
  }

  get initialized(): boolean {
    return !!this.analyser && !!this.audioCtx;
  }

  get sampleRate(): number {
    return this.audioCtx?.sampleRate ?? 0;
  }

  updateSpectrum(): void {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    this.lastSpectrum = this.downsampleSpectrum(160, SPECTROGRAM_MAX_HZ);
  }

  getSpectrumSnapshot(): Uint8Array {
    return this.lastSpectrum;
  }

  sampleBand(centerHz: number, bandwidthHz: number): number {
    return this.meanBandEnergy(centerHz, bandwidthHz);
  }

  sampleBandWithSideRatio(centerHz: number, bandwidthHz: number): { sample: number; sideRatio: number; sideMean: number } {
    const target = this.meanBandEnergy(centerHz, bandwidthHz);
    const leftSide = this.meanBandEnergy(centerHz - bandwidthHz, bandwidthHz);
    const rightSide = this.meanBandEnergy(centerHz + bandwidthHz, bandwidthHz);
    const sideMean = (leftSide + rightSide) / 2;
    const sideRatio = target / Math.max(1, sideMean);
    return { sample: target, sideRatio, sideMean };
  }

  private meanBandEnergy(centerHz: number, bandwidthHz: number): number {
    if (!this.analyser || !this.audioCtx || this.freqData.length === 0) return 0;

    const nyquist = this.audioCtx.sampleRate / 2;
    const binHz = nyquist / this.freqData.length;
    const halfBw = Math.max(1, bandwidthHz / 2);
    const lowHz = Math.max(0, centerHz - halfBw);
    const highHz = Math.min(nyquist, centerHz + halfBw);

    const lowBin = Math.max(0, Math.floor(lowHz / binHz));
    const highBin = Math.min(this.freqData.length - 1, Math.ceil(highHz / binHz));

    let sum = 0;
    let count = 0;
    for (let i = lowBin; i <= highBin; i++) {
      sum += this.freqData[i];
      count++;
    }

    return count > 0 ? Math.round(sum / count) : 0;
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
    }

    this.analyser = null;
    this.sourceNode = null;
    this.freqData = new Uint8Array(0);
    this.lastSpectrum = new Uint8Array(0);
  }

  private downsampleSpectrum(binCount: number, maxHz: number): Uint8Array {
    if (!this.audioCtx || this.freqData.length === 0) return new Uint8Array(0);

    const out = new Uint8Array(binCount);
    const nyquist = this.audioCtx.sampleRate / 2;
    const clampedMaxHz = Math.max(1, Math.min(maxHz, nyquist));
    const maxBin = Math.max(1, Math.floor((clampedMaxHz / nyquist) * this.freqData.length));

    const srcLen = maxBin;
    const scale = srcLen / binCount;

    for (let i = 0; i < binCount; i++) {
      const start = Math.floor(i * scale);
      const end = Math.max(start + 1, Math.floor((i + 1) * scale));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < srcLen; j++) {
        sum += this.freqData[j];
        count++;
      }
      out[i] = count > 0 ? Math.round(sum / count) : 0;
    }

    return out;
  }
}

class SpectrogramRenderer {
  private secondAccumulatorMs = 0;
  private sampleAccumulatorMs = 0;
  private readonly historyCanvas: HTMLCanvasElement;
  private readonly historyCtx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly maxHz: number) {
    this.historyCanvas = document.createElement('canvas');
    this.historyCanvas.width = this.canvas.width;
    this.historyCanvas.height = this.canvas.height;
    const ctx = this.historyCanvas.getContext('2d');
    if (!ctx) throw new Error('Failed to initialize spectrogram history context.');
    this.historyCtx = ctx;
  }

  private ensureSize(): void {
    if (this.historyCanvas.width !== this.canvas.width || this.historyCanvas.height !== this.canvas.height) {
      this.historyCanvas.width = this.canvas.width;
      this.historyCanvas.height = this.canvas.height;
    }
  }

  render(spectrum: Uint8Array, centerHz: number, bandwidthHz: number, dtMs: number, sampleHz: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    this.ensureSize();

    const w = this.canvas.width;
    const h = this.canvas.height;

    this.historyCtx.drawImage(this.historyCanvas, -1, 0);

    this.secondAccumulatorMs += Math.max(0, dtMs);
    let drawSecondMarker = false;
    while (this.secondAccumulatorMs >= 1000) {
      this.secondAccumulatorMs -= 1000;
      drawSecondMarker = true;
    }

    const sampleIntervalMs = 1000 / Math.max(1, sampleHz);
    this.sampleAccumulatorMs += Math.max(0, dtMs);
    let drawSampleMarker = false;
    while (this.sampleAccumulatorMs >= sampleIntervalMs) {
      this.sampleAccumulatorMs -= sampleIntervalMs;
      drawSampleMarker = true;
    }

    for (let y = 0; y < h; y++) {
      const t = 1 - (y / Math.max(1, h - 1));
      const idx = Math.max(0, Math.min(spectrum.length - 1, Math.floor(t * (spectrum.length - 1))));
      const v = spectrum[idx] ?? 0;
      const r = Math.min(255, v + 25);
      const g = Math.min(255, Math.floor(v * 0.65) + 20);
      const b = Math.min(255, Math.floor(v * 0.35) + 15);
      this.historyCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      this.historyCtx.fillRect(w - 1, y, 1, 1);
    }

    if (drawSampleMarker) {
      const x = w - 1;
      this.historyCtx.beginPath();
      this.historyCtx.moveTo(x, 0);
      this.historyCtx.lineTo(x, h);
      this.historyCtx.strokeStyle = 'rgba(180, 180, 180, 0.08)';
      this.historyCtx.lineWidth = 1;
      this.historyCtx.stroke();
    }

    if (drawSecondMarker) {
      const x = w - 1;
      this.historyCtx.beginPath();
      this.historyCtx.moveTo(x, 0);
      this.historyCtx.lineTo(x, h);
      this.historyCtx.strokeStyle = 'rgba(180, 180, 180, 0.18)';
      this.historyCtx.lineWidth = 1;
      this.historyCtx.stroke();
    }

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.historyCanvas, 0, 0);

    const halfBw = Math.max(1, bandwidthHz / 2);
    const low = Math.max(0, centerHz - halfBw);
    const high = Math.min(this.maxHz, centerHz + halfBw);

    const yForHz = (hz: number): number => {
      const norm = Math.max(0, Math.min(1, hz / this.maxHz));
      return h - 1 - norm * (h - 1);
    };

    const yLow = yForHz(low);
    const yHigh = yForHz(high);
    const yCenter = yForHz(centerHz);

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yLow);
    ctx.lineTo(w, yLow);
    ctx.moveTo(0, yHigh);
    ctx.lineTo(w, yHigh);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, yCenter);
    ctx.lineTo(w, yCenter);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.95)';
    ctx.stroke();

    const drawPoint = (y: number, color: string): void => {
      ctx.beginPath();
      ctx.arc(w - 3, y, 2.1, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    drawPoint(yLow, 'rgba(148, 163, 184, 0.95)');
    drawPoint(yHigh, 'rgba(148, 163, 184, 0.95)');
    drawPoint(yCenter, 'rgba(56, 189, 248, 1)');

  }
}

class CenterSideChartRenderer {
  constructor(private readonly canvas: HTMLCanvasElement, private readonly minY: number, private readonly maxY: number) {}

  private drawSeries(
    ctx: CanvasRenderingContext2D,
    arr: number[],
    color: string,
    w: number,
    h: number,
    width = 1.3,
  ): void {
    if (arr.length < 2) return;
    const range = Math.max(1e-6, this.maxY - this.minY);
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = (i / Math.max(1, arr.length - 1)) * (w - 1);
      const y = h - 1 - ((arr[i] - this.minY) / range) * (h - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  private drawSampleGrid(ctx: CanvasRenderingContext2D, w: number, h: number, points: number): void {
    if (points < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < points; i++) {
      const x = (i / Math.max(1, points - 1)) * (w - 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSecondGrid(ctx: CanvasRenderingContext2D, w: number, h: number, points: number, hz: number, tickIndex: number): void {
    if (points < 2 || hz <= 0) return;
    const startGlobalIndex = tickIndex - (points - 1);
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i < points; i++) {
      const globalIndex = startGlobalIndex + i;
      if (globalIndex <= 0 || globalIndex % hz !== 0) continue;
      const x = (i / Math.max(1, points - 1)) * (w - 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  render(centerHistory: number[], sideHistory: number[], hz: number, tickIndex: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const points = Math.min(centerHistory.length, sideHistory.length);
    this.drawSampleGrid(ctx, w, h, points);
    this.drawSecondGrid(ctx, w, h, points, hz, tickIndex);

    this.drawSeries(ctx, sideHistory, 'rgba(148, 163, 184, 0.95)', w, h, 1.2);
    this.drawSeries(ctx, centerHistory, 'rgba(165, 180, 252, 0.95)', w, h, 1.35);
  }
}

const hzEl = document.getElementById('hz') as HTMLInputElement;
const hzValEl = document.getElementById('hz-val') as HTMLSpanElement;
const windowEl = document.getElementById('window') as HTMLInputElement;
const windowValEl = document.getElementById('window-val') as HTMLSpanElement;
const zThrEl = document.getElementById('z-thr') as HTMLInputElement;
const zThrValEl = document.getElementById('z-thr-val') as HTMLSpanElement;
const sigmaFloorEl = document.getElementById('sigma-floor') as HTMLInputElement;
const sigmaFloorValEl = document.getElementById('sigma-floor-val') as HTMLSpanElement;
const deltaFloorEl = document.getElementById('delta-floor') as HTMLInputElement;
const deltaFloorValEl = document.getElementById('delta-floor-val') as HTMLSpanElement;
const sideRatioFloorEl = document.getElementById('side-ratio-floor') as HTMLInputElement;
const sideRatioFloorValEl = document.getElementById('side-ratio-floor-val') as HTMLSpanElement;
const freezeBgOnEventEl = document.getElementById('freeze-bg-on-event') as HTMLInputElement;
const centerFreqEl = document.getElementById('center-freq') as HTMLInputElement;
const centerFreqValEl = document.getElementById('center-freq-val') as HTMLSpanElement;
const bandwidthEl = document.getElementById('bandwidth') as HTMLInputElement;
const bandwidthValEl = document.getElementById('bandwidth-val') as HTMLSpanElement;
const runBtn = document.getElementById('btn-run') as HTMLButtonElement;
const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
const audioStatusEl = document.getElementById('audio-status') as HTMLDivElement;

const sampleNowEl = document.getElementById('sample-now') as HTMLDivElement;
const meanNowEl = document.getElementById('mean-now') as HTMLDivElement;
const stdNowEl = document.getElementById('std-now') as HTMLDivElement;
const maxNowEl = document.getElementById('max-now') as HTMLDivElement;
const zNowEl = document.getElementById('z-now') as HTMLDivElement;
const eventNowEl = document.getElementById('event-now') as HTMLDivElement;

const spectrogramEl = document.getElementById('spectrogram') as HTMLCanvasElement;
const signalChartEl = document.getElementById('signal-chart') as HTMLCanvasElement;
const zChartEl = document.getElementById('z-chart') as HTMLCanvasElement;
const zPosEventChartEl = document.getElementById('z-pos-event-chart') as HTMLCanvasElement;

const metricsRenderer = new MetricsPanelRenderer(sampleNowEl, meanNowEl, stdNowEl, maxNowEl, zNowEl, eventNowEl);
const centerSideChartRenderer = new CenterSideChartRenderer(signalChartEl, SIGNAL_MIN_Y, SIGNAL_MAX_Y);
const zChartRenderer = new ZScoreChartRenderer(zChartEl, Z_MIN_Y, Z_MAX_Y);
const zPosEventChartRenderer = new PositiveZEventChartRenderer(zPosEventChartEl);
const spectrogramRenderer = new SpectrogramRenderer(spectrogramEl, SPECTROGRAM_MAX_HZ);

let hz = 20;
let windowSize = 200;
let zThreshold = 2.0;
let sigmaFloor = 4.0;
let deltaFloor = 15;
let sideRatioFloor = 1.8;
let freezeBackgroundOnEvent = true;
let centerFreqToneIdx = 2;
let centerFreqHz = AUDIO_TONE_FREQS[centerFreqToneIdx];
let bandwidthHz = 200;
let running = true;
let tickIndex = 0;
let latestRollingMean = 0;

let statsBuffer = new RollingStatsBuffer(windowSize);

const sampleHistory: number[] = [];
const meanHistory: number[] = [];
const upperHistory: number[] = [];
const lowerHistory: number[] = [];
const zHistory: number[] = [];
const eventHistory: boolean[] = [];
const sideRatioHistory: number[] = [];
const sideMeanHistory: number[] = [];

const source = new AudioSpectrumSource();
const orchestrator = new TickOrchestrator(hz, {
  onFrame: ({ dtMs }) => {
    source.updateSpectrum();
    spectrogramRenderer.render(source.getSpectrumSnapshot(), centerFreqHz, bandwidthHz, dtMs, hz);
  },
  onTick: () => {
    runTick();
  },
});

function setStatus(msg: string): void {
  audioStatusEl.textContent = msg;
}

function applyControlValues(): void {
  hz = parseInt(hzEl.value, 10);
  windowSize = parseInt(windowEl.value, 10);
  zThreshold = parseFloat(zThrEl.value);
  sigmaFloor = parseFloat(sigmaFloorEl.value);
  deltaFloor = parseInt(deltaFloorEl.value, 10);
  sideRatioFloor = parseFloat(sideRatioFloorEl.value);
  freezeBackgroundOnEvent = freezeBgOnEventEl.checked;
  const maxIdx = AUDIO_TONE_FREQS.length - 1;
  centerFreqToneIdx = Math.max(0, Math.min(maxIdx, parseInt(centerFreqEl.value, 10)));
  centerFreqHz = AUDIO_TONE_FREQS[centerFreqToneIdx];
  bandwidthHz = parseInt(bandwidthEl.value, 10);

  hzValEl.textContent = String(hz);
  windowValEl.textContent = String(windowSize);
  zThrValEl.textContent = zThreshold.toFixed(2);
  sigmaFloorValEl.textContent = sigmaFloor.toFixed(1);
  deltaFloorValEl.textContent = String(deltaFloor);
  sideRatioFloorValEl.textContent = sideRatioFloor.toFixed(2);
  centerFreqEl.value = String(centerFreqToneIdx);
  centerFreqValEl.textContent = String(centerFreqHz);
  bandwidthValEl.textContent = String(bandwidthHz);
}

function pushHistory<T>(arr: T[], value: T): void {
  arr.push(value);
  if (arr.length > HISTORY) arr.splice(0, arr.length - HISTORY);
}

function detectEvent(sample: number, mean: number, stddev: number, sideRatio: number): { z: number; event: boolean } {
  const stdEff = Math.max(sigmaFloor, stddev);
  const delta = sample - mean;
  const z = stdEff > 1e-6 ? delta / stdEff : 0;
  const event = z >= zThreshold && delta >= deltaFloor && sideRatio >= sideRatioFloor;
  return { z, event };
}

function recomputeDerivedHistories(): void {
  zHistory.length = 0;
  eventHistory.length = 0;

  const n = Math.min(sampleHistory.length, meanHistory.length, upperHistory.length);
  for (let i = 0; i < n; i++) {
    const sample = sampleHistory[i];
    const mean = meanHistory[i];
    const stddev = Math.max(0, upperHistory[i] - mean);
    const sideRatio = sideRatioHistory[i] ?? 1;
    const { z, event } = detectEvent(sample, mean, stddev, sideRatio);
    zHistory.push(z);
    eventHistory.push(event);
  }
}

function renderAll(sample: number, mean: number, stddev: number, max: number, z: number, eventDetected: boolean): void {
  metricsRenderer.render({ sample, mean, stddev, max, z, zThreshold, eventDetected });
  centerSideChartRenderer.render(sampleHistory, sideMeanHistory, hz, tickIndex);
  zChartRenderer.render({ zHistory, zThreshold, hz, tickIndex });
  zPosEventChartRenderer.render({ eventHistory, hz, tickIndex });
}

function rebuildStatsBufferFromHistory(): void {
  const rebuilt = new RollingStatsBuffer(windowSize);
  const start = Math.max(0, sampleHistory.length - windowSize);
  for (let i = start; i < sampleHistory.length; i++) {
    rebuilt.push(sampleHistory[i]);
  }
  statsBuffer = rebuilt;
}

function refreshRenderFromCurrentState(): void {
  recomputeDerivedHistories();
  const latestSample = sampleHistory[sampleHistory.length - 1] ?? 0;
  const stats = statsBuffer.snapshot();
  const latestSideRatio = sideRatioHistory[sideRatioHistory.length - 1] ?? 1;
  const { z, event } = detectEvent(latestSample, stats.mean, stats.stddev, latestSideRatio);
  latestRollingMean = stats.mean;
  renderAll(latestSample, stats.mean, stats.stddev, stats.max, z, event);
}

function resetState(): void {
  orchestrator.resetTimeline();
  tickIndex = 0;
  statsBuffer = new RollingStatsBuffer(windowSize);

  sampleHistory.length = 0;
  meanHistory.length = 0;
  upperHistory.length = 0;
  lowerHistory.length = 0;
  zHistory.length = 0;
  eventHistory.length = 0;
  sideRatioHistory.length = 0;
  sideMeanHistory.length = 0;

  for (let i = 0; i < windowSize; i++) {
    source.updateSpectrum();
    const reading = source.sampleBandWithSideRatio(centerFreqHz, bandwidthHz);
    const sample = reading.sample;
    const stats = statsBuffer.push(sample);
    const { z, event } = detectEvent(sample, stats.mean, stats.stddev, reading.sideRatio);

    pushHistory(sampleHistory, sample);
    pushHistory(meanHistory, stats.mean);
    pushHistory(upperHistory, stats.mean + stats.stddev);
    pushHistory(lowerHistory, stats.mean - stats.stddev);
    pushHistory(zHistory, z);
    pushHistory(eventHistory, event);
    pushHistory(sideRatioHistory, reading.sideRatio);
    pushHistory(sideMeanHistory, reading.sideMean);
    tickIndex++;
  }

  const latestSample = sampleHistory[sampleHistory.length - 1] ?? 0;
  const latestMean = meanHistory[meanHistory.length - 1] ?? 0;
  const latestStd = Math.max(0, (upperHistory[upperHistory.length - 1] ?? 0) - latestMean);
  const latestMax = Math.max(...sampleHistory);
  const latestZ = zHistory[zHistory.length - 1] ?? 0;
  const latestEvent = eventHistory[eventHistory.length - 1] ?? false;

  latestRollingMean = latestMean;
  renderAll(latestSample, latestMean, latestStd, latestMax, latestZ, latestEvent);
}

function runTick(): void {
  const reading = source.sampleBandWithSideRatio(centerFreqHz, bandwidthHz);
  const sample = reading.sample;

  const prevStats = statsBuffer.snapshot();
  const { event: prevEvent } = detectEvent(sample, prevStats.mean, prevStats.stddev, reading.sideRatio);
  const shouldFreeze = freezeBackgroundOnEvent && prevEvent;

  const stats = shouldFreeze ? prevStats : statsBuffer.push(sample);
  const { z, event } = detectEvent(sample, stats.mean, stats.stddev, reading.sideRatio);

  pushHistory(sampleHistory, sample);
  pushHistory(meanHistory, stats.mean);
  pushHistory(upperHistory, stats.mean + stats.stddev);
  pushHistory(lowerHistory, stats.mean - stats.stddev);
  pushHistory(zHistory, z);
  pushHistory(eventHistory, event);
  pushHistory(sideRatioHistory, reading.sideRatio);
  pushHistory(sideMeanHistory, reading.sideMean);

  latestRollingMean = stats.mean;
  renderAll(sample, stats.mean, stats.stddev, stats.max, z, event);
  tickIndex++;
}

function onControlChange(): void {
  const prevWindowSize = windowSize;
  applyControlValues();
  orchestrator.setTargetHz(hz);

  if (windowSize !== prevWindowSize) {
    rebuildStatsBufferFromHistory();
  }

  refreshRenderFromCurrentState();
}

[
  hzEl,
  windowEl,
  zThrEl,
  sigmaFloorEl,
  deltaFloorEl,
  sideRatioFloorEl,
  freezeBgOnEventEl,
  centerFreqEl,
  bandwidthEl,
].forEach((el) => {
  el.addEventListener('input', onControlChange);
  el.addEventListener('change', onControlChange);
});

runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.textContent = running ? 'Pause' : 'Run';
  if (running) orchestrator.start();
  else orchestrator.stop();
});

resetBtn.addEventListener('click', () => {
  applyControlValues();
  resetState();
});

async function main(): Promise<void> {
  applyControlValues();
  setStatus('Requesting microphone access…');

  try {
    await source.initialize();
    setStatus('Microphone active. Spectrogram running.');
    resetState();
    if (running) orchestrator.start();
  } catch (err) {
    setStatus(`Microphone unavailable: ${String(err)}`);
  }
}

void main();

window.addEventListener('beforeunload', () => {
  orchestrator.stop();
  void source.stop();
});
