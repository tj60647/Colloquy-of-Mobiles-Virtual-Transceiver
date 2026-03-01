import { RollingStatsBuffer } from '../shared/samplePipeline.js';
import { TickOrchestrator } from '../shared/tickOrchestrator.js';
import {
  MetricsPanelRenderer,
  PositiveZEventChartRenderer,
  SignalChartRenderer,
  VideoPreviewRenderer,
  ZScoreChartRenderer,
} from './backgroundStatsRenderers.js';
import {
  MovingSampleSource,
  type AxisMotionConfig,
  type SampleSourceMode,
  type SimulatedSignalConfig,
} from './movingSampleSource.js';

const HISTORY = 220;
const SIGNAL_MIN_Y = 0;
const SIGNAL_MAX_Y = 255;
const Z_MIN_Y = -4;
const Z_MAX_Y = 4;

const sourceEl = document.getElementById('sample-source') as HTMLSelectElement;
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
const freezeBgOnEventEl = document.getElementById('freeze-bg-on-event') as HTMLInputElement;
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
const cameraHFovEl = document.getElementById('camera-h-fov') as HTMLInputElement;
const cameraHFovValEl = document.getElementById('camera-h-fov-val') as HTMLSpanElement;
const sampleDiameterEl = document.getElementById('sample-diameter') as HTMLInputElement;
const sampleDiameterValEl = document.getElementById('sample-diameter-val') as HTMLSpanElement;
const cameraGrayscaleEl = document.getElementById('camera-grayscale') as HTMLInputElement;
const cameraExposureEl = document.getElementById('camera-exposure') as HTMLInputElement;
const cameraExposureValEl = document.getElementById('camera-exposure-val') as HTMLSpanElement;
const cameraExposureAvailabilityEl = document.getElementById('camera-exposure-availability') as HTMLSpanElement;
const runBtn = document.getElementById('btn-run') as HTMLButtonElement;
const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;
const cameraPreviewEl = document.getElementById('camera-preview') as HTMLVideoElement;
const cameraStatusEl = document.getElementById('camera-status') as HTMLDivElement;
const cameraParamsEl = document.getElementById('camera-params') as HTMLDivElement;
const sampleZoneEl = document.querySelector('.sample-zone') as HTMLDivElement;

const sampleNowEl = document.getElementById('sample-now') as HTMLDivElement;
const meanNowEl = document.getElementById('mean-now') as HTMLDivElement;
const stdNowEl = document.getElementById('std-now') as HTMLDivElement;
const maxNowEl = document.getElementById('max-now') as HTMLDivElement;
const zNowEl = document.getElementById('z-now') as HTMLDivElement;
const eventNowEl = document.getElementById('event-now') as HTMLDivElement;

const signalChartEl = document.getElementById('signal-chart') as HTMLCanvasElement;
const zChartEl = document.getElementById('z-chart') as HTMLCanvasElement;
const zPosEventChartEl = document.getElementById('z-pos-event-chart') as HTMLCanvasElement;
const helpModalBackdropEl = document.getElementById('help-modal-backdrop') as HTMLDivElement;
const helpModalEl = document.getElementById('help-modal') as HTMLDivElement;
const helpModalTitleEl = document.getElementById('help-modal-title') as HTMLHeadingElement;
const helpModalBodyEl = document.getElementById('help-modal-body') as HTMLParagraphElement;
const helpModalCloseEl = document.getElementById('help-modal-close') as HTMLButtonElement;

const videoPreviewRenderer = new VideoPreviewRenderer(sampleZoneEl);
const metricsRenderer = new MetricsPanelRenderer(
  sampleNowEl,
  meanNowEl,
  stdNowEl,
  maxNowEl,
  zNowEl,
  eventNowEl,
);
const signalChartRenderer = new SignalChartRenderer(signalChartEl, SIGNAL_MIN_Y, SIGNAL_MAX_Y);
const zChartRenderer = new ZScoreChartRenderer(zChartEl, Z_MIN_Y, Z_MAX_Y);
const zPosEventChartRenderer = new PositiveZEventChartRenderer(zPosEventChartEl);

let source: SampleSourceMode = 'camera';
let hz = 20;
let windowSize = 200;
let zThreshold = 2.0;
let sigmaFloor = 4.0;
let deltaFloor = 15;
let freezeBackgroundOnEvent = true;
let cameraHFov = 90;
let sampleDiameterDeg = 12.5;
let grayscaleEnabled = true;
let exposureTime = 0;
let running = true;
let tickIndex = 0;
let latestRollingMean = 0;

