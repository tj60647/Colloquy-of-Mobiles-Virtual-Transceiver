import type { LightReading } from '../shared/types.js';
import { DICT_LABELS, type DictWord } from '../shared/dictionary.js';
import type { SensitivityZone } from './sensitivityZone.js';
import type { BackgroundModel  } from './background.js';
import type { RingBuffer       } from './ringBuffer.js';
import type { MatchResult } from './patternMatcher.js';

export type ViewMode = 'live' | 'background' | 'difference';

export interface RenderParams {
  imageData:       ImageData;
  backgroundModel: BackgroundModel;
  viewMode:        ViewMode;
  zone:            SensitivityZone;
  ringBuffer:      RingBuffer<boolean>;
  lastReading:     LightReading | null;
  patternMatch:    MatchResult | null;
  patternScores:   Record<DictWord, number>;
  detectorMode:    'light' | 'audio';
  matcherInputMode: 'detector' | 'scalar-fixed' | 'scalar-zscore';
  audioSpectrum:   Uint8Array | null;
  audioBandpassCenter: number;
  audioBandpassQ:  number;
  effectiveHz:     number;
  sampleRateHistoryHz: number[];
  deltaHistory: number[];
  threshold:       number;
  wsConnected:     boolean;
}

const COLORS = {
  detected:    '#00ff88',
  idle:        '#ffcc00',
  ringOn:      'rgba(0, 255, 136, 0.9)',
  ringOff:     'rgba(30, 30, 30, 0.75)',
  hudBg:       'rgba(0, 0, 0, 0.62)',
  hudText:     '#d8d8d8',
  hudAccent:   '#00ff88',
  hudWarning:  '#ff8844',
};

const WORDS_I: DictWord[] = ['I_O', 'I_P', 'I_OP', 'I_R'];
const WORDS_II: DictWord[] = ['II_O', 'II_P', 'II_OP', 'II_R'];
const HUD_SPARKLINE_SAMPLES = 152;
const ALL_WORDS: DictWord[] = [...WORDS_I, ...WORDS_II];

/**
 * Renderer
 *
 * All drawing happens on a single HTMLCanvasElement in this order:
 *   1. Video frame (live) or background model image
 *   2. Oscillating sensitivity zone (dashed circle + crosshair)
 *   3. Ring-buffer visualisation (arc segments around the zone)
 *   4. HUD overlay (readings, angles, WS status, pattern confidence)
 */
