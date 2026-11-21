/**
 * Build the interactive player for `chimera render autograph`.
 * Usage: node tools/autograph-player.ts out/autograph.json out/autograph.wav out/autograph.html
 *
 * The JSON is inlined so the page opens from disk; the WAV sits beside it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [jsonPath, wavPath, outPath, embedFlag] = process.argv.slice(2);
if (!jsonPath || !wavPath || !outPath) {
  console.error("usage: node tools/autograph-player.ts in.json in.wav out.html [--embed]");
  process.exit(1);
}
const meta = JSON.parse(readFileSync(jsonPath, "utf8"));
const embed = embedFlag === "--embed";
const wav = embed
  ? "data:audio/wav;base64," + readFileSync(wavPath).toString("base64")
  : basename(wavPath);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AUTOGRAPH - CHIMERA</title>
<style>
  :root { --cell: 26px; --gap: 3px; --bg: #090b10; --ink: #e7eef7; --muted: #7a8699; --line: #232a36; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); }
  body { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; min-height: 100vh; padding: 28px 32px 40px; max-width: 1500px; margin: 0 auto; }
  h1 { font-size: clamp(34px, 6vw, 76px); letter-spacing: .16em; margin: 0 0 6px; font-weight: 600; }
  .sub { color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
  .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; flex-wrap: wrap; }
  .facts { text-align: right; color: var(--muted); white-space: pre-line; }
  .facts b { color: var(--ink); font-weight: 500; }
  .stage { margin-top: 34px; overflow-x: auto; padding-bottom: 8px; }
  .board { display: inline-block; position: relative; }
  .row { display: flex; align-items: center; gap: 10px; }
  .label { width: 76px; text-align: right; color: var(--muted); line-height: 1.1; flex: none; }
  .label b { display: block; color: var(--ink); font-weight: 500; letter-spacing: .06em; }
  .label span { font-size: 10px; letter-spacing: .16em; }
  .cells { display: flex; gap: var(--gap); }
  .cell { width: var(--cell); height: var(--cell); border-radius: 3px; background: #141924; border: 1px solid #1e2532; transition: background .06s linear, box-shadow .06s linear, border-color .06s linear; }
  .cell.on { background: var(--c); border-color: var(--c); }
  .cell.now { border-color: #ffffff55; }
  .cell.now.on { box-shadow: 0 0 0 1px #fff8, 0 0 14px var(--c); filter: saturate(1.25) brightness(1.15); }
  .cell.miss { background: #3a1418; border-color: #d23e3a; }
  .cell.false { background: #ff4a96; border-color: #ff4a96; }
  .letters { display: grid; grid-template-columns: repeat(41, var(--cell)); gap: var(--gap); margin-top: 10px; }
  .letter { text-align: center; font-size: 20px; letter-spacing: .1em; color: var(--ink); border-top: 1px solid var(--line); padding-top: 6px; }
  .beam { position: absolute; top: 0; width: 2px; height: calc(var(--cell) * 7 + var(--gap) * 6); background: #ffe6a8; box-shadow: 0 0 18px #ffb84d; opacity: 0; pointer-events: none; }
  .controls { display: flex; align-items: center; gap: 16px; margin-top: 28px; flex-wrap: wrap; }
  button { font: inherit; letter-spacing: .14em; text-transform: uppercase; color: var(--ink); background: #121722; border: 1px solid #2b3444; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
  button:hover { border-color: #4a5973; }
  button:focus-visible { outline: 2px solid #ffb84d; outline-offset: 2px; }
  .bar { flex: 1; min-width: 240px; height: 8px; background: #141924; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffb84d, #7ae5ff); }
  .time { color: var(--muted); min-width: 92px; text-align: right; }
  .chord { margin-top: 16px; min-height: 22px; color: var(--muted); }
  .chord b { color: #ffd48a; font-weight: 500; letter-spacing: .12em; }
  .scope { width: 100%; height: 170px; display: block; margin-top: 22px; background: #0d1119; border: 1px solid var(--line); border-radius: 4px; }
  .note { color: var(--muted); margin-top: 22px; max-width: 900px; }
  .note em { color: var(--ink); font-style: normal; }
  @media (max-width: 900px) { :root { --cell: 14px; --gap: 2px; } body { padding: 20px 16px; } .label { width: 54px; font-size: 10px; } .letters { margin-left: 64px; } }
</style>
</head>
<body>
  <div class="top">
    <div>
      <h1>AUTOGRAPH</h1>
      <div class="sub">CHIMERA signs its own name, one throat per row of a 5x7 typeface</div>
      <div class="sub" style="margin-top:4px">The type is the score; the audio is the type.</div>
    </div>
    <div class="facts"><b>__HIT__/__INK__ CELLS READ BACK</b>
__DUR__ S  -  __VOICES__ VOICES  -  __COLS__ COLUMNS
__FALSE__ FALSE ONSETS</div>
  </div>

  <div class="stage">
    <div class="board" id="board">
      <div class="beam" id="beam"></div>
      <div id="rows"></div>
      <div class="letters" id="letters"></div>
    </div>
  </div>

  <div class="controls">
    <button id="play">PLAY</button>
    <div class="bar"><i id="fill"></i></div>
    <div class="time" id="time">0.0 / __DUR__ S</div>
  </div>
  <div class="chord" id="chord">PRESS PLAY. THE CHOIR IS THE TYPEFACE.</div>

  <canvas id="scope" class="scope" width="1400" height="170" aria-label="live spectrum"></canvas>

  <div class="note">
    Every lit cell is a voice that actually sounds: its energy was measured in that throat's
    rendered stem, not copied from the score. The seven stems are the choir inside the WAV; two pedals and a room sit under it. Pitches run from
    G3 to G#4 in a whole-tone cluster, so no row is an octave from another and every throat
    stays audible. The word is printed one 200 ms column at a time; the held chord after it is
    the signature drying.
  </div>

  <audio id="audio" src="__WAV__" preload="auto"></audio>
<script>
const META = __META__;
const ROWS = META.rows, COLS = META.colCount, PITCH = 25;
const rowsEl = document.getElementById('rows');
const lettersEl = document.getElementById('letters');
const audio = document.getElementById('audio');
const beam = document.getElementById('beam');
const fill = document.getElementById('fill');
const timeEl = document.getElementById('time');
const chordEl = document.getElementById('chord');
const playEl = document.getElementById('play');
const scope = document.getElementById('scope');
const sctx = scope.getContext('2d');
const cells = [];
let analyser = null;
let spec = null;
let actx = null;

const color = (r) => {
  const t = 1 - r / (ROWS.length - 1);
  const a = [255, 171, 64], b = [122, 229, 255];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t));
  return 'rgb(' + c.join(',') + ')';
};

for (let r = 0; r < ROWS.length; r++) {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('div');
  lab.className = 'label';
  lab.innerHTML = '<b>' + ROWS[r].note + '</b><span>' + ROWS[r].vowelLabel + '</span>';
  const wrap = document.createElement('div');
  wrap.className = 'cells';
  cells[r] = [];
  for (let c = 0; c < COLS; c++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.style.setProperty('--c', color(r));
    const want = META.intended[c][r], got = META.detected[c][r];
    if (want && got) d.classList.add('on');
    else if (want && !got) d.classList.add('miss');
    else if (!want && got) d.classList.add('false');
    wrap.appendChild(d);
    cells[r][c] = d;
  }
  row.appendChild(lab);
  row.appendChild(wrap);
  rowsEl.appendChild(row);
}

for (const l of META.letters) {
  const d = document.createElement('div');
  d.className = 'letter';
  d.style.gridColumn = (l.col0 + 1) + ' / span ' + (l.col1 - l.col0);
  d.textContent = l.ch;
  lettersEl.appendChild(d);
}
function ensureAudio() {
  if (analyser || !window.AudioContext) return;
  try {
    actx = new AudioContext();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    analyser.connect(actx.destination);
    spec = new Float32Array(analyser.frequencyBinCount);
  } catch (e) {
    analyser = null;
  }
}

const fmin = 80, fmax = 800;
const logMin = Math.log(fmin), logMax = Math.log(fmax);
const xOf = (f) => (Math.log(f) - logMin) / (logMax - logMin);
const noteHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
function drawScope() {
  const w = scope.width, h = scope.height;
  sctx.clearRect(0, 0, w, h);
  const bg = sctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0c1019');
  bg.addColorStop(1, '#0a0d14');
  sctx.fillStyle = bg;
  sctx.fillRect(0, 0, w, h);
  // the seven rows' fundamentals
  sctx.font = '11px ui-monospace, monospace';
  ROWS.forEach((row, r) => {
    const x = xOf(noteHz(row.midi)) * w;
    sctx.strokeStyle = 'rgba(255,255,255,0.09)';
    sctx.beginPath();
    sctx.moveTo(x, 16);
    sctx.lineTo(x, h);
    sctx.stroke();
    sctx.fillStyle = color(r);
    sctx.fillText(row.note, Math.min(w - 28, x + 3), 12);
  });
  sctx.strokeStyle = 'rgba(255,255,255,0.12)';
  sctx.beginPath();
  sctx.moveTo(0, h - 1);
  sctx.lineTo(w, h - 1);
  sctx.stroke();
  if (!analyser) {
    sctx.fillStyle = 'rgba(122,134,153,0.7)';
    sctx.fillText('PRESS PLAY FOR THE LIVE SPECTRUM', 12, h - 12);
    sctx.fillText('80 HZ', 8, h - 24);
    sctx.fillText('800 HZ', w - 48, h - 24);
    return;
  }
  analyser.getFloatFrequencyData(spec);
  const sr = analyser.context.sampleRate;
  const bins = spec.length;
  const grad = sctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, 'rgba(122,229,255,0.10)');
  grad.addColorStop(0.55, 'rgba(122,229,255,0.55)');
  grad.addColorStop(1, 'rgba(255,216,138,0.95)');
  sctx.beginPath();
  sctx.moveTo(0, h);
  for (let x = 0; x < w; x++) {
    const f = Math.exp(logMin + (x / w) * (logMax - logMin));
    const b = (f / (sr / 2)) * bins;
    const i = Math.min(bins - 2, Math.max(0, Math.floor(b)));
    const frac = b - i;
    const db = spec[i] * (1 - frac) + spec[i + 1] * frac;
    const y = h - Math.max(0, Math.min(1, (db + 92) / 58)) * (h - 18);
    sctx.lineTo(x, y);
  }
  sctx.lineTo(w, h);
  sctx.closePath();
  sctx.fillStyle = grad;
  sctx.fill();
  sctx.strokeStyle = 'rgba(190,245,255,0.8)';
  sctx.lineWidth = 1;
  sctx.stroke();
  sctx.fillStyle = 'rgba(122,134,153,0.7)';
  sctx.fillText('80 HZ', 8, h - 8);
  sctx.fillText('800 HZ', w - 48, h - 8);
}

const pitch = () => {
  const a = cells[0][0].getBoundingClientRect();
  const b = cells[0][1].getBoundingClientRect();
  return b.left - a.left;
};
const left = cells[0][0].offsetLeft;
lettersEl.style.gridTemplateColumns = 'repeat(' + COLS + ', var(--cell))';
lettersEl.style.marginLeft = left + 'px';
beam.style.left = left + 'px';

let raf = 0;
function draw() {
  const t = audio.currentTime;
  const c = Math.floor((t - META.intro) / META.colSeconds);
  const cadence = t >= META.wordEnd;
  for (let r = 0; r < ROWS.length; r++) {
    for (let k = 0; k < COLS; k++) {
      cells[r][k].classList.toggle('now', k === c && !cadence);
    }
  }
  if (cadence) {
    for (let r = 0; r < ROWS.length; r++) {
      for (let k = 0; k < COLS; k++) {
        if (META.detected[k][r]) cells[r][k].style.filter = 'brightness(1.35)';
      }
    }
    beam.style.opacity = '0';
    chordEl.innerHTML = '<b>CADENCE</b> &nbsp; G2 + G3 A3 B3 C#4 D#4 F4 G#4';
  } else {
    for (let r = 0; r < ROWS.length; r++) {
      for (let k = 0; k < COLS; k++) cells[r][k].style.filter = '';
    }
    if (c >= 0 && c < COLS) {
      beam.style.transform = 'translateX(' + (c * pitch()) + 'px)';
      beam.style.opacity = '1';
      const notes = [];
      for (let r = 0; r < ROWS.length; r++) if (META.detected[c][r]) notes.push(ROWS[r].note);
      chordEl.innerHTML = '<b>COLUMN ' + (c + 1) + '</b> &nbsp; ' + (notes.length ? notes.join('  ') : 'REST');
    } else {
      beam.style.opacity = '0';
      chordEl.innerHTML = c < 0 ? 'BREATH' : 'RELEASE';
    }
  }
  fill.style.width = (100 * Math.min(1, t / META.duration)) + '%';
  timeEl.textContent = t.toFixed(1) + ' / ' + META.duration.toFixed(1) + ' S';
  drawScope();
  raf = requestAnimationFrame(draw);
}

function toggle() {
  if (audio.paused) {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    audio.play();
    playEl.textContent = 'PAUSE';
    cancelAnimationFrame(raf);
    draw();
  } else {
    audio.pause();
    playEl.textContent = 'PLAY';
    cancelAnimationFrame(raf);
  }
}
playEl.addEventListener('click', toggle);
audio.addEventListener('ended', () => { playEl.textContent = 'PLAY'; audio.currentTime = 0; draw(); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
draw();
</script>
</body>
</html>
`;

const page = html
  .replace("__META__", JSON.stringify(meta))
  .replaceAll("__HIT__", String(meta.stats.hit))
  .replaceAll("__INK__", String(meta.stats.ink))
  .replaceAll("__FALSE__", String(meta.stats.falseOn))
  .replaceAll("__DUR__", meta.duration.toFixed(1))
  .replaceAll("__VOICES__", String(meta.rowCount))
  .replaceAll("__COLS__", String(meta.colCount))
  .replaceAll("__WAV__", wav);
writeFileSync(outPath, page);
console.log(`wrote ${outPath}  ${(page.length / 1024).toFixed(0)} KB`);
