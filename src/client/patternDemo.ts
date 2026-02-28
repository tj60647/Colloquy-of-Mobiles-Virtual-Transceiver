import { DICTIONARY, DICT_LABELS, DICT_WORDS, PATTERN_LEN, type DictWord } from '../shared/dictionary.js';

type ScoreRow = { word: DictWord; score: number };

const WINDOW = PATTERN_LEN;
const HISTORY = 152;

const txWordEl = document.getElementById('tx-word') as HTMLSelectElement;
const phaseEl = document.getElementById('phase') as HTMLInputElement;
const phaseValEl = document.getElementById('phase-val') as HTMLSpanElement;
const noiseEl = document.getElementById('noise') as HTMLInputElement;
const noiseValEl = document.getElementById('noise-val') as HTMLSpanElement;
const thrEl = document.getElementById('thr') as HTMLInputElement;
const thrValEl = document.getElementById('thr-val') as HTMLSpanElement;
const hzEl = document.getElementById('hz') as HTMLInputElement;
const hzValEl = document.getElementById('hz-val') as HTMLSpanElement;
const runBtn = document.getElementById('btn-run') as HTMLButtonElement;
const resetBtn = document.getElementById('btn-reset') as HTMLButtonElement;

const dictBitsEl = document.getElementById('dict-bits') as HTMLDivElement;
const inBitsEl = document.getElementById('in-bits') as HTMLDivElement;
const topWordEl = document.getElementById('top-word') as HTMLDivElement;
const topScoreEl = document.getElementById('top-score') as HTMLDivElement;
const secondScoreEl = document.getElementById('second-score') as HTMLDivElement;
const marginEl = document.getElementById('margin') as HTMLDivElement;
const chartEl = document.getElementById('chart') as HTMLCanvasElement;
const tableEl = document.getElementById('score-table') as HTMLTableElement;

for (const word of DICT_WORDS) {
  const opt = document.createElement('option');
  opt.value = word;
  opt.textContent = `${word} — ${DICT_LABELS[word]}`;
  txWordEl.appendChild(opt);
}

let txWord: DictWord = 'I_O';
let phase = 0;
let noisePct = 0;
let threshold = 0.875;
let hz = 20;

let running = true;
let cursor = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

let incomingWindow: number[] = [];
let prevRaw = false;

const topScoreHistory: number[] = [];
const rawTriggerHistory: number[] = [];
const edgeTriggerHistory: number[] = [];
const rawTriggerWordHistory: Array<DictWord | null> = [];
const edgeTriggerWordHistory: Array<DictWord | null> = [];

function setValueLabels(): void {
  phaseValEl.textContent = String(phase);
  noiseValEl.textContent = `${noisePct}%`;
  thrValEl.textContent = threshold.toFixed(3);
  hzValEl.textContent = String(hz);
}

function resetState(): void {
  cursor = phase;
  incomingWindow = [];
  prevRaw = false;
  topScoreHistory.length = 0;
  rawTriggerHistory.length = 0;
  edgeTriggerHistory.length = 0;
  rawTriggerWordHistory.length = 0;
  edgeTriggerWordHistory.length = 0;
  for (let i = 0; i < WINDOW; i++) {
    pushIncomingSample(nextBit());
  }
  renderEverything();
}

function nextBit(): number {
  const src = DICTIONARY[txWord][cursor % PATTERN_LEN];
  cursor++;
  const flip = Math.random() < noisePct / 100;
  return flip ? (src ? 0 : 1) : src;
}

function pushIncomingSample(bit: number): void {
  incomingWindow.push(bit);
  if (incomingWindow.length > WINDOW) incomingWindow.shift();
}

function scoreWord(word: DictWord): number {
  if (incomingWindow.length < WINDOW) return 0;
  const pattern = DICTIONARY[word];
  let matches = 0;
  for (let i = 0; i < WINDOW; i++) {
    if (incomingWindow[i] === pattern[i]) matches++;
  }
  return matches / WINDOW;
}

function pushHistory(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > HISTORY) arr.splice(0, arr.length - HISTORY);
}

function pushWordHistory(arr: Array<DictWord | null>, value: DictWord | null): void {
  arr.push(value);
  if (arr.length > HISTORY) arr.splice(0, arr.length - HISTORY);
}

