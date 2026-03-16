/**
 * A single light reading from the sensitivity zone.
 * Sent at 40 Hz from the sensor client to the WebSocket server,
 * then broadcast to all subscribers.
 */
export interface LightReading {
  /** Unix-ms timestamp of the sample */
  timestamp: number;

  /** Pixel coordinate of the zone centre in the video frame */
  frameX: number;
  frameY: number;

  /** Horizontal angle from frame centre (degrees). Positive = right. */
  xAngle: number;
  /** Vertical angle from frame centre (degrees). Positive = down. */
  yAngle: number;

  /** Whether the brightness delta exceeded the threshold */
  detected: boolean;

  /** Average luminance inside the zone (0-255) */
  brightness: number;
  /** Average background luminance inside the zone (0-255) */
  background: number;
  /** brightness - background */
  delta: number;

  /** Current zone centre in frame pixels */
  zoneX: number;
  zoneY: number;
  /** Current zone radius in pixels */
  zoneRadius: number;

  /** Current detection packet frequency selected in the sensor UI (Hz). */
  sampleRateHz?: number;

  /** Last dictionary pattern detected by the matcher, or null when none matched. */
  patternDetected?: string | null;

  /** Confidence score (0–1) for patternDetected when available. */
  patternScore?: number;
}

// ── Motion profile ────────────────────────────────────────────────────────────

/** Angular unit used by the motion profile */
export type MotionUnit = 'deg' | 'rad';

/**
 * Trapezoidal motion profile for one axis of the sensitivity zone.
 * The zone accelerates to maxVelocity, cruises, then decelerates to a stop at
 * each range boundary before reversing – no abrupt velocity jumps.
 */
export interface MotionAxisConfig {
  /** Minimum position (inclusive) in motionUnit from frame centre */
  rangeMin: number;
  /** Maximum position (inclusive) in motionUnit from frame centre */
  rangeMax: number;
  /** Peak speed in motionUnit / s */
  maxVelocity: number;
  /** Acceleration and deceleration magnitude in motionUnit / s² */
  maxAcceleration: number;
}

/** Configuration for the oscillating sensitivity zone */
export interface ZoneConfig {
  /** Radius of the dashed-circle zone in pixels */
  radius: number;
  /** Angular unit for rangeMin/Max, maxVelocity, and maxAcceleration */
  unit: MotionUnit;
  /** Horizontal axis motion profile */
  axisX: MotionAxisConfig;
  /** Vertical axis motion profile */
  axisY: MotionAxisConfig;
}

/** Camera field-of-view used to map pixel coords to angles */
export interface FovConfig {
  /** Total horizontal field of view in degrees (e.g. 60) */
  hFov: number;
  /** Total vertical field of view in degrees (e.g. 45) */
  vFov: number;
}

/** Detector tuning parameters */
export interface DetectorConfig {
  /** Minimum delta luminance to count as "detected" (0-255) */
  threshold: number;
  /**
   * Background model learning rate (0–1).
   * Lower = slower adaptation, more stable reference.
   */
  backgroundAlpha: number;
}

// ── WebSocket message protocol ───────────────────────────────────────────────

export type WsMessageType = 'identify' | 'sensor_reading' | 'pattern_detected' | 'ping' | 'pong';

export type SubscriberMode = 'full' | 'pattern';

/** Current protocol version.  Bump when message shapes change. */
export const WS_PROTOCOL_VERSION = 1;

export interface IdentifyPayload {
  role: 'sensor' | 'subscriber';
  mode?: SubscriberMode;
  /** Optional shared secret token for role-claim authentication. */
  token?: string;
}

export interface PatternDetectedPayload {
  timestamp: number;
  patternDetected: string;
  patternScore?: number;
  sampleRateHz?: number;
}

export interface WsMessage {
  type: WsMessageType;
  /** Protocol version for forward-compatibility checks. */
  version?: number;
  payload?: LightReading | IdentifyPayload | PatternDetectedPayload | Record<string, unknown>;
}
