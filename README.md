# Colloquy of Mobiles — Virtual Transceiver

A virtual transceiver for the *Colloquy of Mobiles* project: a system in which
mobile agents (physical phones, simulated entities, or embedded nodes) exchange
structured light-and-sound signals, and a listening station decodes those
signals into behavioural vocabulary.

---

## Project concept

*Colloquy of Mobiles* explores a vocabulary of intentional signals exchanged
between autonomous or semi-autonomous mobile units.  Each unit carries a
distinct identity (Male I, Male II) and a current motivational state (drive O,
drive P, reinforcement).  The eight dictionary words encode every
identity–drive combination as a 40-segment binary waveform.  The transceiver
simultaneously listens, decodes, and can transmit — a full conversational loop.

### Signal medium

| Mode | Transmitter | Receiver |
|---|---|---|
| **Light** | Phone torch / camera flash | Webcam + EMA background model |
| **Audio** | Browser tone (Web Audio API) | Microphone + bandpass FFT analysis |
| **Virtual** | Programmatic scalar stream | `MatcherInputAdapter` pipeline |

The same dictionary patterns and pattern-matching engine are used across all
three modes.

---

## Current state (as of 2026-03)

### Overall health

- **Build status:** ✅ `npm run build` succeeds (Vite client + TypeScript server compile).
- **Architecture quality:** **Good** — clear module boundaries, typed shared
  protocol, predictable data flow.
- **Runtime resilience:** **Good** — exponential-backoff reconnect, heartbeat
  cycle, server-side stale-client pruning.
- **Performance profile:** **Moderate-to-good** — stable 40 Hz pipeline, with
  one obvious optimization opportunity in the detector hot path.
- **Operational maturity:** **Moderate** — deployable and understandable, but
  missing tests, observability, and formal security controls.

### What is strong

1. **Clear separation of concerns**
   - `src/client` handles capture, signal processing, rendering, and UX.
   - `src/server` is a focused relay/static host.
   - `src/shared` centralizes protocol, dictionary, pattern-matching core, and
     reusable pipeline components.
2. **Well-typed protocol and domain model**
   - Shared `LightReading`, `WsMessage`, and dictionary types prevent drift
     between client and server.
3. **Dual-mode sensor** (light + audio)
   - Camera + EMA path and microphone + bandpass FFT path both feed the same
     pattern-matching engine.
4. **Dual-mode transmitter fallback**
   - Torch mode + sound mode improves practical usability across device and
     browser differences.
