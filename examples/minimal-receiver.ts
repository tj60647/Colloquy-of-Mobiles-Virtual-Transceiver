/**
 * examples/minimal-receiver.ts
 *
 * Demonstrates the minimal Node.js virtual receiver loop using only
 * src/shared/index.ts — no camera, audio, or DOM APIs required.
 *
 * Usage:
 *   npx tsx examples/minimal-receiver.ts
 *
 * Signal structure recap:
 *   Each dictionary word is a 40-segment binary waveform transmitted at 40 Hz
 *   (one segment = 25 ms).  The virtual pipeline ingests one scalar value per
 *   tick and maps it to a detection bit that the PatternMatcher scores against
 *   all 8 dictionary words.
 *
 *   10 agents × 4 samples/agent = 40 samples per tick window (PATTERN_LEN).
 */

import {
  MatcherInputAdapter,
  FixedThresholdStrategy,
  AdaptiveZScoreStrategy,
  DICTIONARY,
  DICT_LABELS,
  PATTERN_LEN,
  TX_CYCLE_LEN,
  getTransmitBit,
  type DictWord,
} from '../src/shared/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a perfect clean signal stream for one dictionary word.
 * Returns PATTERN_LEN scalar values: 255 where the pattern bit is ON, 0 where OFF.
 */
function perfectSignal(word: DictWord): number[] {
  const samples: number[] = [];
  for (let i = 0; i < PATTERN_LEN; i++) {
    samples.push(getTransmitBit(word, i) ? 255 : 0);
  }
  return samples;
}

/**
 * Add uniform noise ±noiseMagnitude to a signal stream.
 */
function addNoise(signal: number[], noiseMagnitude: number): number[] {
  return signal.map((v) => {
    const noise = (Math.random() * 2 - 1) * noiseMagnitude;
    return Math.max(0, Math.min(255, v + noise));
  });
}

// ── Example 1: Fixed-threshold receiver ──────────────────────────────────────

console.log('=== Example 1: Fixed-threshold receiver ===\n');

{
  // Threshold at midpoint between ON (255) and OFF (0)
  const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));

  const wordToTransmit: DictWord = 'I_O';
  const signal = perfectSignal(wordToTransmit);

  console.log(`Transmitting word: ${wordToTransmit}  (${DICT_LABELS[wordToTransmit]})`);
  console.log(`Signal (${signal.length} segments): ${signal.join('')}\n`);

  let matchTick: ReturnType<typeof adapter.process> | null = null;
  for (const sample of signal) {
    matchTick = adapter.process(sample);
  }

  if (matchTick?.match) {
    console.log(`✅ Match: ${matchTick.match.word}  score=${(matchTick.match.score * 100).toFixed(1)}%`);
    console.log(`   Label: ${matchTick.match.label}`);
  } else {
    console.log('❌ No match detected');
  }
}

// ── Example 2: Adaptive z-score receiver ─────────────────────────────────────

console.log('\n=== Example 2: Adaptive z-score receiver ===\n');

{
  // Z-score normalises against the rolling distribution — works even when the
  // absolute signal scale is unknown.
  const adapter = new MatcherInputAdapter(
    new AdaptiveZScoreStrategy(1.5), // trigger when >= 1.5 σ above rolling mean
  );

  const wordToTransmit: DictWord = 'II_P';
  // Scale the signal to a random amplitude to demonstrate scale invariance
  const baseSignal = perfectSignal(wordToTransmit).map((v) => v / 255 * 80 + 20);

  console.log(`Transmitting word: ${wordToTransmit}  (${DICT_LABELS[wordToTransmit]})`);
  console.log(`Signal amplitude scaled to [20, 100] range\n`);

  let matchTick: ReturnType<typeof adapter.process> | null = null;
  for (const sample of baseSignal) {
    matchTick = adapter.process(sample);
  }

  if (matchTick?.match) {
    console.log(`✅ Match: ${matchTick.match.word}  score=${(matchTick.match.score * 100).toFixed(1)}%`);
  } else {
    console.log('❌ No match detected (z-score needs full PATTERN_LEN samples for warm-up)');
  }
}

