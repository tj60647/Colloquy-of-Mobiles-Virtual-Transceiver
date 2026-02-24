/**
 * main.ts – application entry point
 *
 * Pipeline (runs every requestAnimationFrame):
 *   Camera → drawFrame → BackgroundModel.update
 *     ↓  (every 25 ms = 40 Hz)
 *   LightDetector.detect → LightReading
 *     → RingBuffer.push
 *     → PatternDecoder.addSample
 *     → WsClient.sendReading
 *   Renderer.render  (every rAF frame for smooth visuals)
 */

import { CameraManager    } from './camera.js';
import { CameraControls   } from './cameraControls.js';
import { BackgroundModel  } from './background.js';
import { SensitivityZone  } from './sensitivityZone.js';
import { FovMapper         } from './fovMapper.js';
import { LightDetector    } from './detector.js';
import { AudioDetector    } from './audioDetector.js';
import { RingBuffer        } from './ringBuffer.js';
import { PatternDecoder   } from './patternDecoder.js';
import { PatternMatcher   } from './patternMatcher.js';
import { Renderer          } from './renderer.js';
import { WsClient          } from './wsClient.js';
import { UI                } from './ui.js';
import { DICT_LABELS       } from '../shared/dictionary.js';
import { TX_CYCLE_LEN } from '../shared/dictionary.js';
import type { LightReading } from '../shared/types.js';

const SENSOR_CONFIG_URL = '/config/sensor.config.json';
const SENSOR_CONFIG_STORAGE_KEY = 'vcl.sensor.config.v1';

const SENSOR_CONTROL_IDS = [
  'detector-mode',
  'sample-rate',
  'grayscale-processing',
  'threshold',
  'audio-threshold',
  'audio-bp-center',
  'audio-bp-q',
  'view-mode-bg',
  'bg-alpha',
  'zone-radius',
  'motion-unit-rad',
  'x-range-min',
  'x-range-max',
  'x-max-vel',
  'x-max-acc',
  'y-range-min',
  'y-range-max',
  'y-max-vel',
  'y-max-acc',
  'h-fov',
  'v-fov',
] as const;

type SensorControlMap = Record<string, string | boolean>;

function toGrayscaleInPlace(imageData: ImageData): void {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = y;
    d[i + 1] = y;
    d[i + 2] = y;
  }
}

async function loadSensorFileConfig(): Promise<SensorControlMap> {
  try {
    const res = await fetch(SENSOR_CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) return {};
    const body = (await res.json()) as { controls?: SensorControlMap };
    return body.controls ?? {};
  } catch {
    return {};
  }
}

function loadSensorLocalConfig(): SensorControlMap {
  try {
    const raw = localStorage.getItem(SENSOR_CONFIG_STORAGE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as { controls?: SensorControlMap }).controls ?? {};
  } catch {
    return {};
  }
}

function collectSensorControls(): SensorControlMap {
  const out: SensorControlMap = {};
  for (const id of SENSOR_CONTROL_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      out[id] = el.checked;
    } else {
      out[id] = (el as HTMLInputElement | HTMLSelectElement).value;
    }
  }
  return out;
}

function applySensorControls(values: SensorControlMap): void {
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = Boolean(value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      el.value = String(value);
      const evt = el instanceof HTMLSelectElement ? 'change' : 'input';
      el.dispatchEvent(new Event(evt, { bubbles: true }));
    }
  }
}

function installSensorConfigPersistence(): void {
  const persist = () => {
    const controls = collectSensorControls();
    localStorage.setItem(SENSOR_CONFIG_STORAGE_KEY, JSON.stringify({ controls }));
  };

  for (const id of SENSOR_CONTROL_IDS) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    const evt = el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'checkbox')
      ? 'change'
      : 'input';
    el.addEventListener(evt, persist);
  }
}

function isLikelyMobile(): boolean {
  return window.matchMedia('(max-width: 900px)').matches;
}

function canUseCamera(): { ok: boolean; reason?: string } {
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return { ok: false, reason: 'Camera access requires HTTPS (or localhost).' };
  }

  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return { ok: false, reason: 'This browser does not support camera capture APIs.' };
  }

  return { ok: true };
}

