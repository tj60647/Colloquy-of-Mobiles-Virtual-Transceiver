/**
 * Deterministic replay harness
 *
 * Feeds known bit streams into the pattern-matching pipeline and asserts
 * that each dictionary word is correctly decoded.  Also sweeps noise levels
 * to characterise the detection margin for each word.
 */

import { describe, it, expect } from 'vitest';
import { PatternMatcher } from '../src/shared/patternMatcher.ts';
import { MatcherInputAdapter } from '../src/shared/matcherInputAdapter.ts';
import { FixedThresholdStrategy } from '../src/shared/samplePipeline.ts';
import {
  DICT_WORDS,
  PATTERN_LEN,
  getTransmitBit,
  type DictWord,
} from '../src/shared/dictionary.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Generate the perfect boolean bit stream for one word. */
function perfectBits(word: DictWord): boolean[] {
  return Array.from({ length: PATTERN_LEN }, (_, i) => getTransmitBit(word, i));
}

/** Generate the perfect scalar signal for one word (255 = ON, 0 = OFF). */
function perfectSignal(word: DictWord): number[] {
  return perfectBits(word).map((b) => (b ? 255 : 0));
}

/**
 * Corrupt a boolean bit stream by flipping exactly `flips` bits
 * at positions 0, 1, … flips-1 (deterministic, not random).
 */
function flipBits(bits: boolean[], flips: number): boolean[] {
  const out = [...bits];
  for (let i = 0; i < flips && i < out.length; i++) {
    out[i] = !out[i];
  }
  return out;
}

/** Feed a boolean stream directly into a fresh PatternMatcher. */
function feedBitsToMatcher(bits: boolean[]): PatternMatcher {
  const m = new PatternMatcher();
  for (const b of bits) m.addSample(b);
  return m;
}

/** Feed a scalar stream through MatcherInputAdapter (fixed threshold). */
function feedScalarToAdapter(signal: number[], threshold = 128): ReturnType<MatcherInputAdapter['process']> | null {
  const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(threshold));
  let lastTick: ReturnType<MatcherInputAdapter['process']> | null = null;
  for (const s of signal) lastTick = adapter.process(s);
  return lastTick;
}

// ── Deterministic word detection ─────────────────────────────────────────────

describe('Deterministic replay — perfect signals', () => {
  it.each(DICT_WORDS as DictWord[])(
    'PatternMatcher: perfect bit stream for %s yields 100%% score',
    (word) => {
      const matcher = feedBitsToMatcher(perfectBits(word));
      expect(matcher.lastMatch).not.toBeNull();
      expect(matcher.lastMatch?.word).toBe(word);
      expect(matcher.lastMatch?.score).toBe(1);
    },
  );

  it.each(DICT_WORDS as DictWord[])(
    'MatcherInputAdapter (scalar): perfect signal for %s decodes correctly',
    (word) => {
      const tick = feedScalarToAdapter(perfectSignal(word));
      expect(tick?.match?.word).toBe(word);
      expect(tick?.match?.score).toBe(1);
    },
  );
});

// ── Noise margin sweep ────────────────────────────────────────────────────────

describe('Deterministic replay — noise margin sweep (deterministic bit flips)', () => {
  /**
   * Maximum bit-flip tolerance for the default threshold (0.875):
   *   0.875 * 40 = 35 matches → at most 5 bit flips allowed.
   */
  const MAX_FLIPS_PASSING = 5;
  const MIN_FLIPS_FAILING = 6;

  it.each(DICT_WORDS as DictWord[])(
    '%s: still matches with %i bit-flips (score ≥ 0.875)',
    (word) => {
      const bits = flipBits(perfectBits(word), MAX_FLIPS_PASSING);
      const matcher = feedBitsToMatcher(bits);
      expect(matcher.lastMatch?.word).toBe(word);
      expect(matcher.lastMatch?.score).toBeGreaterThanOrEqual(0.875);
    },
  );

  it.each(DICT_WORDS as DictWord[])(
    '%s: does NOT match as itself with %i bit-flips at positions 0–5',
    (word) => {
      const bits = flipBits(perfectBits(word), MIN_FLIPS_FAILING);
      const matcher = feedBitsToMatcher(bits);
      // The specific word's score for these deterministic flips at positions 0-5
      expect(matcher.lastScores[word]).toBeLessThan(0.875);
    },
  );
});

// ── Alignment replay ──────────────────────────────────────────────────────────

describe('Deterministic replay — alignment properties', () => {
  it('match appears exactly at PATTERN_LEN samples', () => {
    const word: DictWord = 'II_R';
    const bits = perfectBits(word);
    const matcher = new PatternMatcher();

    for (let i = 0; i < PATTERN_LEN - 1; i++) {
      matcher.addSample(bits[i]);
      expect(matcher.lastMatch).toBeNull();
    }
    matcher.addSample(bits[PATTERN_LEN - 1]);
    expect(matcher.lastMatch).not.toBeNull();
    expect(matcher.lastMatch?.word).toBe(word);
  });

  it('feeds two sequential words and decodes each in its own window', () => {
    const first: DictWord = 'I_O';
    const second: DictWord = 'II_OP';

    // Feed first word — should match
    const m1 = feedBitsToMatcher(perfectBits(first));
    expect(m1.lastMatch?.word).toBe(first);

    // Continue feeding the second word into the same matcher
    for (const b of perfectBits(second)) m1.addSample(b);
    expect(m1.lastMatch?.word).toBe(second);
  });

  it('silence (all-false) after a word clears the match', () => {
    const word: DictWord = 'I_R';
    const matcher = feedBitsToMatcher(perfectBits(word));
    expect(matcher.lastMatch).not.toBeNull();

    for (let i = 0; i < PATTERN_LEN; i++) matcher.addSample(false);
    expect(matcher.lastMatch).toBeNull();
  });
});

// ── Score consistency ─────────────────────────────────────────────────────────

describe('Deterministic replay — score consistency', () => {
  it('all 8 words produce distinct perfect scores of 1.0', () => {
    for (const word of DICT_WORDS) {
      const m = feedBitsToMatcher(perfectBits(word as DictWord));
      expect(m.lastScores[word as DictWord]).toBe(1);
    }
  });

  it('inverted signal for any word scores near 0 for that word', () => {
    const word: DictWord = 'I_P';
    const inverted = perfectBits(word).map((b) => !b);
    const matcher = feedBitsToMatcher(inverted);
    expect(matcher.lastScores[word]).toBeLessThan(0.25);
  });
});