function tick(): void {
  if (!running) return;

  pushIncomingSample(nextBit());

  const rows: ScoreRow[] = DICT_WORDS.map((word) => ({ word, score: scoreWord(word) }))
    .sort((a, b) => b.score - a.score);

  const top = rows[0];
  const second = rows[1];
  const raw = top.score >= threshold;
  const edge = raw && !prevRaw;
  prevRaw = raw;

  pushHistory(topScoreHistory, top.score);
  pushHistory(rawTriggerHistory, raw ? 1 : 0);
  pushHistory(edgeTriggerHistory, edge ? 1 : 0);
  pushWordHistory(rawTriggerWordHistory, raw ? top.word : null);
  pushWordHistory(edgeTriggerWordHistory, edge ? top.word : null);

  renderBits(dictBitsEl, DICTIONARY[txWord]);
  renderBits(inBitsEl, incomingWindow);
  topWordEl.textContent = `${top.word} (${DICT_LABELS[top.word]})`;
  topScoreEl.textContent = top.score.toFixed(3);
  secondScoreEl.textContent = second.score.toFixed(3);
  marginEl.textContent = (top.score - second.score).toFixed(3);

  renderTable(rows);
  renderChart();

  const intervalMs = Math.max(5, Math.round(1000 / hz));
  timer = setTimeout(tick, intervalMs);
}

function renderBits(container: HTMLElement, bits: readonly number[]): void {
  container.innerHTML = '';
  for (let i = 0; i < WINDOW; i++) {
    const b = bits[i] ?? 0;
    const d = document.createElement('div');
    d.className = `bit${b ? ' on' : ''}`;
    container.appendChild(d);
  }
}

function renderTable(rows: ScoreRow[]): void {
  tableEl.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');

    const tdWord = document.createElement('td');
    tdWord.className = 'word';
    tdWord.textContent = row.word;

    const tdLabel = document.createElement('td');
    tdLabel.className = 'label';
    tdLabel.textContent = DICT_LABELS[row.word];

    const tdScore = document.createElement('td');
    tdScore.className = 'score';
    tdScore.textContent = `${Math.round(row.score * 100)}%`;

    const tdBar = document.createElement('td');
    const wrap = document.createElement('div');
    wrap.className = 'bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${Math.max(0, Math.min(100, row.score * 100))}%`;
    wrap.appendChild(bar);
    tdBar.appendChild(wrap);

    tr.append(tdWord, tdLabel, tdScore, tdBar);
    tableEl.appendChild(tr);
  });
}

function renderChart(): void {
  const ctx = chartEl.getContext('2d');
  if (!ctx) return;

  const w = chartEl.width;
  const h = chartEl.height;
  ctx.clearRect(0, 0, w, h);

  const drawLine = (arr: number[], color: string): void => {
    if (arr.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const x = (i / Math.max(1, arr.length - 1)) * (w - 1);
      const y = h - 1 - arr[i] * (h - 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };

  const thrY = h - 1 - threshold * (h - 1);
  ctx.beginPath();
  ctx.moveTo(0, thrY);
  ctx.lineTo(w, thrY);
  ctx.strokeStyle = 'rgba(255, 165, 0, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const drawMarkers = (
    arr: number[],
    words: Array<DictWord | null>,
    color: string,
    textY: number,
  ): void => {
    ctx.save();
    ctx.font = '10px Consolas, Monaco, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;

    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < 0.5) continue;
      const x = (i / Math.max(1, arr.length - 1)) * (w - 1);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      const word = words[i];
      if (word) {
        ctx.fillText(word, Math.min(x + 2, w - 32), textY);
      }
    }
    ctx.restore();
  };

  drawMarkers(rawTriggerHistory, rawTriggerWordHistory, 'rgba(239, 68, 68, 0.7)', 2);
  drawMarkers(edgeTriggerHistory, edgeTriggerWordHistory, 'rgba(34, 197, 94, 0.9)', 14);
  drawLine(topScoreHistory, 'rgba(56, 189, 248, 0.95)');
}

function renderEverything(): void {
  renderBits(dictBitsEl, DICTIONARY[txWord]);
  renderBits(inBitsEl, incomingWindow);
  renderChart();
}

function applyControls(): void {
  txWord = txWordEl.value as DictWord;
  phase = parseInt(phaseEl.value, 10);
  noisePct = parseInt(noiseEl.value, 10);
  threshold = parseFloat(thrEl.value);
  hz = parseInt(hzEl.value, 10);
  setValueLabels();
}

[txWordEl, phaseEl, noiseEl, thrEl, hzEl].forEach((el) => {
  el.addEventListener('input', () => {
    applyControls();
    resetState();
  });
  el.addEventListener('change', () => {
    applyControls();
    resetState();
  });
});

runBtn.addEventListener('click', () => {
  running = !running;
  runBtn.textContent = running ? 'Pause' : 'Run';
  if (running) tick();
  else if (timer) {
    clearTimeout(timer);
    timer = null;
  }
});

resetBtn.addEventListener('click', () => {
  applyControls();
  resetState();
});

applyControls();
resetState();
tick();
