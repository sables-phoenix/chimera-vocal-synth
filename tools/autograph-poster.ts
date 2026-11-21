/**
 * Poster for `chimera render autograph`: the word as the seven voices actually sounded it.
 * Usage: node tools/autograph-poster.ts out/autograph.json out/autograph.wav out/autograph.png
 */
import { readFileSync } from "node:fs";
import { FFT, hann, nextPow2 } from "./lib/fft.ts";
import { Image, inferno } from "./lib/image.ts";
import { readWav } from "./lib/wav.ts";

type Meta = {
  word: string;
  rowCount: number;
  colCount: number;
  colSeconds: number;
  intro: number;
  wordEnd: number;
  duration: number;
  rows: { midi: number; note: string; vowel: string; body: string }[];
  letters: { ch: string; col0: number; col1: number }[];
  intended: boolean[][];
  detected: boolean[][];
  stats: { ink: number; hit: number; rest: number; falseOn: number };
};

const [jsonPath, wavPath, outPath] = process.argv.slice(2);
if (!jsonPath || !wavPath || !outPath) {
  console.error("usage: node tools/autograph-poster.ts in.json in.wav out.png");
  process.exit(1);
}
const meta = JSON.parse(readFileSync(jsonPath, "utf8")) as Meta;
const { sampleRate, channels } = readWav(wavPath);
const audio = channels[0];

const W = 1500;
const H = 880;
const BG: [number, number, number] = [9, 11, 16];
const INK: [number, number, number] = [231, 238, 247];
const MUTED: [number, number, number] = [122, 134, 153];
const GRID: [number, number, number] = [26, 31, 41];
const EDGE: [number, number, number] = [54, 64, 82];
const AMBER: [number, number, number] = [255, 171, 64];
const CYAN: [number, number, number] = [122, 229, 255];
const BAD: [number, number, number] = [255, 74, 150];
const MISS: [number, number, number] = [210, 62, 58];

const img = new Image(W, H, BG);

const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
// low rows amber, high rows cyan
const rowColor = (r: number) => mix(AMBER, CYAN, 1 - r / (meta.rowCount - 1));

// ---- masthead
img.text(60, 44, "AUTOGRAPH", INK, 7);
img.text(62, 114, "CHIMERA SIGNS ITS OWN NAME, ONE THROAT PER ROW OF A 5X7 TYPEFACE.", MUTED, 2);
img.text(62, 136, "THE TYPE IS THE SCORE; THE AUDIO IS THE TYPE.", MUTED, 2);
const facts = `${meta.duration.toFixed(1)} S   ${meta.rowCount} VOICES   ${meta.colCount} COLUMNS`;
img.text(W - 60 - facts.length * 12, 62, facts, MUTED, 2);
img.text(W - 60 - 27 * 12, 92, `READ BACK ${meta.stats.hit}/${meta.stats.ink} INK`, meta.stats.hit === meta.stats.ink ? INK : BAD, 2);
img.text(W - 60 - 34 * 12, 116, `${meta.stats.falseOn} FALSE ONSET${meta.stats.falseOn === 1 ? "" : "S"}`, meta.stats.falseOn === 0 ? MUTED : BAD, 2);

// ---- grid
const cell = 28;
const gap = 3;
const pitch = cell + gap;
const x0 = 176;
const y0 = 218;
const rows = meta.rowCount;
const cols = meta.colCount;
const gridW = cols * pitch - gap;
const gridH = rows * pitch - gap;

// row labels
for (let r = 0; r < rows; r++) {
  const y = y0 + r * pitch;
  img.text(40, y + 6, meta.rows[r].note, INK, 2);
  img.text(40, y + 22, meta.rows[r].vowelLabel, MUTED, 1);
}

// column shading: every other letter block gets a faint band
for (const l of meta.letters) {
  if ((meta.letters.indexOf(l) & 1) === 0) {
    img.rect(x0 + l.col0 * pitch - gap, y0 - 8, (l.col1 - l.col0) * pitch, gridH + 16, [255, 255, 255], 0.02);
  }
}

for (let c = 0; c < cols; c++) {
  for (let r = 0; r < rows; r++) {
    const x = x0 + c * pitch;
    const y = y0 + r * pitch;
    const want = meta.intended[c][r];
    const got = meta.detected[c][r];
    img.rect(x, y, cell, cell, GRID, 1);
    if (got && want) {
      img.rect(x - 3, y - 3, cell + 6, cell + 6, rowColor(r), 0.1);
      img.rect(x, y, cell, cell, rowColor(r), 0.9);
    } else if (got && !want) {
      img.rect(x, y, cell, cell, BAD, 0.9);
    } else if (want && !got) {
      img.rect(x, y, cell, cell, MISS, 0.25);
      img.rect(x, y, cell, 2, MISS, 0.95);
      img.rect(x, y + cell - 2, cell, 2, MISS, 0.95);
      img.rect(x, y, 2, cell, MISS, 0.95);
      img.rect(x + cell - 2, y, 2, cell, MISS, 0.95);
    } else {
      // a rest: only the cell's edge
      img.line(x, y, x + cell - 1, y, EDGE, 0.5);
      img.line(x, y + cell - 1, x + cell - 1, y + cell - 1, EDGE, 0.5);
    }
  }
}