function formatExposureTimeUs(value: number): string {
  return `${value.toFixed(0)}`;
}

let motionConfig: AxisMotionConfig = {
  rangeMin: -40,
  rangeMax: 40,
  maxVelocity: 5,
  maxAcceleration: 5,
};

let simulatedConfig: SimulatedSignalConfig = {
  baseline: 100,
  noiseStd: 6,
  driftAmp: 8,
  pulseAmp: 30,
  pulseEvery: 40,
};

let statsBuffer = new RollingStatsBuffer(windowSize);

const sampleHistory: number[] = [];
const meanHistory: number[] = [];
const upperHistory: number[] = [];
const lowerHistory: number[] = [];
const zHistory: number[] = [];
const eventHistory: boolean[] = [];

const movingSource = new MovingSampleSource(cameraPreviewEl, motionConfig, simulatedConfig);
const orchestrator = new TickOrchestrator(hz, {
  onFrame: ({ dtMs }) => {
    movingSource.updateFrame(dtMs);
    updateSampleZoneMarker();
  },
  onTick: () => {
    runTick();
  },
});

const sliderHelpText: Record<string, { title: string; body: string }> = {
  hz: {
    title: 'Sample rate (Hz)',
    body: 'How often the detector samples luminance each second. Higher values react faster but may increase noise sensitivity.',
  },
  window: {
    title: 'Window size (samples)',
    body: 'How many recent samples are used for rolling mean/stddev. Larger windows are steadier; smaller windows adapt faster.',
  },
  'z-thr': {
    title: 'Z threshold',
    body: 'Minimum z-score required for a potential event after sigma-floor normalization.',
  },
  'sigma-floor': {
    title: 'Sigma floor',
    body: 'Lower bound for stddev in z-score math: z = (sample - mean) / max(stddev, sigmaFloor). Prevents over-triggering in very dark/quiet scenes.',
  },
  'delta-floor': {
    title: 'Delta floor',
    body: 'Absolute minimum brightness jump (sample - mean) required to count as event. Helps ignore tiny variations that are statistically large but visually dark.',
  },
  baseline: {
    title: 'Baseline',
    body: 'Simulated mode: base luminance level around which synthetic signal varies.',
  },
  noise: {
    title: 'Noise stddev',
    body: 'Simulated mode: random fluctuation strength around baseline.',
  },
  drift: {
    title: 'Slow drift amp',
    body: 'Simulated mode: low-frequency brightness drift amplitude.',
  },
  'pulse-amp': {
    title: 'Pulse amplitude',
    body: 'Simulated mode: additional brightness added during pulse events.',
  },
  'pulse-every': {
    title: 'Pulse every N ticks',
    body: 'Simulated mode: pulse repeat interval in sample ticks.',
  },
  'sample-x-range-min': {
    title: 'X range min (°)',
    body: 'Leftmost sweep angle for camera sampling point relative to optical center.',
  },
  'sample-x-range-max': {
    title: 'X range max (°)',
    body: 'Rightmost sweep angle for camera sampling point relative to optical center.',
  },
  'sample-x-max-vel': {
    title: 'X max vel (°/s)',
    body: 'Maximum horizontal sweep speed of the sample point.',
  },
  'sample-x-max-acc': {
    title: 'X max acc (°/s²)',
    body: 'Maximum horizontal sweep acceleration/deceleration.',
  },
  'camera-h-fov': {
    title: 'Camera H-FoV (°)',
    body: 'Horizontal field-of-view used to map angle controls to frame position when camera metadata is missing or overridden.',
  },
  'sample-diameter': {
    title: 'Sample diameter (°)',
    body: 'Angular diameter of the circular region averaged for each sample. Larger values smooth local noise and spatial flicker.',
  },
  'camera-exposure': {
    title: 'Exposure time (µs)',
    body: 'Approximate shutter-open duration from camera controls when supported by browser/device. Longer exposure increases brightness and motion blur.',
  },
};

function openHelpModal(title: string, body: string): void {
  helpModalTitleEl.textContent = title;
  helpModalBodyEl.textContent = body;
  helpModalBackdropEl.classList.add('visible');
  helpModalBackdropEl.setAttribute('aria-hidden', 'false');
}

