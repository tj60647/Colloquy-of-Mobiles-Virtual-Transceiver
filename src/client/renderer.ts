import type { LightReading } from '../shared/types.js';
import { DICT_LABELS } from '../shared/dictionary.js';
import type { SensitivityZone } from './sensitivityZone.js';
import type { BackgroundModel  } from './background.js';
import type { RingBuffer       } from './ringBuffer.js';
import type { PatternDecoder   } from './patternDecoder.js';
import type { MatchResult } from './patternMatcher.js';

export type ViewMode = 'live' | 'background';

export interface RenderParams {
  imageData:       ImageData;
  backgroundModel: BackgroundModel;
  viewMode:        ViewMode;
  zone:            SensitivityZone;
  ringBuffer:      RingBuffer<boolean>;
  lastReading:     LightReading | null;
  decoder:         PatternDecoder;
  patternMatch:    MatchResult | null;
  detectorMode:    'light' | 'audio';
  audioSpectrum:   Uint8Array | null;
  audioBandpassCenter: number;
  audioBandpassQ:  number;
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
  morseText:   '#00ff88',
  morseCode:   '#ffcc00',
};

/**
 * Renderer
 *
 * All drawing happens on a single HTMLCanvasElement in this order:
 *   1. Video frame (live) or background model image
 *   2. Oscillating sensitivity zone (dashed circle + crosshair)
 *   3. Ring-buffer visualisation (arc segments around the zone)
 *   4. HUD overlay (readings, angles, WS status, Morse output)
 */
export class Renderer {
  private readonly specWidth = 130;
  private readonly specHeight = 72;
  private readonly specBins = 64;
  private readonly specMaxHz = 3000;
  private specHistory: Uint8Array[] = [];

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

  private drawHUD(p: RenderParams, width: number, height: number): void {
    const { ctx }  = this;
    const r        = p.lastReading;
    const detected = r?.detected ?? false;

    // ── Info panel (top-left) ────────────────────────────────────────────────
    const panelW = 240;
    const panelH = 200;
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
          ['PIXEL ', `${r.frameX}, ${r.frameY} px`],
          ['ANGLE ', `${r.xAngle.toFixed(1)}° H  ${r.yAngle.toFixed(1)}° V`],
          ['BRIGHT', `${r.brightness}  (bg ${r.background})`],
          ['DELTA ', `${r.delta > 0 ? '+' : ''}${r.delta}  / thr ${p.threshold}`],
          ['POS   ', `${fmt1(p.zone.posX)}${unitLabel}  ${fmt1(p.zone.posY)}${unitLabel}`],
          ['VEL   ', `${fmt1(p.zone.velX)} ${velLabel}  ${fmt1(p.zone.velY)} ${velLabel}`],
          ['WS    ', p.wsConnected ? 'connected' : 'offline'],
          ['BUFF  ', `${p.ringBuffer.size} samples`],
        ]
      : [['STATUS', 'Initialising…']];

    lines.forEach(([label, value], i) => {
      const y = 12 + i * 20;
      ctx.fillStyle = '#5a7a5a';
      ctx.fillText(label, 10, y);
      ctx.fillStyle =
        label === 'DETECT' && detected ? COLORS.hudAccent :
        label === 'WS' && !p.wsConnected ? COLORS.hudWarning :
        COLORS.hudText;
      ctx.fillText(value, 78, y);
    });

    ctx.restore();

    // ── Morse decode panel (bottom) ──────────────────────────────────────────
    const botH = 52;
    ctx.save();
    ctx.fillStyle = COLORS.hudBg;
    this.roundRect(0, height - botH, width, botH, 0);
    ctx.fill();

    const dictWord = p.patternMatch?.word ?? '—';
    const dictInfo = p.patternMatch
      ? `${DICT_LABELS[p.patternMatch.word]}  ${Math.round(p.patternMatch.score * 100)}%`
      : 'No dictionary match';

    ctx.textBaseline = 'top';
    ctx.font      = 'bold 15px "Courier New", monospace';
    ctx.fillStyle = COLORS.morseText;
    ctx.fillText(`DECODED › ${dictWord}`, 12, height - botH + 8);

    ctx.font      = '12px "Courier New", monospace';
    ctx.fillStyle = COLORS.morseCode;
    ctx.fillText(`DETAIL › ${dictInfo}`, 12, height - botH + 30);

    ctx.restore();
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
