/**
 * Colloquy of Mobiles – Virtual Transceiver core library
 *
 * This barrel re-exports every component needed to run the pattern-matching
 * pipeline in a purely virtual (non-camera / non-microphone) context:
 *
 *   // From a file at the project root:
 *   import {
 *     DICTIONARY, DICT_WORDS, PATTERN_LEN, TX_CYCLE_LEN, getTransmitBit,
 *     PatternMatcher,
 *     FixedThresholdStrategy, AdaptiveZScoreStrategy,
 *     ScalarSampleProcessor, RollingStatsBuffer,
 *     MatcherInputAdapter,
 *     TickOrchestrator,
 *   } from './src/shared/index.js';
 *
 * Minimal virtual-receiver loop:
 *
 *   const adapter = new MatcherInputAdapter(new FixedThresholdStrategy(128));
 *
 *   for (const sample of mySignalStream) {
 *     const tick = adapter.process(sample);
 *     if (tick.match) console.log('matched', tick.match.word, tick.match.score);
 *   }
 *
 * Browser / Node.js compatible – no camera, audio, or DOM APIs required.
 */

// ── Dictionary ────────────────────────────────────────────────────────────────
export {
  SEGMENT_MS,
  PATTERN_LEN,
  LISTEN_LEN,
  TX_CYCLE_LEN,
  DICTIONARY,
  DICT_WORDS,
  DICT_LABELS,
  AUDIO_TONE_FREQS,
  AUDIO_BANDPASS_DEFAULT_CENTER,
  AUDIO_BANDPASS_DEFAULT_Q,
  getTransmitBit,
} from './dictionary.js';
export type { DictWord } from './dictionary.js';

// ── Pattern matcher ───────────────────────────────────────────────────────────
export { PatternMatcher } from './patternMatcher.js';
export type { MatchResult } from './patternMatcher.js';

// ── Scalar sample pipeline ────────────────────────────────────────────────────
export {
  RollingStatsBuffer,
  FixedThresholdStrategy,
  AdaptiveZScoreStrategy,
  ScalarSampleProcessor,
} from './samplePipeline.js';
export type {
  RollingStatsSnapshot,
  SampleDecisionContext,
  SampleDecisionStrategy,
  ScalarSampleTick,
} from './samplePipeline.js';

// ── Matcher input adapter (pipeline + matcher combined) ───────────────────────
export { MatcherInputAdapter } from './matcherInputAdapter.js';
export type { MatcherTick } from './matcherInputAdapter.js';

// ── Tick orchestrator (timer abstraction for browser + Node.js) ───────────────
export { TickOrchestrator } from './tickOrchestrator.js';
export type {
  FrameContext,
  TickContext,
  TickOrchestratorCallbacks,
} from './tickOrchestrator.js';

// ── Shared domain + protocol types ───────────────────────────────────────────
export { WS_PROTOCOL_VERSION } from './types.js';
export type {
  LightReading,
  MotionUnit,
  MotionAxisConfig,
  ZoneConfig,
  FovConfig,
  DetectorConfig,
  WsMessageType,
  SubscriberMode,
  IdentifyPayload,
  PatternDetectedPayload,
  WsMessage,
} from './types.js';
