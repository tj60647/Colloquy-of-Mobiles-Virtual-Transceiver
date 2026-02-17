import type { ZoneConfig } from '../shared/types.js';

export type { ZoneConfig };

/**
 * SensitivityZone
 *
 * A circular region (rendered as a dashed circle) that oscillates across the
 * camera frame following a Lissajous-style path:
 *
 *   x(t) = frameW/2  +  amplitudeX × frameW  × sin(2π · freqX · t)
 *   y(t) = frameH/2  +  amplitudeY × frameH  × sin(2π · freqY · t)
 *
 * Setting freqY to a different value from freqX creates the oscillating sweep.
 * At amplitudeX=0, amplitudeY=0 the zone stays at the frame centre.
 */
export class SensitivityZone {
  config: ZoneConfig;

  private _x = 0;
  private _y = 0;
  private frameW: number;
  private frameH: number;

  constructor(frameW: number, frameH: number, config: ZoneConfig) {
    this.frameW = frameW;
    this.frameH = frameH;
    this.config = { ...config };
    this._x = frameW / 2;
    this._y = frameH / 2;
  }

  /**
   * Advance the zone position.
   * @param timestamp  performance.now() value in milliseconds
   */
  update(timestamp: number): void {
    const t  = timestamp / 1000; // seconds
    const { amplitudeX, amplitudeY, freqX, freqY } = this.config;

    this._x = this.frameW / 2 + amplitudeX * this.frameW  * Math.sin(2 * Math.PI * freqX * t);
    this._y = this.frameH / 2 + amplitudeY * this.frameH  * Math.sin(2 * Math.PI * freqY * t);
  }

  /** Notify of a video-track resolution change */
  updateDimensions(w: number, h: number): void {
    this.frameW = w;
    this.frameH = h;
  }

  get centerX(): number { return this._x; }
  get centerY(): number { return this._y; }
  get radius():  number { return this.config.radius; }

  /** True if pixel (px, py) falls inside the zone circle */
  contains(px: number, py: number): boolean {
    const dx = px - this._x;
    const dy = py - this._y;
    return dx * dx + dy * dy <= this.config.radius * this.config.radius;
  }
}
