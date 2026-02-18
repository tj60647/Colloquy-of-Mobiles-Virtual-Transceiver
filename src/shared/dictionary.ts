/**
 * Communication Signal Dictionary
 *
 * Fixed 40-segment patterns used by male and female units.
 * Each segment corresponds to one system sample (25 ms at 40 Hz).
 *   1 = signal ON  (light flash for male; audio tone for female)
 *   0 = signal OFF
 *
 * Word structure:
 *   I_O / I_P / I_OP   – Male ID I  with drive O, P, or O-or-P
 *   II_O / II_P / II_OP – Male ID II with drive O, P, or O-or-P
 *   I_R / II_R          – Reinforcement signal from Male I or II
 */

/** Duration of one segment in milliseconds (matches the 40 Hz sensor rate). */
export const SEGMENT_MS = 25;

/** Total length of every pattern in segments. */
export const PATTERN_LEN = 40;

/** Listening window length in segments (equal to transmit word duration). */
export const LISTEN_LEN = PATTERN_LEN;

/** Full transmit cycle length: TX word + LISTEN window. */
export const TX_CYCLE_LEN = PATTERN_LEN + LISTEN_LEN;

export type DictWord = 'I_O' | 'I_P' | 'I_OP' | 'II_O' | 'II_P' | 'II_OP' | 'I_R' | 'II_R';

export const DICTIONARY: Readonly<Record<DictWord, readonly number[]>> = {
  I_O:  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1],
  I_P:  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0],
  I_OP: [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1],
  II_O: [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0],
  II_P: [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1],
  II_OP:[1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0,1,1,1,1,0,0,0,0],
  I_R:  [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1],
  II_R: [1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0],
};

export const DICT_WORDS = Object.keys(DICTIONARY) as DictWord[];

/** Audio-tone frequencies used by the transmitter sound mode. */
export const AUDIO_TONE_FREQS = [1760, 1976, 2093, 2349, 2637] as const;

/** Default bandpass centre based on transmitter tone set. */
export const AUDIO_BANDPASS_DEFAULT_CENTER =
  Math.round((AUDIO_TONE_FREQS[0] + AUDIO_TONE_FREQS[AUDIO_TONE_FREQS.length - 1]) / 2);

/** Default bandpass quality factor for audio detection mode. */
export const AUDIO_BANDPASS_DEFAULT_Q = 1.5;

/** Human-readable label for each word. */
export const DICT_LABELS: Readonly<Record<DictWord, string>> = {
  I_O:   'Male I – drive O',
  I_P:   'Male I – drive P',
  I_OP:  'Male I – drive O or P',
  II_O:  'Male II – drive O',
  II_P:  'Male II – drive P',
  II_OP: 'Male II – drive O or P',
  I_R:   'Male I – reinforcement',
  II_R:  'Male II – reinforcement',
};

/**
 * Returns whether the transmitter output should be ON for a cycle segment.
 * Segment index is interpreted over the full TX/LISTEN cycle.
 */
export function getTransmitBit(word: DictWord, segmentIndex: number, invert = false): boolean {
  const idx = ((segmentIndex % TX_CYCLE_LEN) + TX_CYCLE_LEN) % TX_CYCLE_LEN;
  if (idx >= PATTERN_LEN) return false;

  const bitOn = DICTIONARY[word][idx] === 1;
  return invert ? !bitOn : bitOn;
}
