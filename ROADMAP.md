# Roadmap

## Completed

### Phase 1 — Reusable Sample Pipeline ✅

- [x] Define a sample-processing interface
  - Input: one scalar value per sample tick.
  - Output: per-tick stats + boolean detection bit.
- [x] Implement rolling stats buffer (`RollingStatsBuffer`)
  - Window size: `PATTERN_LEN` (40).
  - Stats each tick: mean, max, stddev.
- [x] Add decision strategies
  - `FixedThresholdStrategy`
  - `AdaptiveZScoreStrategy`

### Phase 2 — Matcher Integration ✅

- [x] Add `MatcherInputAdapter`
  - Feeds `ScalarSampleProcessor` output into `PatternMatcher.addSample(...)`.
  - Preserves existing match metadata (`patternDetected`, `patternScore`, `sampleRateHz`).
- [x] Camera + EMA path remains selectable
  - Camera mode continues to work as-is via `LightDetector`.
  - Audio mode added as a second physical detection path (`AudioDetector`).
- [x] `TickOrchestrator` — rAF / setTimeout abstraction for browser + Node.js loops.
- [x] `MovingSampleSource` — camera or programmatic simulated scalar source
  with a trapezoidal motion profile.
- [x] Subscriber modes (`full` / `pattern`) added to the WebSocket protocol.
- [x] Server heartbeat — 30 s ping cycle; stale clients are terminated.

### Phase 3 — Core Library Extraction ✅

- [x] Move `PatternMatcher` to `src/shared/patternMatcher.ts`
  (no browser deps; works in Node.js / simulation contexts).
- [x] Move `MatcherInputAdapter` to `src/shared/matcherInputAdapter.ts`.
- [x] Create `src/shared/index.ts` barrel export for virtual-context consumers.
- [x] Client shims in `src/client/patternMatcher.ts` and
  `src/client/matcherInputAdapter.ts` re-export from shared so existing
  browser imports are unchanged.

---

## In progress / next

### Phase 4 — Documentation and Examples

- [ ] Add usage docs for external virtual apps
  - Minimal example loop: sample → stats → decision → matcher.
  - Demonstrate 10 units × 4 samples/unit assumptions with `PATTERN_LEN=40`.
- [ ] Add simulation example
  - Multi-agent conversation replay with deterministic signal streams.
  - Headless Node.js script using `src/shared/index.ts` only.

### Phase 5 — Validation and Testing

- [ ] Add `vitest` unit tests
  - `PatternMatcher` — threshold, alignment, edge/raw trigger distinction.
  - `RollingStatsBuffer` — mean/stddev correctness, warm-up behaviour.
  - `AdaptiveZScoreStrategy` — decision boundary, cold-start guard.
  - `FovMapper` — pixel→angle→pixel round-trip sanity.
  - `TickOrchestrator` — tick count and catch-up capping in headless mode.
- [ ] Deterministic replay harness
  - Feed a known bit stream and assert matched word.
  - Sweep noise levels to characterise detection margin.

### Phase 6 — Security and Operability

- [ ] Add minimal WebSocket auth (shared secret token).
- [ ] Reject unauthenticated or unauthorised role claims.
- [ ] Add lifecycle hooks (`visibilitychange`, `beforeunload`) to stop camera
  and disconnect WS when the tab is closed or hidden.
- [ ] Add npm scripts for lint / type-check / test and a CI pipeline.
- [ ] Add runtime diagnostics panel (actual Hz, decode confidence trends,
  reconnect count).
- [ ] Add protocol version field to WS messages for forward compatibility.

### Phase 7 — Package and Distribution

- [ ] Publish `src/shared/` as a standalone npm package
  (`@colloquy-of-mobiles/virtual-transceiver` or similar).
- [ ] Add a `package.json` `exports` map so consumers can import by feature:
  - `./dictionary` — signal dictionary + helper
  - `./matcher` — `PatternMatcher`
  - `./pipeline` — `ScalarSampleProcessor` + strategies
  - `./adapter` — `MatcherInputAdapter`
  - `./orchestrator` — `TickOrchestrator`

---

## Non-Goals (for now)

- Do not remove or replace the EMA background model.
- Do not change dictionary format or protocol message shape unless required by
  integration.
- Do not add persistent storage or event replay (out of scope for the
  transceiver layer).