function closeHelpModal(): void {
  helpModalBackdropEl.classList.remove('visible');
  helpModalBackdropEl.setAttribute('aria-hidden', 'true');
}

function initSliderHelp(): void {
  for (const [id, help] of Object.entries(sliderHelpText)) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input || input.type !== 'range') continue;

    const label = document.querySelector(`label[for="${id}"]`) as HTMLLabelElement | null;
    if (!label) continue;
    if (label.parentElement?.querySelector('.info-btn')) continue;

    const row = document.createElement('div');
    row.className = 'label-row';
    label.parentElement?.insertBefore(row, label);
    row.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'info-btn';
    btn.textContent = 'i';
    btn.setAttribute('aria-label', `Info: ${help.title}`);
    btn.addEventListener('click', () => {
      openHelpModal(help.title, help.body);
    });
    row.appendChild(btn);
  }

  helpModalCloseEl.addEventListener('click', closeHelpModal);
  helpModalBackdropEl.addEventListener('click', (event) => {
    if (event.target === helpModalBackdropEl) closeHelpModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && helpModalBackdropEl.classList.contains('visible')) {
      closeHelpModal();
    }
  });
  helpModalEl.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

function setCameraStatus(msg: string): void {
  cameraStatusEl.textContent = msg;
}

function setSimControlsDisabled(disabled: boolean): void {
  const simControls = [baselineEl, noiseEl, driftEl, pulseAmpEl, pulseEveryEl];
  simControls.forEach((el) => {
    el.disabled = disabled;
  });
}

function applyControlValues(): void {
  source = sourceEl.value === 'camera' ? 'camera' : 'simulated';
  hz = parseInt(hzEl.value, 10);
  windowSize = parseInt(windowEl.value, 10);
  zThreshold = parseFloat(zThrEl.value);
  sigmaFloor = parseFloat(sigmaFloorEl.value);
  deltaFloor = parseInt(deltaFloorEl.value, 10);
  freezeBackgroundOnEvent = freezeBgOnEventEl.checked;

  const rangeMin = parseFloat(sampleXRangeMinEl.value);
  const rangeMax = parseFloat(sampleXRangeMaxEl.value);
  motionConfig = {
    rangeMin: Math.min(rangeMin, rangeMax),
    rangeMax: Math.max(rangeMin, rangeMax),
    maxVelocity: parseFloat(sampleXMaxVelEl.value),
    maxAcceleration: parseFloat(sampleXMaxAccEl.value),
  };

  cameraHFov = parseFloat(cameraHFovEl.value);
  sampleDiameterDeg = parseFloat(sampleDiameterEl.value);
  grayscaleEnabled = cameraGrayscaleEl.checked;
  exposureTime = parseFloat(cameraExposureEl.value);

  simulatedConfig = {
    baseline: parseInt(baselineEl.value, 10),
    noiseStd: parseInt(noiseEl.value, 10),
    driftAmp: parseInt(driftEl.value, 10),
    pulseAmp: parseInt(pulseAmpEl.value, 10),
    pulseEvery: parseInt(pulseEveryEl.value, 10),
  };

  hzValEl.textContent = String(hz);
  windowValEl.textContent = String(windowSize);
  zThrValEl.textContent = zThreshold.toFixed(2);
  sigmaFloorValEl.textContent = sigmaFloor.toFixed(1);
  deltaFloorValEl.textContent = String(deltaFloor);

  baselineValEl.textContent = String(simulatedConfig.baseline);
  noiseValEl.textContent = String(simulatedConfig.noiseStd);
  driftValEl.textContent = String(simulatedConfig.driftAmp);
  pulseAmpValEl.textContent = String(simulatedConfig.pulseAmp);
  pulseEveryValEl.textContent = String(simulatedConfig.pulseEvery);

  sampleXRangeMinValEl.textContent = motionConfig.rangeMin.toFixed(1);
  sampleXRangeMaxValEl.textContent = motionConfig.rangeMax.toFixed(1);
  sampleXMaxVelValEl.textContent = motionConfig.maxVelocity.toFixed(1);
  sampleXMaxAccValEl.textContent = motionConfig.maxAcceleration.toFixed(1);
  cameraHFovValEl.textContent = cameraHFov.toFixed(1);
  sampleDiameterValEl.textContent = sampleDiameterDeg.toFixed(1);
  cameraExposureValEl.textContent = formatExposureTimeUs(exposureTime);

  renderCameraParameterSummary();
}

