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
}

/** Configuration for the oscillating sensitivity zone */
export interface ZoneConfig {
  /** Radius of the dashed-circle zone in pixels */
  radius: number;
  /**
   * Oscillation amplitude as a fraction of frame width (0–0.5).
   * At 0.5 the zone sweeps to the frame edge.
   */
  amplitudeX: number;
  /** Oscillation amplitude as a fraction of frame height (0–0.5) */
  amplitudeY: number;
  /** Oscillation frequency in Hz (horizontal) */
  freqX: number;
  /** Oscillation frequency in Hz (vertical) */
  freqY: number;
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

export type WsMessageType = 'identify' | 'sensor_reading' | 'ping' | 'pong';

export interface IdentifyPayload {
  role: 'sensor' | 'subscriber';
}

export interface WsMessage {
  type: WsMessageType;
  payload?: LightReading | IdentifyPayload | Record<string, unknown>;
}
