export interface MetricsSnapshot {
  sample: number;
  mean: number;
  stddev: number;
  max: number;
  z: number;
  zThreshold: number;
}

export interface SignalChartSnapshot {
  sampleHistory: number[];
  meanHistory: number[];
  upperHistory: number[];
  lowerHistory: number[];
  windowSize: number;
  hz: number;
  tickIndex: number;
}

export interface ZChartSnapshot {
  zHistory: number[];
  zThreshold: number;
  hz: number;
  tickIndex: number;
}

export interface PositiveZEventChartSnapshot {
  zHistory: number[];
  zThreshold: number;
  hz: number;
  tickIndex: number;
}

export class VideoPreviewRenderer {
  private lastDiameterPx = -1;

  constructor(private readonly sampleZoneEl: HTMLElement) {}

  renderSampleProbe(
    offsetFraction: number,
    diameterFraction: number,
    sampleValue: number,
    rollingMeanValue: number,
  ): void {
    const parentEl = this.sampleZoneEl.parentElement;
    const parentW = Math.max(1, parentEl?.clientWidth ?? 1);
    const parentH = Math.max(1, parentEl?.clientHeight ?? 1);

    const targetDiameterPx = Math.max(4, Math.min(parentW * diameterFraction, parentH * 0.95));
    const diameterPx = Math.round(targetDiameterPx);
    if (diameterPx !== this.lastDiameterPx) {
      this.sampleZoneEl.style.width = `${diameterPx}px`;
      this.sampleZoneEl.style.height = `${diameterPx}px`;
      this.lastDiameterPx = diameterPx;
    }

    const maxOffsetPx = Math.max(0, (parentW - diameterPx) / 2);
    const offsetPx = Math.max(-maxOffsetPx, Math.min(maxOffsetPx, offsetFraction * maxOffsetPx));
    this.sampleZoneEl.style.transform = `translate(-50%, -50%) translateX(${offsetPx.toFixed(3)}px)`;

    const sampleLum = Math.max(0, Math.min(255, Math.round(sampleValue)));
    const meanLum = Math.max(0, Math.min(255, Math.round(rollingMeanValue)));
    this.sampleZoneEl.style.background = `linear-gradient(to bottom, rgb(${sampleLum}, ${sampleLum}, ${sampleLum}) 0 50%, rgb(${meanLum}, ${meanLum}, ${meanLum}) 50% 100%)`;
  }
}

export class MetricsPanelRenderer {
  constructor(
    private readonly sampleNowEl: HTMLElement,
    private readonly meanNowEl: HTMLElement,
    private readonly stdNowEl: HTMLElement,
    private readonly maxNowEl: HTMLElement,
    private readonly zNowEl: HTMLElement,
    private readonly eventNowEl: HTMLElement,
  ) {}

  render(snapshot: MetricsSnapshot): void {
    this.sampleNowEl.textContent = snapshot.sample.toFixed(1);
    this.meanNowEl.textContent = snapshot.mean.toFixed(1);
    this.stdNowEl.textContent = snapshot.stddev.toFixed(2);
    this.maxNowEl.textContent = snapshot.max.toFixed(1);
    this.zNowEl.textContent = snapshot.z.toFixed(2);

    const event = Math.abs(snapshot.z) >= snapshot.zThreshold;
    this.eventNowEl.textContent = event ? 'YES' : 'no';
    this.eventNowEl.className = `v ${event ? 'bad' : 'ok'}`;
    this.zNowEl.className = `v ${event ? 'warn' : ''}`;
  }
}