async function main(): Promise<void> {
  // ── DOM ───────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  const statusEl = document.getElementById('status-msg');
  const compatEl = document.getElementById('compat-msg');
  function setStatus(msg: string): void {
    if (statusEl) statusEl.textContent = msg;
  }

  function setCompat(msg: string, kind: 'ok' | 'warn' = 'warn'): void {
    if (!compatEl) return;
    compatEl.textContent = msg;
    compatEl.classList.remove('ok', 'warn');
    compatEl.classList.add(kind);
  }

  const capability = canUseCamera();
  if (!capability.ok) {
    setStatus(capability.reason ?? 'Camera unavailable');
    setCompat(capability.reason ?? 'Unsupported environment', 'warn');
    return;
  }

  setCompat(
    isLikelyMobile()
      ? 'Mobile mode active: use portrait/landscape and keep screen awake while sampling.'
      : 'Desktop mode active: full controls available.',
    'ok',
  );

  setStatus('Requesting camera access…');

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new CameraManager();
  try {
    await camera.initialize();
  } catch (err) {
    setStatus(`Camera error: ${String(err)}`);
    throw err;
  }

  canvas.width  = camera.width;
  canvas.height = camera.height;
  setStatus('Camera ready.');

  // ── Camera controls panel ─────────────────────────────────────────────────
  const camPropsEl = document.getElementById('cam-props');
  const camControls = camPropsEl
    ? new CameraControls(camPropsEl, camera)
    : null;

  // Build once on startup
  camControls?.build();

  // Allow manual refresh (useful after switching cameras)
  document.getElementById('btn-refresh-cam')?.addEventListener('click', () => {
    camControls?.build();
  });

  // ── Off-screen canvas for frame capture ───────────────────────────────────
  const offCanvas = document.createElement('canvas');
  offCanvas.width  = camera.width;
  offCanvas.height = camera.height;
  const offCtx = offCanvas.getContext('2d')!;

  // ── Subsystems ────────────────────────────────────────────────────────────
  const ui      = new UI();

  const fileControls = await loadSensorFileConfig();
  const localControls = loadSensorLocalConfig();
  applySensorControls({ ...fileControls, ...localControls });
  installSensorConfigPersistence();

  const bgModel = new BackgroundModel(ui.config.backgroundAlpha);
  const zone    = new SensitivityZone(camera.width, camera.height, ui.config.zone, ui.config.fov);
  const fov     = new FovMapper(ui.config.fov);
  const det     = new LightDetector(ui.config.threshold);
  const rb      = new RingBuffer<boolean>(TX_CYCLE_LEN);
  for (let i = 0; i < TX_CYCLE_LEN; i++) rb.push(false);
  const decoder = new PatternDecoder(ui.config.morseUnitMs);
  const matcher = new PatternMatcher();
  const audioDet = new AudioDetector(ui.config.audioBandpassCenter, ui.config.audioBandpassQ);
  const renderer= new Renderer(canvas, ctx);

  const matchEl = document.getElementById('pattern-match');
  const matchWordEl  = matchEl?.querySelector('.match-word')  as HTMLElement | null;
  const matchScoreEl = matchEl?.querySelector('.match-score') as HTMLElement | null;

  // ── WebSocket ─────────────────────────────────────────────────────────────
  // In dev Vite proxies /ws → ws://localhost:3001/ws
  // In production the Express server handles the upgrade at /ws
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws`;
  const wsClient = new WsClient(wsUrl);
  wsClient.connect();

  function shutdown(): void {
    wsClient.disconnect();
    camera.stop();
    void audioDet.stop();
  }

  window.addEventListener('beforeunload', shutdown);
  window.addEventListener('pagehide', shutdown);

  // ── UI callbacks ──────────────────────────────────────────────────────────
  ui.onResetBackground = () => bgModel.reset();
  ui.onResetDecoder    = () => {
    decoder.reset();
    matcher.reset();
    rb.clear();
    for (let i = 0; i < TX_CYCLE_LEN; i++) rb.push(false);
  };

  // ── Main loop ─────────────────────────────────────────────────────────────
  let lastSampleTs = 0;
  let lastReading: LightReading | null = null;
  let audioInitPending = false;
  let lastAudioSpectrum: Uint8Array | null = null;
  let prevSampleIntervalMs = 1000 / ui.config.sampleRateHz;
  let lastSampleWallTs = 0;
  let effectiveSampleHz = 0;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setStatus('Paused while tab is hidden.');
    } else {
      lastSampleTs = performance.now();
      setStatus('Resumed.');
    }
  });

  function loop(timestamp: number): void {
    requestAnimationFrame(loop);

    if (document.hidden) return;

    // Sync config from UI every frame (cheap reads)
    bgModel.alpha        = ui.config.backgroundAlpha;
    zone.config          = ui.config.zone;
    zone.updateFov(ui.config.fov);
    fov.config           = ui.config.fov;
    det.threshold        = ui.config.threshold;
    decoder.unitMs       = ui.config.morseUnitMs;
    zone.updateDimensions(camera.width, camera.height);
    audioDet.setBandpass(ui.config.audioBandpassCenter, ui.config.audioBandpassQ);

    // Advance zone oscillation
    zone.update(timestamp);

    // Capture current video frame
    camera.drawFrame(offCtx);
    const imageData = offCtx.getImageData(0, 0, camera.width, camera.height);
    if (ui.config.grayscaleProcessing) {
      toGrayscaleInPlace(imageData);
    }

    // Update background model every frame (smooth EMA)
    bgModel.update(imageData);

    // ── 40 Hz detection tick ────────────────────────────────────────────────
    const sampleIntervalMs = 1000 / ui.config.sampleRateHz;

    if (lastSampleTs === 0) {
      lastSampleTs = timestamp;
      prevSampleIntervalMs = sampleIntervalMs;
    }

    if (Math.abs(sampleIntervalMs - prevSampleIntervalMs) > 0.001) {
      lastSampleTs = timestamp;
      prevSampleIntervalMs = sampleIntervalMs;
    }

    let catchUp = 0;
    const maxCatchUpTicks = 3;

    while (timestamp - lastSampleTs >= sampleIntervalMs && catchUp < maxCatchUpTicks) {
      lastSampleTs += sampleIntervalMs;
      catchUp++;

      const sampleTs = lastSampleTs;
      const wallNow = performance.now();
      if (lastSampleWallTs > 0) {
        const dt = wallNow - lastSampleWallTs;
        if (dt > 0) {
          const instHz = 1000 / dt;
          effectiveSampleHz = effectiveSampleHz === 0
            ? instHz
            : (0.18 * instHz + 0.82 * effectiveSampleHz);
        }
      }
      lastSampleWallTs = wallNow;

      if (ui.config.detectorMode === 'light') {
        if (!bgModel.isInitialized) break;
        lastAudioSpectrum = null;

        const reading = det.detect(imageData, bgModel, zone, fov, sampleTs);
        lastReading = reading;

        rb.push(reading.detected);
        decoder.addSample(reading.detected, sampleTs);
        matcher.addSample(reading.detected);

        decoder.flush(sampleTs);

        if (matchEl) {
          const m = matcher.lastMatch;
          if (m) {
            matchWordEl && (matchWordEl.textContent = m.word);
            matchScoreEl && (matchScoreEl.textContent = `${DICT_LABELS[m.word]}  ${Math.round(m.score * 100)}%`);
            matchEl.classList.add('visible');
          } else {
            matchEl.classList.remove('visible');
          }
        }

        wsClient.sendReading(reading);
      } else {
        if (!audioDet.isInitialized) {
          if (!audioInitPending) {
            audioInitPending = true;
            setStatus('Audio mode: requesting microphone access…');
            void audioDet.initialize().then(() => {
              audioInitPending = false;
              setStatus('Audio mode active.');
            }).catch((err) => {
              audioInitPending = false;
              setStatus(`Audio mode error: ${String(err)}`);
            });
          }
          break;
        }

        const a = audioDet.detect(ui.config.audioThreshold);
        lastAudioSpectrum = audioDet.getSpectrumSnapshot(128, 3000);
        const { xAngle, yAngle } = fov.pixelToAngle(zone.centerX, zone.centerY, camera.width, camera.height);
        const reading: LightReading = {
          timestamp: sampleTs,
          frameX: Math.round(zone.centerX),
          frameY: Math.round(zone.centerY),
          xAngle: Math.round(xAngle * 10) / 10,
          yAngle: Math.round(yAngle * 10) / 10,
          detected: a.detected,
          brightness: a.level,
          background: a.baseline,
          delta: a.delta,
          zoneX: zone.centerX,
          zoneY: zone.centerY,
          zoneRadius: zone.radius,
        };
        lastReading = reading;

        rb.push(reading.detected);
        decoder.addSample(reading.detected, sampleTs);
        matcher.addSample(reading.detected);

        decoder.flush(sampleTs);

        if (matchEl) {
          const m = matcher.lastMatch;
          if (m) {
            matchWordEl && (matchWordEl.textContent = m.word);
            matchScoreEl && (matchScoreEl.textContent = `${DICT_LABELS[m.word]}  ${Math.round(m.score * 100)}%`);
            matchEl.classList.add('visible');
          } else {
            matchEl.classList.remove('visible');
          }
        }

        wsClient.sendReading(reading);
      }
    }

    // ── Render ───────────────────────────────────────────────────────────────
    renderer.render({
      imageData,
      backgroundModel: bgModel,
      viewMode:        ui.config.viewMode,
      zone,
      ringBuffer:      rb,
      lastReading,
      decoder,
      patternMatch:    matcher.lastMatch,
      patternScores:   matcher.lastScores,
      detectorMode:    ui.config.detectorMode,
      audioSpectrum:   lastAudioSpectrum,
      audioBandpassCenter: ui.config.audioBandpassCenter,
      audioBandpassQ:  ui.config.audioBandpassQ,
      effectiveHz:     effectiveSampleHz,
      threshold:       ui.config.detectorMode === 'audio' ? ui.config.audioThreshold : ui.config.threshold,
      wsConnected:     wsClient.connected,
    });
  }

  requestAnimationFrame(loop);
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('status-msg');
  if (el) el.textContent = `Fatal error: ${String(err)}`;
});
