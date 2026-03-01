export type SampleSourceMode = 'simulated' | 'camera';

export interface AxisMotionConfig {
  rangeMin: number;
  rangeMax: number;
  maxVelocity: number;
  maxAcceleration: number;
}

export interface SimulatedSignalConfig {
  baseline: number;
  noiseStd: number;
  driftAmp: number;
  pulseAmp: number;
  pulseEvery: number;
}

interface ActivateSourceResult {
  ok: boolean;
  activeSource: SampleSourceMode;
  message: string;
}

export interface CameraSourceParameters {
  hFovDeg: number;
  vFovDeg: number;
  width: number;
  height: number;
  frameRate: number | null;
  facingMode: string;
  fovSource: 'camera-metadata' | 'manual';
  sampleDiameterDeg: number;
  grayscaleEnabled: boolean;
  exposureTimeAvailable: boolean;
  exposureTime: number | null;
  exposureTimeMin: number | null;
  exposureTimeMax: number | null;
  exposureTimeStep: number | null;
}

class MotionProfile1D {
  position: number;
  velocity = 0;
  private direction: 1 | -1 = 1;

  constructor(initialPos: number) {
    this.position = initialPos;
  }

  update(dt: number, cfg: AxisMotionConfig): void {
    const { rangeMin, rangeMax, maxVelocity, maxAcceleration } = cfg;
    if (rangeMax <= rangeMin || maxVelocity <= 0 || maxAcceleration <= 0) return;

    this.position = Math.max(rangeMin, Math.min(rangeMax, this.position));

    const target = this.direction > 0 ? rangeMax : rangeMin;
    const remaining = Math.abs(target - this.position);
    const rampSpeed = Math.sqrt(2 * maxAcceleration * Math.max(0, remaining));
    const desiredSpeed = Math.min(maxVelocity, rampSpeed);
    const desiredVel = this.direction * desiredSpeed;

    const maxDv = maxAcceleration * dt;
    this.velocity += Math.max(-maxDv, Math.min(maxDv, desiredVel - this.velocity));
    this.position += this.velocity * dt;

    if (this.direction > 0 && this.position >= rangeMax) {
      this.position = rangeMax;
      this.velocity = 0;
      this.direction = -1;
    } else if (this.direction < 0 && this.position <= rangeMin) {
      this.position = rangeMin;
      this.velocity = 0;
      this.direction = 1;
    }
  }

  reset(cfg: AxisMotionConfig): void {
    this.position = cfg.rangeMin;
    this.velocity = 0;
    this.direction = 1;
  }
}

function randNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v));
}

export class MovingSampleSource {
  private source: SampleSourceMode = 'camera';
  private motion: AxisMotionConfig;
  private simulated: SimulatedSignalConfig;

  private readonly motionProfile: MotionProfile1D;
  private lastSample = 0;

  private cameraStream: MediaStream | null = null;
  private cameraReady = false;
  private cameraTrack: MediaStreamTrack | null = null;
  private cameraFov = { hFovDeg: 60, vFovDeg: 45 };
  private cameraFovSource: 'camera-metadata' | 'manual' = 'manual';
  private sampleDiameterDeg = 5;
  private grayscaleEnabled = true;
  private exposureTimeAvailable = false;
  private exposureTimeValue: number | null = null;
  private exposureTimeMin: number | null = null;
  private exposureTimeMax: number | null = null;
  private exposureTimeStep: number | null = null;
  private readonly cameraCanvas = document.createElement('canvas');
  private readonly cameraCtx: CanvasRenderingContext2D | null;

  constructor(
    private readonly videoEl: HTMLVideoElement,
    motion: AxisMotionConfig,
    simulated: SimulatedSignalConfig,
  ) {
    this.motion = { ...motion };
    this.simulated = { ...simulated };
    this.motionProfile = new MotionProfile1D(this.motion.rangeMin);

    this.cameraCanvas.width = 160;
    this.cameraCanvas.height = 120;
    this.cameraCtx = this.cameraCanvas.getContext('2d', { willReadFrequently: true });
    this.videoEl.style.filter = 'grayscale(100%)';
  }

