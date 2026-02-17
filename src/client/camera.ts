/**
 * CameraManager
 * Wraps getUserMedia, provides a stable video element and frame-capture helpers.
 *
 * Extended surface (available after initialize()):
 *   getCapabilities()     – what the hardware supports (ranges, enums, booleans)
 *   getSettings()         – current effective values for every property
 *   applyConstraints()    – live-tune any tunable property without restarting
 *   deviceLabel           – human-readable camera name from the OS
 */

// ── Extended type declarations ────────────────────────────────────────────────
// TypeScript's DOM lib only covers the baseline W3C spec.  Chrome (and other
// browsers implementing the ImageCapture / PTZ extensions) expose many more
// properties.  We declare them here so callers get full type safety.

export interface MediaSettingsRange {
  min:   number;
  max:   number;
  step?: number;
}

export interface ExtendedMediaTrackCapabilities extends MediaTrackCapabilities {
  // Image processing
  brightness?:            MediaSettingsRange;
  contrast?:              MediaSettingsRange;
  saturation?:            MediaSettingsRange;
  sharpness?:             MediaSettingsRange;
  // Exposure
  exposureMode?:          string[];
  exposureTime?:          MediaSettingsRange;  // microseconds
  exposureCompensation?:  MediaSettingsRange;  // EV stops
  iso?:                   MediaSettingsRange;
  // White balance
  whiteBalanceMode?:      string[];
  colorTemperature?:      MediaSettingsRange;  // Kelvin
  // Focus
  focusMode?:             string[];
  focusDistance?:         MediaSettingsRange;  // normalised 0–1
  // Zoom
  zoom?:                  MediaSettingsRange;
  // PTZ
  pan?:                   MediaSettingsRange;  // arc-seconds
  tilt?:                  MediaSettingsRange;  // arc-seconds
  // Torch / flash
  torch?:                 boolean[];
}

export interface ExtendedMediaTrackSettings extends MediaTrackSettings {
  brightness?:            number;
  contrast?:              number;
  saturation?:            number;
  sharpness?:             number;
  exposureMode?:          string;
  exposureTime?:          number;
  exposureCompensation?:  number;
  iso?:                   number;
  whiteBalanceMode?:      string;
  colorTemperature?:      number;
  focusMode?:             string;
  focusDistance?:         number;
  zoom?:                  number;
  pan?:                   number;
  tilt?:                  number;
  torch?:                 boolean;
}

// ── CameraManager ─────────────────────────────────────────────────────────────

export class CameraManager {
  private readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay    = true;
    this.video.muted       = true;
    this.video.playsInline = true;
  }

  /**
   * Request camera access and wait for the first frame to be ready.
   * Prefers 640×480 @ ≥60 fps so the 40 Hz sample loop has headroom.
   */
  async initialize(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:     { ideal: 640 },
        height:    { ideal: 480 },
        frameRate: { ideal: 60, min: 30 },
      },
    });

    this.video.srcObject = this.stream;

    await new Promise<void>((resolve, reject) => {
      this.video.onloadedmetadata = () => resolve();
      this.video.onerror = reject;
    });

    await this.video.play();
  }

  // ── Frame dimensions ─────────────────────────────────────────────────────

  get width():  number { return this.video.videoWidth  || 640; }
  get height(): number { return this.video.videoHeight || 480; }

  drawFrame(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.video, 0, 0, this.width, this.height);
  }

  getVideoElement(): HTMLVideoElement { return this.video; }

  // ── Track capabilities / settings ─────────────────────────────────────────

  /** OS-reported camera name (e.g. "HD Pro Webcam C920"). */
  get deviceLabel(): string {
    return this.stream?.getVideoTracks()[0]?.label ?? '(unknown device)';
  }

  /**
   * What the hardware says it can do.
   * Returns null if the API is unavailable (Firefox, some mobile browsers).
   */
  getCapabilities(): ExtendedMediaTrackCapabilities | null {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return null;
    return track.getCapabilities() as ExtendedMediaTrackCapabilities;
  }

  /**
   * The current effective value of every property.
   * This is always available after initialize() – it never returns null.
   */
  getSettings(): ExtendedMediaTrackSettings {
    const track = this.stream?.getVideoTracks()[0];
    return (track?.getSettings() ?? {}) as ExtendedMediaTrackSettings;
  }

  /**
   * Apply one or more constraints without restarting the stream.
   * Throws if the browser rejects the combination (e.g. manual exposureTime
   * requested while exposureMode is still 'auto').
   *
   * @param constraints  A flat map of property names → desired values.
   *                     The browser ignores keys it does not support.
   */
  async applyConstraints(constraints: Record<string, unknown>): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    await track.applyConstraints(constraints as MediaTrackConstraints);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
