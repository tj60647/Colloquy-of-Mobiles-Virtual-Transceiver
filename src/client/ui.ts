import type { ViewMode } from './renderer.js';
import type { ZoneConfig, FovConfig } from '../shared/types.js';

/**
 * All user-tunable application configuration in one flat object.
 * The main loop reads this every frame – no reactive subscription needed.
 */
export interface AppConfig {
  threshold:       number;   // detection delta threshold (0–255)
  viewMode:        ViewMode; // 'live' | 'background'
  backgroundAlpha: number;   // EMA learning rate (0–1)
  morseUnitMs:     number;   // Morse unit duration in ms
  zone: ZoneConfig;
  fov:  FovConfig;
}

/**
 * UI
 *
 * Wires HTML control elements to `config`.
 * Does NOT use any framework – just plain DOM event listeners.
 *
 * Control elements are looked up by id.  Missing elements are silently
 * ignored so the app still works with a partial HTML.
 */
export class UI {
  readonly config: AppConfig = {
    threshold:       30,
    viewMode:        'live',
    backgroundAlpha: 0.03,
    morseUnitMs:     100,
    zone: {
      radius:     50,
      amplitudeX: 0.30, // fraction of frame width
      amplitudeY: 0.20,
      freqX:      0.10, // Hz
      freqY:      0.07,
    },
    fov: {
      hFov: 60,
      vFov: 45,
    },
  };

  /** Called when the user clicks "Reset Background" */
  onResetBackground?: () => void;
  /** Called when the user clicks "Reset Decoder" */
  onResetDecoder?: () => void;

  constructor() {
    this.bind();
  }

  private bind(): void {
    // ── Detection ────────────────────────────────────────────────────────────
    this.slider('threshold',   0, 255, 1,     this.config.threshold,
      v => { this.config.threshold = v; });

    // ── View toggle ──────────────────────────────────────────────────────────
    this.toggle('view-mode-bg', v => {
      this.config.viewMode = v ? 'background' : 'live';
    });

    // ── Background model ─────────────────────────────────────────────────────
    this.slider('bg-alpha', 0.001, 0.20, 0.001, this.config.backgroundAlpha,
      v => { this.config.backgroundAlpha = v; });

    // ── Zone ─────────────────────────────────────────────────────────────────
    this.slider('zone-radius', 10, 200, 1, this.config.zone.radius,
      v => { this.config.zone.radius = v; });

    this.slider('amp-x', 0, 0.50, 0.01, this.config.zone.amplitudeX,
      v => { this.config.zone.amplitudeX = v; });

    this.slider('amp-y', 0, 0.50, 0.01, this.config.zone.amplitudeY,
      v => { this.config.zone.amplitudeY = v; });

    this.slider('freq-x', 0.01, 2.0, 0.01, this.config.zone.freqX,
      v => { this.config.zone.freqX = v; });

    this.slider('freq-y', 0.01, 2.0, 0.01, this.config.zone.freqY,
      v => { this.config.zone.freqY = v; });

    // ── FOV ──────────────────────────────────────────────────────────────────
    this.slider('h-fov', 20, 180, 1, this.config.fov.hFov,
      v => { this.config.fov.hFov = v; });

    this.slider('v-fov', 10, 120, 1, this.config.fov.vFov,
      v => { this.config.fov.vFov = v; });

    // ── Morse ────────────────────────────────────────────────────────────────
    this.slider('morse-unit', 30, 600, 10, this.config.morseUnitMs,
      v => { this.config.morseUnitMs = v; });

    // ── Buttons ──────────────────────────────────────────────────────────────
    document.getElementById('btn-reset-bg')?.addEventListener('click', () => {
      this.onResetBackground?.();
    });

    document.getElementById('btn-reset-decode')?.addEventListener('click', () => {
      this.onResetDecoder?.();
    });
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  private slider(
    id:      string,
    min:     number,
    max:     number,
    step:    number,
    initial: number,
    set:     (v: number) => void,
  ): void {
    const el    = document.getElementById(id) as HTMLInputElement | null;
    const label = document.getElementById(`${id}-val`);
    if (!el) return;

    el.min   = String(min);
    el.max   = String(max);
    el.step  = String(step);
    el.value = String(initial);
    if (label) label.textContent = String(initial);

    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      set(v);
      if (label) label.textContent = el.value;
    });
  }

  private toggle(id: string, set: (checked: boolean) => void): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('change', () => set(el.checked));
  }

  /** Update a label element that shows the current value of a slider */
  updateLabel(id: string, value: string): void {
    const el = document.getElementById(`${id}-val`);
    if (el) el.textContent = value;
  }
}
