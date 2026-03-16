import { describe, it, expect, beforeEach } from 'vitest';
import { RollingStatsBuffer } from '../src/shared/samplePipeline.ts';
import { PATTERN_LEN } from '../src/shared/dictionary.ts';

describe('RollingStatsBuffer', () => {
  let buf: RollingStatsBuffer;

  beforeEach(() => {
    buf = new RollingStatsBuffer(PATTERN_LEN);
  });

  describe('warm-up / partial window', () => {
    it('returns count=0 on a fresh buffer (no snapshot yet)', () => {
      expect(buf.snapshot().count).toBe(0);
    });

    it('counts only pushed samples before window is full', () => {
      buf.push(10);
      buf.push(20);
      const snap = buf.snapshot();
      expect(snap.count).toBe(2);
    });

    it('caps count at windowSize once full', () => {
      for (let i = 0; i < PATTERN_LEN + 10; i++) buf.push(1);
      expect(buf.snapshot().count).toBe(PATTERN_LEN);
    });
  });

  describe('mean', () => {
    it('computes correct mean for uniform values', () => {
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(50);
      expect(buf.snapshot().mean).toBeCloseTo(50, 6);
    });

    it('computes mean for alternating 0 / 100', () => {
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(i % 2 === 0 ? 0 : 100);
      expect(buf.snapshot().mean).toBeCloseTo(50, 6);
    });

    it('tracks rolling mean as old values fall off', () => {
      // Fill with 100s
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(100);
      expect(buf.snapshot().mean).toBeCloseTo(100, 6);

      // Replace all with 0s
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(0);
      expect(buf.snapshot().mean).toBeCloseTo(0, 6);
    });
  });

  describe('max', () => {
    it('tracks the rolling maximum', () => {
      for (let i = 0; i < PATTERN_LEN - 1; i++) buf.push(10);
      buf.push(200);
      expect(buf.snapshot().max).toBe(200);

      // Roll out the 200 by pushing window more values
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(5);
      expect(buf.snapshot().max).toBe(5);
    });
  });

  describe('stddev', () => {
    it('returns 0 for a constant stream', () => {
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(42);
      expect(buf.snapshot().stddev).toBeCloseTo(0, 6);
    });

    it('returns non-zero stddev for a varied stream', () => {
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(i % 2 === 0 ? 0 : 100);
      expect(buf.snapshot().stddev).toBeGreaterThan(0);
    });

    it('computes population stddev for [0, 100] pair (windowSize=2)', () => {
      const smallBuf = new RollingStatsBuffer(2);
      smallBuf.push(0);
      smallBuf.push(100);
      // Population stddev of {0, 100} = 50
      expect(smallBuf.snapshot().stddev).toBeCloseTo(50, 5);
    });
  });

  describe('push return value', () => {
    it('push returns the same snapshot as snapshot()', () => {
      buf.push(10);
      const fromPush = buf.push(20);
      const fromSnap = buf.snapshot();
      expect(fromPush).toEqual(fromSnap);
    });
  });

  describe('non-finite input handling', () => {
    it('replaces NaN with 0', () => {
      buf.push(NaN);
      const snap = buf.snapshot();
      expect(snap.mean).toBe(0);
    });

    it('replaces Infinity with 0', () => {
      buf.push(Infinity);
      const snap = buf.snapshot();
      expect(snap.mean).toBe(0);
    });
  });

  describe('reset', () => {
    it('resets count and stats to zero', () => {
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(100);
      buf.reset();
      const snap = buf.snapshot();
      expect(snap.count).toBe(0);
      expect(snap.mean).toBe(0);
      expect(snap.max).toBe(0);
      expect(snap.stddev).toBe(0);
    });

    it('accepts new samples normally after reset', () => {
      for (let i = 0; i < PATTERN_LEN; i++) buf.push(100);
      buf.reset();
      buf.push(77);
      expect(buf.snapshot().mean).toBe(77);
    });
  });

  describe('custom window size', () => {
    it('respects a window size of 1', () => {
      const b = new RollingStatsBuffer(1);
      b.push(10);
      b.push(20);
      expect(b.snapshot().mean).toBe(20); // only latest value
      expect(b.snapshot().count).toBe(1);
    });

    it('floors fractional window size to integer', () => {
      const b = new RollingStatsBuffer(3.9);
      for (let i = 0; i < 10; i++) b.push(i);
      expect(b.snapshot().count).toBe(3);
    });
  });
});
