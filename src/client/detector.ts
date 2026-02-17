import type { LightReading } from '../shared/types.js';
import type { BackgroundModel }  from './background.js';
import type { SensitivityZone } from './sensitivityZone.js';
import type { FovMapper }        from './fovMapper.js';

/**
 * LightDetector
 *
 * For every 40 Hz tick:
 *  1. Iterate all pixels inside the sensitivity zone circle.
 *  2. Compute average luminance of the live frame and the background model.
 *  3. delta = liveAvg − bgAvg
 *  4. detected = (delta > threshold)
 *
 * The result is a fully-typed LightReading ready for the ring buffer,
 * pattern decoder, and WebSocket broadcast.
 */
export class LightDetector {
  /** Minimum delta luminance to register as a detection (0–255) */
  threshold: number;

  constructor(threshold = 30) {
    this.threshold = threshold;
  }

  detect(
    imageData: ImageData,
    background: BackgroundModel,
    zone: SensitivityZone,
    fov: FovMapper,
    timestamp: number,
  ): LightReading {
    const { data, width, height } = imageData;
    const r  = zone.radius;
    const cx = zone.centerX;
    const cy = zone.centerY;

    const xMin = Math.max(0, Math.floor(cx - r));
    const xMax = Math.min(width  - 1, Math.ceil(cx + r));
    const yMin = Math.max(0, Math.floor(cy - r));
    const yMax = Math.min(height - 1, Math.ceil(cy + r));

    let sumBrightness = 0;
    let sumBackground = 0;
    let pixelCount    = 0;

    for (let py = yMin; py <= yMax; py++) {
      for (let px = xMin; px <= xMax; px++) {
        if (!zone.contains(px, py)) continue;

        const idx = (py * width + px) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const bgL = background.getLuminanceAt(px, py);

        sumBrightness += lum;
        sumBackground += bgL;
        pixelCount++;
      }
    }

    const brightness = pixelCount > 0 ? sumBrightness / pixelCount : 0;
    const bg         = pixelCount > 0 ? sumBackground / pixelCount : 0;
    const delta      = brightness - bg;
    const detected   = delta > this.threshold;

    const { xAngle, yAngle } = fov.pixelToAngle(cx, cy, width, height);

    return {
      timestamp,
      frameX:     Math.round(cx),
      frameY:     Math.round(cy),
      xAngle:     Math.round(xAngle * 10) / 10,
      yAngle:     Math.round(yAngle * 10) / 10,
      detected,
      brightness: Math.round(brightness),
      background: Math.round(bg),
      delta:      Math.round(delta),
      zoneX:      cx,
      zoneY:      cy,
      zoneRadius: r,
    };
  }
}