// letter names and their column spans
for (const l of meta.letters) {
  const cx = x0 + (l.col0 + (l.col1 - l.col0) / 2) * pitch - cell / 2;
  img.text(cx - 6, y0 + gridH + 14, l.ch, INK, 3);
  img.line(x0 + l.col0 * pitch, y0 + gridH + 8, x0 + l.col1 * pitch - gap, y0 + gridH + 8, EDGE, 0.7);
}

// ---- time ruler
const rulerY = y0 + gridH + 62;
for (let c = 0; c <= cols; c += 5) {
  const x = x0 + c * pitch;
  const t = meta.intro + c * meta.colSeconds;
  img.line(x, rulerY, x, rulerY + 5, EDGE, 1);
  img.text(x - 6, rulerY + 10, `${t.toFixed(1)}`, MUTED, 1);
}
img.line(x0, rulerY, x0 + gridW, rulerY, EDGE, 0.7);
img.text(x0 + gridW + 10, rulerY - 1, "S", MUTED, 1);

// ---- narrow-band spectrogram of the same twelve seconds
const wx = x0;
const ww = gridW;
const sy = 544;
const sh = 88;
const sr = sampleRate;
const win = Math.round(0.06 * sr);
const hop = Math.round(0.01 * sr);
const nfft = nextPow2(win * 2);
const fft = new FFT(nfft);
const w = hann(win);
const frameCount = Math.max(1, Math.floor((audio.length - win) / hop) + 1);
const fLo = 120;
const fHi = 700;
const binLo = Math.floor((fLo / sr) * nfft);
const binHi = Math.ceil((fHi / sr) * nfft);
const spec: Float64Array[] = [];
let maxDb = -Infinity;
const re = new Float64Array(nfft);
const im = new Float64Array(nfft);
for (let f = 0; f < frameCount; f++) {
  re.fill(0);
  im.fill(0);
  const off = f * hop;
  for (let i = 0; i < win; i++) re[i] = (audio[off + i] ?? 0) * w[i];
  fft.transform(re, im);
  const col = new Float64Array(binHi - binLo);
  for (let k = binLo; k < binHi; k++) {
    const v = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-20);
    col[k - binLo] = v;
    if (v > maxDb) maxDb = v;
  }
  spec.push(col);
}
img.text(wx, sy - 14, "NARROW-BAND, 120-700 HZ, 60 MS WINDOW", MUTED, 1);
for (let px = 0; px < ww; px++) {
  const f = Math.min(frameCount - 1, Math.floor((px / ww) * frameCount));
  const col = spec[f];
  for (let py = 0; py < sh; py++) {
    const u = 1 - py / (sh - 1);
    const k = Math.min(col.length - 1, Math.max(0, Math.round(u * (col.length - 1))));
    const db = (col[k] - maxDb + 62) / 62;
    if (db <= 0) continue;
    img.set(wx + px, sy + py, inferno(Math.min(1, db) ** 0.85));
  }
}
img.line(wx, sy, wx + ww, sy, EDGE, 0.6);
img.text(wx + 6, sy + 5, "THE MIX", MUTED, 1);

// ---- waveform
const wy = 672;
const wh = 96;
img.rect(wx, wy, ww, wh, [14, 17, 24], 1);
img.line(wx, wy + wh / 2, wx + ww, wy + wh / 2, EDGE, 0.5);
const spc = audio.length / ww;
for (let px = 0; px < ww; px++) {
  let mn = 1;
  let mx = -1;
  const a = Math.floor(px * spc);
  const b = Math.min(audio.length, Math.floor((px + 1) * spc) + 1);
  for (let i = a; i < b; i++) {
    if (audio[i] < mn) mn = audio[i];
    if (audio[i] > mx) mx = audio[i];
  }
  const y1 = wy + wh / 2 - mx * (wh / 2 - 2);
  const y2 = wy + wh / 2 - mn * (wh / 2 - 2);
  img.line(wx + px, y1, wx + px, y2, CYAN, 0.55);
}
// the word's last column, and the cadence after it
const endX = wx + (ww * meta.wordEnd) / meta.duration;
img.line(endX, wy, endX, wy + wh, AMBER, 0.5);
img.text(endX + 6, wy + 6, "CADENCE", AMBER, 1);
img.text(wx + 6, wy + 6, "THE MIX", MUTED, 1);

// ---- legend and caption
const ly = wy + wh + 26;
let lx = wx;
const legend = (color: [number, number, number], label: string, alpha = 1) => {
  img.rect(lx, ly + 2, 12, 12, color, alpha);
  img.text(lx + 18, ly + 2, label, MUTED, 1);
  lx += 18 + label.length * 6 + 26;
};
legend(CYAN, "DETECTED IN THE AUDIO", 0.9);
legend(MISS, "INTENDED, NOT FOUND");
img.rect(lx, ly + 2, 12, 12, BAD, 0.9);
img.text(lx + 18, ly + 2, "FALSE ONSET", MUTED, 1);

img.text(60, H - 44, "EACH CELL WAS READ FROM THAT THROAT'S RENDERED AUDIO, NOT FROM THE SCORE. THE SEVEN STEMS ARE THE CHOIR INSIDE THE MIX.", MUTED, 1);
img.text(60, H - 26, "PITCHES ARE A WHOLE-TONE CLUSTER WITH NO OCTAVE OR LOW HARMONIC BETWEEN ROWS, SO EVERY ROW CAN BE HEARD APART.", MUTED, 1);

img.savePng(outPath);
console.log(`wrote ${outPath}  ${W}x${H}`);
