/**
 * examples/multi-agent-conversation.ts
 *
 * Deterministic multi-agent conversation replay.
 *
 * Simulates a population of autonomous mobile units exchanging structured
 * signals according to the Colloquy of Mobiles vocabulary.  Each agent
 * cycles through TX → LISTEN windows; a virtual receiver decodes the
 * overlapping signal stream.
 *
 * This script uses only src/shared/index.ts — no camera, audio, or DOM APIs.
 *
 * Usage:
 *   npx tsx examples/multi-agent-conversation.ts
 *
 * Scenario:
 *   • 3 agents with fixed identities and drives broadcast in turn.
 *   • Their signals are superimposed (summed) at the listener position.
 *   • The listener uses the AdaptiveZScoreStrategy to decode each word.
 */

import {
  MatcherInputAdapter,
  AdaptiveZScoreStrategy,
  FixedThresholdStrategy,
  DICT_LABELS,
  PATTERN_LEN,
  TX_CYCLE_LEN,
  getTransmitBit,
  type DictWord,
} from '../src/shared/index.js';

// ── Agent definition ──────────────────────────────────────────────────────────

interface Agent {
  id: string;
  word: DictWord;
  /** Transmit amplitude (0–255) */
  amplitude: number;
  /** Phase offset into the TX cycle (in segments) */
  phaseOffset: number;
}

const AGENTS: Agent[] = [
  { id: 'Agent-A', word: 'I_O',  amplitude: 200, phaseOffset: 0  },
  { id: 'Agent-B', word: 'II_P', amplitude: 180, phaseOffset: TX_CYCLE_LEN },
  { id: 'Agent-C', word: 'I_R',  amplitude: 160, phaseOffset: TX_CYCLE_LEN * 2 },
];

// ── Simulation ────────────────────────────────────────────────────────────────

/** Total simulation length: all agents complete 2 full TX cycles */
const SIM_SEGMENTS = TX_CYCLE_LEN * (AGENTS.length + 1);

/** Ambient background level added to every sample */
const BACKGROUND_LEVEL = 40;

/**
 * Compute the composite signal at each time segment by summing contributions
 * from all active agents at that point in their TX cycle.
 */
function buildCompositeSignal(): number[] {
  const samples: number[] = [];

  for (let t = 0; t < SIM_SEGMENTS; t++) {
    let composite = BACKGROUND_LEVEL;

    for (const agent of AGENTS) {
      // Position in this agent's TX cycle
      const cyclePos = t - agent.phaseOffset;
      if (cyclePos < 0 || cyclePos >= TX_CYCLE_LEN) continue;

      if (getTransmitBit(agent.word, cyclePos)) {
        composite += agent.amplitude;
      }
    }

    samples.push(Math.min(255, composite));
  }

  return samples;
}

// ── Run conversation replay ───────────────────────────────────────────────────

console.log('=== Multi-Agent Conversation Replay ===\n');
console.log('Agents:');
for (const agent of AGENTS) {
  console.log(`  ${agent.id.padEnd(10)} word=${agent.word.padEnd(6)} amp=${agent.amplitude}  phase_offset=${agent.phaseOffset}seg`);
}
console.log(`\nSimulation length: ${SIM_SEGMENTS} segments  (${(SIM_SEGMENTS * 25 / 1000).toFixed(1)}s at 40Hz)\n`);

const compositeSignal = buildCompositeSignal();

// Print the composite signal as a rough ASCII waveform
console.log('Composite signal (ASCII waveform):');
const step = Math.ceil(SIM_SEGMENTS / 80);
const waveLine = compositeSignal
  .filter((_, i) => i % step === 0)
  .map((v) => (v > BACKGROUND_LEVEL + 50 ? '█' : v > BACKGROUND_LEVEL + 10 ? '▄' : '░'))
  .join('');
console.log(`  |${waveLine}|`);
console.log(`   ${'0'.padEnd(39)} ${SIM_SEGMENTS}seg\n`);

// ── Z-score receiver ──────────────────────────────────────────────────────────

