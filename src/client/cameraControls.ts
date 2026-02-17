/**
 * CameraControls
 *
 * Reads MediaStreamTrack.getCapabilities() after the camera is live and
 * dynamically builds a control panel:
 *
 *   Range caps   → labelled <input type="range"> sliders
 *   Enum caps    → <select> dropdowns
 *   Boolean caps → pill toggle switches  (e.g. torch)
 *
 * Any change is debounced (80 ms) then forwarded to
 * MediaStreamTrack.applyConstraints() so the stream stays live.
 *
 * Properties by category
 * ──────────────────────
 * Resolution/rate  width, height, frameRate, aspectRatio  (info only – changing
 *                  resolution requires getUserMedia restart)
 * Image            brightness, contrast, saturation, sharpness
 * Exposure         exposureMode, exposureTime (µs), exposureCompensation (EV),
 *                  iso
 * White balance    whiteBalanceMode, colorTemperature (K)
 * Focus            focusMode, focusDistance (0–1 normalised)
 * Zoom             zoom
 * PTZ              pan, tilt  (arc-seconds)
 * Misc             torch (boolean), facingMode (enum)
 *
 * Browser support
 * ──────────────
 * Chrome / Edge   Full support including image, exposure, WB, focus, zoom, PTZ
 * Firefox         getCapabilities() returns only basic geometry – no imaging
 * Safari          Partial: facingMode, frameRate; no imaging controls
 */

import type { CameraManager, ExtendedMediaTrackCapabilities,
              ExtendedMediaTrackSettings, MediaSettingsRange } from './camera.js';

// ── Metadata tables ───────────────────────────────────────────────────────────

interface RangeMeta { key: string; label: string; unit: string; fmt: 'int' | 'f1' | 'f2' }
interface EnumMeta  { key: string; label: string }

const RANGE_PARAMS: RangeMeta[] = [
  // These are the most impactful for light detection – keep them first
  { key: 'exposureTime',         label: 'Exposure',      unit: 'µs',    fmt: 'int' },
  { key: 'iso',                  label: 'ISO',           unit: '',      fmt: 'int' },
  { key: 'exposureCompensation', label: 'EV comp',       unit: 'EV',    fmt: 'f1'  },
  { key: 'frameRate',            label: 'Frame rate',    unit: 'fps',   fmt: 'f1'  },
  { key: 'zoom',                 label: 'Zoom',          unit: '×',     fmt: 'f2'  },
  { key: 'brightness',           label: 'Brightness',    unit: '',      fmt: 'int' },
  { key: 'contrast',             label: 'Contrast',      unit: '',      fmt: 'int' },
  { key: 'saturation',           label: 'Saturation',    unit: '',      fmt: 'int' },
  { key: 'sharpness',            label: 'Sharpness',     unit: '',      fmt: 'int' },
  { key: 'colorTemperature',     label: 'Color temp',    unit: 'K',     fmt: 'int' },
  { key: 'focusDistance',        label: 'Focus dist',    unit: '',      fmt: 'f2'  },
  { key: 'pan',                  label: 'Pan',           unit: '″',     fmt: 'int' },
  { key: 'tilt',                 label: 'Tilt',          unit: '″',     fmt: 'int' },
];

const ENUM_PARAMS: EnumMeta[] = [
  { key: 'exposureMode',     label: 'Exposure mode'   },
  { key: 'whiteBalanceMode', label: 'White balance'   },
  { key: 'focusMode',        label: 'Focus mode'      },
  { key: 'facingMode',       label: 'Camera facing'   },
];

// ── Internal param descriptors ────────────────────────────────────────────────

type ParamKind = 'range' | 'enum' | 'bool';

interface RangeParam { kind: 'range'; meta: RangeMeta; cap: MediaSettingsRange }
interface EnumParam  { kind: 'enum';  meta: EnumMeta;  options: string[] }
interface BoolParam  { kind: 'bool';  key: string; label: string }

type Param = RangeParam | EnumParam | BoolParam;

// ── CameraControls ────────────────────────────────────────────────────────────

