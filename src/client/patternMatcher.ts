/**
 * PatternMatcher
 *
 * Scans the rolling stream of boolean detections for the 8-word dictionary
 * patterns defined in src/shared/dictionary.ts.
 *
 * Strategy: maintain a circular buffer of the last (PATTERN_LEN * 2) samples
 * so that every possible alignment of a 40-segment pattern is covered.
 * On each sample, the best-scoring word across all 40 alignments is returned
 * when its score meets the threshold.
 */

import { DICT_WORDS, TX_CYCLE_LEN, getTransmitBit, type DictWord } from '../shared/dictionary.js';

export interface MatchResult {
  word:      DictWord;
  /** Fraction of segments that match the pattern (0–1). */
  score:     number;
  /** Short human-readable description. */
  label:     string;
}

/** Minimum match fraction required to report a hit. */
const THRESHOLD = 0.875;

const BUF_LEN = TX_CYCLE_LEN * 2;

export class PatternMatcher {
  private buf: Uint8Array = new Uint8Array(BUF_LEN);
  private head = 0;  // next write position (oldest slot)
  private count = 0; // samples ingested so far (caps at BUF_LEN)

  lastMatch: MatchResult | null = null;
  lastScores: Record<DictWord, number> = {
    I_O: 0,
    I_P: 0,
    I_OP: 0,
    II_O: 0,
    II_P: 0,
    II_OP: 0,
    I_R: 0,
    II_R: 0,
  };

  addSample(detected: boolean): void {
    this.buf[this.head] = detected ? 1 : 0;
    this.head = (this.head + 1) % BUF_LEN;
    if (this.count < BUF_LEN) this.count++;

    if (this.count >= TX_CYCLE_LEN) {
      this.lastMatch = this.scoreCurrentWindow();
    }
  }

  /**
   * Try every possible alignment of each dictionary word against the
   * most recent (BUF_LEN) samples and return the best match.
   */
  private scoreCurrentWindow(): MatchResult | null {
    let bestScore = 0;
    let bestWord: DictWord | null = null;
    const windowStart = (this.head - TX_CYCLE_LEN + BUF_LEN * 2) % BUF_LEN;

    for (const word of DICT_WORDS) {
      let matches = 0;
      for (let i = 0; i < TX_CYCLE_LEN; i++) {
        const bufIdx = (windowStart + i) % BUF_LEN;
        const expected = getTransmitBit(word, i) ? 1 : 0;
        if (this.buf[bufIdx] === expected) matches++;
      }
      const score = matches / TX_CYCLE_LEN;
      this.lastScores[word] = score;

      if (score > bestScore) {
        bestScore = score;
        bestWord = word;
      }
    }

    if (bestScore >= THRESHOLD && bestWord !== null) {
      return { word: bestWord, score: bestScore, label: bestWord.replace('_', ' – drive ') };
    }
    return null;
  }

  reset(): void {
    this.buf.fill(0);
    this.head      = 0;
    this.count     = 0;
    this.lastMatch = null;
    for (const word of DICT_WORDS) {
      this.lastScores[word] = 0;
    }
  }
}
