# Roadmap

## Current Direction (2026-02)

Keep the existing camera + EMA detection path intact, while adding a reusable
scalar-sample processing path that can feed `PatternMatcher` in simulation and
embedded-style workflows.

## Phase 1 — Reusable Sample Pipeline

1. Define a sample-processing interface
   - Input: one scalar value per sample tick.
   - Output: per-tick stats + boolean detection bit.
2. Implement rolling stats buffer
   - Window size: `PATTERN_LEN` (40).
   - Stats each tick: mean, max, stddev.
3. Add decision strategies
   - `fixed-threshold`
   - `adaptive-zscore`

## Phase 2 — Matcher Integration

1. Add matcher input adapter
   - Feed strategy output into `PatternMatcher.addSample(...)`.
   - Preserve existing match metadata (`patternDetected`, `patternScore`, `sampleRateHz`).
2. Keep EMA path selectable
   - Camera mode continues to work as-is.
   - New scalar path can be used by simulation and other apps.

## Phase 3 — Documentation and Examples

1. Add usage docs for external apps
   - Minimal example loop: sample -> stats -> decision -> matcher.
2. Add simulation example
   - Demonstrate 10 units × 4 samples/unit assumptions with `PATTERN_LEN=40`.

## Phase 4 — Validation

1. Add unit tests
   - Rolling stats correctness.
   - Decision strategy behavior.
   - Matcher integration contracts.
2. Add quick verification scripts
   - Deterministic replay of sample streams.
   - Match-rate sanity checks across thresholds.

## Non-Goals (for now)

- Do not remove or replace the EMA background model.
- Do not change dictionary format or protocol message shape unless required by integration.
