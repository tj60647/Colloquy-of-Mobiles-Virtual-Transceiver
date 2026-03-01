import { RollingStatsBuffer } from '../shared/samplePipeline.js';

const HISTORY = 220;
const SIGNAL_MIN_Y = 0;
const SIGNAL_MAX_Y = 255;
const Z_MIN_Y = -4;
const Z_MAX_Y = 4;

type SampleSource = 'simulated' | 'camera';

interface AxisMotionConfig {
  rangeMin: number;
  rangeMax: number;
  maxVelocity: number;
  maxAcceleration: number;
}

class MotionProfile1D {
  position: number;
  velocity = 0;
  private direction: 1 | -1 = 1;

  constructor(initialPos: number) {
    this.position = initialPos;
  }

  update(dt: number, cfg: AxisMotionConfig): void {
    const { rangeMin, rangeMax, maxVelocity, maxAcceleration } = cfg;
    if (rangeMax <= rangeMin || maxVelocity <= 0 || maxAcceleration <= 0) return;

    this.position = Math.max(rangeMin, Math.min(rangeMax, this.position));

    const target = this.direction > 0 ? rangeMax : rangeMin;
    const remaining = Math.abs(target - this.position);
    const rampSpeed = Math.sqrt(2 * maxAcceleration * Math.max(0, remaining));
    const desiredSpeed = Math.min(maxVelocity, rampSpeed);
    const desiredVel = this.direction * desiredSpeed;

    const maxDv = maxAcceleration * dt;
    this.velocity += Math.max(-maxDv, Math.min(maxDv, desiredVel - this.velocity));
    this.position += this.velocity * dt;

    if (this.direction > 0 && this.position >= rangeMax) {
      this.position = rangeMax;
      this.velocity = 0;
      this.direction = -1;
    } else if (this.direction < 0 && this.position <= rangeMin) {
      this.position = rangeMin;
      this.velocity = 0;
      this.direction = 1;
    }
  }

  reset(cfg: AxisMotionConfig): void {
    this.position = cfg.rangeMin;
    this.velocity = 0;
    this.direction = 1;
  }
}

const sourceEl = document.getElementById('sample-source') as HTMLSelectElement;
const hzEl = document.getElementById('hz') as HTMLInputElement;
const hzValEl = document.getElementById('hz-val') as HTMLSpanElement;
const windowEl = document.getElementById('window') as HTMLInputElement;
const windowValEl = document.getElementById('window-val') as HTMLSpanElement;
const zThrEl = document.getElementById('z-thr') as HTMLInputElement;
const zThrValEl = document.getElementById('z-thr-val') as HTMLSpanElement;
const baselineEl = document.getElementById('baseline') as HTMLInputElement;
const baselineValEl = document.getElementById('baseline-val') as HTMLSpanElement;
const noiseEl = document.getElementById('noise') as HTMLInputElement;
const noiseValEl = document.getElementById('noise-val') as HTMLSpanElement;
const driftEl = document.getElementById('drift') as HTMLInputElement;
const driftValEl = document.getElementById('drift-val') as HTMLSpanElement;
const pulseAmpEl = document.getElementById('pulse-amp') as HTMLInputElement;
const pulseAmpValEl = document.getElementById('pulse-amp-val') as HTMLSpanElement;
const pulseEveryEl = document.getElementById('pulse-every') as HTMLInputElement;
const pulseEveryValEl = document.getElementById('pulse-every-val') as HTMLSpanElement;
const sampleXRangeMinEl = document.getElementById('sample-x-range-min') as HTMLInputElement;
const sampleXRangeMinValEl = document.getElementById('sample-x-range-min-val') as HTMLSpanElement;
const sampleXRangeMaxEl = document.getElementById('sample-x-range-max') as HTMLInputElement;
const sampleXRangeMaxValEl = document.getElementById('sample-x-range-max-val') as HTMLSpanElement;
const sampleXMaxVelEl = document.getElementById('sample-x-max-vel') as HTMLInputElement;
const sampleXMaxVelValEl = document.getElementById('sample-x-max-vel-val') as HTMLSpanElement;
const sampleXMaxAccEl = document.getElementById('sample-x-max-acc') as HTMLInputElement;
const sampleXMaxAccValEl = document.getElementById('sample-x-max-acc-val') as HTMLSpanElement;
const runBtn = document.getElementById('btn-run') as HTMLButtonElement;
const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
const cameraPreviewEl = document.getElementById('camera-preview') as HTMLVideoElement;
const cameraStatusEl = document.getElementById('camera-status') as HTMLDivElement;
const sampleZoneEl = document.querySelector('.sample-zone') as HTMLDivElement;