// ── Example 3: All 8 dictionary words round-trip ──────────────────────────────

console.log('\n=== Example 3: All 8 dictionary words round-trip ===\n');

{
  const words = Object.keys(DICTIONARY) as DictWord[];
  let pass = 0;

  for (const word of words) {
    const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));
    const signal = perfectSignal(word);

    let lastTick: ReturnType<typeof adapter.process> | null = null;
    for (const sample of signal) {
      lastTick = adapter.process(sample);
    }

    const matched = lastTick?.match?.word === word;
    const score = lastTick?.match?.score ?? 0;
    const status = matched ? '✅' : '❌';
    console.log(`  ${status} ${word.padEnd(6)} → ${(lastTick?.match?.word ?? 'null').padEnd(6)}  score=${(score * 100).toFixed(1)}%`);
    if (matched) pass++;
  }

  console.log(`\n  ${pass}/${words.length} words correctly identified`);
}

// ── Example 4: Noise tolerance sweep ─────────────────────────────────────────

console.log('\n=== Example 4: Noise tolerance sweep ===\n');

{
  const word: DictWord = 'I_OP';
  const noiseLevels = [0, 20, 40, 60, 80, 100, 120];

  console.log(`Word: ${word}  (${DICT_LABELS[word]})`);
  console.log('');

  for (const noise of noiseLevels) {
    // Average over 10 random trials
    let detections = 0;
    const trials = 10;

    for (let trial = 0; trial < trials; trial++) {
      const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));
      const signal = addNoise(perfectSignal(word), noise);

      let lastTick: ReturnType<typeof adapter.process> | null = null;
      for (const sample of signal) {
        lastTick = adapter.process(sample);
      }

      if (lastTick?.match?.word === word) detections++;
    }

    const rate = detections / trials;
    const bar = '█'.repeat(Math.round(rate * 20)).padEnd(20, '░');
    console.log(`  noise±${String(noise).padStart(3)} |${bar}| ${(rate * 100).toFixed(0).padStart(3)}% (${detections}/${trials})`);
  }
}

// ── Example 5: TX_CYCLE_LEN stream (TX word + LISTEN window) ─────────────────

console.log('\n=== Example 5: Full TX cycle (TX word + LISTEN window) ===\n');

{
  const word: DictWord = 'II_O';
  const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));

  // A real transmitter sends PATTERN_LEN bits of signal followed by
  // PATTERN_LEN bits of silence (LISTEN window).  getTransmitBit handles
  // both segments — returns false for the listen-window portion.
  const cycleSamples: number[] = [];
  for (let i = 0; i < TX_CYCLE_LEN; i++) {
    cycleSamples.push(getTransmitBit(word, i) ? 255 : 0);
  }

  console.log(`TX cycle for word ${word}: ${TX_CYCLE_LEN} segments`);
  console.log(`  TX window   (${PATTERN_LEN} segments): ${cycleSamples.slice(0, PATTERN_LEN).join('')}`);
  console.log(`  LISTEN window (${PATTERN_LEN} segments): ${cycleSamples.slice(PATTERN_LEN).join('')}\n`);

  let firstMatch: ReturnType<typeof adapter.process>['match'] = null;
  let matchedAtSegment = -1;
  cycleSamples.forEach((sample, i) => {
    const tick = adapter.process(sample);
    if (tick.match && firstMatch === null) {
      firstMatch = tick.match;
      matchedAtSegment = i + 1;
    }
  });

  if (firstMatch) {
    console.log(`✅ Match: ${firstMatch.word}  score=${(firstMatch.score * 100).toFixed(1)}%`);
    console.log(`   First detected at segment: ${matchedAtSegment} (out of ${TX_CYCLE_LEN} total)`);
    console.log(`   Note: match clears after LISTEN window as buffer fills with silence.`);
  } else {
    console.log('❌ No match');
  }
}

console.log('\nDone.');