console.log('--- Z-Score Receiver (scale-invariant) ---\n');
{
  const adapter = new MatcherInputAdapter(new AdaptiveZScoreStrategy(1.5));

  const detections: Array<{ segment: number; word: DictWord; score: number }> = [];
  let lastMatchWord: DictWord | null = null;

  compositeSignal.forEach((sample, segment) => {
    const tick = adapter.process(sample);
    if (tick.match && tick.match.word !== lastMatchWord) {
      detections.push({ segment, word: tick.match.word, score: tick.match.score });
      lastMatchWord = tick.match.word;
    }
    if (!tick.match) {
      lastMatchWord = null;
    }
  });

  console.log(`Decoded ${detections.length} pattern change(s):\n`);
  for (const d of detections) {
    const expectedAgent = AGENTS.find((a) => {
      const cyclePos = d.segment - a.phaseOffset;
      return cyclePos >= PATTERN_LEN - 5 && cyclePos < PATTERN_LEN + 5;
    });

    const status = expectedAgent?.word === d.word ? '✅' : '🔀';
    const timeMs = (d.segment * 25).toFixed(0);
    console.log(
      `  ${status} t=${timeMs.padStart(5)}ms  seg=${String(d.segment).padStart(4)}  ` +
      `word=${d.word.padEnd(6)}  score=${(d.score * 100).toFixed(1)}%  ` +
      `(${DICT_LABELS[d.word]})`,
    );
  }

  if (detections.length === 0) {
    console.log('  (no patterns detected — signals may be overlapping)');
  }
}

// ── Fixed-threshold receiver for comparison ───────────────────────────────────

console.log('\n--- Fixed-Threshold Receiver (threshold=100, above background) ---\n');
{
  const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(BACKGROUND_LEVEL + 60));

  const detections: Array<{ segment: number; word: DictWord; score: number }> = [];
  let lastMatchWord: DictWord | null = null;

  compositeSignal.forEach((sample, segment) => {
    const tick = adapter.process(sample);
    if (tick.match && tick.match.word !== lastMatchWord) {
      detections.push({ segment, word: tick.match.word, score: tick.match.score });
      lastMatchWord = tick.match.word;
    }
    if (!tick.match) lastMatchWord = null;
  });

  console.log(`Decoded ${detections.length} pattern change(s):\n`);
  for (const d of detections) {
    const timeMs = (d.segment * 25).toFixed(0);
    console.log(
      `  🔍 t=${timeMs.padStart(5)}ms  seg=${String(d.segment).padStart(4)}  ` +
      `word=${d.word.padEnd(6)}  score=${(d.score * 100).toFixed(1)}%  ` +
      `(${DICT_LABELS[d.word]})`,
    );
  }

  if (detections.length === 0) {
    console.log('  (no patterns detected above threshold)');
  }
}

// ── Per-agent isolated receiver ───────────────────────────────────────────────

console.log('\n--- Per-Agent Isolated Receivers (one adapter per agent) ---\n');

for (const agent of AGENTS) {
  const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));

  // Build a clean isolated signal for this agent over the full sim length
  const isolatedSignal: number[] = [];
  for (let t = 0; t < SIM_SEGMENTS; t++) {
    const cyclePos = t - agent.phaseOffset;
    if (cyclePos < 0 || cyclePos >= TX_CYCLE_LEN) {
      isolatedSignal.push(0);
    } else {
      isolatedSignal.push(getTransmitBit(agent.word, cyclePos) ? 255 : 0);
    }
  }

  type MatchSummary = { word: DictWord; score: number };
  let firstMatch: MatchSummary | null = null;
  let firstMatchSeg = -1;
  isolatedSignal.forEach((sample, seg) => {
    const tick = adapter.process(sample);
    if (tick.match && firstMatch === null) {
      firstMatch = { word: tick.match.word, score: tick.match.score };
      firstMatchSeg = seg;
    }
  });

  const matched = firstMatch !== null && firstMatch.word === agent.word;
  const score = firstMatch?.score ?? 0;
  const status = matched ? '✅' : '❌';
  console.log(
    `  ${status} ${agent.id.padEnd(10)} expected=${agent.word.padEnd(6)} ` +
    `got=${(firstMatch?.word ?? 'null').padEnd(6)} ` +
    `score=${(score * 100).toFixed(1)}%` +
    (firstMatchSeg >= 0 ? `  first_match_at=seg${firstMatchSeg}` : ''),
  );
}

console.log('\nDone.');