export class Renderer {
  private readonly specWidth = 130;
  private readonly specHeight = 72;
  private readonly specBins = 64;
  private readonly specMaxHz = 3000;
  private specHistory: Uint8Array[] = [];
  private differenceImage: ImageData | null = null;
  private readonly patternScoreHistory: Record<DictWord, number[]> = {
    I_O: [], I_P: [], I_OP: [], I_R: [],
    II_O: [], II_P: [], II_OP: [], II_R: [],
  };
  private readonly patternDetectionMarkers: number[] = [];
  private lastDetectedPatternWord: DictWord | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx:    CanvasRenderingContext2D,
  ) {}

  render(p: RenderParams): void {
    const { ctx } = this;
    const { width, height } = this.canvas;

    this.updateSpecHistory(p.audioSpectrum, Math.max(this.specWidth, width));

    // 1 ── Video or background frame ─────────────────────────────────────────
    if (p.detectorMode === 'audio') {
      this.drawAudioBackground(width, height);
    } else if (p.viewMode === 'live') {
      ctx.putImageData(p.imageData, 0, 0);
    } else if (p.viewMode === 'difference') {
      this.drawDifferenceView(p);
    } else if (p.backgroundModel.isInitialized) {
      ctx.putImageData(p.backgroundModel.getBackgroundImageData(ctx), 0, 0);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // 2 ── Sensitivity zone ───────────────────────────────────────────────────
    this.drawZone(p.zone, p.lastReading?.detected ?? false);

    // 3 ── Ring buffer ────────────────────────────────────────────────────────
    this.drawRingBuffer(p.zone, p.ringBuffer);

    // 4 ── HUD ────────────────────────────────────────────────────────────────
    this.drawHUD(p, width, height);

    if (p.detectorMode === 'audio') {
      this.drawAudioSpectrogram(p, width);
    }
  }

  // ── Private drawing helpers ────────────────────────────────────────────────

  private drawZone(zone: SensitivityZone, detected: boolean): void {
    const { ctx } = this;
    const color = detected ? COLORS.detected : COLORS.idle;

    ctx.save();

    // Dashed circle
    ctx.setLineDash([9, 6]);
    ctx.lineWidth   = 2.5;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = detected ? 14 : 5;

    ctx.beginPath();
    ctx.arc(zone.centerX, zone.centerY, zone.radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Inner fill tint when detected
    if (detected) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0, 255, 136, 0.06)';
      ctx.beginPath();
      ctx.arc(zone.centerX, zone.centerY, zone.radius, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Crosshair at zone centre
    ctx.setLineDash([]);
    ctx.lineWidth   = 1;
    ctx.strokeStyle = detected ? 'rgba(0,255,136,0.7)' : 'rgba(255,204,0,0.5)';
    ctx.shadowBlur  = 0;
    const cs = 7;
    ctx.beginPath();
    ctx.moveTo(zone.centerX - cs, zone.centerY);
    ctx.lineTo(zone.centerX + cs, zone.centerY);
    ctx.moveTo(zone.centerX, zone.centerY - cs);
    ctx.lineTo(zone.centerX, zone.centerY + cs);
    ctx.stroke();

    ctx.restore();
  }

  private drawRingBuffer(zone: SensitivityZone, rb: RingBuffer<boolean>): void {
    const readings = rb.getAll();
    if (readings.length === 0) return;

    const { ctx }   = this;
    const inner     = zone.radius + 14;
    const outer     = zone.radius + 28;
    const startAngle = -Math.PI / 2; // 12 o'clock
    const total      = readings.length;
    const step       = (2 * Math.PI) / Math.min(total, 240);

    ctx.save();

    readings.forEach((on, i) => {
      const a0 = startAngle + i * step;
      const a1 = a0 + step * 0.85; // slight gap between segments

      ctx.beginPath();
      ctx.arc(zone.centerX, zone.centerY, inner, a0, a1);
      ctx.arc(zone.centerX, zone.centerY, outer, a1, a0, true);
      ctx.closePath();

      ctx.fillStyle = on ? COLORS.ringOn : COLORS.ringOff;
      ctx.fill();
    });

    ctx.restore();
  }

  private drawDifferenceView(p: RenderParams): void {
    const { ctx } = this;
    const src = p.imageData;

    if (!p.backgroundModel.isInitialized) {
      ctx.putImageData(src, 0, 0);
      return;
    }

    const bg = p.backgroundModel.getBackgroundImageData(ctx);
    if (bg.width !== src.width || bg.height !== src.height) {
      ctx.putImageData(src, 0, 0);
      return;
    }

    if (!this.differenceImage ||
        this.differenceImage.width !== src.width ||
        this.differenceImage.height !== src.height) {
      this.differenceImage = ctx.createImageData(src.width, src.height);
    }

    const out = this.differenceImage.data;
    const srcData = src.data;
    const bgData = bg.data;

    for (let i = 0; i < srcData.length; i += 4) {
      const srcLum = 0.299 * srcData[i] + 0.587 * srcData[i + 1] + 0.114 * srcData[i + 2];
      const bgLum = 0.299 * bgData[i] + 0.587 * bgData[i + 1] + 0.114 * bgData[i + 2];
      const diff = srcLum - bgLum;
      const on = diff > p.threshold;
      const v = on ? 255 : 0;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }

    ctx.putImageData(this.differenceImage, 0, 0);
  }

  private drawHUD(p: RenderParams, width: number, height: number): void {
    const { ctx }  = this;
    const r        = p.lastReading;
    const detected = r?.detected ?? false;
    const hudTopPad = 12;
    const hudRowGap = 18;

    // ── Info panel (top-left) ────────────────────────────────────────────────
    const panelW = 240;
    const panelH = 214;
    ctx.save();
    ctx.fillStyle = COLORS.hudBg;
    this.roundRect(0, 0, panelW, panelH, 0);
    ctx.fill();

    ctx.font      = '12px "Courier New", monospace';
    ctx.textBaseline = 'top';

    const unitLabel = p.zone.config.unit;
    const velLabel  = `${unitLabel}/s`;
    const fmt1 = (n: number) => n.toFixed(1);

    const lines: Array<[string, string]> = r
      ? [
          ['DETECT', detected ? '● YES' : '○ no'],
          ['MATCH ', p.matcherInputMode === 'detector'
            ? 'detector bit'
            : p.matcherInputMode === 'scalar-fixed'
              ? 'scalar fixed'
              : 'scalar z-score'],
          ['PIXEL ', `${r.frameX}, ${r.frameY} px`],
          ['ANGLE ', `${r.xAngle.toFixed(1)}° H  ${r.yAngle.toFixed(1)}° V`],
          ['BRIGHT', `${r.brightness}  (bg ${r.background})`],
          ['DELTA ', `${r.delta > 0 ? '+' : ''}${r.delta}  / thr ${p.threshold}`],
          ['RATE  ', `${p.effectiveHz > 0 ? p.effectiveHz.toFixed(1) : '--.-'} Hz`],
          ['POS   ', `${fmt1(p.zone.posX)}${unitLabel}  ${fmt1(p.zone.posY)}${unitLabel}`],
          ['VEL   ', `${fmt1(p.zone.velX)} ${velLabel}  ${fmt1(p.zone.velY)} ${velLabel}`],
          ['WS    ', p.wsConnected ? 'connected' : 'offline'],
          ['BUFF  ', `${p.ringBuffer.size} samples`],
        ]
      : [['STATUS', 'Initialising…']];

    const rateLineIdx = lines.findIndex(([label]) => label.trim() === 'RATE');
    if (rateLineIdx >= 0) {
      this.drawRateSparkline(p.sampleRateHistoryHz, 78, hudTopPad + rateLineIdx * hudRowGap, panelW - 88, 12);
    }

    const deltaLineIdx = lines.findIndex(([label]) => label.trim() === 'DELTA');
    if (deltaLineIdx >= 0) {
      this.drawDeltaSparkline(p.deltaHistory, p.threshold, 78, hudTopPad + deltaLineIdx * hudRowGap, panelW - 88, 12);
    }

    lines.forEach(([label, value], i) => {
      const y = hudTopPad + i * hudRowGap;
      ctx.fillStyle = '#5a7a5a';
      ctx.fillText(label, 10, y);
      ctx.fillStyle =
        label === 'DETECT' && detected ? COLORS.hudAccent :
        label === 'WS' && !p.wsConnected ? COLORS.hudWarning :
        COLORS.hudText;
      ctx.fillText(value, 78, y);
    });

    ctx.restore();

    // ── Pattern confidence panel (bottom) ───────────────────────────────────
    this.updatePatternScoreHistory(p.patternScores, p.patternMatch?.word ?? null);

    const botH = 156;
    ctx.save();
    ctx.fillStyle = COLORS.hudBg;
    this.roundRect(0, height - botH, width, botH, 0);
    ctx.fill();

    ctx.textBaseline = 'top';
    ctx.font      = 'bold 13px "Courier New", monospace';
    ctx.fillStyle = COLORS.hudAccent;
    const titleY = height - botH + 8;
    ctx.fillText('PATTERN CONFIDENCE', 12, titleY);

    ctx.font = '11px "Courier New", monospace';
    const leftX = 12;
    const rightX = Math.max(250, Math.floor(width / 2));
    const columnTitleY = titleY + 18;
    const baseY = columnTitleY + 15;
    const confidenceRowGap = 19;

    ctx.fillStyle = '#9fb3a0';
    ctx.fillText('I Patterns', leftX, columnTitleY);
    ctx.fillText('II Patterns', rightX, columnTitleY);

    this.drawPatternConfidenceColumn(ctx, p, WORDS_I, leftX, baseY, confidenceRowGap);
    this.drawPatternConfidenceColumn(ctx, p, WORDS_II, rightX, baseY, confidenceRowGap);

    ctx.restore();
  }

  private drawRateSparkline(history: number[], x: number, y: number, w: number, h: number): void {
    if (w <= 4 || h <= 4) return;

    const { ctx } = this;
    const minHz = 10;
    const maxHz = 50;
    const range = maxHz - minHz;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(x, y + 1, w, h);

    const drawGuide = (hz: number): void => {
      const clamped = Math.max(minHz, Math.min(maxHz, hz));
      const gy = y + h - 1 - ((clamped - minHz) / range) * (h - 2);
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.strokeStyle = 'rgba(180, 180, 180, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    drawGuide(20);
    drawGuide(40);

    if (history.length >= 2) {
      const samples = this.resampleToCount(history, HUD_SPARKLINE_SAMPLES);

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const hz = Math.max(minHz, Math.min(maxHz, samples[i]));
        const nx = samples.length <= 1 ? 0 : i / (samples.length - 1);
        const px = x + nx * (w - 1);
        const ny = y + h - 1 - ((hz - minHz) / range) * (h - 2);
        if (i === 0) ctx.moveTo(px, ny);
        else ctx.lineTo(px, ny);
      }
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawDeltaSparkline(history: number[], threshold: number, x: number, y: number, w: number, h: number): void {
    if (w <= 4 || h <= 4) return;

    const { ctx } = this;
    const minDelta = -64;
    const maxDelta = 128;
    const range = maxDelta - minDelta;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fillRect(x, y + 1, w, h);

    const drawGuide = (value: number, color: string): void => {
      const clamped = Math.max(minDelta, Math.min(maxDelta, value));
      const gy = y + h - 1 - ((clamped - minDelta) / range) * (h - 2);
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + w, gy);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    drawGuide(0, 'rgba(160, 160, 160, 0.18)');
    drawGuide(threshold, 'rgba(255, 136, 68, 0.38)');

    if (history.length >= 2) {
      const samples = this.resampleToCount(history, HUD_SPARKLINE_SAMPLES);

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const v = Math.max(minDelta, Math.min(maxDelta, samples[i]));
        const nx = samples.length <= 1 ? 0 : i / (samples.length - 1);
        const px = x + nx * (w - 1);
        const py = y + h - 1 - ((v - minDelta) / range) * (h - 2);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(255, 204, 0, 0.62)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  private resampleToCount(values: number[], count: number): number[] {
    if (count <= 1) return values.slice(-1);
    if (values.length <= count) return values;

    const out: number[] = [];
    for (let x = 0; x < count; x++) {
      const start = Math.floor((x * values.length) / count);
      const end = Math.floor(((x + 1) * values.length) / count);
      let sum = 0;
      let count = 0;
      for (let i = start; i < Math.max(start + 1, end); i++) {
        sum += values[i];
        count++;
      }
      out.push(count > 0 ? sum / count : values[start]);
    }
    return out;
  }

  private drawPatternConfidenceColumn(
    ctx: CanvasRenderingContext2D,
    p: RenderParams,
    words: DictWord[],
    x: number,
    baseY: number,
    rowGap: number,
  ): void {
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const score = p.patternScores[word] ?? 0;
      const pct = Math.round(score * 100);
      const y = baseY + i * rowGap;

      this.drawPatternConfidenceSparkline(
        ctx,
        this.patternScoreHistory[word],
        this.patternDetectionMarkers,
        x + 40,
        y,
        40,
        12,
      );

      ctx.fillStyle = p.patternMatch?.word === word ? COLORS.hudAccent : '#9fb3a0';
      ctx.fillText(word, x, y);

      ctx.fillStyle = this.confidenceColor(score);
      ctx.fillText(`${pct.toString().padStart(3, ' ')}%`, x + 44, y);

      ctx.fillStyle = COLORS.hudText;
      ctx.fillText(DICT_LABELS[word], x + 84, y);
    }
  }

  private drawPatternConfidenceSparkline(
    ctx: CanvasRenderingContext2D,
    history: number[],
    markers: number[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w <= 4 || h <= 4) return;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(x, y + 1, w, h);

    if (history.length >= 2) {
      const samples = this.resampleToCount(history, HUD_SPARKLINE_SAMPLES);
      const markerSamples = this.resampleToCount(markers, HUD_SPARKLINE_SAMPLES);

      for (let i = 0; i < markerSamples.length; i++) {
        if (markerSamples[i] < 0.5) continue;
        const nx = markerSamples.length <= 1 ? 0 : i / (markerSamples.length - 1);
        const px = x + nx * (w - 1);
        ctx.beginPath();
        ctx.moveTo(px, y + 1);
        ctx.lineTo(px, y + h - 1);
        ctx.strokeStyle = 'rgba(255, 64, 64, 0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const v = Math.max(0, Math.min(1, samples[i]));
        const nx = samples.length <= 1 ? 0 : i / (samples.length - 1);
        const px = x + nx * (w - 1);
        const py = y + h - 1 - v * (h - 2);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(255, 204, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  private updatePatternScoreHistory(scores: Record<DictWord, number>, patternWord: DictWord | null): void {
    for (const word of ALL_WORDS) {
      const value = Math.max(0, Math.min(1, scores[word] ?? 0));
      const history = this.patternScoreHistory[word];
      history.push(value);
      if (history.length > HUD_SPARKLINE_SAMPLES) {
        history.splice(0, history.length - HUD_SPARKLINE_SAMPLES);
      }
    }

    const event = patternWord !== null && patternWord !== this.lastDetectedPatternWord ? 1 : 0;
    this.patternDetectionMarkers.push(event);
    if (this.patternDetectionMarkers.length > HUD_SPARKLINE_SAMPLES) {
      this.patternDetectionMarkers.splice(0, this.patternDetectionMarkers.length - HUD_SPARKLINE_SAMPLES);
    }
    this.lastDetectedPatternWord = patternWord;
  }

  private confidenceColor(score: number): string {
    const s = Math.max(0, Math.min(1, score));
    const hue = 8 + s * 132;
    const sat = 88;
    const light = 58;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  }

  private drawAudioSpectrogram(p: RenderParams, width: number): void {
    const { ctx } = this;

    const x0 = width - this.specWidth - 10;
    const y0 = 10;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    this.roundRect(x0 - 8, y0 - 8, this.specWidth + 16, this.specHeight + 38, 6);
    ctx.fill();

    for (let x = 0; x < this.specHistory.length; x++) {
      const col = this.specHistory[x];
      for (let y = 0; y < col.length; y++) {
        const value = col[y] / 255;
        const hue = 220 - value * 200;
        const sat = 85;
        const light = 12 + value * 55;
        ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
        const px = x0 + x;
        const py = y0 + (col.length - 1 - y) * (this.specHeight / col.length);
        ctx.fillRect(px, py, 1, Math.ceil(this.specHeight / col.length));
      }
    }

    ctx.strokeStyle = 'rgba(0,255,136,0.45)';
    ctx.strokeRect(x0, y0, this.specWidth, this.specHeight);

    const centerHz = Math.max(1, Math.min(this.specMaxHz, p.audioBandpassCenter));
    const q = Math.max(0.01, p.audioBandpassQ);
    const bandwidth = centerHz / q;
    const minHz = Math.max(0, centerHz - bandwidth / 2);
    const maxHz = Math.min(this.specMaxHz, centerHz + bandwidth / 2);

    this.drawSpecGuideLine(ctx, x0, y0, this.specWidth, minHz, 'rgba(255,204,0,0.85)');
    this.drawSpecGuideLine(ctx, x0, y0, this.specWidth, centerHz, 'rgba(0,255,136,0.95)');
    this.drawSpecGuideLine(ctx, x0, y0, this.specWidth, maxHz, 'rgba(255,204,0,0.85)');

    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = '#00ff88';
    ctx.fillText('AUDIO SPECTROGRAM', x0, y0 + this.specHeight + 6);

    ctx.fillStyle = '#d8d8d8';
    ctx.fillText(`0–${this.specMaxHz} Hz`, x0, y0 + this.specHeight + 20);
    ctx.fillText(`BP ${Math.round(centerHz)}Hz  Q ${q.toFixed(1)}`, x0, y0 + this.specHeight + 32);

    ctx.restore();
  }

  private updateSpecHistory(spectrum: Uint8Array | null, maxColumns: number): void {
    if (!spectrum || spectrum.length === 0) return;

    this.specHistory.push(this.downsampleSpectrum(spectrum, this.specBins));
    const cap = Math.max(this.specWidth, maxColumns);
    if (this.specHistory.length > cap) {
      this.specHistory.splice(0, this.specHistory.length - cap);
    }
  }

  private drawAudioBackground(width: number, height: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, width, height);

    if (this.specHistory.length === 0) return;

    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x / Math.max(1, width - 1)) * (this.specHistory.length - 1));
      const col = this.specHistory[sx];
      if (!col) continue;

      for (let y = 0; y < col.length; y++) {
        const value = col[y] / 255;
        const hue = 225 - value * 190;
        const sat = 85;
        const light = 5 + value * 42;
        ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;

        const py = (col.length - 1 - y) * (height / col.length);
        ctx.fillRect(x, py, 1, Math.ceil(height / col.length));
      }
    }
  }

  private drawSpecGuideLine(
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    width: number,
    frequencyHz: number,
    color: string,
  ): void {
    const t = 1 - Math.max(0, Math.min(this.specMaxHz, frequencyHz)) / this.specMaxHz;
    const y = y0 + t * this.specHeight;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + width, y);
    ctx.stroke();
    ctx.restore();
  }

  private downsampleSpectrum(src: Uint8Array, bins: number): Uint8Array {
    if (bins <= 0 || src.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(bins);
    const scale = src.length / bins;

    for (let i = 0; i < bins; i++) {
      const start = Math.floor(i * scale);
      const end = Math.max(start + 1, Math.floor((i + 1) * scale));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < src.length; j++) {
        sum += src[j];
        count++;
      }
      out[i] = count > 0 ? Math.round(sum / count) : 0;
    }

    return out;
  }

  /** Tiny helper – draws a rect with optional rounded corners */
  private roundRect(
    x: number, y: number, w: number, h: number, r: number,
  ): void {
    const ctx = this.ctx;
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }
  }
}
