import type { LightReading, PatternDetectedPayload, SubscriberMode, WsMessage } from '../shared/types.js';

const connEl = document.getElementById('conn') as HTMLSpanElement;
const urlEl = document.getElementById('url') as HTMLSpanElement;
const mpsEl = document.getElementById('mps') as HTMLDivElement;
const sampleRateEl = document.getElementById('sample-rate') as HTMLDivElement;
const patternEl = document.getElementById('pattern') as HTMLDivElement;
const patternScoreEl = document.getElementById('pattern-score') as HTMLDivElement;
const detectedEl = document.getElementById('detected') as HTMLDivElement;
const deltaEl = document.getElementById('delta') as HTMLDivElement;
const lumEl = document.getElementById('lum') as HTMLDivElement;
const anglesEl = document.getElementById('angles') as HTMLDivElement;
const latestEl = document.getElementById('latest') as HTMLPreElement;
const modeEl = document.getElementById('sub-mode') as HTMLSelectElement;
const connectBtn = document.getElementById('btn-connect') as HTMLButtonElement;
const disconnectBtn = document.getElementById('btn-disconnect') as HTMLButtonElement;

const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
urlEl.textContent = wsUrl;

let ws: WebSocket | null = null;
const msgTimestamps: number[] = [];

function resetView(): void {
  msgTimestamps.length = 0;
  mpsEl.textContent = '0.0';
  sampleRateEl.textContent = '—';
  patternEl.textContent = '—';
  patternScoreEl.textContent = '—';
  detectedEl.textContent = '—';
  deltaEl.textContent = '—';
  lumEl.textContent = '—';
  anglesEl.textContent = '—';
  latestEl.textContent = '(no message yet)';
}

function setConnected(connected: boolean): void {
  connEl.textContent = connected ? 'connected' : 'disconnected';
  connEl.classList.toggle('ok', connected);
}

function updateMps(now: number): void {
  const cutoff = now - 1000;
  while (msgTimestamps.length && msgTimestamps[0] < cutoff) msgTimestamps.shift();
  mpsEl.textContent = msgTimestamps.length.toFixed(1);
}

function onReading(reading: LightReading): void {
  const now = performance.now();
  msgTimestamps.push(now);
  updateMps(now);

  sampleRateEl.textContent = reading.sampleRateHz ? `${reading.sampleRateHz} Hz` : '—';
  patternEl.textContent = reading.patternDetected ?? '—';
  patternScoreEl.textContent = typeof reading.patternScore === 'number'
    ? `${Math.round(reading.patternScore * 100)}%`
    : '—';
  detectedEl.textContent = reading.detected ? 'YES' : 'no';
  deltaEl.textContent = String(reading.delta);
  lumEl.textContent = `${reading.brightness} / ${reading.background}`;
  anglesEl.textContent = `${reading.xAngle.toFixed(1)}°, ${reading.yAngle.toFixed(1)}°`;
  latestEl.textContent = JSON.stringify(reading, null, 2);
}

function onPatternDetected(payload: PatternDetectedPayload): void {
  const now = performance.now();
  msgTimestamps.push(now);
  updateMps(now);

  sampleRateEl.textContent = payload.sampleRateHz ? `${payload.sampleRateHz} Hz` : '—';
  patternEl.textContent = payload.patternDetected;
  patternScoreEl.textContent = typeof payload.patternScore === 'number'
    ? `${Math.round(payload.patternScore * 100)}%`
    : '—';
  detectedEl.textContent = 'YES';
  deltaEl.textContent = '—';
  lumEl.textContent = '—';
  anglesEl.textContent = '—';
  latestEl.textContent = JSON.stringify(payload, null, 2);
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const mode = (modeEl.value === 'pattern' ? 'pattern' : 'full') as SubscriberMode;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setConnected(true);
    ws?.send(JSON.stringify({ type: 'identify', payload: { role: 'subscriber', mode } }));
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as WsMessage;
      if (msg.type === 'sensor_reading') {
        onReading(msg.payload as LightReading);
      } else if (msg.type === 'pattern_detected') {
        onPatternDetected(msg.payload as PatternDetectedPayload);
      }
    } catch {
      // ignore malformed payloads
    }
  };

  ws.onclose = () => setConnected(false);
  ws.onerror = () => setConnected(false);
}

function disconnect(): void {
  ws?.close();
  ws = null;
  setConnected(false);
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
modeEl.addEventListener('change', () => {
  resetView();
  if (ws?.readyState === WebSocket.OPEN) {
    disconnect();
    connect();
  }
});

setConnected(false);
resetView();
connect();
setInterval(() => updateMps(performance.now()), 250);
