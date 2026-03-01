import type { DictWord } from '../shared/dictionary.js';
import type { SampleDecisionStrategy, ScalarSampleTick } from '../shared/samplePipeline.js';
import { ScalarSampleProcessor } from '../shared/samplePipeline.js';
import { PatternMatcher, type MatchResult } from './patternMatcher.js';

export interface MatcherTick extends ScalarSampleTick {
  match: MatchResult | null;
  scores: Record<DictWord, number>;
}

export class MatcherInputAdapter {
  readonly matcher: PatternMatcher;
  readonly processor: ScalarSampleProcessor;

  constructor(strategy: SampleDecisionStrategy, windowSize?: number) {
    this.matcher = new PatternMatcher();
    this.processor = new ScalarSampleProcessor(strategy, windowSize);
  }

  process(sample: number): MatcherTick {
    const tick = this.processor.process(sample);
    this.matcher.addSample(tick.detected);

    return {
      ...tick,
      match: this.matcher.lastMatch,
      scores: { ...this.matcher.lastScores },
    };
  }

  reset(): void {
    this.processor.reset();
    this.matcher.reset();
  }
}