export class CameraControls {
  private params: Param[] = [];
  private pending: Record<string, unknown> = {};
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly camera:    CameraManager,
  ) {}

  /**
   * Inspect the live track's capabilities and rebuild the control panel.
   * Safe to call multiple times (e.g. after switching cameras).
   */
  build(): void {
    this.container.innerHTML = '';
    this.params = [];

    const caps = this.camera.getCapabilities();
    const settings = this.camera.getSettings();

    // ── Always-available info row ───────────────────────────────────────────
    this.appendInfo(this.buildInfoLine(settings));

    if (!caps) {
      this.appendNote(
        'getCapabilities() is not available in this browser.\n' +
        'Chrome/Edge required for camera tuning controls.',
      );
      return;
    }

    // ── Range sliders ───────────────────────────────────────────────────────
    let built = 0;
    for (const meta of RANGE_PARAMS) {
      const raw = (caps as Record<string, unknown>)[meta.key];
      if (!isRange(raw)) continue;

      const current = (settings as Record<string, unknown>)[meta.key];
      const p: RangeParam = { kind: 'range', meta, cap: raw };
      this.params.push(p);
      this.appendRange(p, typeof current === 'number' ? current : undefined);
      built++;
    }

    // ── Enum selects ────────────────────────────────────────────────────────
    for (const meta of ENUM_PARAMS) {
      const raw = (caps as Record<string, unknown>)[meta.key];
      if (!isStringArray(raw) || raw.length < 2) continue; // skip single-value enums

      const current = (settings as Record<string, unknown>)[meta.key];
      const p: EnumParam = { kind: 'enum', meta, options: raw };
      this.params.push(p);
      this.appendEnum(p, typeof current === 'string' ? current : undefined);
      built++;
    }

    // ── Torch toggle ────────────────────────────────────────────────────────
    if (Array.isArray(caps.torch) && caps.torch.includes(true)) {
      const p: BoolParam = { kind: 'bool', key: 'torch', label: 'Torch / flash' };
      this.params.push(p);
      this.appendBool(p, (settings as ExtendedMediaTrackSettings).torch ?? false);
      built++;
    }

    if (built === 0) {
      this.appendNote(
        'This camera reports no tunable properties.\n' +
        'Try Chrome with a USB webcam for full control.',
      );
    }
  }

  /**
   * Return a short string describing current camera state for the HUD.
   * e.g. "640×480 30fps  exp:manual  ISO:400"
   */
  getSummaryLine(): string {
    return this.buildInfoLine(this.camera.getSettings());
  }

  // ── DOM builders ───────────────────────────────────────────────────────────

  private buildInfoLine(s: ExtendedMediaTrackSettings): string {
    const parts: string[] = [];
    if (s.width && s.height) parts.push(`${s.width}×${s.height}`);
    if (s.frameRate)          parts.push(`${s.frameRate.toFixed(0)} fps`);
    if (s.exposureMode)       parts.push(`exp:${s.exposureMode}`);
    if (s.iso)                parts.push(`ISO ${s.iso}`);
    if (s.whiteBalanceMode)   parts.push(`wb:${s.whiteBalanceMode}`);
    if (!parts.length)        parts.push(this.camera.deviceLabel);
    return parts.join('  ');
  }

  private appendInfo(text: string): void {
    const el = document.createElement('div');
    el.className = 'cam-info-line';
    el.textContent = text;
    this.container.appendChild(el);
  }

  private appendNote(text: string): void {
    const el = document.createElement('p');
    el.className = 'cam-note';
    el.textContent = text;
    this.container.appendChild(el);
  }

  private appendRange(p: RangeParam, current?: number): void {
    const { meta, cap } = p;
    const step    = cap.step ?? bestStep(cap.min, cap.max);
    const initial = current ?? cap.min;

    const row = document.createElement('div');
    row.className = 'ctrl-row';

    const lbl = document.createElement('label');
    lbl.textContent = meta.label;

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = String(cap.min);
    input.max   = String(cap.max);
    input.step  = String(step);
    input.value = String(clamp(initial, cap.min, cap.max));

    const valSpan = document.createElement('span');
    valSpan.className = 'ctrl-val';
    valSpan.textContent = fmt(initial, meta.fmt) + (meta.unit ? ` ${meta.unit}` : '');

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valSpan.textContent = fmt(v, meta.fmt) + (meta.unit ? ` ${meta.unit}` : '');
      this.schedule(meta.key, v);
    });

    row.append(lbl, input, valSpan);
    this.container.appendChild(row);
  }

  private appendEnum(p: EnumParam, current?: string): void {
    const row = document.createElement('div');
    row.className = 'ctrl-row';

    const lbl = document.createElement('label');
    lbl.textContent = p.meta.label;

    const sel = document.createElement('select');
    sel.className = 'cam-select';

    for (const opt of p.options) {
      const o = document.createElement('option');
      o.value = o.textContent = opt;
      if (opt === current) o.selected = true;
      sel.appendChild(o);
    }

    sel.addEventListener('change', () => this.schedule(p.meta.key, sel.value));

    row.append(lbl, sel);
    this.container.appendChild(row);
  }

  private appendBool(p: BoolParam, current: boolean): void {
    const row = document.createElement('div');
    row.className = 'toggle-row';

    const lbl = document.createElement('span');
    lbl.className = 'toggle-label';
    lbl.textContent = p.label;

    const sw = document.createElement('label');
    sw.className = 'switch';

    const inp = document.createElement('input');
    inp.type    = 'checkbox';
    inp.checked = current;

    const pill = document.createElement('span');
    pill.className = 'slider-pill';

    inp.addEventListener('change', () => this.schedule(p.key, inp.checked));

    sw.append(inp, pill);
    row.append(lbl, sw);
    this.container.appendChild(row);
  }

  // ── Debounced constraint application ────────────────────────────────────────

  /**
   * Queue a constraint change.  A short debounce prevents flooding
   * applyConstraints() while the user drags a slider.
   */
  private schedule(key: string, value: unknown): void {
    this.pending[key] = value;
    if (this.debounce !== null) clearTimeout(this.debounce);

    this.debounce = setTimeout(() => {
      this.debounce = null;
      const batch = { ...this.pending };
      this.pending = {};

      this.camera.applyConstraints(batch).catch((err: unknown) => {
        console.warn('[camera] applyConstraints rejected:', err,
          '\nConstraints sent:', batch);
      });
    }, 80);
  }
}

// ── Type guards ───────────────────────────────────────────────────────────────

function isRange(v: unknown): v is MediaSettingsRange {
  return (
    typeof v === 'object' && v !== null &&
    'min' in v && 'max' in v &&
    typeof (v as MediaSettingsRange).min === 'number' &&
    typeof (v as MediaSettingsRange).max === 'number' &&
    (v as MediaSettingsRange).max > (v as MediaSettingsRange).min
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && typeof v[0] === 'string';
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt(n: number, style: RangeMeta['fmt']): string {
  switch (style) {
    case 'int': return String(Math.round(n));
    case 'f1':  return n.toFixed(1);
    case 'f2':  return n.toFixed(2);
  }
}

function bestStep(min: number, max: number): number {
  const range = max - min;
  if (range <= 2)    return 0.01;
  if (range <= 20)   return 0.1;
  if (range <= 200)  return 1;
  if (range <= 2000) return 10;
  return 100;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