class CanvasSeriesRenderer {
  protected drawSeries(
    ctx: CanvasRenderingContext2D,
    arr: number[],
    minY: number,
    maxY: number,
    color: string,
    w: number,
    h: number,
    width = 1.2,
  ): void {
    if (arr.length < 2) return;
    const range = Math.max(1e-6, maxY - minY);
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = (i / Math.max(1, arr.length - 1)) * (w - 1);
      const y = h - 1 - ((arr[i] - minY) / range) * (h - 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  protected drawSecondGrid(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    points: number,
    hz: number,
    tickIndex: number,
  ): void {
    if (points < 2 || hz <= 0) return;

    const startGlobalIndex = tickIndex - (points - 1);
    ctx.save();
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.18)';
    ctx.lineWidth = 1;

    for (let i = 0; i < points; i++) {
      const globalIndex = startGlobalIndex + i;
      if (globalIndex <= 0 || globalIndex % hz !== 0) continue;

      const x = (i / Math.max(1, points - 1)) * (w - 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.restore();
  }

  protected drawSampleGrid(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    points: number,
  ): void {
    if (points < 2) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.08)';
    ctx.lineWidth = 1;

    for (let i = 0; i < points; i++) {
      const x = (i / Math.max(1, points - 1)) * (w - 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.restore();
  }
}

export class SignalChartRenderer extends CanvasSeriesRenderer {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly minY: number,
    private readonly maxY: number,
  ) {
    super();
  }

  render(snapshot: SignalChartSnapshot): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const points = snapshot.sampleHistory.length;
    if (points > 1) {
      const windowPoints = Math.max(1, Math.min(points, Math.floor(snapshot.windowSize)));
      const startIdx = Math.max(0, points - windowPoints);
      const x0 = (startIdx / Math.max(1, points - 1)) * (w - 1);
      const x1 = w - 1;
      const rectW = Math.max(1, x1 - x0);

      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.lineWidth = 1;
      ctx.fillRect(x0, 0, rectW, h);
      ctx.strokeRect(x0 + 0.5, 0.5, Math.max(0, rectW - 1), Math.max(0, h - 1));
      ctx.restore();
    }

    this.drawSampleGrid(ctx, w, h, snapshot.sampleHistory.length);
    this.drawSecondGrid(ctx, w, h, snapshot.sampleHistory.length, snapshot.hz, snapshot.tickIndex);

    const range = this.maxY - this.minY;
    const n = Math.min(snapshot.meanHistory.length, snapshot.upperHistory.length, snapshot.lowerHistory.length);

    if (n > 1) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const std = snapshot.upperHistory[i] - snapshot.meanHistory[i];
        const upper2 = snapshot.meanHistory[i] + (2 * std);
        const x = (i / Math.max(1, n - 1)) * (w - 1);
        const y = h - 1 - ((upper2 - this.minY) / range) * (h - 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        const std = snapshot.upperHistory[i] - snapshot.meanHistory[i];
        const lower2 = snapshot.meanHistory[i] - (2 * std);
        const x = (i / Math.max(1, n - 1)) * (w - 1);
        const y = h - 1 - ((lower2 - this.minY) / range) * (h - 2);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.10)';
      ctx.fill();
    }

    if (snapshot.upperHistory.length > 1 && snapshot.lowerHistory.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < snapshot.upperHistory.length; i++) {
        const x = (i / Math.max(1, snapshot.upperHistory.length - 1)) * (w - 1);
        const y = h - 1 - ((snapshot.upperHistory[i] - this.minY) / range) * (h - 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = snapshot.lowerHistory.length - 1; i >= 0; i--) {
        const x = (i / Math.max(1, snapshot.lowerHistory.length - 1)) * (w - 1);
        const y = h - 1 - ((snapshot.lowerHistory[i] - this.minY) / range) * (h - 2);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.fill();
    }

    this.drawSeries(ctx, snapshot.meanHistory, this.minY, this.maxY, 'rgba(34, 211, 238, 0.95)', w, h, 1.4);
    this.drawSeries(ctx, snapshot.sampleHistory, this.minY, this.maxY, 'rgba(165, 180, 252, 0.95)', w, h, 1.3);
  }
}

export class ZScoreChartRenderer extends CanvasSeriesRenderer {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly minY: number,
    private readonly maxY: number,
  ) {
    super();
  }

  render(snapshot: ZChartSnapshot): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    this.drawSampleGrid(ctx, w, h, snapshot.zHistory.length);
    this.drawSecondGrid(ctx, w, h, snapshot.zHistory.length, snapshot.hz, snapshot.tickIndex);

    const drawGuide = (value: number, color: string): void => {
      const y = h - 1 - ((value - this.minY) / (this.maxY - this.minY)) * (h - 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    drawGuide(0, 'rgba(125, 125, 125, 0.35)');
    drawGuide(snapshot.zThreshold, 'rgba(239, 68, 68, 0.55)');
    drawGuide(-snapshot.zThreshold, 'rgba(239, 68, 68, 0.55)');

    this.drawSeries(ctx, snapshot.zHistory, this.minY, this.maxY, 'rgba(245, 158, 11, 0.95)', w, h, 1.4);
  }
}

export class PositiveZEventChartRenderer extends CanvasSeriesRenderer {
  constructor(private readonly canvas: HTMLCanvasElement) {
    super();
  }

  render(snapshot: PositiveZEventChartSnapshot): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    this.drawSampleGrid(ctx, w, h, snapshot.zHistory.length);
    this.drawSecondGrid(ctx, w, h, snapshot.zHistory.length, snapshot.hz, snapshot.tickIndex);

    if (snapshot.zHistory.length === 0) return;

    const points = snapshot.zHistory.length;
    const stepW = points > 1 ? (w - 1) / (points - 1) : w;

    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.72)';
    for (let i = 0; i < points; i++) {
      if (snapshot.zHistory[i] < snapshot.zThreshold) continue;
      const x = i * stepW;
      const barW = Math.max(1, stepW * 0.85);
      ctx.fillRect(x - (barW / 2), 0, barW, h - 1);
    }
    ctx.restore();
  }
}
