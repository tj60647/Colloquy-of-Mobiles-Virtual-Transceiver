# Virtual Colloquy Light Sensor

Webcam-based light-pattern detector with two browser apps:
- **Sensor app** (`/`): captures camera frames, detects light pulses, decodes patterns, and streams readings over WebSocket.
- **Transmitter app** (`/flash`): emits dictionary patterns using phone torch (or speaker tone fallback).

---

## Deep Assessment (as of 2026-02-17)

### Overall health
- **Build status:** ✅ `npm run build` succeeds (Vite client + TypeScript server compile).
- **Architecture quality:** **Good** — clear module boundaries, typed shared protocol, predictable data flow.
- **Runtime resilience:** **Moderate** — reconnect/backoff exists, but no heartbeat timeout or auth.
- **Performance profile:** **Moderate-to-good** — stable 40 Hz pipeline, with one obvious optimization opportunity in detector math.
- **Operational maturity:** **Moderate** — deployable and understandable, but missing tests, observability, and formal security controls.

### What is strong
1. **Clear separation of concerns**
   - `src/client` handles capture, signal processing, rendering, and UX.
   - `src/server` is a focused relay/static host.
   - `src/shared` centralizes protocol + dictionary typing.
2. **Well-typed protocol and domain model**
   - Shared `LightReading`, `WsMessage`, and dictionary types reduce drift between client and server.
3. **Robust UI control surface**
   - Camera capability introspection and dynamic control generation are unusually strong for this class of app.
4. **Practical reconnect behavior**
   - Sensor WebSocket client uses exponential backoff and automatic re-identify.
5. **Dual-mode transmitter fallback**
   - Torch mode plus sound mode improves practical usability across device/browser differences.

### Key technical risks / gaps
1. **No automated tests**
  - Core behavior (matcher alignment logic, detector output invariants) is untested.
2. **WebSocket trust model is open**
   - Any client can identify as `sensor`/`subscriber`; no origin allowlist, token auth, or role authorization.
3. **No heartbeat/timeout for stale sockets**
   - Server responds to `ping` but does not proactively prune idle/dead peers.
4. **Potential detector hot-path inefficiency**
   - `LightDetector.detect()` calls `background.getLuminanceAt()` per pixel, which repeatedly clamps/rounds and recalculates index.
5. **Camera lifecycle cleanup not explicit in main app**
   - `CameraManager.stop()` exists but is not wired to page lifecycle events in `main.ts`.
6. **Limited observability**
   - Minimal structured logging and no metrics for frame rate, detection rate, dropped WS sends, etc.

### Prioritized improvements
**P0 (high impact / low-medium effort)**
- Add unit tests for:
  - `PatternMatcher` threshold/alignment behavior.
  - `FovMapper` round-trip sanity.
- Add minimal WebSocket auth (shared token) and reject unauthenticated role claims.
- Add server heartbeat cycle (`ping` + terminate stale clients).

**P1 (performance + reliability)**
- Optimize detector inner loop by computing background luminance directly from pre-indexed channel arrays or a cached luminance frame.
- Add lifecycle hooks (`visibilitychange`, `beforeunload`) to disconnect WS and stop camera stream.
- Add configurable sample rate and ring buffer sizing via UI/config.

**P2 (operability + DX)**
- Add npm scripts for lint/check/test and CI pipeline.
- Add runtime diagnostics panel (actual sample Hz, decode confidence trends, reconnect count).
- Add protocol version field to WS messages for forward compatibility.

---

## Architecture

```text
Camera frame (rAF)
  -> BackgroundModel.update (EMA)
  -> every 25ms (40Hz):
       LightDetector.detect
       -> RingBuffer.push
       -> PatternMatcher.addSample
       -> WsClient.sendReading
  -> Renderer.draw (canvas HUD + overlays)

Sensor client (/)
  -- ws identify(sensor) + sensor_reading -->
WebSocket relay server (/ws)
  -- broadcast sensor_reading --> subscribers

Transmitter client (/flash)
  -> emits fixed 40-segment dictionary words via torch or tone
```

### Signal-processing direction (EMA kept, matcher pipeline generalized)

The current camera path keeps the EMA background model and detector as-is.
In parallel, the project is moving toward a reusable matcher input pipeline for
simulation and embedded-style sources:

- Input: one scalar sample per tick (e.g., single-pixel grayscale value).
- Rolling window: `PATTERN_LEN` samples (currently 40).
- Per-tick stats: mean, max, stddev updated every sample tick.
- Decision stage: strategy converts scalar/stats to boolean `detected` bit.
- Matcher stage: `PatternMatcher.addSample(detected)` compares against dictionary.

Z-score mode uses the same mean/stddev stats and normalizes the current sample:

- `z = (sample - mean) / stddev`
- A threshold like `z >= 1.5` is equivalent to `sample >= mean + 1.5 * stddev`.
- This helps keep behavior stable when absolute brightness scale changes.

This allows non-camera apps (simulation, Arduino-adjacent tooling) to reuse the
same dictionary matcher behavior without depending on EMA internals.

---

## Repository layout

```text
src/
  client/
    main.ts             Sensor app entrypoint and loop orchestration
    flash.ts            Torch/tone transmitter app
    camera.ts           Camera abstraction + capability APIs
    cameraControls.ts   Dynamic camera tuning UI
    background.ts       EMA background model
    detector.ts         Zone luminance delta detector
    sensitivityZone.ts  Trapezoidal motion profiles (X/Y)
    fovMapper.ts        Pixel <-> angle conversions
    patternMatcher.ts   Dictionary pattern matcher
    renderer.ts         Canvas rendering + HUD
    wsClient.ts         Sensor WebSocket client with reconnect
    ringBuffer.ts       Generic circular buffer
    ui.ts               DOM control bindings and runtime config
    styles.css          Sensor page styling
  server/
    index.ts            HTTP static host + WS relay
  shared/
    types.ts            Shared domain and protocol types
    dictionary.ts       8-word, 40-segment dictionary
index.html              Sensor page shell
flash.html              Transmitter page shell
vite.config.ts          MPA setup, dev WS proxy, build inputs
```