function syncSourceConfigs(): void {
  movingSource.setMotionConfig(motionConfig);
  movingSource.setSimulatedConfig(simulatedConfig);
  movingSource.setCameraHorizontalFov(cameraHFov);
  movingSource.setSampleDiameterDeg(sampleDiameterDeg);
  movingSource.setGrayscaleEnabled(grayscaleEnabled);
}

async function syncCameraHardwareControls(): Promise<void> {
  const applied = await movingSource.setExposureTime(exposureTime);
  const params = movingSource.getCameraParameters();

  if (params.exposureTimeAvailable) {
    const min = params.exposureTimeMin ?? 0;
    const max = params.exposureTimeMax ?? 1;
    const step = params.exposureTimeStep ?? 0.0001;
    cameraExposureEl.min = String(min);
    cameraExposureEl.max = String(max);
    cameraExposureEl.step = String(step);
    cameraExposureEl.disabled = false;

    const value = params.exposureTime ?? exposureTime;
    exposureTime = value;
    cameraExposureEl.value = String(value);
    cameraExposureValEl.textContent = formatExposureTimeUs(value);
    cameraExposureAvailabilityEl.textContent = '';
  } else {
    cameraExposureEl.disabled = true;
    cameraExposureAvailabilityEl.textContent = '(unsupported on this device)';
  }

  if (!applied && params.exposureTimeAvailable) {
    cameraExposureAvailabilityEl.textContent = '(apply failed)';
  }
}

function updateSampleZoneMarker(): void {
  videoPreviewRenderer.renderSampleProbe(
    movingSource.getSampleOffsetFraction(),
    movingSource.getSampleDiameterFraction(),
    movingSource.getLastSample(),
    latestRollingMean,
  );
}

function renderCameraParameterSummary(): void {
  const params = movingSource.getCameraParameters();
  const frameRate = params.frameRate !== null ? `${params.frameRate.toFixed(1)} fps` : 'n/a fps';
  const fovSource = params.fovSource === 'camera-metadata' ? 'camera metadata' : 'manual';
  const exposureText = params.exposureTimeAvailable
    ? `exposure time ${(params.exposureTime !== null ? formatExposureTimeUs(params.exposureTime) : 'n/a')} µs`
    : 'exposure unsupported';
  const grayscaleText = params.grayscaleEnabled ? 'grayscale on' : 'grayscale off';
  cameraParamsEl.textContent =
    `Track ${params.width}x${params.height}, ${frameRate}, facing ${params.facingMode} · ` +
    `derived V-FoV ${params.vFovDeg.toFixed(1)}° · FoV source: ${fovSource} · ${grayscaleText} · ${exposureText}`;
}

function pushHistory(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > HISTORY) arr.splice(0, arr.length - HISTORY);
}

function detectEvent(sample: number, mean: number, stddev: number): { z: number; event: boolean } {
  const stdEff = Math.max(sigmaFloor, stddev);
  const delta = sample - mean;
  const z = stdEff > 1e-6 ? (delta / stdEff) : 0;
  const event = z >= zThreshold && delta >= deltaFloor;
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
    const { z, event } = detectEvent(sample, mean, stddev);
    zHistory.push(z);
    eventHistory.push(event);
  }
}

function renderAll(sample: number, mean: number, stddev: number, max: number, z: number, eventDetected: boolean): void {
  metricsRenderer.render({ sample, mean, stddev, max, z, zThreshold, eventDetected });
  signalChartRenderer.render({
    sampleHistory,
    meanHistory,
    upperHistory,
    lowerHistory,
    windowSize,
    hz,
    tickIndex,
  });
  zChartRenderer.render({
    zHistory,
    zThreshold,
    hz,
    tickIndex,
  });
  zPosEventChartRenderer.render({
    eventHistory,
    hz,
    tickIndex,
  });
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
  const latestSample = sampleHistory[sampleHistory.length - 1] ?? movingSource.getLastSample();
  const stats = statsBuffer.snapshot();
  const { z, event } = detectEvent(latestSample, stats.mean, stats.stddev);
  latestRollingMean = stats.mean;
  renderAll(latestSample, stats.mean, stats.stddev, stats.max, z, event);
  updateSampleZoneMarker();
}

