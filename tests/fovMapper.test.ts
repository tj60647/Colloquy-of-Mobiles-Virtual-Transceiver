import { describe, it, expect } from 'vitest';
import { FovMapper } from '../src/client/fovMapper.ts';

describe('FovMapper', () => {
  const hFov = 60;
  const vFov = 45;
  const mapper = new FovMapper({ hFov, vFov });
  const W = 1280;
  const H = 720;

  describe('pixelToAngle', () => {
    it('maps centre pixel to (0°, 0°)', () => {
      const { xAngle, yAngle } = mapper.pixelToAngle(W / 2, H / 2, W, H);
      expect(xAngle).toBeCloseTo(0, 6);
      expect(yAngle).toBeCloseTo(0, 6);
    });

    it('maps left edge to -hFov/2', () => {
      const { xAngle } = mapper.pixelToAngle(0, H / 2, W, H);
      expect(xAngle).toBeCloseTo(-hFov / 2, 6);
    });

    it('maps right edge to +hFov/2', () => {
      const { xAngle } = mapper.pixelToAngle(W, H / 2, W, H);
      expect(xAngle).toBeCloseTo(hFov / 2, 6);
    });

    it('maps top edge to -vFov/2', () => {
      const { yAngle } = mapper.pixelToAngle(W / 2, 0, W, H);
      expect(yAngle).toBeCloseTo(-vFov / 2, 6);
    });

    it('maps bottom edge to +vFov/2', () => {
      const { yAngle } = mapper.pixelToAngle(W / 2, H, W, H);
      expect(yAngle).toBeCloseTo(vFov / 2, 6);
    });
  });

  describe('angleToPixel', () => {
    it('maps (0°, 0°) back to frame centre', () => {
      const { x, y } = mapper.angleToPixel(0, 0, W, H);
      expect(x).toBeCloseTo(W / 2, 6);
      expect(y).toBeCloseTo(H / 2, 6);
    });

    it('maps -hFov/2 back to left edge', () => {
      const { x } = mapper.angleToPixel(-hFov / 2, 0, W, H);
      expect(x).toBeCloseTo(0, 6);
    });

    it('maps +hFov/2 back to right edge', () => {
      const { x } = mapper.angleToPixel(hFov / 2, 0, W, H);
      expect(x).toBeCloseTo(W, 6);
    });

    it('maps -vFov/2 back to top edge', () => {
      const { y } = mapper.angleToPixel(0, -vFov / 2, W, H);
      expect(y).toBeCloseTo(0, 6);
    });

    it('maps +vFov/2 back to bottom edge', () => {
      const { y } = mapper.angleToPixel(0, vFov / 2, W, H);
      expect(y).toBeCloseTo(H, 6);
    });
  });

  describe('round-trip pixel → angle → pixel', () => {
    const testPoints: Array<[number, number]> = [
      [0, 0],
      [W / 2, H / 2],
      [W, H],
      [100, 200],
      [W * 0.75, H * 0.25],
    ];

    it.each(testPoints)(
      'round-trips pixel (%i, %i) within floating-point precision',
      (px, py) => {
        const { xAngle, yAngle } = mapper.pixelToAngle(px, py, W, H);
        const { x, y } = mapper.angleToPixel(xAngle, yAngle, W, H);
        expect(x).toBeCloseTo(px, 5);
        expect(y).toBeCloseTo(py, 5);
      },
    );
  });

  describe('round-trip angle → pixel → angle', () => {
    const testAngles: Array<[number, number]> = [
      [0, 0],
      [hFov / 2, vFov / 2],
      [-hFov / 2, -vFov / 2],
      [10, -5],
    ];

    it.each(testAngles)(
      'round-trips angle (%d°, %d°) within floating-point precision',
      (xa, ya) => {
        const { x, y } = mapper.angleToPixel(xa, ya, W, H);
        const { xAngle, yAngle } = mapper.pixelToAngle(x, y, W, H);
        expect(xAngle).toBeCloseTo(xa, 5);
        expect(yAngle).toBeCloseTo(ya, 5);
      },
    );
  });

  describe('different FOV configs', () => {
    it('scales correctly with a wide 90×60 FOV', () => {
      const wide = new FovMapper({ hFov: 90, vFov: 60 });
      const { xAngle } = wide.pixelToAngle(W, H / 2, W, H);
      expect(xAngle).toBeCloseTo(45, 6); // 90/2
    });

    it('config is copied in constructor (no aliasing)', () => {
      const cfg = { hFov: 60, vFov: 45 };
      const m = new FovMapper(cfg);
      cfg.hFov = 999; // mutate original
      expect(m.config.hFov).toBe(60); // mapper should not be affected
    });
  });
});
