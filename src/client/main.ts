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

import { CameraManager   } from './camera.js';
import { BackgroundModel  } from './background.js';
import { SensitivityZone  } from './sensitivityZone.js';
import { FovMapper         } from './fovMapper.js';
import { LightDetector    } from './detector.js';
import { RingBuffer        } from './ringBuffer.js';
import { PatternDecoder   } from './patternDecoder.js';
import { Renderer          } from './renderer.js';
import { WsClient          } from './wsClient.js';
import { UI                } from './ui.js';
import type { LightReading } from '../shared/types.js';

const SAMPLE_INTERVAL_MS = 1000 / 40; // 25 ms → 40 Hz

async function main(): Promise<void> {
  // ── DOM ───────────────────────────────────────────────────────────────────
  const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context');

  const statusEl = document.getElementById('status-msg');
  function setStatus(msg: string): void {
    if (statusEl) statusEl.textContent = msg;
  }

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

  // ── Off-screen canvas for frame capture ───────────────────────────────────
  const offCanvas = document.createElement('canvas');
  offCanvas.width  = camera.width;
  offCanvas.height = camera.height;
  const offCtx = offCanvas.getContext('2d')!;

  // ── Subsystems ────────────────────────────────────────────────────────────
  const ui      = new UI();
  const bgModel = new BackgroundModel(ui.config.backgroundAlpha);
  const zone    = new SensitivityZone(camera.width, camera.height, ui.config.zone);
  const fov     = new FovMapper(ui.config.fov);
  const det     = new LightDetector(ui.config.threshold);
  const rb      = new RingBuffer<boolean>(240);
  const decoder = new PatternDecoder(ui.config.morseUnitMs);
  const renderer= new Renderer(canvas, ctx);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  // In dev Vite proxies /ws → ws://localhost:3001/ws
  // In production the Express server handles the upgrade at /ws
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${window.location.host}/ws`;
  const wsClient = new WsClient(wsUrl);
  wsClient.connect();

  // ── UI callbacks ──────────────────────────────────────────────────────────
  ui.onResetBackground = () => bgModel.reset();
  ui.onResetDecoder    = () => decoder.reset();

  // ── Main loop ─────────────────────────────────────────────────────────────
  let lastSampleTs = 0;
  let lastReading: LightReading | null = null;

  function loop(timestamp: number): void {
    requestAnimationFrame(loop);

    // Sync config from UI every frame (cheap reads)
    bgModel.alpha        = ui.config.backgroundAlpha;
    zone.config          = ui.config.zone;
    fov.config           = ui.config.fov;
    det.threshold        = ui.config.threshold;
    decoder.unitMs       = ui.config.morseUnitMs;
    zone.updateDimensions(camera.width, camera.height);

    // Advance zone oscillation
    zone.update(timestamp);

    // Capture current video frame
    camera.drawFrame(offCtx);
    const imageData = offCtx.getImageData(0, 0, camera.width, camera.height);

    // Update background model every frame (smooth EMA)
    bgModel.update(imageData);

    // ── 40 Hz detection tick ────────────────────────────────────────────────
    if (timestamp - lastSampleTs >= SAMPLE_INTERVAL_MS) {
      lastSampleTs = timestamp;

      if (bgModel.isInitialized) {
        const reading = det.detect(imageData, bgModel, zone, fov, timestamp);
        lastReading   = reading;

        rb.push(reading.detected);
        decoder.addSample(reading.detected, timestamp);

        // Auto-flush Morse decoder on long silences
        decoder.flush(timestamp);

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
      threshold:       ui.config.threshold,
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
