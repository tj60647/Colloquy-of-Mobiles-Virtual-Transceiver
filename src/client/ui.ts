import type { ViewMode } from './renderer.js';
import type { ZoneConfig, FovConfig, MotionUnit } from '../shared/types.js';
import { AUDIO_BANDPASS_DEFAULT_CENTER, AUDIO_BANDPASS_DEFAULT_Q } from '../shared/dictionary.js';

/**
 * All user-tunable application configuration in one flat object.
 * The main loop reads this every frame – no reactive subscription needed.
 */
export interface AppConfig {
  detectorMode:    'light' | 'audio';
  sampleRateHz:    20 | 40;
  threshold:       number;   // detection delta threshold (0–255)
  audioThreshold:  number;   // audio delta threshold (0–255)
  audioBandpassCenter: number; // audio detector bandpass center frequency (Hz)
  audioBandpassQ:      number; // audio detector bandpass Q
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
    detectorMode:    'light',
    sampleRateHz:    40,
    threshold:       30,
    audioThreshold:  20,
    audioBandpassCenter: AUDIO_BANDPASS_DEFAULT_CENTER,
    audioBandpassQ:      AUDIO_BANDPASS_DEFAULT_Q,
    viewMode:        'live',
    backgroundAlpha: 0.03,
    morseUnitMs:     100,
    zone: {
      radius: 50,
      unit:   'deg',
      axisX: { rangeMin: -22, rangeMax: 22, maxVelocity: 25, maxAcceleration: 40 },
      axisY: { rangeMin: -14, rangeMax: 14, maxVelocity: 18, maxAcceleration: 30 },
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
    this.select('detector-mode', v => {
      this.config.detectorMode = v === 'audio' ? 'audio' : 'light';
    });

    this.select('sample-rate', v => {
      this.config.sampleRateHz = v === '20' ? 20 : 40;
    });

    this.slider('threshold',   0, 255, 1,     this.config.threshold,
      v => { this.config.threshold = v; });

    this.slider('audio-threshold',   0, 255, 1, this.config.audioThreshold,
      v => { this.config.audioThreshold = v; });

    this.slider('audio-bp-center', 500, 6000, 10, this.config.audioBandpassCenter,
      v => { this.config.audioBandpassCenter = v; });

    this.slider('audio-bp-q', 0.2, 20, 0.1, this.config.audioBandpassQ,
      v => { this.config.audioBandpassQ = v; });

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

    // Motion unit toggle (deg / rad)
    this.unitToggle('motion-unit-rad', u => { this.config.zone.unit = u; });

    // ── X axis motion profile ────────────────────────────────────────────────
    this.slider('x-range-min', -90, 0, 0.5, this.config.zone.axisX.rangeMin,
      v => { this.config.zone.axisX.rangeMin = v; });
    this.slider('x-range-max', 0, 90, 0.5, this.config.zone.axisX.rangeMax,
      v => { this.config.zone.axisX.rangeMax = v; });
    this.slider('x-max-vel', 0.5, 180, 0.5, this.config.zone.axisX.maxVelocity,
      v => { this.config.zone.axisX.maxVelocity = v; });
    this.slider('x-max-acc', 1, 360, 1, this.config.zone.axisX.maxAcceleration,
      v => { this.config.zone.axisX.maxAcceleration = v; });

    // ── Y axis motion profile ────────────────────────────────────────────────
    this.slider('y-range-min', -90, 0, 0.5, this.config.zone.axisY.rangeMin,
      v => { this.config.zone.axisY.rangeMin = v; });
    this.slider('y-range-max', 0, 90, 0.5, this.config.zone.axisY.rangeMax,
      v => { this.config.zone.axisY.rangeMax = v; });
    this.slider('y-max-vel', 0.5, 180, 0.5, this.config.zone.axisY.maxVelocity,
      v => { this.config.zone.axisY.maxVelocity = v; });
    this.slider('y-max-acc', 1, 360, 1, this.config.zone.axisY.maxAcceleration,
      v => { this.config.zone.axisY.maxAcceleration = v; });

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
    let label = document.getElementById(`${id}-val`);
    if (!el) return;

    if (!label) {
      const row = el.closest('.ctrl-row');
      if (row) {
        const fallback = document.createElement('span');
        fallback.id = `${id}-val`;
        fallback.className = 'ctrl-val';
        row.appendChild(fallback);
        label = fallback;
      }
    }

    el.min   = String(min);
    el.max   = String(max);
    el.step  = String(step);
    el.value = String(initial);
    if (label) label.textContent = this.formatSliderValue(initial, step);

    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      set(v);
      if (label) label.textContent = this.formatSliderValue(v, step);
    });
  }

  private formatSliderValue(value: number, step: number): string {
    if (step >= 1) return String(Math.round(value));
    if (step >= 0.1) return value.toFixed(1);
    if (step >= 0.01) return value.toFixed(2);
    return value.toFixed(3);
  }

  private toggle(id: string, set: (checked: boolean) => void): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('change', () => set(el.checked));
  }

  private select(id: string, set: (value: string) => void): void {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (!el) return;
    el.addEventListener('change', () => set(el.value));
  }

  /**
   * Bind the motion-unit radio/toggle: unchecked = 'deg', checked = 'rad'.
   * When the unit changes the slider labels and range limits are NOT rescaled
   * automatically – the user must re-enter values in the new unit.
   */
  private unitToggle(id: string, set: (unit: MotionUnit) => void): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('change', () => set(el.checked ? 'rad' : 'deg'));
  }

  /** Update a label element that shows the current value of a slider */
  updateLabel(id: string, value: string): void {
    const el = document.getElementById(`${id}-val`);
    if (el) el.textContent = value;
  }
}
