import { PATTERN_LEN } from './dictionary.js';

export interface RollingStatsSnapshot {
  count: number;
  mean: number;
  max: number;
  stddev: number;
}

export class RollingStatsBuffer {
  private readonly windowSize: number;
  private readonly buf: Float32Array;
  private head = 0;
  private count = 0;

  constructor(windowSize = PATTERN_LEN) {
    const size = Math.max(1, Math.floor(windowSize));
    this.windowSize = size;
    this.buf = new Float32Array(size);
  }

  push(sample: number): RollingStatsSnapshot {
    const value = Number.isFinite(sample) ? sample : 0;

    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.windowSize;
    if (this.count < this.windowSize) this.count++;

    return this.snapshot();
  }

  snapshot(): RollingStatsSnapshot {
    if (this.count === 0) {
      return { count: 0, mean: 0, max: 0, stddev: 0 };
    }

    let sum = 0;
    let max = -Infinity;

    for (let i = 0; i < this.count; i++) {
      const v = this.buf[i];
      sum += v;
      if (v > max) max = v;
    }

    const mean = sum / this.count;
    let varianceSum = 0;

    for (let i = 0; i < this.count; i++) {
      const d = this.buf[i] - mean;
      varianceSum += d * d;
    }

    const variance = varianceSum / this.count;
    const stddev = Math.sqrt(variance);

    return {
      count: this.count,
      mean,
      max,
      stddev,
    };
  }

  reset(): void {
    this.buf.fill(0);
    this.head = 0;
    this.count = 0;
  }
}

export interface SampleDecisionContext {
  sample: number;
  stats: RollingStatsSnapshot;
}

export interface SampleDecisionStrategy {
  readonly name: string;
  decide(ctx: SampleDecisionContext): boolean;
}

export class FixedThresholdStrategy implements SampleDecisionStrategy {
  readonly name = 'fixed-threshold';
  threshold: number;

  constructor(threshold: number) {
    this.threshold = threshold;
  }

  decide(ctx: SampleDecisionContext): boolean {
    return ctx.sample >= this.threshold;
  }
}

export class AdaptiveZScoreStrategy implements SampleDecisionStrategy {
  readonly name = 'adaptive-zscore';
  zThreshold: number;

  constructor(zThreshold: number) {
    this.zThreshold = zThreshold;
  }

  decide(ctx: SampleDecisionContext): boolean {
    const { sample, stats } = ctx;
    if (stats.count < 2) return false;
    if (stats.stddev <= 1e-6) return false;

    const z = (sample - stats.mean) / stats.stddev;
    return z >= this.zThreshold;
  }
}

export interface ScalarSampleTick {
  sample: number;
  stats: RollingStatsSnapshot;
  detected: boolean;
}

export class ScalarSampleProcessor {
  readonly statsBuffer: RollingStatsBuffer;
  strategy: SampleDecisionStrategy;

  constructor(
    strategy: SampleDecisionStrategy,
    windowSize = PATTERN_LEN,
  ) {
    this.statsBuffer = new RollingStatsBuffer(windowSize);
    this.strategy = strategy;
  }

  process(sample: number): ScalarSampleTick {
    const safeSample = Number.isFinite(sample) ? sample : 0;
    const stats = this.statsBuffer.push(safeSample);
    const detected = this.strategy.decide({ sample: safeSample, stats });

    return { sample: safeSample, stats, detected };
  }

  reset(): void {
    this.statsBuffer.reset();
  }
}
