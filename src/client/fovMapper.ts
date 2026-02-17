import type { FovConfig } from '../shared/types.js';

export type { FovConfig };

/**
 * FovMapper
 *
 * Converts between pixel coordinates and angular coordinates relative to the
 * optical centre of the camera.
 *
 * Assumptions:
 *  • The principal point is at (frameW/2, frameH/2).
 *  • The mapping is linear (pin-hole model without distortion).
 *  • Positive xAngle = right of centre; positive yAngle = below centre.
 *
 * Typical webcam FOV values:  hFov ≈ 60°, vFov ≈ 45°
 * Wide-angle webcams may reach hFov ≈ 90°.
 */
export class FovMapper {
  config: FovConfig;

  constructor(config: FovConfig) {
    this.config = { ...config };
  }

  /**
   * Convert a pixel position to (xAngle, yAngle) in degrees.
   * @param x       pixel x (0 = left edge)
   * @param y       pixel y (0 = top edge)
   * @param width   frame width in pixels
   * @param height  frame height in pixels
   */
  pixelToAngle(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { xAngle: number; yAngle: number } {
    const xNorm = x / width  - 0.5; // –0.5 … +0.5
    const yNorm = y / height - 0.5;
    return {
      xAngle: xNorm * this.config.hFov,
      yAngle: yNorm * this.config.vFov,
    };
  }

  /**
   * Convert angular coordinates back to pixel position.
   * Useful for aiming the zone at a known angle.
   */
  angleToPixel(
    xAngle: number,
    yAngle: number,
    width: number,
    height: number,
  ): { x: number; y: number } {
    return {
      x: (xAngle / this.config.hFov + 0.5) * width,
      y: (yAngle / this.config.vFov + 0.5) * height,
    };
  }
}