5. **Reusable virtual pipeline**
   - `ScalarSampleProcessor`, `PatternMatcher`, and `MatcherInputAdapter` live
     in `src/shared/` with no browser or DOM dependencies; see
     [Using the pipeline as a library](#using-the-pipeline-as-a-library).
6. **Trapezoidal motion profile**
   - `SensitivityZone` sweeps the detection circle with a smooth,
     acceleration-limited bounce profile — the same logic drives the
     `MovingSampleSource` in simulation mode.
7. **Robust UI control surface**
   - Camera capability introspection and dynamic control generation are
     unusually strong for this class of app.
8. **Practical reconnect + heartbeat**
   - Sensor WebSocket client uses exponential backoff and automatic
     re-identify; the server prunes stale connections every 30 s.

### Key technical risks / gaps

1. **No automated tests**
   - Core behaviour (matcher alignment logic, detector output invariants) is
     untested.
2. **WebSocket trust model is open**
   - Any client can identify as `sensor`/`subscriber`; no origin allowlist,
     token auth, or role authorization.
3. **Potential detector hot-path inefficiency**
   - `LightDetector.detect()` calls `background.getLuminanceAt()` per pixel,
     which repeatedly clamps/rounds and recalculates the index.
4. **Camera lifecycle cleanup not explicit in main app**
   - `CameraManager.stop()` exists but is not wired to page-lifecycle events
     in `main.ts`.
5. **Limited observability**
   - Minimal structured logging and no metrics for frame rate, detection rate,
     dropped WS sends, etc.

### Prioritized improvements

**P0 (high impact / low-medium effort)**
- Add unit tests for `PatternMatcher` threshold/alignment behaviour and
  `FovMapper` round-trip sanity.
- Add minimal WebSocket auth (shared token) and reject unauthenticated role
  claims.

**P1 (performance + reliability)**
- Optimize detector inner loop by computing background luminance from a
  pre-indexed cached luminance frame.
- Add lifecycle hooks (`visibilitychange`, `beforeunload`) to disconnect WS
  and stop camera stream.

**P2 (operability + DX)**
- Add npm scripts for lint/check/test and CI pipeline.
- Add runtime diagnostics panel (actual sample Hz, decode confidence trends,
  reconnect count).
- Add protocol version field to WS messages for forward compatibility.

---

## Architecture

```text
Camera frame (rAF)
  -> BackgroundModel.update (EMA)
  -> every 25ms (40Hz):
       LightDetector.detect
       -> RingBuffer.push
       -> PatternMatcher.addSample        (via MatcherInputAdapter)
       -> WsClient.sendReading

Microphone (optional audio mode)
  -> AudioDetector.detect (FFT bandpass)
  -> PatternMatcher.addSample            (via MatcherInputAdapter)
  -> WsClient.sendReading

Sensor client (/)
  -- ws identify(sensor) + sensor_reading -->
WebSocket relay server (/ws)
  -- broadcast sensor_reading --> full subscribers
  -- broadcast pattern_detected --> pattern subscribers

Transmitter client (/flash)
  -> emits fixed 40-segment dictionary words via torch or tone

Virtual / simulation (headless)
  -> MovingSampleSource (simulated mode) or any scalar feed
  -> ScalarSampleProcessor + PatternMatcher (src/shared/index.ts)
```

### Signal-processing pipeline

The sensor and virtual paths share the same decision + matching stages:

```text
Input: one scalar sample per tick (e.g., pixel luminance, audio level, simulated value)
          |
  RollingStatsBuffer  (PATTERN_LEN = 40 samples)
    computes: mean, max, stddev
          |
  SampleDecisionStrategy
    FixedThresholdStrategy:   detected = (sample >= threshold)
    AdaptiveZScoreStrategy:   detected = ((sample - mean) / stddev >= zThreshold)
          |
  PatternMatcher.addSample(detected)
    rolling Uint8 buffer of 40 bits
    scores all 8 dictionary words against the window
    reports best match when score >= threshold (default 0.875)
          |
  MatchResult | null  ->  patternDetected, patternScore
```

Z-score mode normalises the sample against the rolling distribution:

```
z = (sample - mean) / stddev
detected = (z >= zThreshold)  // e.g. zThreshold = 1.5
```

This keeps behaviour stable when absolute brightness or amplitude scale
changes, making it suitable for both camera and virtual contexts.

---

## Using the pipeline as a library

All pattern-matching components live in `src/shared/` and have **no camera,
audio, or DOM dependencies**.  They work equally in browser, Node.js, and
simulation contexts.

### Minimal Node.js / virtual receiver

```ts
import {
  MatcherInputAdapter,
  FixedThresholdStrategy,
} from './src/shared/index.js';

const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));

for (const sample of mySignalStream) {
  const tick = adapter.process(sample);
  if (tick.match) {
    console.log('matched', tick.match.word, 'score', tick.match.score);
  }
}
```

### Adaptive z-score receiver

```ts
import {
  MatcherInputAdapter,
  AdaptiveZScoreStrategy,
} from './src/shared/index.js';

// Trigger when the sample is >= 1.5 standard deviations above the rolling mean
const adapter = new MatcherInputAdapter(new AdaptiveZScoreStrategy(1.5));
```

### Custom decision strategy

```ts
import type { SampleDecisionStrategy, SampleDecisionContext } from './src/shared/index.js';

class MedianThresholdStrategy implements SampleDecisionStrategy {
  readonly name = 'median-threshold';
  constructor(private factor: number) {}

  decide({ sample, stats }: SampleDecisionContext): boolean {
    return sample >= stats.mean * this.factor;
  }
}
```

### Standalone components

| Export | Purpose | Has browser deps? |
|---|---|---|
| `DICTIONARY` / `DICT_WORDS` | 8-word, 40-segment signal dictionary | No |
| `getTransmitBit(word, idx)` | TX bit for a given segment | No |
| `PatternMatcher` | Rolling boolean-stream pattern scorer | No |
| `RollingStatsBuffer` | Windowed mean / max / stddev | No |
| `FixedThresholdStrategy` | Simple threshold decision | No |
| `AdaptiveZScoreStrategy` | Z-score normalised decision | No |
| `ScalarSampleProcessor` | Stats buffer + strategy combined | No |
| `MatcherInputAdapter` | Processor + matcher combined | No |
| `TickOrchestrator` | rAF / setTimeout loop abstraction | No (falls back to `setTimeout`) |
| `LightDetector` | Zone luminance delta detector | `ImageData` (browser) |
| `AudioDetector` | FFT bandpass audio analyser | `AudioContext` (browser) |
| `BackgroundModel` | EMA per-pixel background model | `ImageData` (browser) |
| `SensitivityZone` | Trapezoidal motion profile | No |
| `MovingSampleSource` | Camera or simulated scalar source | Optional camera |

Everything under `src/shared/index.ts` is browser/Node compatible.

---

## Repository layout

```text
src/
  shared/
    index.ts              Virtual-library barrel export
    types.ts              Shared domain and protocol types
    dictionary.ts         8-word, 40-segment dictionary
    samplePipeline.ts     RollingStatsBuffer + decision strategies + ScalarSampleProcessor
    patternMatcher.ts     Dictionary pattern matcher
    matcherInputAdapter.ts ScalarSampleProcessor + PatternMatcher combined
    tickOrchestrator.ts   rAF/setTimeout loop abstraction
  client/
    main.ts               Sensor app entrypoint and loop orchestration
    flash.ts              Torch/tone transmitter app
    camera.ts             Camera abstraction + capability APIs
    cameraControls.ts     Dynamic camera tuning UI
    background.ts         EMA background model
    detector.ts           Zone luminance delta detector
    sensitivityZone.ts    Trapezoidal motion profiles (X/Y)
    fovMapper.ts          Pixel <-> angle conversions
    audioDetector.ts      Microphone FFT bandpass analyser
    movingSampleSource.ts Camera or simulated scalar source
    renderer.ts           Canvas rendering + HUD
    wsClient.ts           Sensor WebSocket client with reconnect
    ringBuffer.ts         Generic circular buffer
    ui.ts                 DOM control bindings and runtime config
    patternMatcher.ts     Re-export shim -> src/shared/patternMatcher.ts
    matcherInputAdapter.ts Re-export shim -> src/shared/matcherInputAdapter.ts
    patternDemo.ts        Pattern comparison demo entrypoint
    backgroundStatsDemo.ts Background stats / simulation demo entrypoint
    audioBackgroundStatsDemo.ts Audio + background stats demo entrypoint
    demo.ts               Simple flash/detection demo entrypoint
    styles.css            Sensor page styling
  server/
    index.ts              HTTP static host + WS relay
config/
  sensor.config.json      Default sensor UI control values
  transmitter.config.json Default transmitter UI control values
index.html                Sensor page shell
flash.html                Transmitter page shell
pattern-demo.html         Pattern comparison interactive visualiser
background-stats-demo.html Background model + rolling-stats demo
audio-background-stats-demo.html Audio detection + stats demo
demo.html                 Flash/detection demo
vite.config.ts            MPA setup, dev WS proxy, build inputs
Procfile                  Heroku process declaration
```

---

## Message protocol (`/ws`)

### Identify
```json
{ "type": "identify", "payload": { "role": "sensor" } }
```
```json
{ "type": "identify", "payload": { "role": "subscriber", "mode": "full" } }
```
```json
{ "type": "identify", "payload": { "role": "subscriber", "mode": "pattern" } }
```

Subscriber modes:
- `full` — receives every `sensor_reading` frame (40 Hz)
- `pattern` — receives only `pattern_detected` events (edge-triggered on new match)

### Sensor reading (sensor -> server -> full subscribers)
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
    "zoneRadius": 50,
    "sampleRateHz": 40,
    "patternDetected": "I_O",
    "patternScore": 0.925
  }
}
```

### Pattern detected (server -> pattern subscribers, edge-triggered)
```json
{
  "type": "pattern_detected",
  "payload": {
    "timestamp": 1739750000000,
    "patternDetected": "I_O",
    "patternScore": 0.925,
    "sampleRateHz": 40
  }
}
```

Pattern matching behaviour:
- Matcher score is computed on the **TX window only** (`PATTERN_LEN = 40` samples).
- The **LISTEN window** (`LISTEN_LEN = 40` samples) is protocol spacing and does
  not contribute to matcher score.
- `pattern_detected` is broadcast only when the matched word _changes_ (edge trigger).

### Ping/pong
```json
{ "type": "ping" }
```
```json
{ "type": "pong" }
```

Server sends a WebSocket-level `ping` frame every 30 s and terminates clients
that do not respond.

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

Pages:
- Sensor app: `http://localhost:5173/`
- Transmitter app: `http://localhost:5173/flash`
- Pattern comparison demo: `http://localhost:5173/pattern-demo`
- Background stats demo: `http://localhost:5173/background-stats-demo`
- Audio + background stats demo: `http://localhost:5173/audio-background-stats-demo`

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
| Desktop Chrome / Edge | Full | Usually unavailable | Yes | Best support for camera capabilities and tuning controls |
| Desktop Firefox | Core | Usually unavailable | Yes | Limited `getCapabilities()` camera tuning |
| Desktop Safari | Core | Usually unavailable | Yes | Camera tuning surface is limited |
| Android Chrome | Full/Core | Best target | Yes | Preferred phone setup for torch transmitter |
| iOS Safari | Core | Not supported | Yes | Torch API generally unavailable on iOS Safari |

### Runtime fallback behaviour

- Sensor page checks camera API + secure context on startup and shows a compatibility banner.
- Flash transmitter auto-falls back to sound mode when torch/camera APIs are unavailable.
- Flash mode button is disabled automatically in environments without secure camera APIs.
- Hidden-tab behaviour is handled to avoid stale timing while backgrounded on phones.

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

1. Add `vitest` unit tests for `PatternMatcher`, `RollingStatsBuffer`, and `FovMapper`.
2. Add minimal WebSocket auth (shared secret token) and reject unauthenticated role claims.
3. Add lifecycle hooks (`visibilitychange`, `beforeunload`) to disconnect WS and stop camera.
4. Add configurable sample rate and ring buffer sizing via UI/config.
5. Add runtime diagnostics panel (actual Hz, decode confidence, reconnect count).
6. Add protocol version field to WS messages for forward compatibility.
7. Publish `src/shared/` as a standalone npm package for virtual-context consumers.
8. Add simulation examples showing multi-agent conversation replay.