  setMotionConfig(next: AxisMotionConfig): void {
    this.motion = {
      rangeMin: Math.min(next.rangeMin, next.rangeMax),
      rangeMax: Math.max(next.rangeMin, next.rangeMax),
      maxVelocity: Math.max(0, next.maxVelocity),
      maxAcceleration: Math.max(0, next.maxAcceleration),
    };
  }

  setCameraHorizontalFov(hFovDeg: number): void {
    this.cameraFov.hFovDeg = Math.max(20, Math.min(170, hFovDeg));
    this.cameraFovSource = 'manual';
    this.updateVerticalFovFromAspect();
  }

  setSampleDiameterDeg(diameterDeg: number): void {
    this.sampleDiameterDeg = Math.max(0.5, Math.min(60, diameterDeg));
  }

  setGrayscaleEnabled(enabled: boolean): void {
    this.grayscaleEnabled = enabled;
    this.videoEl.style.filter = enabled ? 'grayscale(100%)' : 'none';
  }

  async setExposureTime(value: number): Promise<boolean> {
    if (!this.cameraTrack || !this.exposureTimeAvailable) return false;

    const target = this.clampExposureTime(value);
    try {
      await this.cameraTrack.applyConstraints({
        advanced: [{ exposureMode: 'manual', exposureTime: target } as MediaTrackConstraintSet],
      });
      this.refreshExposureInfo();
      return true;
    } catch {
      this.refreshExposureInfo();
      return false;
    }
  }

  setSimulatedConfig(next: SimulatedSignalConfig): void {
    this.simulated = { ...next };
  }

  get activeSource(): SampleSourceMode {
    return this.source;
  }

  getCurrentXAngleDeg(): number {
    return this.motionProfile.position;
  }

  getLastSample(): number {
    return this.lastSample;
  }

  getSampleDiameterFraction(): number {
    const fraction = this.sampleDiameterDeg / Math.max(1, this.cameraFov.hFovDeg);
    return Math.max(0.01, Math.min(1, fraction));
  }

  getCameraParameters(): CameraSourceParameters {
    const settings = this.cameraTrack?.getSettings();
    return {
      hFovDeg: this.cameraFov.hFovDeg,
      vFovDeg: this.cameraFov.vFovDeg,
      width: settings?.width ?? this.videoEl.videoWidth ?? this.cameraCanvas.width,
      height: settings?.height ?? this.videoEl.videoHeight ?? this.cameraCanvas.height,
      frameRate: settings?.frameRate ?? null,
      facingMode: settings?.facingMode ?? 'unknown',
      fovSource: this.cameraFovSource,
      sampleDiameterDeg: this.sampleDiameterDeg,
      grayscaleEnabled: this.grayscaleEnabled,
      exposureTimeAvailable: this.exposureTimeAvailable,
      exposureTime: this.exposureTimeValue,
      exposureTimeMin: this.exposureTimeMin,
      exposureTimeMax: this.exposureTimeMax,
      exposureTimeStep: this.exposureTimeStep,
    };
  }

  getSampleOffsetFraction(): number {
    if (this.source !== 'camera') return 0;
    const halfFov = Math.max(1, this.cameraFov.hFovDeg / 2);
    return Math.max(-1, Math.min(1, this.motionProfile.position / halfFov));
  }

  updateFrame(dtMs: number): void {
    if (this.source !== 'camera') return;
    const dtSec = Math.min(0.1, Math.max(0.001, dtMs / 1000));
    this.motionProfile.update(dtSec, this.motion);
  }

  sample(tickIndex: number): number {
    const sample = this.source === 'camera'
      ? this.sampleFromCamera()
      : this.sampleSimulated(tickIndex);

    this.lastSample = sample;
    return sample;
  }

  reset(): void {
    this.motionProfile.reset(this.motion);
    this.lastSample = this.source === 'camera' ? 0 : this.simulated.baseline;
  }

