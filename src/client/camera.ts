/**
 * CameraManager
 * Wraps getUserMedia, provides a stable video element and frame-capture helpers.
 */
export class CameraManager {
  private readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
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

  /** Width of the video track in pixels (available after initialize()) */
  get width(): number {
    return this.video.videoWidth || 640;
  }

  /** Height of the video track in pixels (available after initialize()) */
  get height(): number {
    return this.video.videoHeight || 480;
  }

  /**
   * Blit the current video frame onto a 2-D canvas context.
   * The caller is responsible for sizing the canvas to match.
   */
  drawFrame(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.video, 0, 0, this.width, this.height);
  }

  /** The underlying HTMLVideoElement (useful for Picture-in-Picture etc.) */
  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