const sampleNowEl = document.getElementById('sample-now') as HTMLDivElement;
const meanNowEl = document.getElementById('mean-now') as HTMLDivElement;
const stdNowEl = document.getElementById('std-now') as HTMLDivElement;
const maxNowEl = document.getElementById('max-now') as HTMLDivElement;
const zNowEl = document.getElementById('z-now') as HTMLDivElement;
const eventNowEl = document.getElementById('event-now') as HTMLDivElement;

const signalChartEl = document.getElementById('signal-chart') as HTMLCanvasElement;
const zChartEl = document.getElementById('z-chart') as HTMLCanvasElement;

let source: SampleSource = 'camera';
let hz = 20;
let windowSize = 40;
let zThreshold = 1.5;
let baseline = 100;
let noiseStd = 6;
let driftAmp = 8;
let pulseAmp = 30;
let pulseEvery = 40;
let sampleMotion: AxisMotionConfig = {
  rangeMin: -20,
  rangeMax: 20,
  maxVelocity: 30,
  maxAcceleration: 60,
};

let running = true;
let tickIndex = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let statsBuffer = new RollingStatsBuffer(windowSize);
let lastSampleValue = 0;
const sampleMotionProfile = new MotionProfile1D(sampleMotion.rangeMin);

let cameraStream: MediaStream | null = null;
let cameraReady = false;
const cameraCanvas = document.createElement('canvas');
cameraCanvas.width = 160;
cameraCanvas.height = 120;
const cameraCtx = cameraCanvas.getContext('2d', { willReadFrequently: true });

const sampleHistory: number[] = [];
const meanHistory: number[] = [];
const upperHistory: number[] = [];
const lowerHistory: number[] = [];
const zHistory: number[] = [];

function applyControlValues(): void {
  source = sourceEl.value === 'camera' ? 'camera' : 'simulated';
  hz = parseInt(hzEl.value, 10);
  windowSize = parseInt(windowEl.value, 10);
  zThreshold = parseFloat(zThrEl.value);
  baseline = parseInt(baselineEl.value, 10);
  noiseStd = parseInt(noiseEl.value, 10);
  driftAmp = parseInt(driftEl.value, 10);
  pulseAmp = parseInt(pulseAmpEl.value, 10);
  pulseEvery = parseInt(pulseEveryEl.value, 10);
  const rangeMin = parseInt(sampleXRangeMinEl.value, 10);
  const rangeMax = parseInt(sampleXRangeMaxEl.value, 10);
  sampleMotion = {
    rangeMin: Math.min(rangeMin, rangeMax),
    rangeMax: Math.max(rangeMin, rangeMax),
    maxVelocity: parseInt(sampleXMaxVelEl.value, 10),
    maxAcceleration: parseInt(sampleXMaxAccEl.value, 10),
  };

  hzValEl.textContent = String(hz);
  windowValEl.textContent = String(windowSize);
  zThrValEl.textContent = zThreshold.toFixed(2);
  baselineValEl.textContent = String(baseline);
  noiseValEl.textContent = String(noiseStd);
  driftValEl.textContent = String(driftAmp);
  pulseAmpValEl.textContent = String(pulseAmp);
  pulseEveryValEl.textContent = String(pulseEvery);
  sampleXRangeMinValEl.textContent = String(sampleMotion.rangeMin);
  sampleXRangeMaxValEl.textContent = String(sampleMotion.rangeMax);
  sampleXMaxVelValEl.textContent = String(sampleMotion.maxVelocity);
  sampleXMaxAccValEl.textContent = String(sampleMotion.maxAcceleration);
}

function getSampleOscOffsetFraction(): number {
  if (source !== 'camera') return 0;
  const clamped = Math.max(-45, Math.min(45, sampleMotionProfile.position));
  return clamped / 100;
}

function updateSampleZoneMarker(): void {
  const offset = getSampleOscOffsetFraction();
  const leftPct = 50 + offset * 50;
  sampleZoneEl.style.left = `${Math.max(5, Math.min(95, leftPct)).toFixed(2)}%`;
}

function setCameraStatus(msg: string): void {
  cameraStatusEl.textContent = msg;
}

function stopCamera(): void {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
  }
  cameraPreviewEl.srcObject = null;
  cameraReady = false;
}

async function ensureCamera(): Promise<boolean> {
  if (cameraReady && cameraStream) return true;

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    setCameraStatus('Camera APIs unavailable in this browser/environment.');
    return false;
  }

  try {
    setCameraStatus('Requesting camera access…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    cameraStream = stream;
    cameraPreviewEl.srcObject = stream;
    await cameraPreviewEl.play();
    cameraReady = true;
    setCameraStatus('Camera active. Sampling center-pixel luminance each tick.');
    return true;
  } catch (err) {
    cameraReady = false;
    const message = err instanceof Error ? err.message : String(err);
    setCameraStatus(`Camera unavailable: ${message}`);
    return false;
  }
}

function randNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function makeSimulatedSample(): number {
  const drift = driftAmp * Math.sin(tickIndex / 24);
  const noise = randNormal() * noiseStd;
  const pulseOn = pulseEvery > 0 && tickIndex % pulseEvery < 4;
  const pulse = pulseOn ? pulseAmp : 0;
  return clampByte(baseline + drift + noise + pulse);
}

function makeCameraSample(): number {
  if (!cameraReady || !cameraCtx || cameraPreviewEl.videoWidth === 0 || cameraPreviewEl.videoHeight === 0) {
    return lastSampleValue;
  }

  const w = cameraCanvas.width;
  const h = cameraCanvas.height;
  cameraCtx.drawImage(cameraPreviewEl, 0, 0, w, h);
  const offset = getSampleOscOffsetFraction();
  const maxOffsetPx = Math.floor((w / 2) - 1);
  const cx = Math.floor(w / 2 + offset * maxOffsetPx);
  const cy = Math.floor(h / 2);
  const pixel = cameraCtx.getImageData(cx, cy, 1, 1).data;
  return clampByte(0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]);
}

function makeSample(): number {
  if (source === 'camera') {
    const dt = Math.max(0.001, 1 / Math.max(1, hz));
    sampleMotionProfile.update(dt, sampleMotion);
    updateSampleZoneMarker();
  }

  const sample = source === 'camera' ? makeCameraSample() : makeSimulatedSample();
  lastSampleValue = sample;
  return sample;
}

