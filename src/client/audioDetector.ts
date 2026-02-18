import {
  AUDIO_BANDPASS_DEFAULT_CENTER,
  AUDIO_BANDPASS_DEFAULT_Q,
  AUDIO_TONE_FREQS,
} from '../shared/dictionary.js';

export interface AudioReading {
  detected: boolean;
  level: number;
  baseline: number;
  delta: number;
}

export class AudioDetector {
  private readonly toneFreqsHz = AUDIO_TONE_FREQS;

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private bandpass: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array = new Uint8Array(0);
  private toneBins: number[] = [];
  private baseline = 0;
  private initialized = false;
  private bandpassCenterHz = AUDIO_BANDPASS_DEFAULT_CENTER;
  private bandpassQ = AUDIO_BANDPASS_DEFAULT_Q;

  constructor(centerHz = AUDIO_BANDPASS_DEFAULT_CENTER, q = AUDIO_BANDPASS_DEFAULT_Q) {
    this.bandpassCenterHz = centerHz;
    this.bandpassQ = q;
  }

  setBandpass(centerHz: number, q: number): void {
    this.bandpassCenterHz = centerHz;
    this.bandpassQ = q;
    if (this.bandpass) {
      this.bandpass.frequency.value = centerHz;
      this.bandpass.Q.value = q;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('Microphone APIs are not available in this browser.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });

    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(this.stream);

    this.bandpass = this.audioCtx.createBiquadFilter();
    this.bandpass.type = 'bandpass';
    this.bandpass.frequency.value = this.bandpassCenterHz;
    this.bandpass.Q.value = this.bandpassQ;

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.12;

    source.connect(this.bandpass);
    this.bandpass.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    const binHz = this.audioCtx.sampleRate / this.analyser.fftSize;
    this.toneBins = this.toneFreqsHz
      .map((f) => Math.round(f / binHz))
      .filter((idx) => idx > 1 && idx < this.analyser!.frequencyBinCount - 2);

    this.baseline = 0;
    this.initialized = true;
  }

  detect(threshold: number): AudioReading {
    if (!this.initialized || !this.analyser) {
      return { detected: false, level: 0, baseline: 0, delta: 0 };
    }

    this.analyser.getByteFrequencyData(this.freqData);

    let sumBand = 0;
    let usedBins = 0;

    for (const bin of this.toneBins) {
      const v0 = this.freqData[bin - 1] ?? 0;
      const v1 = this.freqData[bin] ?? 0;
      const v2 = this.freqData[bin + 1] ?? 0;
      const peak = Math.max(v0, v1, v2);
      sumBand += peak;
      usedBins++;
    }

    const level = usedBins > 0 ? Math.round(sumBand / usedBins) : 0;

    if (this.baseline === 0) this.baseline = level;

    const delta = Math.max(0, Math.round(level - this.baseline));
    const detected = delta > threshold;

    // Keep baseline stable during detections to avoid collapsing into
    // leading-edge-only behavior on sustained tones.
    const alpha = detected ? 0.002 : 0.02;
    this.baseline = alpha * level + (1 - alpha) * this.baseline;


    return {
      detected,
      level,
      baseline: Math.round(this.baseline),
      delta,
    };
  }

  getSpectrumSnapshot(binCount = 128, maxHz = 3000): Uint8Array {
    if (!this.initialized || this.freqData.length === 0 || binCount <= 0) {
      return new Uint8Array(0);
    }

    const out = new Uint8Array(binCount);
    const sampleRate = this.audioCtx?.sampleRate ?? 48_000;
    const fftSize = this.analyser?.fftSize ?? 2048;
    const nyquist = sampleRate / 2;
    const clampedMaxHz = Math.max(1, Math.min(maxHz, nyquist));
    const maxBin = Math.max(1, Math.floor((clampedMaxHz / nyquist) * this.freqData.length));

    const srcLen = maxBin;
    const scale = srcLen / binCount;

    for (let i = 0; i < binCount; i++) {
      const start = Math.floor(i * scale);
      const end = Math.max(start + 1, Math.floor((i + 1) * scale));
      let sum = 0;
      let count = 0;

      for (let j = start; j < end && j < srcLen; j++) {
        sum += this.freqData[j];
        count++;
      }

      out[i] = count > 0 ? Math.round(sum / count) : 0;
    }

    return out;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    if (this.audioCtx) {
      await this.audioCtx.close();
      this.audioCtx = null;
    }

    this.analyser = null;
    this.bandpass = null;
    this.freqData = new Uint8Array(0);
    this.toneBins = [];
    this.baseline = 0;
    this.initialized = false;
  }
}
