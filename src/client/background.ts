/**
 * BackgroundModel
 *
 * Maintains a per-pixel exponential moving average of the video feed.
 * The "background" is used as the reference level for light-spike detection:
 *
 *   bg[i] = alpha × frame[i] + (1 − alpha) × bg[i]
 *
 * A small alpha (e.g. 0.02–0.05) gives a slow-adapting reference that ignores
 * brief bright flashes but follows gradual illumination changes.
 */
export class BackgroundModel {
  /** bg values stored as Float32 per channel (RGBA) */
  private bg = new Float32Array(0);
  private _width  = 0;
  private _height = 0;
  private _initialized = false;

  /** Exponential moving average learning rate (0–1) */
  alpha: number;

  constructor(alpha = 0.03) {
    this.alpha = alpha;
  }

  /**
   * Feed the latest frame into the model.
   * On the first call the model is seeded with the frame values.
   */
  update(imageData: ImageData): void {
    const { data, width, height } = imageData;

    if (!this._initialized || this._width !== width || this._height !== height) {
      this._width  = width;
      this._height = height;
      this.bg = new Float32Array(data.length);
      // Seed with current frame
      for (let i = 0; i < data.length; i++) {
        this.bg[i] = data[i];
      }
      this._initialized = true;
      return;
    }

    const { alpha } = this;
    const inv = 1 - alpha;
    for (let i = 0; i < data.length; i++) {
      this.bg[i] = alpha * data[i] + inv * this.bg[i];
    }
  }

  /** Build an ImageData representing the current background model */
  getBackgroundImageData(ctx: CanvasRenderingContext2D): ImageData {
    const out = ctx.createImageData(this._width, this._height);
    for (let i = 0; i < this.bg.length; i++) {
      out.data[i] = Math.round(this.bg[i]);
    }
    return out;
  }

  /**
   * Return the background luminance at a pixel coordinate.
   * Uses the BT.601 luma weights.
   */
  getLuminanceAt(x: number, y: number): number {
    if (!this._initialized) return 0;
    const xi = Math.max(0, Math.min(this._width  - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(this._height - 1, Math.round(y)));
    const i  = (yi * this._width + xi) * 4;
    return 0.299 * this.bg[i] + 0.587 * this.bg[i + 1] + 0.114 * this.bg[i + 2];
  }

  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Reset the model – it will re-seed on the next update() call */
  reset(): void {
    this._initialized = false;
  }
}
