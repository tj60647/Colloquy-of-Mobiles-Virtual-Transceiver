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