  async activateSource(nextSource: SampleSourceMode): Promise<ActivateSourceResult> {
    if (nextSource === 'camera') {
      const ok = await this.ensureCamera();
      if (ok) {
        this.source = 'camera';
        return {
          ok: true,
          activeSource: 'camera',
          message: 'Camera active. Sampling luminance at the highlighted motion profile position.',
        };
      }

      this.source = 'simulated';
      return {
        ok: false,
        activeSource: 'simulated',
        message: 'Camera unavailable. Falling back to simulated source.',
      };
    }

    this.stopCamera();
    this.source = 'simulated';
    return {
      ok: true,
      activeSource: 'simulated',
      message: 'Simulated source active.',
    };
  }

  stopAll(): void {
    this.stopCamera();
  }

  private async ensureCamera(): Promise<boolean> {
    if (this.cameraReady && this.cameraStream) return true;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      this.cameraStream = stream;
      this.cameraTrack = stream.getVideoTracks()[0] ?? null;
      this.videoEl.srcObject = stream;
      await this.videoEl.play();
      this.cameraReady = true;
      this.tryLoadFovFromCameraMetadata();
      this.updateVerticalFovFromAspect();
      this.refreshExposureInfo();
      this.setGrayscaleEnabled(this.grayscaleEnabled);
      return true;
    } catch {
      this.cameraReady = false;
      this.cameraTrack = null;
      return false;
    }
  }

  private stopCamera(): void {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) {
        track.stop();
      }
      this.cameraStream = null;
    }
    this.cameraTrack = null;
    this.videoEl.srcObject = null;
    this.cameraReady = false;
    this.exposureTimeAvailable = false;
    this.exposureTimeValue = null;
    this.exposureTimeMin = null;
    this.exposureTimeMax = null;
    this.exposureTimeStep = null;
  }

  private sampleFromCamera(): number {
    if (!this.cameraReady || !this.cameraCtx || this.videoEl.videoWidth === 0 || this.videoEl.videoHeight === 0) {
      return this.lastSample;
    }

    const w = this.cameraCanvas.width;
    const h = this.cameraCanvas.height;
    this.cameraCtx.drawImage(this.videoEl, 0, 0, w, h);

    const halfFov = Math.max(1, this.cameraFov.hFovDeg / 2);
    const clampedAngle = Math.max(-halfFov, Math.min(halfFov, this.motionProfile.position));
    const normalizedX = Math.max(0, Math.min(1, (clampedAngle / this.cameraFov.hFovDeg) + 0.5));
    const cx = Math.floor(normalizedX * (w - 1));
    const cy = Math.floor(h / 2);

    const diameterFraction = this.sampleDiameterDeg / Math.max(1, this.cameraFov.hFovDeg);
    const diameterPx = Math.max(1, diameterFraction * w);
    const radius = Math.max(0.5, diameterPx / 2);
    const radiusSq = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(w - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(h - 1, Math.ceil(cy + radius));

    const sampleW = maxX - minX + 1;
    const sampleH = maxY - minY + 1;
    const image = this.cameraCtx.getImageData(minX, minY, sampleW, sampleH).data;

    let sum = 0;
    let count = 0;

    for (let y = 0; y < sampleH; y++) {
      const py = minY + y;
      for (let x = 0; x < sampleW; x++) {
        const px = minX + x;
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy > radiusSq) continue;

        const idx = (y * sampleW + x) * 4;
        const lum = 0.299 * image[idx] + 0.587 * image[idx + 1] + 0.114 * image[idx + 2];
        sum += lum;
        count++;
      }
    }

    if (count === 0) return this.lastSample;
    return clampByte(sum / count);
  }

  private sampleSimulated(tickIndex: number): number {
    const drift = this.simulated.driftAmp * Math.sin(tickIndex / 24);
    const noise = randNormal() * this.simulated.noiseStd;
    const pulseOn = this.simulated.pulseEvery > 0 && tickIndex % this.simulated.pulseEvery < 4;
    const pulse = pulseOn ? this.simulated.pulseAmp : 0;
    return clampByte(this.simulated.baseline + drift + noise + pulse);
  }

  private updateVerticalFovFromAspect(): void {
    const width = this.videoEl.videoWidth || this.cameraCanvas.width;
    const height = this.videoEl.videoHeight || this.cameraCanvas.height;
    const aspect = width > 0 && height > 0 ? width / height : 4 / 3;
    this.cameraFov.vFovDeg = Math.max(10, Math.min(120, this.cameraFov.hFovDeg / aspect));
  }

  private tryLoadFovFromCameraMetadata(): void {
    if (!this.cameraTrack) return;

    const settings = this.cameraTrack.getSettings() as MediaTrackSettings & {
      fieldOfView?: number;
      horizontalFieldOfView?: number;
    };

    const capabilities = (typeof this.cameraTrack.getCapabilities === 'function'
      ? this.cameraTrack.getCapabilities()
      : null) as (MediaTrackCapabilities & {
      fieldOfView?: number | { min?: number; max?: number };
      horizontalFieldOfView?: number | { min?: number; max?: number };
    }) | null;

    const settingsCandidates = [settings.horizontalFieldOfView, settings.fieldOfView]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    const extractCapabilityValue = (value: number | { min?: number; max?: number } | undefined): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (value && typeof value === 'object') {
        const min = typeof value.min === 'number' ? value.min : undefined;
        const max = typeof value.max === 'number' ? value.max : undefined;
        if (min !== undefined && max !== undefined) return (min + max) / 2;
        if (min !== undefined) return min;
        if (max !== undefined) return max;
      }
      return null;
    };

    const capabilityCandidates = capabilities
      ? [
        extractCapabilityValue(capabilities.horizontalFieldOfView),
        extractCapabilityValue(capabilities.fieldOfView),
      ].filter((value): value is number => value !== null)
      : [];

    const candidate = [...settingsCandidates, ...capabilityCandidates]
      .find((value) => value >= 20 && value <= 170);

    if (typeof candidate === 'number') {
      this.cameraFov.hFovDeg = candidate;
      this.cameraFovSource = 'camera-metadata';
    }
  }

  private refreshExposureInfo(): void {
    if (!this.cameraTrack) {
      this.exposureTimeAvailable = false;
      this.exposureTimeValue = null;
      this.exposureTimeMin = null;
      this.exposureTimeMax = null;
      this.exposureTimeStep = null;
      return;
    }

    const settings = this.cameraTrack.getSettings() as MediaTrackSettings & { exposureTime?: number };
    const capabilities = (typeof this.cameraTrack.getCapabilities === 'function'
      ? this.cameraTrack.getCapabilities()
      : null) as (MediaTrackCapabilities & {
      exposureTime?: number | { min?: number; max?: number; step?: number };
    }) | null;

    const exposureCap = capabilities?.exposureTime;
    let min: number | null = null;
    let max: number | null = null;
    let step: number | null = null;

    if (typeof exposureCap === 'number' && Number.isFinite(exposureCap)) {
      min = exposureCap;
      max = exposureCap;
      step = 0.1;
    } else if (exposureCap && typeof exposureCap === 'object') {
      if (typeof exposureCap.min === 'number') min = exposureCap.min;
      if (typeof exposureCap.max === 'number') max = exposureCap.max;
      if (typeof exposureCap.step === 'number') step = exposureCap.step;
    }

    const current = typeof settings.exposureTime === 'number'
      ? settings.exposureTime
      : null;

    this.exposureTimeAvailable = min !== null || max !== null || current !== null;
    this.exposureTimeMin = min;
    this.exposureTimeMax = max;
    this.exposureTimeStep = step;

    if (this.exposureTimeAvailable) {
      const fallback = current ?? min ?? max ?? 0;
      this.exposureTimeValue = this.clampExposureTime(fallback);
    } else {
      this.exposureTimeValue = null;
    }
  }

  private clampExposureTime(value: number): number {
    let next = Number.isFinite(value) ? value : 0;
    if (this.exposureTimeMin !== null) next = Math.max(this.exposureTimeMin, next);
    if (this.exposureTimeMax !== null) next = Math.min(this.exposureTimeMax, next);
    return next;
  }
}
