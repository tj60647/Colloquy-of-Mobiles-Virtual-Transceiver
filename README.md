# Colloquy of Mobiles — Virtual Transceiver

A receiver station for the *Colloquy of Mobiles* signal vocabulary. Point a
webcam at a flashing phone torch, or a microphone at a gated tone, and the
station decodes the stream into one of eight dictionary words and relays every
sample over a WebSocket.

It is a receiver first. It also ships a transmitter page (`/flash`), but that
page is a permanent duplicate of the maintained transmitter, which now lives in
another repo — see [Deprecations](#deprecations).

---

## What it does, and what it does not

**Does**

- Samples one scalar per tick — mean luminance inside a moving circular zone, or
  the level in an audio bandpass — and turns it into a detection bit.
- Scores the last 40 detection bits against all 8 dictionary words and reports
  the best word above a match threshold (default `0.875`,
  `src/shared/patternMatcher.ts:23`).
- Relays every reading to `full` subscribers and every *change* of matched word
  to `pattern` subscribers over `/ws`.
- Runs the same matching core headlessly in Node with no camera, microphone, or
  DOM — see [Using the pipeline as a library](#using-the-pipeline-as-a-library).

**Does not**

- It does not do Morse. The vocabulary is a fixed, closed set of eight
  40-segment binary words (`src/shared/dictionary.ts`). There is no
  variable-length encoding and no character alphabet.
- It has no persistent storage and no event replay. Readings are relayed and
  dropped; nothing is written to disk. That is a stated non-goal in `ROADMAP.md`.
- It does not synchronise clocks with the transmitter. The matcher is
  alignment-free — it re-scores the whole rolling window every sample — so a
  free-running transmitter and a free-running receiver decode without a
  handshake.
- It has no formal API version negotiation. Messages carry a `version` integer
  (`WS_PROTOCOL_VERSION`, currently `1`) but neither side rejects a mismatch.
- It is not a Vercel deployment. It is a long-lived Node process with a
  `Procfile`; it needs a host that keeps WebSocket upgrades open.

### Signal medium

| Mode | Transmitter | Receiver |
|---|---|---|
| **Light** | Phone torch / camera flash | Webcam + EMA background model, zone-mean delta |
| **Audio** | Gated sine tone (Web Audio) | Microphone + bandpass FFT level |
| **Virtual** | Any programmatic scalar stream | `MatcherInputAdapter` pipeline, headless |

All three feed the same `PatternMatcher`. Nothing about the dictionary or the
matcher knows which medium produced a bit.

---

## The dictionary and its timing

Eight words cover every identity–drive combination the mobiles can utter
(`src/shared/dictionary.ts:29`):

| Word | Meaning |
|---|---|
| `I_O` / `I_P` / `I_OP` | Male I — drive O, drive P, drive O-or-P |
| `II_O` / `II_P` / `II_OP` | Male II — drive O, drive P, drive O-or-P |
| `I_R` / `II_R` | Reinforcement from Male I / Male II |

Every word is 40 segments (`PATTERN_LEN = 40`). A transmit cycle is the word
followed by an equal-length silent listening window
(`TX_CYCLE_LEN = PATTERN_LEN + LISTEN_LEN = 80`). Only the transmit window is
scored; the listening window is protocol spacing.

**Segment length is not fixed at 25 ms, and the default rate is 20 Hz, not
40 Hz.** `SEGMENT_MS = 25` (`src/shared/dictionary.ts:16`) is the segment length
in the *40 Hz* mode. Both ends ship defaulted to the slower option:

| | Default (20 Hz) | Option (40 Hz) |
|---|---|---|
| Sensor sample interval | 50 ms — `sampleRateHz: 20` (`src/client/ui.ts:38`), `"sample-rate": "20"` (`config/sensor.config.json:4`), `<option value="20" selected>` (`index.html:78`) | 25 ms |
| Transmitter segment | 50 ms — `SEGMENT_MS * 2` (`src/client/flash.ts:502`), reached because `"rate-toggle": "1"` maps to `txRateHz = 20` (`src/client/flash.ts:340`) | 25 ms |
| One 40-segment word | 2000 ms | 1000 ms |

In both modes the relationship the matcher relies on is the same: **one sensor
sample per transmitted segment**, so the 40-sample matcher window is exactly one
word wide. Changing the rate at one end only will not decode. The two selectors
are independent, and there is no negotiation between them — this is the single
most common cause of "no detections".

---

## Current state

Assessed **2026-09-02** against commit `7499346` (2026-07-16), the latest on
`main`. Every claim below was re-run or re-read at that assessment; where a
number appears, the command that produced it is named.

### Health scorecard

| Dimension | Rating | Evidence |
|---|---|---|
| Build | ✅ passes | `npm run build` — Vite emits 6 HTML entries to `dist/client`; `tsc -p tsconfig.server.json` emits the server. Note that `vite build` transpiles without type-checking, which is why this passes while the row below does not |
| Tests | ✅ 128 passing | `npx vitest run` — 6 files, 128 tests, 0 failures |
| Type-check | ❌ 13 errors | `npm run typecheck` — the server project (`tsconfig.server.json`) is clean; the client+shared project (`tsconfig.json`) fails across six files, below |
| CI | ❌ red | `.github/workflows/ci.yml` runs both type-checks and `npm test` on every push and pull request, but it stops at the first step. Every run in the repo's history has failed there, so `npm test` has never run on CI |
| Architecture | Good | `src/shared/` imports nothing from client or server; one typed protocol shared by both ends |
| Runtime resilience | Good | Exponential back-off reconnect (`src/client/wsClient.ts`), 30 s server heartbeat with terminate (`src/server/index.ts:207`) |
| Performance | Moderate | Stable at either rate; one known hot-path inefficiency, below |
| Operational maturity | Moderate | Deployable and optionally token-authed, but production config delivery is broken, below |

Test counts per file, from that same `npx vitest run`:

| File | Tests |
|---|---|
| `tests/replayHarness.test.ts` | 37 |
| `tests/patternMatcher.test.ts` | 22 |
| `tests/fovMapper.test.ts` | 21 |
| `tests/adaptiveZScoreStrategy.test.ts` | 18 |
| `tests/rollingStatsBuffer.test.ts` | 17 |
| `tests/tickOrchestrator.test.ts` | 13 |

The totals exceed the number of `it(` calls in the sources because the replay
harness, the FOV suite, and the matcher suite use table-driven `it.each` cases.

### What is strong

1. **Clear module boundaries.** `src/client` captures and renders, `src/server`
   relays and serves, `src/shared` holds protocol, dictionary, and the matching
   core. `src/shared` imports nothing from the other two.
2. **One typed protocol.** `LightReading`, `WsMessage`, `IdentifyPayload` and
   friends are declared once in `src/shared/types.ts` and consumed at both ends,
   so drift is a compile error rather than a runtime surprise.
3. **Two physical detection paths into one matcher.** The EMA/luminance path and
   the FFT/bandpass path each produce a single scalar; the decision strategy and
   matcher downstream are identical.
4. **Three selectable matcher inputs.** `detector` (the EMA bit),
   `scalar-fixed`, and `scalar-zscore` (`index.html:225`) let you compare
   decision strategies against the same live signal without a rebuild.
5. **A genuinely headless core.** The barrel in `src/shared/index.ts` runs under
   plain Node; `examples/multi-agent-conversation.ts` decodes three superimposed
   agents with no browser at all.
6. **Acceleration-limited zone sweep.** `SensitivityZone` moves the detection
   circle on a velocity- and acceleration-limited trapezoidal profile
   (`src/client/sensitivityZone.ts`), so the zone does not jerk between samples.
7. **Practical reconnect and heartbeat.** The sensor client backs off 1 s → 16 s
   and re-identifies on every reconnect; the server pings every 30 s and
   terminates clients that miss a pong.

### Known gaps and risks

1. **The detector hot path recomputes per pixel.** `LightDetector.detect()` calls
   `background.getLuminanceAt(px, py)` inside the inner loop
   (`src/client/detector.ts:53`), and that method clamps, rounds, and recomputes
   the flat index on every call (`src/client/background.ts:65`) even though the
   caller already holds an in-bounds integer coordinate and an index.
2. **Config never reaches production.** The sensor and transmitter pages fetch
   `/config/sensor.config.json` and `/config/transmitter.config.json`
   (`src/client/main.ts:33`, `src/client/flash.ts:28`), but `config/` is not
   copied into `dist/client` by the Vite build and is not served by the Node
   server. In production the fetch lands on the index-HTML fallback, JSON parsing
   throws, and the loader silently returns `{}` (`src/client/main.ts:86`). The
   pages then run on their compiled-in defaults. Nothing errors; the config file
   simply has no effect once deployed.
3. **`/audio-background-stats-demo` is dev-only in practice.** The production
   server's route table maps `/`, `/flash`, `/demo`, `/pattern-demo`, and
   `/background-stats-demo` to their HTML files (`src/server/index.ts:54`) but
   not the audio demo, so that path falls through to the SPA fallback and serves
   the sensor page. The built HTML file is present in `dist/client`; only the
   bare route is missing.
4. **`express` is a dependency but is never imported.** `src/server/index.ts`
   uses `node:http` and `ws` only. The dependency, and a stale comment at
   `src/client/main.ts:411` reading "the Express server handles the upgrade", are
   leftovers.
5. **Two dead keys in `config/sensor.config.json`.** `"view-mode-bg"` (line 10)
   and `"morse-unit"` (line 24) are absent from `SENSOR_CONTROL_IDS`
   (`src/client/main.ts:40`) and are read by nothing. `"morse-unit"` is the last
   trace of an abandoned Morse idea.
6. **The client type-check does not pass, so CI is red.** `npx tsc --noEmit`
   reports 13 errors across `audioBackgroundStatsDemo.ts`, `audioDetector.ts`,
   `backgroundStatsDemo.ts`, `cameraControls.ts`, `flash.ts`, and `renderer.ts`.
   Most are unused locals and `Uint8Array<ArrayBuffer>` variance under
   TypeScript 5.9, but one is a genuine latent bug: `src/client/renderer.ts:418`
   reads `count` inside a loop body that declares its own `let count` three lines
   later, so that read is in the temporal dead zone and would throw a
   `ReferenceError`. It never fires today only because every caller passes a
   history already capped at `HUD_SPARKLINE_SAMPLES`, which takes the early
   return at `src/client/renderer.ts:414` before the loop. Because CI runs the
   client type-check first, the server type-check and the test suite never
   execute there.
7. **`npm start` serves nothing on Windows.** `DIST_CLIENT`
   (`src/server/index.ts:24`) is derived from `new URL(import.meta.url).pathname`,
   which on Windows yields `/C:/…`; `path.resolve` then produces
   `C:\C:\…\dist\client`, which does not exist, so every request falls through to
   the plaintext "Build the client first" branch (`src/server/index.ts:70`). The
   Heroku/Linux deployment target is unaffected — but the `npm run build &&
   npm start` loop below cannot be exercised locally on Windows. Use `npm run dev`.
8. **No persistence, no replay, no version negotiation** — see
   [What it does, and what it does not](#what-it-does-and-what-it-does-not).

### Prioritised improvements

The single list; there is no second one further down. Items with a roadmap phase
are tracked in `ROADMAP.md`.

| Priority | Item | Notes |
|---|---|---|
| P1 | Get the client type-check green | Fix `renderer.ts`'s shadowed `count` first — a latent defect, not a lint nit — then the unused locals and the `Uint8Array` variance. Nothing else in CI runs until this does. Closes gap 6. |
| P1 | Ship `config/` with the build | Copy to `dist/client/config/`, or move it into a Vite `public/` directory, so deployed pages honour the config file. Closes gap 2. |
| P1 | Flatten the detector inner loop | Precompute a background luminance frame once per tick and index it directly instead of calling `getLuminanceAt` per pixel. Closes gap 1. |
| P2 | Route `/audio-background-stats-demo` on the server | One line in `src/server/index.ts`. Closes gap 3. |
| P2 | Resolve `DIST_CLIENT` with `fileURLToPath` | `new URL(import.meta.url).pathname` is not a filesystem path on Windows. Closes gap 7. |
| P2 | Publish `src/shared/` as a package | ROADMAP Phase 7, with an `exports` map per feature. Would also remove `apps/transmitter`'s cross-root relative import. |
| P3 | Drop `express`, fix the stale comment, delete the two dead config keys | Cosmetic, but they mislead readers. |
| P3 | Make the sample rate and ring-buffer size configurable beyond the two fixed options | Currently `20 \| 40` only (`src/client/ui.ts:12`). |

Two items that earlier drafts of this file listed as pending are **done**:
`examples/minimal-receiver.ts` and `examples/multi-agent-conversation.ts` both
exist and run, which is ROADMAP Phase 4 complete.

---

## Architecture

```text
Camera frame (requestAnimationFrame)
  -> BackgroundModel.update            per-pixel EMA, alpha default 0.03
  -> on each sample tick               50 ms at the default 20 Hz; 25 ms at 40 Hz
       LightDetector.detect            zone-mean luminance minus zone-mean background
       -> RingBuffer.push
       -> PatternMatcher.addSample     directly, or via MatcherInputAdapter
       -> WsClient.sendReading

Microphone (audio detector mode)
  -> AudioDetector.detect              bandpass FFT level, default centre 2199 Hz, Q 1.5
  -> PatternMatcher.addSample          directly, or via MatcherInputAdapter
  -> WsClient.sendReading

Sensor page (/)
  -- ws identify{role:sensor}, then sensor_reading ------>
node:http + ws relay server (/ws)
  -- sensor_reading   --> subscribers in "full" mode
  -- pattern_detected --> subscribers in "pattern" mode   (edge-triggered)

Transmitter page (/flash)              frozen duplicate — see Deprecations
  -> emits the selected 40-segment word by torch or tone over the 80-segment cycle

Headless / virtual (Node)
  -> any scalar stream
  -> MatcherInputAdapter (src/shared/index.ts) -> MatchResult
```

### Signal-processing pipeline

The camera, microphone, and virtual paths converge here:

```text
one scalar sample per tick   (zone luminance | audio level | simulated value)
          |
  RollingStatsBuffer         window = PATTERN_LEN = 40 samples
    -> { count, mean, max, stddev }
          |
  SampleDecisionStrategy
    FixedThresholdStrategy     detected = sample >= threshold
    AdaptiveZScoreStrategy     detected = (sample - mean) / stddev >= zThreshold
          |
  PatternMatcher.addSample(detected)
    Uint8Array ring of 40 bits
    re-scores all 8 words against the whole window every sample, no alignment step
    reports the best word once its score >= threshold (default 0.875)
          |
  MatchResult | null    ->    patternDetected, patternScore
```

The z-score strategy normalises against the rolling distribution:

```text
z = (sample - mean) / stddev
detected = (z >= zThreshold)          // the sensor page uses zThreshold = 1.5
```

Why it exists: absolute brightness and microphone gain drift with the room, the
exposure, and the distance to the transmitter, but the *shape* of a word does
not. Normalising lets one tuning survive a change of venue. It is not free —
z-score decoding fails on signals superimposed from several agents, which
`examples/multi-agent-conversation.ts` demonstrates and prints plainly.

---

## Using the pipeline as a library

Everything exported from `src/shared/index.ts` is free of camera, audio, and DOM
APIs, and runs unchanged in a browser or under Node.

### Minimal headless receiver

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

### What the barrel actually exports

Read straight off `src/shared/index.ts`. Values:

| Export | Kind | Purpose |
|---|---|---|
| `SEGMENT_MS`, `PATTERN_LEN`, `LISTEN_LEN`, `TX_CYCLE_LEN` | const | Segment and window lengths — 25, 40, 40, 80 |
| `DICTIONARY`, `DICT_WORDS`, `DICT_LABELS` | const | The 8 words, their keys, their human labels |
| `AUDIO_TONE_FREQS`, `AUDIO_BANDPASS_DEFAULT_CENTER`, `AUDIO_BANDPASS_DEFAULT_Q` | const | Transmitter tone set and the matching receiver bandpass defaults |
| `getTransmitBit(word, segmentIndex, invert?)` | function | TX state for a segment index over the full 80-segment cycle |
| `PatternMatcher` | class | Rolling boolean-stream scorer over the 8 words |
| `RollingStatsBuffer` | class | Windowed count / mean / max / stddev |
| `FixedThresholdStrategy`, `AdaptiveZScoreStrategy` | class | Sample decision strategies |
| `ScalarSampleProcessor` | class | Stats buffer plus a strategy |
| `MatcherInputAdapter` | class | `ScalarSampleProcessor` plus `PatternMatcher` |
| `TickOrchestrator` | class | rAF / `setTimeout` loop with catch-up capping |
| `WS_PROTOCOL_VERSION` | const | Protocol version integer |

Types: `DictWord`, `MatchResult`, `RollingStatsSnapshot`,
`SampleDecisionContext`, `SampleDecisionStrategy`, `ScalarSampleTick`,
`MatcherTick`, `FrameContext`, `TickContext`, `TickOrchestratorCallbacks`,
`LightReading`, `MotionUnit`, `MotionAxisConfig`, `ZoneConfig`, `FovConfig`,
`DetectorConfig`, `WsMessageType`, `SubscriberMode`, `IdentifyPayload`,
`PatternDetectedPayload`, `WsMessage`.

**Not exported, and not importable from the barrel:** `LightDetector`,
`AudioDetector`, `BackgroundModel`, `SensitivityZone`, `MovingSampleSource`,
`FovMapper`, `RingBuffer`, `CameraManager`, `CameraControls`, `Renderer`,
`WsClient`, `UI`, and the five chart classes in `backgroundStatsRenderers.ts`.
All of these
live under `src/client/`, and several of them touch `ImageData`, `AudioContext`,
or the DOM. Import them by path from `src/client/…` if you need them in a browser
context; there is no library surface for them and none is planned.

### Runnable examples

```bash
npx tsx examples/minimal-receiver.ts            # 5-part decode walk-through
npx tsx examples/multi-agent-conversation.ts    # 3 agents, superimposed, decoded
```

`minimal-receiver.ts` runs five numbered examples in sequence: a fixed-threshold
single-word decode, a z-score decode that deliberately fails its warm-up, an
all-8-words round trip (8/8), a noise-tolerance sweep from ±0 to ±120 (100% at
every level), and a full 80-segment TX cycle showing the match clearing as the
listen window fills the buffer with silence.

Both import only `src/shared/index.js`. The multi-agent script runs a
fixed-threshold receiver and a z-score receiver over the same composite stream
and prints what each recovers, including the case where the z-score receiver
recovers nothing.

---

## Repository layout

```text
src/
  shared/                        No DOM, no camera, no audio — Node and browser alike
    index.ts                     Library barrel; see the export table above
    types.ts                     Domain and WS protocol types, WS_PROTOCOL_VERSION
    dictionary.ts                8 words, 40 segments, timing constants, tone set
    samplePipeline.ts            RollingStatsBuffer, decision strategies, ScalarSampleProcessor
    patternMatcher.ts            Alignment-free dictionary scorer
    matcherInputAdapter.ts       ScalarSampleProcessor + PatternMatcher
    tickOrchestrator.ts          rAF / setTimeout loop with catch-up capping
  client/
    main.ts                      Sensor app: capture loop, config, diagnostics, WS
    ui.ts                        DOM control bindings and the AppConfig defaults
    camera.ts                    Camera acquisition and capability introspection
    cameraControls.ts            Control UI generated from getCapabilities()
    background.ts                Per-pixel EMA background model
    detector.ts                  Zone-mean luminance delta detector
    audioDetector.ts             Microphone bandpass FFT level detector
    sensitivityZone.ts           Velocity/acceleration-limited zone motion
    movingSampleSource.ts        Camera or simulated scalar source
    fovMapper.ts                 Pixel <-> angle conversion
    renderer.ts                  Canvas render and HUD sparklines
    ringBuffer.ts                Fixed-capacity circular buffer
    wsClient.ts                  Sensor WS client: back-off reconnect, re-identify
    patternMatcher.ts            Re-export shim -> src/shared/patternMatcher.ts
    matcherInputAdapter.ts       Re-export shim -> src/shared/matcherInputAdapter.ts
    flash.ts                     /flash transmitter page (frozen duplicate)
    demo.ts                      Simple flash/detection demo
    patternDemo.ts               Pattern comparison visualiser
    backgroundStatsDemo.ts       Background model and rolling-stats demo
    audioBackgroundStatsDemo.ts  Audio detection and stats demo
    backgroundStatsRenderers.ts  Shared chart drawing for the two stats demos
    styles.css                   Sensor page styling
  server/
    index.ts                     node:http static host plus ws relay at /ws
tests/                           vitest, node environment
  patternMatcher.test.ts         Threshold, scoring, edge vs raw trigger
  rollingStatsBuffer.test.ts     Mean/stddev correctness, warm-up behaviour
  adaptiveZScoreStrategy.test.ts Decision boundary, cold-start guard
  fovMapper.test.ts              Pixel -> angle -> pixel round trips
  tickOrchestrator.test.ts       Tick counting and catch-up capping, headless
  replayHarness.test.ts          Deterministic bit streams and noise sweeps
examples/
  minimal-receiver.ts            Headless decode walk-through, five examples
  multi-agent-conversation.ts    Deterministic 3-agent conversation replay
config/
  sensor.config.json             Sensor control defaults — dev only, see gap 2
  transmitter.config.json        Transmitter control defaults — dev only, see gap 2
apps/
  transmitter/                   FROZEN standalone transmitter app — see Deprecations
.github/
  workflows/ci.yml               Type-check (client+shared, server) and test, per push/PR
index.html                       Sensor page
flash.html                       Transmitter page (frozen duplicate)
demo.html                        Flash/detection demo
pattern-demo.html                Pattern comparison visualiser
background-stats-demo.html       Background model and rolling stats
audio-background-stats-demo.html Audio detection and stats
vite.config.ts                   MPA inputs, dev route rewrites, /ws dev proxy
vitest.config.ts                 node environment; src/**/*.test.ts and tests/**/*.test.ts
tsconfig.json                    Client + shared; noEmit, strict, DOM libs
tsconfig.server.json             Server + shared; NodeNext, emits to dist/
Procfile                         web: node dist/server/index.js
ROADMAP.md                       Phase log — 1–6 complete, 7 open, 8 superseded
package.json                     Scripts and the two runtime dependencies
.gitignore                       node_modules/, dist/, .vite/, .env*, editor and OS noise
```

There is no `vercel.json` and no `.vercel/` in this repo. Deployment is the
`Procfile`.

---

## Scripts

Verbatim from `package.json`:

| Script | Command | What it is for |
|---|---|---|
| `dev` | `concurrently --kill-others-on-fail "vite" "tsx watch src/server/index.ts"` | Vite on 5173 and the relay on 3001, together |
| `build` | `vite build && tsc -p tsconfig.server.json` | Client to `dist/client`, server to `dist/server` |
| `heroku-postbuild` | `npm run build` | Build on the dyno after install |
| `start` | `node dist/server/index.js` | Serve `dist/client` and the `/ws` relay |
| `preview` | `vite preview` | Vite's own preview of the built client; no WS relay |
| `typecheck` | `tsc --noEmit && tsc -p tsconfig.server.json --noEmit` | Both projects |
| `test` | `vitest run` | The six suites |
| `test:watch` | `vitest` | Watch mode |
| `dev:tx` | `npm --prefix apps/transmitter run dev` | Dev-serves the **frozen** app — see Deprecations |
| `build:tx` | `npm --prefix apps/transmitter run build` | Builds the **frozen** app — see Deprecations |

Runtime dependencies are `express` (unused — gap 4) and `ws`. Everything else is
a devDependency.

---

## Getting started

### Prerequisites

- Node **>=20** and npm **>=10**, declared in `engines` in `package.json`. There
  is no `.npmrc`, so npm treats that as advisory (an `EBADENGINE` warning), not
  a hard gate.
- A Chromium browser gives the fullest camera-control surface. Camera access
  needs a secure context: `localhost` qualifies, a LAN IP over plain HTTP does
  not.

### Install and run

```bash
npm install
npm run dev
```

| Page | URL in dev | Notes |
|---|---|---|
| Sensor | `http://localhost:5173/` | The receiver |
| Transmitter | `http://localhost:5173/flash` | Frozen duplicate — see Deprecations |
| Pattern comparison | `http://localhost:5173/pattern-demo` | |
| Background stats | `http://localhost:5173/background-stats-demo` | |
| Audio + background stats | `http://localhost:5173/audio-background-stats-demo` | Dev only in practice — gap 3 |

Vite proxies `/ws` to `ws://localhost:3001/ws` in dev and rewrites the bare
routes above to their `.html` files (`vite.config.ts`).

### Build and serve

```bash
npm run build
npm start
```

The server listens on `PORT` (default `3001`), serves `dist/client`, and accepts
WebSocket upgrades at `/ws` only — any other upgrade path is destroyed. On
Windows it serves nothing but a plaintext placeholder: see gap 7. Use
`npm run dev` there.

### Deployment

- `Procfile` declares `web: node dist/server/index.js`.
- `heroku-postbuild` runs the build on the dyno.
- The reverse proxy must pass WebSocket upgrades through at `/ws`, and should
  terminate TLS: the sensor page derives `wss:` from `window.location.protocol`
  (`src/client/main.ts:412`), so an HTTPS page will only ever attempt `wss:`.

---

## Security

### WebSocket token auth

Set `WS_TOKEN` to a non-empty shared secret to require it on every `identify`:

```bash
WS_TOKEN=my-secret-token npm start
```

```json
{ "type": "identify", "version": 1, "payload": { "role": "sensor", "token": "my-secret-token" } }
```

A missing or wrong token receives a `pong` carrying `{ "error": "unauthorized" }`
and is then closed with code `1008` (`src/server/index.ts:139`). With `WS_TOKEN`
unset the server logs `token authentication DISABLED` at boot and runs open.

The sensor page does not currently send a token. `WsClient` accepts one as its
second constructor argument, but `src/client/main.ts:414` constructs it without
one, so a tokened server rejects the shipped sensor page. That is deliberate to
the extent that no secret should ever be baked into a public bundle; supplying
the token is left to whoever deploys.

### Role enforcement

Only a connection that has completed `identify` as `role: "sensor"` may send
`sensor_reading`. Anything else is dropped silently, with no reply
(`src/server/index.ts:157`). Broadcasts always exclude the sender.

---

## Message protocol (`/ws`)

Every message may carry `"version"` — an integer, currently `1`.

### Identify

```json
{ "type": "identify", "version": 1, "payload": { "role": "sensor" } }
```
```json
{ "type": "identify", "version": 1, "payload": { "role": "subscriber", "mode": "full" } }
```
```json
{ "type": "identify", "version": 1, "payload": { "role": "subscriber", "mode": "pattern" } }
```

Subscriber modes:

- `full` — every `sensor_reading` frame, at whatever rate the sensor is running:
  20 Hz by default, 40 Hz if selected.
- `pattern` — only `pattern_detected`, emitted when the matched word *changes*.

Any `mode` other than `"pattern"` is coerced to `"full"`.

### Sensor reading — sensor → server → `full` subscribers

```json
{
  "type": "sensor_reading",
  "version": 1,
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
    "sampleRateHz": 20,
    "patternDetected": "I_O",
    "patternScore": 0.925
  }
}
```

`sampleRateHz` reports the rate the sensor is configured to, not a measured one.
The sensor page tracks the achieved rate separately, on a 30 s window, and shows
it in the HUD.

### Pattern detected — server → `pattern` subscribers, edge-triggered

```json
{
  "type": "pattern_detected",
  "version": 1,
  "payload": {
    "timestamp": 1739750000000,
    "patternDetected": "I_O",
    "patternScore": 0.925,
    "sampleRateHz": 20
  }
}
```

Matching behaviour:

- Score is computed over the transmit window only, `PATTERN_LEN = 40` samples.
  The listening window, `LISTEN_LEN = 40`, is spacing and contributes nothing.
- The matcher emits nothing until 40 samples have been ingested.
- The server remembers the last word it forwarded *per connection* and forwards
  only on a change. A reading with no match resets that memory, so the same word
  detected again after a gap is forwarded again.

### Ping / pong

```json
{ "type": "ping" }
```
```json
{ "type": "pong" }
```

Independently of that application-level pair, the server sends a
WebSocket-level ping frame every 30 s and terminates any client that has not
ponged since the previous round.

---

## Deprecations

### `apps/transmitter/` — frozen, 2026-07-16

The maintained transmitter is no longer in this repo. It is the `/transmitter`
page in **Colloquy-of-Mobiles-Virtual-Simulation**, where it imports that repo's
compiled communication dictionary directly, so there is one dictionary authority
and no cross-repo drift.

`apps/transmitter/` remains as a working snapshot of the first extraction
increment. It will not receive further changes, and the standalone Vercel project
once planned for it will not be created. `ROADMAP.md` Phase 8 records the items
that were dropped.

Two root scripts still point into it. They still work, but they build a frozen
app:

| Script | Runs |
|---|---|
| `dev:tx` | `npm --prefix apps/transmitter run dev` → `vite --port 5174` |
| `build:tx` | `npm --prefix apps/transmitter run build` → `tsc --noEmit && vite build` |

Its one tie to the monolith is a relative import of the shared dictionary,
`../../../src/shared/dictionary.js` (`apps/transmitter/src/main.ts:22`), allowed
through Vite's `server.fs.allow` in `apps/transmitter/vite.config.ts`.

### `/flash` — live, but a permanent duplicate

The in-monolith transmitter page is still built and still served. It is a Vite
MPA entry (`vite.config.ts`), routed at `/flash` in dev and in production
(`src/server/index.ts:56`), and it works.

It is now a **permanent duplicate** of the flagship's `/transmitter`. Retiring it
was one of the open items of ROADMAP Phase 8 (`ROADMAP.md:109`), and that phase
is superseded, so no retirement is planned. Treat `/flash` as a convenience for exercising this
receiver without a second repo checked out, and do not evolve it: any transmitter
change belongs in Colloquy-of-Mobiles-Virtual-Simulation. The two will drift, and
that is accepted.

---

## Browser and device compatibility

| Device / browser | Sensor (`/`) | `/flash` torch | `/flash` tone |
|---|---|---|---|
| Android Chrome | Full | Best target | Yes |
| Desktop Chrome / Edge | Full — richest camera controls | Usually unavailable | Yes |
| Desktop Firefox | Core — limited `getCapabilities()` | Usually unavailable | Yes |
| Desktop Safari | Core — limited camera tuning | Usually unavailable | Yes |
| iOS Safari | Core | Not available — no torch API | Yes |

Fallback behaviour:

- The sensor page checks for the camera API and a secure context at startup and
  shows a compatibility banner.
- `/flash` selects tone mode at load on any non-Android user agent — the test is
  a UA sniff, `/Android/i.test(navigator.userAgent)` (`src/client/flash.ts:207`),
  not a torch-API probe. Neither mode button is ever disabled; you can always
  switch back by hand. If you do, and the torch then turns out to be
  unavailable, the page does *not* fall back to tone: it broadcasts in
  **simulated flash mode**, an on-screen icon only (`src/client/flash.ts:602`).
- Both pages handle `visibilitychange` so a backgrounded tab does not accumulate
  stale timing.

---

## Troubleshooting

- **No detections at all.** First check that both rate selectors match — the
  sensor's "Sample Hz" and the transmitter's "Rate" must read the same number.
  Then lower the camera exposure or ISO, reduce ambient light, and only then tune
  the threshold.
- **Detections, but never a word.** The score is probably sitting just under the
  match threshold. Watch `patternScore` in the HUD and lower the pattern
  threshold slider, range 0.7–0.98, before touching anything else.
- **Config file changes do nothing after deploying.** Expected — gap 2. The file
  is honoured in dev only.
- **WS disconnected.** Confirm the relay is running and that the proxy passes
  upgrades at `/ws`. The client backs off to 16 s, so give it that long before
  concluding it is stuck.
- **Torch unavailable.** Use tone mode, or Android Chrome with the rear camera.

### Mixed-device runbook

1. `npm run dev` on the laptop.
2. Laptop: open `http://<host>:5173/`. The camera starts, controls render, and
   the compatibility banner reads ok.
3. Phone: open `http://<host>:5173/flash`. Note that a LAN IP over plain HTTP is
   not a secure context, so the torch will be unavailable — use tone mode, or put
   both ends behind HTTPS.
4. Set the same rate at both ends.
5. Point the torch or the speaker at the sensor zone and watch `patternScore`.
6. Background and resume the tab on each device; detection should recover.
7. Drop and restore the network; the sensor should reconnect and resume sending.
