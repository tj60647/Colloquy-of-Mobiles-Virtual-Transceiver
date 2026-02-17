/**
 * PatternDecoder
 *
 * Converts a stream of boolean (detected / not-detected) samples into text
 * using a timing-based Morse code decoder.
 *
 * ─── Morse timing model ────────────────────────────────────────────────────
 *
 *  Symbol          Duration
 *  dot             1 unit
 *  dash            ≥ 2.5 units
 *  intra-element   1 unit  (between dots/dashes in the same letter) → ignored
 *  inter-letter    ≥ 2.5 units  (gap between letters)
 *  inter-word      ≥ 6 units    (gap between words)
 *
 *  "unit" is configurable (default 100 ms).  At 40 Hz, 1 unit ≈ 4 samples.
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *
 *  const dec = new PatternDecoder(100);   // 100 ms per Morse unit
 *  dec.addSample(detected, performance.now());
 *  console.log(dec.currentWord);
 */

export interface DecodeEntry {
  letter:  string;
  pattern: string; // e.g. ".-" for 'A'
}

const MORSE: Record<string, string> = {
  // Letters
  '.-': 'A',   '-...': 'B', '-.-.': 'C', '-..': 'D',  '.': 'E',
  '..-.': 'F', '--.': 'G',  '....': 'H', '..': 'I',   '.---': 'J',
  '-.-': 'K',  '.-..': 'L', '--': 'M',   '-.': 'N',   '---': 'O',
  '.--.': 'P', '--.-': 'Q', '.-.': 'R',  '...': 'S',  '-': 'T',
  '..-': 'U',  '...-': 'V', '.--': 'W',  '-..-': 'X', '-.--': 'Y',
  '--..': 'Z',
  // Digits
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
  // Punctuation
  '.-.-.-': '.', '--..--': ',', '..--..': '?', '.----.': "'",
  '-.-.--': '!', '-..-.': '/',  '-.--.': '(',  '-.--.-': ')',
  '.-...': '&',  '---...': ':', '-.-.-.': ';', '-...-': '=',
  '.-.-.': '+',  '-....-': '-', '..--.-': '_', '.-..-.': '"',
  '...-..-': '$','.--.-.': '@', '...---...': 'SOS',
};

export class PatternDecoder {
  // Timing configuration
  unitMs: number;

  // Thresholds (in units)
  private readonly DOT_DASH_THRESHOLD  = 2.0; // above = dash
  private readonly LETTER_GAP_MIN      = 2.0; // above = letter gap
  private readonly WORD_GAP_MIN        = 6.0; // above = word gap

  // State machine
  private lastState     = false;
  private stateStart    = 0; // ms timestamp of last state transition

  // Current letter being built
  private currentCode   = '';

  // Decoded output (last MAX_HISTORY entries)
  decoded: DecodeEntry[]  = [];
  currentWord             = '';

  private static readonly MAX_HISTORY = 40;

  constructor(unitMs = 100) {
    this.unitMs = unitMs;
  }

  /**
   * Feed one detection sample into the decoder.
   * Call once per 40 Hz tick with the current detection boolean.
   */
  addSample(detected: boolean, timestamp: number): void {
    // Bootstrap
    if (this.stateStart === 0) {
      this.stateStart = timestamp;
      this.lastState  = detected;
      return;
    }

    if (detected === this.lastState) return; // no transition

    const durationMs = timestamp - this.stateStart;
    const units      = durationMs / this.unitMs;

    if (this.lastState) {
      // HIGH → LOW: end of a dot or dash
      this.currentCode += units < this.DOT_DASH_THRESHOLD ? '.' : '-';
    } else {
      // LOW → HIGH: end of a gap
      if (units >= this.WORD_GAP_MIN) {
        this.flushLetter();
        this.appendEntry({ letter: ' ', pattern: '' });
        this.currentWord += ' ';
      } else if (units >= this.LETTER_GAP_MIN) {
        this.flushLetter();
      }
      // else: intra-element gap – nothing to do
    }

    this.lastState  = detected;
    this.stateStart = timestamp;
  }

  /**
   * Force-flush the current in-progress code (e.g. on timeout or user reset).
   * Useful when the light source goes dark for more than one word-gap.
   */
  flush(timestamp: number): void {
    if (this.stateStart === 0) return;
    const durationMs = timestamp - this.stateStart;
    const units      = durationMs / this.unitMs;
    if (!this.lastState && units >= this.LETTER_GAP_MIN) {
      this.flushLetter();
    }
  }

  private flushLetter(): void {
    if (this.currentCode.length === 0) return;
    const letter = MORSE[this.currentCode] ?? `[${this.currentCode}]`;
    this.appendEntry({ letter, pattern: this.currentCode });
    this.currentWord += letter;
    this.currentCode  = '';
  }

  private appendEntry(e: DecodeEntry): void {
    this.decoded.push(e);
    if (this.decoded.length > PatternDecoder.MAX_HISTORY) {
      this.decoded.shift();
    }
  }

  /** The Morse symbols accumulated for the current letter (e.g. ".-") */
  get currentCode_(): string { return this.currentCode; }

  reset(): void {
    this.lastState   = false;
    this.stateStart  = 0;
    this.currentCode = '';
    this.decoded     = [];
    this.currentWord = '';
  }
}
