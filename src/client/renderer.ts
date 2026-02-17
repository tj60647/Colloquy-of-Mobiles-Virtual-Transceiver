import type { LightReading } from '../shared/types.js';
import type { SensitivityZone } from './sensitivityZone.js';
import type { BackgroundModel  } from './background.js';
import type { RingBuffer       } from './ringBuffer.js';
import type { PatternDecoder   } from './patternDecoder.js';

export type ViewMode = 'live' | 'background';

export interface RenderParams {
  imageData:       ImageData;
  backgroundModel: BackgroundModel;
  viewMode:        ViewMode;
  zone:            SensitivityZone;
  ringBuffer:      RingBuffer<boolean>;
  lastReading:     LightReading | null;
  decoder:         PatternDecoder;
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
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx:    CanvasRenderingContext2D,
  ) {}

  render(p: RenderParams): void {
    const { ctx } = this;
    const { width, height } = this.canvas;

    // 1 ── Video or background frame ─────────────────────────────────────────
    if (p.viewMode === 'live') {
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

    const decoded = p.decoder.decoded.map((e) => e.letter).join('');

    ctx.textBaseline = 'top';
    ctx.font      = 'bold 15px "Courier New", monospace';
    ctx.fillStyle = COLORS.morseText;
    ctx.fillText(`DECODED › ${decoded}`, 12, height - botH + 8);

    ctx.font      = '12px "Courier New", monospace';
    ctx.fillStyle = COLORS.morseCode;
    ctx.fillText(`CURRENT › ${p.decoder.currentCode_}`, 12, height - botH + 30);

    ctx.restore();
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
