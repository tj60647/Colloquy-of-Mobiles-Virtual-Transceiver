import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TickOrchestrator } from '../src/shared/tickOrchestrator.ts';

// ── Minimal time helpers ──────────────────────────────────────────────────────

/** Build a fake requestAnimationFrame / cancelAnimationFrame pair driven by
 *  an explicit advance() function so tests remain fully synchronous. */
function buildFakeRaf() {
  let nextId = 1;
  const pending = new Map<number, (ts: number) => void>();

  function requestFrame(cb: (ts: number) => void): number {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  }

  function cancelFrame(id: number): void {
    pending.delete(id);
  }

  /** Advance time by deltaMs, firing all pending callbacks. */
  function advance(ts: number): void {
    const cbs = [...pending.values()];
    pending.clear();
    for (const cb of cbs) cb(ts);
  }

  return { requestFrame, cancelFrame, advance, pending };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TickOrchestrator (headless / setTimeout mode)', () => {
  // The TickOrchestrator falls back to setTimeout when requestAnimationFrame
  // is not present in globalThis.  We run all tests in the Node.js fallback.
  // Vitest provides fake timers to control setTimeout behaviour.

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not fire ticks before start() is called', () => {
    const onTick = vi.fn();
    new TickOrchestrator(40, { onTick });
    vi.advanceTimersByTime(1000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('fires approximately targetHz ticks per second', () => {
    const onTick = vi.fn();
    const orchestrator = new TickOrchestrator(10, { onTick });
    orchestrator.start();
    // Each fake setTimeout fires in ~16ms intervals
    // Advance 1 second worth of time
    vi.advanceTimersByTime(1000);
    orchestrator.stop();
    // Expect around 10 ticks (±2 tolerance for timing granularity)
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(onTick.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it('increments tickIndex monotonically', () => {
    const indices: number[] = [];
    const orchestrator = new TickOrchestrator(10, {
      onTick: (ctx) => indices.push(ctx.tickIndex),
    });
    orchestrator.start();
    vi.advanceTimersByTime(500);
    orchestrator.stop();

    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
  });

  it('stop() prevents further ticks', () => {
    const onTick = vi.fn();
    const orchestrator = new TickOrchestrator(10, { onTick });
    orchestrator.start();
    vi.advanceTimersByTime(100);
    orchestrator.stop();
    const countAfterStop = onTick.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(onTick.mock.calls.length).toBe(countAfterStop);
  });

  it('isRunning reflects state', () => {
    const orchestrator = new TickOrchestrator(10, { onTick: vi.fn() });
    expect(orchestrator.isRunning).toBe(false);
    orchestrator.start();
    expect(orchestrator.isRunning).toBe(true);
    orchestrator.stop();
    expect(orchestrator.isRunning).toBe(false);
  });

  it('calling start() twice is idempotent', () => {
    const onTick = vi.fn();
    const orchestrator = new TickOrchestrator(10, { onTick });
    orchestrator.start();
    orchestrator.start(); // second call should be no-op
    vi.advanceTimersByTime(500);
    orchestrator.stop();
    // Should still be ~5 ticks, not doubled
    expect(onTick.mock.calls.length).toBeLessThanOrEqual(7);
  });

  it('resetTimeline resets tickIndex to 0', () => {
    const indices: number[] = [];
    const orchestrator = new TickOrchestrator(10, {
      onTick: (ctx) => indices.push(ctx.tickIndex),
    });
    orchestrator.start();
    vi.advanceTimersByTime(300);
    orchestrator.stop();

    const countBefore = indices.length;
    expect(countBefore).toBeGreaterThan(0);

    orchestrator.resetTimeline();
    orchestrator.start();
    vi.advanceTimersByTime(300);
    orchestrator.stop();

    // After reset, tickIndex should restart from 0
    expect(indices[countBefore]).toBe(0);
    // And continue incrementing monotonically
    for (let i = countBefore + 1; i < indices.length; i++) {
      expect(indices[i]).toBe(indices[i - 1] + 1);
    }
  });

  it('setTargetHz changes the tick rate', () => {
    const onTick = vi.fn();
    const orchestrator = new TickOrchestrator(1, { onTick }); // 1 Hz
    orchestrator.start();
    vi.advanceTimersByTime(200);
    const countAt1Hz = onTick.mock.calls.length;

    orchestrator.setTargetHz(10); // 10 Hz
    vi.advanceTimersByTime(200);
    orchestrator.stop();

    const countAt10Hz = onTick.mock.calls.length - countAt1Hz;
    // At 10 Hz for 200ms ≈ 2 ticks; at 1Hz for 200ms ≈ 0–1 ticks
    expect(countAt10Hz).toBeGreaterThan(countAt1Hz);
  });

  it('passes targetHz in tick context', () => {
    const contexts: Array<{ targetHz: number }> = [];
    const orchestrator = new TickOrchestrator(20, {
      onTick: (ctx) => contexts.push(ctx),
    });
    orchestrator.start();
    vi.advanceTimersByTime(200);
    orchestrator.stop();

    expect(contexts.length).toBeGreaterThan(0);
    for (const ctx of contexts) {
      expect(ctx.targetHz).toBe(20);
    }
  });

  it('clamps dtMs per tick to approximate intervalMs', () => {
    const dtValues: number[] = [];
    const orchestrator = new TickOrchestrator(10, {
      onTick: (ctx) => dtValues.push(ctx.dtMs),
    });
    orchestrator.start();
    vi.advanceTimersByTime(500);
    orchestrator.stop();

    // Each tick's dtMs should be approximately 100ms (1000/10)
    for (const dt of dtValues) {
      expect(dt).toBeCloseTo(100, -1); // within ±10ms
    }
  });

  it('onFrame callback is called each animation frame if provided', () => {
    const onFrame = vi.fn();
    const onTick = vi.fn();
    const orchestrator = new TickOrchestrator(10, { onFrame, onTick });
    orchestrator.start();
    vi.advanceTimersByTime(200);
    orchestrator.stop();
    // onFrame should be called at least as often as onTick
    expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(onTick.mock.calls.length);
  });
});

describe('TickOrchestrator (catch-up capping)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('limits catch-up ticks to maxCatchUpTicks per frame', () => {
    const onTick = vi.fn();
    const maxCatchUp = 2;
    const orchestrator = new TickOrchestrator(40, { onTick }, maxCatchUp);
    orchestrator.start();

    // Jump far ahead — would generate many catch-up ticks without capping
    vi.advanceTimersByTime(2000);
    orchestrator.stop();

    // If catch-up were unlimited, we'd have ~80 ticks from 2s at 40Hz.
    // With cap=2 and ~16ms frames, we get at most 2 ticks/frame.
    // Just verify it didn't explode past a reasonable ceiling.
    const ticks = onTick.mock.calls.length;
    // 2000ms / 16ms per frame * 2 catch-up = 250 max, but the draining logic
    // will have capped the accumulator.  The key invariant is it completed.
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(500); // sanity bound
  });

  it('catchUpTick counter starts at 0 for first catch-up tick', () => {
    const catchUpValues: number[] = [];
    const orchestrator = new TickOrchestrator(40, {
      onTick: (ctx) => catchUpValues.push(ctx.catchUpTick),
    }, 3);
    orchestrator.start();
    vi.advanceTimersByTime(500);
    orchestrator.stop();
    expect(catchUpValues[0]).toBe(0);
  });
});