---

## Message protocol (`/ws`)

### Identify
```json
{ "type": "identify", "payload": { "role": "sensor" } }
```
or
```json
{ "type": "identify", "payload": { "role": "subscriber" } }
```

### Sensor reading (broadcast from sensor to subscribers)
```json
{
  "type": "sensor_reading",
  "payload": {
    "timestamp": 1739750000000,
    "frameX": 320,
    "frameY": 240,
    "xAngle": 0,
    "yAngle": 0,
    "detected": true,
    "brightness": 142,
    "background": 104,
    "delta": 38,
    "zoneX": 318.7,
    "zoneY": 233.2,
    "zoneRadius": 50
  }
}
```

Pattern matching behavior:
- Matcher score is computed on the **TX window only** (`PATTERN_LEN = 40` samples).
- The **LISTEN window** (`LISTEN_LEN = 40` samples) is protocol spacing and does
  not contribute to matcher score.

### Ping/pong
```json
{ "type": "ping" }
```
```json
{ "type": "pong" }
```

---

## Getting started

### Prerequisites
- Node.js **20+**
- npm **10+**
- Modern Chromium browser for best camera capabilities

### Install
```bash
npm install
```

### Development
Runs both services concurrently:
- Vite dev server on `http://localhost:5173`
- WebSocket/HTTP relay server on `http://localhost:3001`

```bash
npm run dev
```

Use:
- Sensor app: `http://localhost:5173/`
- Transmitter app: `http://localhost:5173/flash`
- Pattern comparison demo: `http://localhost:5173/pattern-demo`
- Background stats demo: `http://localhost:5173/background-stats-demo`

Vite proxies `/ws` to `ws://localhost:3001/ws` in dev.

### Production build + run
```bash
npm run build
npm start
```

Server listens on `PORT` (default `3001`) and serves built client from `dist/client`.

---

## Deployment notes

- `Procfile` expects built output:
  - `web: node dist/server/index.js`
- For Heroku-like environments:
  - `heroku-postbuild` runs `npm run build`
- Ensure WebSocket upgrades are enabled for `/ws` at your reverse proxy.

---

## Browser/device compatibility

| Device / Browser | Sensor (`/`) | Transmitter Flash (`/flash`) | Transmitter Sound (`/flash`) | Notes |
|---|---|---|---|---|
| Desktop Chrome / Edge | ✅ Full | ⚠️ Usually unavailable | ✅ | Best support for camera capabilities and tuning controls |
| Desktop Firefox | ✅ Core | ⚠️ Usually unavailable | ✅ | Limited `getCapabilities()` camera tuning |
| Desktop Safari | ✅ Core | ⚠️ Usually unavailable | ✅ | Camera tuning surface is limited |
| Android Chrome | ✅ Full/Core | ✅ Best target | ✅ | Preferred phone setup for torch transmitter |
| iOS Safari | ✅ Core | ❌ Not supported | ✅ | Torch API generally unavailable on iOS Safari |

### Runtime fallback behavior

- Sensor page now checks camera API + secure context on startup and shows a compatibility banner.
- Flash transmitter auto-falls back to sound mode when torch/camera APIs are unavailable.
- Flash mode button is disabled automatically in environments without secure camera APIs.
- Hidden-tab behavior is handled to avoid stale timing while backgrounded on phones.

---

## Troubleshooting

- **No detections:** lower exposure/ISO in camera controls, reduce ambient light, then tune threshold.
- **WS disconnected:** verify server is running and `/ws` proxy path is correct.
- **Torch unavailable:** switch to sound mode or use Android Chrome with rear camera.

### Quick validation checklist (laptop + phone)

- Open sensor page on laptop: camera starts, controls render, compatibility banner shows `ok`.
- Open sensor page on phone: UI remains usable in portrait and landscape.
- Background and resume tab/app: status changes to paused/resumed and detection recovers.
- Open transmitter on phone: flash mode works on Android Chrome; iOS auto-switches to sound.
- Disconnect/reconnect network: sensor reconnects WS automatically and resumes sending.

### Mixed-device runbook

1. Start app with `npm run dev`.
2. On laptop, open sensor page: `http://<host>:5173/`.
3. On phone, open transmitter page: `http://<host>:5173/flash`.
4. If flash mode is unsupported, use sound mode and point phone speaker toward sensor mic/capture target.
5. For remote hosting, use HTTPS/WSS and ensure `/ws` upgrades are enabled at the proxy.

---

## Current limitations

- No authentication/authorization for WS roles.
- No test suite.
- No persistent storage or event replay.
- No formal API versioning.

---

## Suggested next work items

1. Implement scalar-sample rolling stats module (`PATTERN_LEN` window, per-tick mean/max/stddev).
2. Add pluggable sample-to-bit decision strategies (fixed threshold, adaptive z-score).
3. Add matcher input adapter so simulation/embedded pipelines can feed `PatternMatcher` directly.
4. Keep camera+EMA path selectable and unchanged for current sensor UI.
5. Add docs/examples showing how external apps provide scalar samples and consume match metadata.
6. Add `vitest` unit tests for matcher/fov mapper and new rolling-stats logic.
