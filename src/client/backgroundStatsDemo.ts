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

function renderAll(sample: number, mean: number, stddev: number, max: number, z: number): void {
  metricsRenderer.render({ sample, mean, stddev, max, z, zThreshold });
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
    zHistory,
    zThreshold,
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
  const latestSample = sampleHistory[sampleHistory.length - 1] ?? movingSource.getLastSample();
  const stats = statsBuffer.snapshot();
  const z = stats.stddev > 1e-6 ? (latestSample - stats.mean) / stats.stddev : 0;
  latestRollingMean = stats.mean;
  renderAll(latestSample, stats.mean, stats.stddev, stats.max, z);
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

  for (let i = 0; i < windowSize; i++) {
    const sample = movingSource.sample(tickIndex);
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
  latestRollingMean = latestMean;

  renderAll(latestSample, latestMean, latestStd, latestMax, latestZ);
  updateSampleZoneMarker();
}

function runTick(): void {
  const sample = movingSource.sample(tickIndex);
  const stats = statsBuffer.push(sample);
  const z = stats.stddev > 1e-6 ? (sample - stats.mean) / stats.stddev : 0;

  pushHistory(sampleHistory, sample);
  pushHistory(meanHistory, stats.mean);
  pushHistory(upperHistory, stats.mean + stats.stddev);
  pushHistory(lowerHistory, stats.mean - stats.stddev);
  pushHistory(zHistory, z);
  latestRollingMean = stats.mean;

  renderAll(sample, stats.mean, stats.stddev, stats.max, z);
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