function pushHistory(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > HISTORY) arr.splice(0, arr.length - HISTORY);
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  arr: number[],
  minY: number,
  maxY: number,
  color: string,
  w: number,
  h: number,
  width = 1.2,
): void {
  if (arr.length < 2) return;
  const range = Math.max(1e-6, maxY - minY);
  ctx.beginPath();
  for (let i = 0; i < arr.length; i++) {
    const x = (i / Math.max(1, arr.length - 1)) * (w - 1);
    const y = h - 1 - ((arr[i] - minY) / range) * (h - 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawSecondGrid(ctx: CanvasRenderingContext2D, w: number, h: number, points: number): void {
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

function drawSignalChart(): void {
  const ctx = signalChartEl.getContext('2d');
  if (!ctx) return;

  const w = signalChartEl.width;
  const h = signalChartEl.height;
  ctx.clearRect(0, 0, w, h);

  const minY = SIGNAL_MIN_Y;
  const maxY = SIGNAL_MAX_Y;
  const range = maxY - minY;

  drawSecondGrid(ctx, w, h, sampleHistory.length);

  if (upperHistory.length > 1 && lowerHistory.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < upperHistory.length; i++) {
      const x = (i / Math.max(1, upperHistory.length - 1)) * (w - 1);
      const y = h - 1 - ((upperHistory[i] - minY) / range) * (h - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = lowerHistory.length - 1; i >= 0; i--) {
      const x = (i / Math.max(1, lowerHistory.length - 1)) * (w - 1);
      const y = h - 1 - ((lowerHistory[i] - minY) / range) * (h - 2);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.fill();
  }

  drawSeries(ctx, meanHistory, minY, maxY, 'rgba(34, 211, 238, 0.95)', w, h, 1.4);
  drawSeries(ctx, sampleHistory, minY, maxY, 'rgba(165, 180, 252, 0.95)', w, h, 1.3);
}

function drawZChart(): void {
  const ctx = zChartEl.getContext('2d');
  if (!ctx) return;

  const w = zChartEl.width;
  const h = zChartEl.height;
  ctx.clearRect(0, 0, w, h);

  const minY = Z_MIN_Y;
  const maxY = Z_MAX_Y;

  drawSecondGrid(ctx, w, h, zHistory.length);

  const drawGuide = (value: number, color: string): void => {
    const y = h - 1 - ((value - minY) / (maxY - minY)) * (h - 2);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  drawGuide(0, 'rgba(125, 125, 125, 0.35)');
  drawGuide(zThreshold, 'rgba(239, 68, 68, 0.55)');
  drawGuide(-zThreshold, 'rgba(239, 68, 68, 0.55)');

  drawSeries(ctx, zHistory, minY, maxY, 'rgba(245, 158, 11, 0.95)', w, h, 1.4);
}

function renderNow(sample: number, mean: number, stddev: number, max: number, z: number): void {
  sampleNowEl.textContent = sample.toFixed(1);
  meanNowEl.textContent = mean.toFixed(1);
  stdNowEl.textContent = stddev.toFixed(2);
  maxNowEl.textContent = max.toFixed(1);
  zNowEl.textContent = z.toFixed(2);

  const event = Math.abs(z) >= zThreshold;
  eventNowEl.textContent = event ? 'YES' : 'no';
  eventNowEl.className = `v ${event ? 'bad' : 'ok'}`;

  zNowEl.className = `v ${Math.abs(z) >= zThreshold ? 'warn' : ''}`;
}

function resetState(): void {
  tickIndex = 0;
  statsBuffer = new RollingStatsBuffer(windowSize);
  sampleMotionProfile.reset(sampleMotion);
  updateSampleZoneMarker();
  lastSampleValue = source === 'camera' ? 0 : baseline;

  sampleHistory.length = 0;
  meanHistory.length = 0;
  upperHistory.length = 0;
  lowerHistory.length = 0;
  zHistory.length = 0;

  for (let i = 0; i < windowSize; i++) {
    const sample = makeSample();
    const stats = statsBuffer.push(sample);
    const z = stats.stddev > 1e-6 ? (sample - stats.mean) / stats.stddev : 0;

    pushHistory(sampleHistory, sample);
    pushHistory(meanHistory, stats.mean);
    pushHistory(upperHistory, stats.mean + stats.stddev);
    pushHistory(lowerHistory, stats.mean - stats.stddev);
    pushHistory(zHistory, z);
    tickIndex++;
  }

  const latestSample = sampleHistory[sampleHistory.length - 1] ?? 0;
  const latestMean = meanHistory[meanHistory.length - 1] ?? 0;
  const latestStd = Math.max(0, (upperHistory[upperHistory.length - 1] ?? 0) - latestMean);
  const latestMax = Math.max(...sampleHistory);
  const latestZ = zHistory[zHistory.length - 1] ?? 0;

  renderNow(latestSample, latestMean, latestStd, latestMax, latestZ);
  drawSignalChart();
  drawZChart();
}

function tick(): void {
  if (!running) return;

  const sample = makeSample();
  const stats = statsBuffer.push(sample);
  const z = stats.stddev > 1e-6 ? (sample - stats.mean) / stats.stddev : 0;

  pushHistory(sampleHistory, sample);
  pushHistory(meanHistory, stats.mean);
  pushHistory(upperHistory, stats.mean + stats.stddev);
  pushHistory(lowerHistory, stats.mean - stats.stddev);
  pushHistory(zHistory, z);

  renderNow(sample, stats.mean, stats.stddev, stats.max, z);
  drawSignalChart();
  drawZChart();

  tickIndex++;
  const intervalMs = Math.max(5, Math.round(1000 / hz));
  timer = setTimeout(tick, intervalMs);
}

function onControlChange(): void {
  applyControlValues();
  updateSampleZoneMarker();
  if (source === 'simulated') {
    setCameraStatus('Simulated source active.');
  }
  resetState();
}

async function onSourceChange(): Promise<void> {
  applyControlValues();

  const simControls = [baselineEl, noiseEl, driftEl, pulseAmpEl, pulseEveryEl];
  const usingCamera = source === 'camera';
  simControls.forEach((el) => {
    el.disabled = usingCamera;
  });

  if (usingCamera) {
    const ok = await ensureCamera();
    if (!ok) {
      source = 'simulated';
      sourceEl.value = 'simulated';
      simControls.forEach((el) => {
        el.disabled = false;
      });
      setCameraStatus('Camera unavailable. Falling back to simulated source.');
    }
  } else {
    stopCamera();
    setCameraStatus('Simulated source active.');
  }

  updateSampleZoneMarker();
  resetState();
}

[
  hzEl,
  windowEl,
  zThrEl,
  baselineEl,
  noiseEl,
  driftEl,
  pulseAmpEl,
  pulseEveryEl,
  sampleXRangeMinEl,
  sampleXRangeMaxEl,
  sampleXMaxVelEl,
  sampleXMaxAccEl,
].forEach((el) => {
  el.addEventListener('input', onControlChange);
  el.addEventListener('change', onControlChange);
});

sourceEl.addEventListener('change', () => {
  void onSourceChange();
});

runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.textContent = running ? 'Pause' : 'Run';
  if (running) {
    tick();
  } else if (timer) {
    clearTimeout(timer);
    timer = null;
  }
});

resetBtn.addEventListener('click', () => {
  applyControlValues();
  resetState();
});

applyControlValues();
updateSampleZoneMarker();
void onSourceChange().finally(() => {
  tick();
});

window.addEventListener('beforeunload', () => {
  stopCamera();
});