function resetState(): void {
  orchestrator.resetTimeline();
  tickIndex = 0;
  statsBuffer = new RollingStatsBuffer(windowSize);
  syncSourceConfigs();
  movingSource.reset();
  updateSampleZoneMarker();

  sampleHistory.length = 0;
  meanHistory.length = 0;
  upperHistory.length = 0;
  lowerHistory.length = 0;
  zHistory.length = 0;
  eventHistory.length = 0;

  for (let i = 0; i < windowSize; i++) {
    const sample = movingSource.sample(tickIndex);
    const stats = statsBuffer.push(sample);
    const { z, event } = detectEvent(sample, stats.mean, stats.stddev);

    pushHistory(sampleHistory, sample);
    pushHistory(meanHistory, stats.mean);
    pushHistory(upperHistory, stats.mean + stats.stddev);
    pushHistory(lowerHistory, stats.mean - stats.stddev);
    pushHistory(zHistory, z);
    pushHistory(eventHistory, event);
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
  updateSampleZoneMarker();
}

function runTick(): void {
  const sample = movingSource.sample(tickIndex);
  const prevStats = statsBuffer.snapshot();
  const { event: prevEvent } = detectEvent(sample, prevStats.mean, prevStats.stddev);
  const shouldFreeze = freezeBackgroundOnEvent && prevEvent;

  const stats = shouldFreeze ? prevStats : statsBuffer.push(sample);
  const { z, event } = detectEvent(sample, stats.mean, stats.stddev);

  pushHistory(sampleHistory, sample);
  pushHistory(meanHistory, stats.mean);
  pushHistory(upperHistory, stats.mean + stats.stddev);
  pushHistory(lowerHistory, stats.mean - stats.stddev);
  pushHistory(zHistory, z);
  pushHistory(eventHistory, event);
  latestRollingMean = stats.mean;

  renderAll(sample, stats.mean, stats.stddev, stats.max, z, event);
  tickIndex++;
}

function onControlChange(): void {
  const prevWindowSize = windowSize;
  applyControlValues();
  orchestrator.setTargetHz(hz);
  syncSourceConfigs();
  renderCameraParameterSummary();

  if (windowSize !== prevWindowSize) {
    rebuildStatsBufferFromHistory();
  }

  if (source === 'simulated') {
    setCameraStatus('Simulated source active.');
  }
  refreshRenderFromCurrentState();
}

function onCameraParamsChange(): void {
  applyControlValues();
  syncSourceConfigs();
  void syncCameraHardwareControls().finally(() => {
    renderCameraParameterSummary();
    updateSampleZoneMarker();
  });
}

async function onSourceChange(): Promise<void> {
  applyControlValues();
  syncSourceConfigs();

  const result = await movingSource.activateSource(source);
  source = result.activeSource;
  sourceEl.value = source;
  setCameraStatus(result.message);
  await syncCameraHardwareControls();
  renderCameraParameterSummary();

  setSimControlsDisabled(source === 'camera');
  resetState();
}

[
  hzEl,
  windowEl,
  zThrEl,
  sigmaFloorEl,
  deltaFloorEl,
  freezeBgOnEventEl,
  baselineEl,
  noiseEl,
  driftEl,
  pulseAmpEl,
  pulseEveryEl,
].forEach((el) => {
  el.addEventListener('input', onControlChange);
  el.addEventListener('change', onControlChange);
});

[
  sampleXRangeMinEl,
  sampleXRangeMaxEl,
  sampleXMaxVelEl,
  sampleXMaxAccEl,
  cameraHFovEl,
  sampleDiameterEl,
  cameraGrayscaleEl,
  cameraExposureEl,
].forEach((el) => {
  el.addEventListener('input', onCameraParamsChange);
  el.addEventListener('change', onCameraParamsChange);
});

sourceEl.addEventListener('change', () => {
  void onSourceChange();
});

runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.textContent = running ? 'Pause' : 'Run';
  if (running) {
    orchestrator.start();
  } else {
    orchestrator.stop();
  }
});

resetBtn.addEventListener('click', () => {
  applyControlValues();
  syncSourceConfigs();
  resetState();
});

applyControlValues();
initSliderHelp();
syncSourceConfigs();
updateSampleZoneMarker();
orchestrator.setTargetHz(hz);
void onSourceChange().finally(() => {
  if (running) orchestrator.start();
});

window.addEventListener('beforeunload', () => {
  orchestrator.stop();
  movingSource.stopAll();
});
