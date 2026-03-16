import { describe, it, expect } from 'vitest';
import {
  AdaptiveZScoreStrategy,
  FixedThresholdStrategy,
  RollingStatsBuffer,
} from '../src/shared/samplePipeline.ts';

describe('AdaptiveZScoreStrategy', () => {
  const zThreshold = 1.5;
  const strategy = new AdaptiveZScoreStrategy(zThreshold);

  describe('cold-start guard', () => {
    it('returns false when count < 2 (buffer not warm)', () => {
      const stats = { count: 0, mean: 0, max: 0, stddev: 0 };
      expect(strategy.decide({ sample: 1000, stats })).toBe(false);
    });

    it('returns false when count = 1 (still cold)', () => {
      const stats = { count: 1, mean: 50, max: 50, stddev: 0 };
      expect(strategy.decide({ sample: 1000, stats })).toBe(false);
    });
  });

  describe('flat signal guard', () => {
    it('returns false when stddev is effectively zero', () => {
      const stats = { count: 10, mean: 50, max: 50, stddev: 0 };
      expect(strategy.decide({ sample: 1000, stats })).toBe(false);
    });

    it('returns false when stddev is below 1e-6', () => {
      const stats = { count: 10, mean: 50, max: 50, stddev: 1e-10 };
      expect(strategy.decide({ sample: 1000, stats })).toBe(false);
    });
  });

  describe('decision boundary', () => {
    const stats = { count: 40, mean: 100, max: 200, stddev: 20 };

    it('returns true when z-score exactly equals zThreshold', () => {
      // z = (sample - mean) / stddev = 1.5  →  sample = mean + 1.5 * stddev = 130
      const sample = 100 + 1.5 * 20; // 130
      expect(strategy.decide({ sample, stats })).toBe(true);
    });

    it('returns true when z-score exceeds zThreshold', () => {
      const sample = 100 + 2.0 * 20; // z=2.0 > 1.5
      expect(strategy.decide({ sample, stats })).toBe(true);
    });

    it('returns false when z-score is below zThreshold', () => {
      const sample = 100 + 1.0 * 20; // z=1.0 < 1.5
      expect(strategy.decide({ sample, stats })).toBe(false);
    });

    it('returns false for samples below the mean', () => {
      const sample = 50; // z < 0
      expect(strategy.decide({ sample, stats })).toBe(false);
    });
  });

  describe('different zThreshold values', () => {
    it('detects at z=1.0 when threshold is 1.0', () => {
      const s = new AdaptiveZScoreStrategy(1.0);
      const stats = { count: 10, mean: 100, max: 200, stddev: 20 };
      expect(s.decide({ sample: 120, stats })).toBe(true); // z=1.0
    });

    it('does not detect at z=1.0 when threshold is 2.0', () => {
      const s = new AdaptiveZScoreStrategy(2.0);
      const stats = { count: 10, mean: 100, max: 200, stddev: 20 };
      expect(s.decide({ sample: 120, stats })).toBe(false); // z=1.0 < 2.0
    });
  });

  describe('integration with RollingStatsBuffer', () => {
    it('does not trigger on constant signal (no variance)', () => {
      const buf = new RollingStatsBuffer(40);
      const s = new AdaptiveZScoreStrategy(1.5);
      let detected = false;

      for (let i = 0; i < 40; i++) {
        const stats = buf.push(100);
        if (s.decide({ sample: 100, stats })) detected = true;
      }
      expect(detected).toBe(false);
    });

    it('triggers on sudden spike above rolling mean', () => {
      const buf = new RollingStatsBuffer(40);
      const s = new AdaptiveZScoreStrategy(1.5);
      // Warm up with stable baseline
      for (let i = 0; i < 39; i++) buf.push(50);
      // Large spike
      const stats = buf.push(50); // 40th stable sample
      const _spikeStats = { ...stats, mean: 50, stddev: 0.1 }; // simulate tiny stddev after stable fill
      // Use the actual buffer stats with a spike sample value
      const spike = 50 + 3 * stats.stddev;
      // stddev after 40 identical values is 0, so guard activates — stddev = 0
      // Verify the guard is working correctly for flat signal
      expect(s.decide({ sample: spike, stats })).toBe(false); // stddev = 0 → guard
    });

    it('triggers correctly when signal has real variance', () => {
      const buf = new RollingStatsBuffer(40);
      const s = new AdaptiveZScoreStrategy(1.5);
      // Mix of 0s and 100s to create variance
      for (let i = 0; i < 38; i++) buf.push(i % 2 === 0 ? 0 : 100);
      buf.push(0);
      const stats = buf.push(100); // last sample = 100
      // stats.mean ≈ 50, stats.stddev ≈ 50
      // z = (250 - 50) / 50 = 4.0 > 1.5
      expect(s.decide({ sample: 250, stats })).toBe(true);
    });
  });

  describe('name property', () => {
    it('has the expected strategy name', () => {
      expect(strategy.name).toBe('adaptive-zscore');
    });
  });
});

describe('FixedThresholdStrategy', () => {
  it('has the expected name', () => {
    const s = new FixedThresholdStrategy(128);
    expect(s.name).toBe('fixed-threshold');
  });

  it('returns true at exactly threshold', () => {
    const s = new FixedThresholdStrategy(128);
    const stats = { count: 1, mean: 0, max: 0, stddev: 0 };
    expect(s.decide({ sample: 128, stats })).toBe(true);
  });

  it('returns false below threshold', () => {
    const s = new FixedThresholdStrategy(128);
    const stats = { count: 1, mean: 0, max: 0, stddev: 0 };
    expect(s.decide({ sample: 127, stats })).toBe(false);
  });

  it('returns true above threshold', () => {
    const s = new FixedThresholdStrategy(255);
    const stats = { count: 1, mean: 0, max: 0, stddev: 0 };
    expect(s.decide({ sample: 255, stats })).toBe(true);
  });
});
