export interface FrameContext {
  frameTs: number;
  dtMs: number;
  targetHz: number;
}

export interface TickContext {
  tickIndex: number;
  tickTs: number;
  dtMs: number;
  targetHz: number;
  catchUpTick: number;
}

export interface TickOrchestratorCallbacks {
  onFrame?: (ctx: FrameContext) => void;
  onTick: (ctx: TickContext) => void;
}

type RequestFrame = (cb: (timestamp: number) => void) => number;
type CancelFrame = (id: number) => void;

export class TickOrchestrator {
  private targetHz: number;
  private readonly callbacks: TickOrchestratorCallbacks;
  private readonly maxCatchUpTicks: number;
  private readonly requestFrame: RequestFrame;
  private readonly cancelFrame: CancelFrame;

  private running = false;
  private rafId: number | null = null;
  private lastFrameTs: number | null = null;
  private lastTickTs = 0;
  private accumulatorMs = 0;
  private tickIndex = 0;

  constructor(targetHz: number, callbacks: TickOrchestratorCallbacks, maxCatchUpTicks = 3) {
    this.targetHz = Math.max(1, targetHz);
    this.callbacks = callbacks;
    this.maxCatchUpTicks = Math.max(1, maxCatchUpTicks);

    const g = globalThis as {
      requestAnimationFrame?: (cb: (timestamp: number) => void) => number;
      cancelAnimationFrame?: (id: number) => void;
    };

    if (typeof g.requestAnimationFrame === 'function' && typeof g.cancelAnimationFrame === 'function') {
      this.requestFrame = (cb) => g.requestAnimationFrame!(cb);
      this.cancelFrame = (id) => g.cancelAnimationFrame!(id);
    } else {
      this.requestFrame = (cb) => {
        const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        return setTimeout(() => cb(now), 16) as unknown as number;
      };
      this.cancelFrame = (id) => {
        clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
      };
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTs = null;
    this.rafId = this.requestFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      this.cancelFrame(this.rafId);
      this.rafId = null;
    }
    this.lastFrameTs = null;
  }

  setTargetHz(nextHz: number): void {
    this.targetHz = Math.max(1, nextHz);
  }

  resetTimeline(): void {
    this.accumulatorMs = 0;
    this.lastTickTs = 0;
    this.tickIndex = 0;
    this.lastFrameTs = null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  private loop = (timestamp: number): void => {
    if (!this.running) return;

    if (this.lastFrameTs === null) {
      this.lastFrameTs = timestamp;
      this.rafId = this.requestFrame(this.loop);
      return;
    }

    const frameDtMs = Math.max(0, Math.min(100, timestamp - this.lastFrameTs));
    this.lastFrameTs = timestamp;

    this.callbacks.onFrame?.({
      frameTs: timestamp,
      dtMs: frameDtMs,
      targetHz: this.targetHz,
    });

    const intervalMs = 1000 / this.targetHz;
    this.accumulatorMs += frameDtMs;

    let catchUpTick = 0;
    while (this.accumulatorMs >= intervalMs && catchUpTick < this.maxCatchUpTicks) {
      const tickTs = this.lastTickTs === 0
        ? timestamp - this.accumulatorMs + intervalMs
        : this.lastTickTs + intervalMs;

      this.callbacks.onTick({
        tickIndex: this.tickIndex,
        tickTs,
        dtMs: intervalMs,
        targetHz: this.targetHz,
        catchUpTick,
      });

      this.tickIndex++;
      this.lastTickTs = tickTs;
      this.accumulatorMs -= intervalMs;
      catchUpTick++;
    }

    if (catchUpTick === this.maxCatchUpTicks && this.accumulatorMs > intervalMs * 4) {
      this.accumulatorMs = intervalMs * 2;
    }

    this.rafId = this.requestFrame(this.loop);
  };
}
