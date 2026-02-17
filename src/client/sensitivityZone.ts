import type { ZoneConfig, MotionAxisConfig, FovConfig } from '../shared/types.js';

export type { ZoneConfig };

// ── Trapezoidal motion profile (1 axis) ──────────────────────────────────────

/**
 * MotionProfile1D
 *
 * Implements a velocity-limited, acceleration-limited profile that bounces
 * between rangeMin and rangeMax.  The velocity target is:
 *
 *   desiredVelocity = direction × min(maxVelocity, √(2 · a · remaining))
 *
 * √(2·a·remaining) is the exact speed that allows deceleration to zero in the
 * remaining distance, yielding a smooth trapezoidal (or triangular when the
 * range is too short to reach maxVelocity) shape with no abrupt jumps.
 *
 * Config is consumed each tick, so slider changes take effect immediately
 * without resetting the motion state.
 */
class MotionProfile1D {
  position: number;
  velocity = 0;
  private direction: 1 | -1 = 1;

  constructor(initialPos: number) {
    this.position = initialPos;
  }

  update(dt: number, cfg: MotionAxisConfig): void {
    const { rangeMin, rangeMax, maxVelocity, maxAcceleration } = cfg;

    if (rangeMax <= rangeMin || maxVelocity <= 0 || maxAcceleration <= 0) return;

    // Clamp position if the config range was tightened at runtime
    this.position = Math.max(rangeMin, Math.min(rangeMax, this.position));

    const target    = this.direction > 0 ? rangeMax : rangeMin;
    const remaining = Math.abs(target - this.position);

    // Desired speed: limited by both the peak cap and the deceleration ramp
    const rampSpeed    = Math.sqrt(2 * maxAcceleration * Math.max(0, remaining));
    const desiredSpeed = Math.min(maxVelocity, rampSpeed);
    const desiredVel   = this.direction * desiredSpeed;

    // Apply acceleration limit
    const maxDv = maxAcceleration * dt;
    this.velocity += Math.max(-maxDv, Math.min(maxDv, desiredVel - this.velocity));

    this.position += this.velocity * dt;

    // Boundary: clamp and reverse
    if (this.direction > 0 && this.position >= rangeMax) {
      this.position  = rangeMax;
      this.velocity  = 0;
      this.direction = -1;
    } else if (this.direction < 0 && this.position <= rangeMin) {
      this.position  = rangeMin;
      this.velocity  = 0;
      this.direction = 1;
    }
  }

  reset(cfg: MotionAxisConfig): void {
    this.position  = cfg.rangeMin;
    this.velocity  = 0;
    this.direction = 1;
  }
}

// ── SensitivityZone ───────────────────────────────────────────────────────────

/**
 * SensitivityZone
 *
 * Two independent MotionProfile1D instances drive the horizontal and vertical
 * positions.  Positions are kept in motion units (degrees or radians) and
 * converted to pixel coordinates on demand using the camera FOV:
 *
 *   pixelX = (positionDeg / hFovDeg) × frameWidth  + frameWidth  / 2
 *   pixelY = (positionDeg / vFovDeg) × frameHeight + frameHeight / 2
 *
 * If config.unit === 'rad' the position is converted to degrees first.
 * Independent axis profiles create a Lissajous-like sweep when the two
 * acceleration/velocity configs differ.
 */
export class SensitivityZone {
  config: ZoneConfig;
  private fov: FovConfig;

  private profileX: MotionProfile1D;
  private profileY: MotionProfile1D;

  private frameW: number;
  private frameH: number;
  private lastTimestamp: number | null = null;

  constructor(frameW: number, frameH: number, config: ZoneConfig, fov: FovConfig) {
    this.frameW   = frameW;
    this.frameH   = frameH;
    this.config   = { ...config };
    this.fov      = { ...fov };
    this.profileX = new MotionProfile1D(config.axisX.rangeMin);
    this.profileY = new MotionProfile1D(config.axisY.rangeMin);
  }

  /**
   * Advance the motion profiles.
   * @param timestamp  performance.now() in milliseconds
   */
  update(timestamp: number): void {
    if (this.lastTimestamp !== null) {
      // Cap dt to avoid large jumps after the tab was hidden
      const dt = Math.min((timestamp - this.lastTimestamp) / 1000, 0.1);
      this.profileX.update(dt, this.config.axisX);
      this.profileY.update(dt, this.config.axisY);
    }
    this.lastTimestamp = timestamp;
  }

  updateDimensions(w: number, h: number): void {
    this.frameW = w;
    this.frameH = h;
  }

  updateFov(fov: FovConfig): void {
    this.fov = fov;
  }

  // ── Pixel coordinates ───────────────────────────────────────────────────────

  get centerX(): number {
    return (this.toDeg(this.profileX.position) / this.fov.hFov) * this.frameW
           + this.frameW / 2;
  }

  get centerY(): number {
    return (this.toDeg(this.profileY.position) / this.fov.vFov) * this.frameH
           + this.frameH / 2;
  }

  get radius(): number { return this.config.radius; }

  // ── Motion-unit accessors (useful for HUD display) ──────────────────────────

  /** Current X position in the configured motion unit */
  get posX(): number { return this.profileX.position; }
  /** Current Y position in the configured motion unit */
  get posY(): number { return this.profileY.position; }
  /** Current X velocity in motion units / s */
  get velX(): number { return this.profileX.velocity; }
  /** Current Y velocity in motion units / s */
  get velY(): number { return this.profileY.velocity; }

  contains(px: number, py: number): boolean {
    const dx = px - this.centerX;
    const dy = py - this.centerY;
    return dx * dx + dy * dy <= this.config.radius * this.config.radius;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private toDeg(value: number): number {
    return this.config.unit === 'rad' ? value * (180 / Math.PI) : value;
  }
}
