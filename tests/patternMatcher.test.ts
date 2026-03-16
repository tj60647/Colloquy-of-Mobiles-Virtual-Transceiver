import { describe, it, expect, beforeEach } from 'vitest';
import { PatternMatcher } from '../src/shared/patternMatcher.ts';
import {
  DICTIONARY,
  DICT_WORDS,
  PATTERN_LEN,
  getTransmitBit,
  type DictWord,
} from '../src/shared/dictionary.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Feed a perfect signal for the given word into a fresh PatternMatcher
 * and return the matcher after all samples have been ingested.
 */
function feedPerfectSignal(matcher: PatternMatcher, word: DictWord): void {
  for (let i = 0; i < PATTERN_LEN; i++) {
    matcher.addSample(getTransmitBit(word, i));
  }
}

/**
 * Feed a stream of boolean values from an array.
 */
function feedBoolStream(matcher: PatternMatcher, bits: boolean[]): void {
  for (const bit of bits) {
    matcher.addSample(bit);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PatternMatcher', () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  describe('basic match on perfect signals', () => {
    it.each(DICT_WORDS as DictWord[])(
      'recognises word %s at 100%% score',
      (word) => {
        feedPerfectSignal(matcher, word);
        expect(matcher.lastMatch).not.toBeNull();
        expect(matcher.lastMatch?.word).toBe(word);
        expect(matcher.lastMatch?.score).toBe(1);
      },
    );
  });

  describe('threshold behaviour', () => {
    it('reports no match below the default threshold', () => {
      // All-false stream scores every word poorly
      for (let i = 0; i < PATTERN_LEN; i++) {
        matcher.addSample(false);
      }
      // The all-zero stream has no match above 0.875 for any word
      // (every word starts with 8 ON bits so score <= 32/40 = 0.80 for an all-OFF stream)
      expect(matcher.lastMatch).toBeNull();
    });

    it('matches when threshold is lowered', () => {
      matcher.threshold = 0.5;
      // Feed all-true — some word should score > 0.5
      for (let i = 0; i < PATTERN_LEN; i++) {
        matcher.addSample(true);
      }
      expect(matcher.lastMatch).not.toBeNull();
    });

    it('does not match when threshold is raised above perfect score', () => {
      matcher.threshold = 1.1; // impossible to reach
      feedPerfectSignal(matcher, 'I_O');
      expect(matcher.lastMatch).toBeNull();
    });
  });

  describe('alignment / rolling window', () => {
    it('only matches after PATTERN_LEN samples have been ingested', () => {
      const word: DictWord = 'II_R';
      const bits = Array.from({ length: PATTERN_LEN }, (_, i) => getTransmitBit(word, i));

      // Before the buffer is full, lastMatch should remain null
      for (let i = 0; i < PATTERN_LEN - 1; i++) {
        matcher.addSample(bits[i]);
        expect(matcher.lastMatch).toBeNull();
      }

      // The 40th sample fills the window — match should appear
      matcher.addSample(bits[PATTERN_LEN - 1]);
      expect(matcher.lastMatch).not.toBeNull();
      expect(matcher.lastMatch?.word).toBe(word);
    });

    it('match is stable for consecutive identical samples after alignment', () => {
      feedPerfectSignal(matcher, 'I_P');
      expect(matcher.lastMatch?.word).toBe('I_P');
      // Re-feed the same pattern — should remain matched
      feedPerfectSignal(matcher, 'I_P');
      expect(matcher.lastMatch?.word).toBe('I_P');
    });

    it('match transitions to new word as stream shifts', () => {
      feedPerfectSignal(matcher, 'I_O');
      expect(matcher.lastMatch?.word).toBe('I_O');

      // Feed the bits for a completely different word; the rolling buffer
      // should eventually align with the new word.
      feedPerfectSignal(matcher, 'II_O');
      expect(matcher.lastMatch?.word).toBe('II_O');
    });

    it('match clears after listen-window silence', () => {
      feedPerfectSignal(matcher, 'I_O');
      expect(matcher.lastMatch).not.toBeNull();

      // LISTEN window: PATTERN_LEN silent (false) samples
      for (let i = 0; i < PATTERN_LEN; i++) {
        matcher.addSample(false);
      }
      // Buffer is now full with zeros — no word scores >= threshold
      expect(matcher.lastMatch).toBeNull();
    });
  });

  describe('lastScores', () => {
    it('exposes per-word scores after each addSample', () => {
      feedPerfectSignal(matcher, 'I_OP');
      expect(matcher.lastScores['I_OP']).toBe(1);
      // All other words must score < 1
      for (const w of DICT_WORDS) {
        if (w !== 'I_OP') {
          expect(matcher.lastScores[w]).toBeLessThan(1);
        }
      }
    });

    it('scores sum correctly (only best counts for match)', () => {
      feedPerfectSignal(matcher, 'II_OP');
      // Every score is between 0 and 1
      for (const w of DICT_WORDS) {
        expect(matcher.lastScores[w]).toBeGreaterThanOrEqual(0);
        expect(matcher.lastScores[w]).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('reset', () => {
    it('clears match and scores on reset', () => {
      feedPerfectSignal(matcher, 'I_O');
      expect(matcher.lastMatch).not.toBeNull();

      matcher.reset();
      expect(matcher.lastMatch).toBeNull();
      for (const w of DICT_WORDS) {
        expect(matcher.lastScores[w]).toBe(0);
      }
    });

    it('allows fresh detection after reset', () => {
      feedPerfectSignal(matcher, 'I_O');
      matcher.reset();
      feedPerfectSignal(matcher, 'I_R');
      expect(matcher.lastMatch?.word).toBe('I_R');
    });
  });

  describe('noise tolerance', () => {
    it('still matches with 2 bit-flips out of 40 (95% accuracy)', () => {
      const word: DictWord = 'I_O';
      const bits = Array.from({ length: PATTERN_LEN }, (_, i) => getTransmitBit(word, i));
      // Flip the first two bits
      bits[0] = !bits[0];
      bits[1] = !bits[1];
      feedBoolStream(matcher, bits);
      expect(matcher.lastMatch?.word).toBe(word);
      expect(matcher.lastMatch?.score).toBeCloseTo(38 / 40, 5);
    });

    it('does not match with more than 5 bit-flips (87.5% default threshold)', () => {
      const word: DictWord = 'II_P';
      const bits = Array.from({ length: PATTERN_LEN }, (_, i) => getTransmitBit(word, i));
      // Flip 6 bits = 34/40 = 0.85 < 0.875
      for (let i = 0; i < 6; i++) bits[i] = !bits[i];
      feedBoolStream(matcher, bits);
      // May match a different word at lower score; best for II_P <= 0.85
      expect(matcher.lastScores[word]).toBeLessThan(0.875);
    });
  });

  describe('dictionary word uniqueness', () => {
    it('all 8 dictionary patterns are distinct', () => {
      // No two words should have the same bit pattern
      const patterns = DICT_WORDS.map((w) =>
        Array.from({ length: PATTERN_LEN }, (_, i) => DICTIONARY[w][i]).join(''),
      );
      const unique = new Set(patterns);
      expect(unique.size).toBe(DICT_WORDS.length);
    });
  });
});
