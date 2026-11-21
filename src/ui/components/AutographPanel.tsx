import { Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "../store.ts";
import { ActionBar, PrimaryButton } from "./ActionBar.tsx";
import { Chip, Screen } from "./Screen.tsx";

/** One throat per row of the 5x7 typeface. Pitch rises with the row. */
const ROWS = [
  { midi: 68, note: "G#4" },
  { midi: 65, note: "F4" },
  { midi: 63, note: "D#4" },
  { midi: 61, note: "C#4" },
  { midi: 59, note: "B3" },
  { midi: 57, note: "A3" },
  { midi: 55, note: "G3" },
];

/** The 5x7 glyphs from tools/lib/image.ts, rows top to bottom (MSB = leftmost column). */
const GLYPHS: Record<string, number[]> = {
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
};
const WORD = "CHIMERA";
const GLYPH_COLS = 5;
const GLYPH_GAP = 1;
const COLS = WORD.length * (GLYPH_COLS + GLYPH_GAP) - GLYPH_GAP;

/** columns of seven row bits, left to right */
function chimera(): boolean[][] {
  const cols: boolean[][] = Array.from({ length: COLS }, () => Array(7).fill(false));
  let x = 0;
  for (const ch of WORD) {
    const glyph = GLYPHS[ch];
    for (let c = 0; c < GLYPH_COLS; c++) {
      for (let r = 0; r < 7; r++) cols[x + c][r] = (glyph[r] & (1 << (GLYPH_COLS - 1 - c))) !== 0;
    }
    x += GLYPH_COLS + GLYPH_GAP;
  }
  return cols;
}

function clearGrid(): boolean[][] {
  return Array.from({ length: COLS }, () => Array(7).fill(false));
}

/**
 * The Play tab's autograph pad: a 5x7 bitmap played on the live voice. The engine is
 * monophonic, so each column is an arpeggio rather than a chord; a dense column takes longer,
 * like a printer slowing down on a vertical stroke. The head on the left is the real head.
 */
export function AutographRight() {
  const start = useStore((s) => s.start);
  const noteOn = useStore((s) => s.noteOn);
  const noteOff = useStore((s) => s.noteOff);
  const setAutograph = useStore((s) => s.setAutograph);
  const [grid, setGrid] = useState<boolean[][]>(chimera);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [colMs, setColMs] = useState(190);

  const timers = useRef<number[]>([]);
  const run = useRef(0);
  const sounding = useRef(new Set<number>());

  const stop = () => {
    run.current++;
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
    for (const m of sounding.current) noteOff(m);
    sounding.current.clear();
    setPlaying(false);
    setCursor(null);
  };

  useEffect(
    () => () => {
      run.current++;
      for (const t of timers.current) window.clearTimeout(t);
      for (const m of sounding.current) noteOff(m);
    },
    [noteOff],
  );

  const print = async () => {
    if (playing) {
      stop();
      return;
    }
    stop();
    await start();
    const id = ++run.current;
    setPlaying(true);
    let at = 0;
    for (let c = 0; c < COLS; c++) {
      const rows = ROWS.map((_, r) => r).filter((r) => grid[c][r]);
      if (!rows.length) {
        at += 70;
        continue;
      }
      const span = Math.max(colMs, rows.length * 55);
      const noteMs = Math.max(35, span / rows.length - 28);
      rows.forEach((r, i) => {
        const t0 = at + (i * span) / rows.length;
        timers.current.push(
          window.setTimeout(() => {
            if (run.current !== id) return;
            noteOn(ROWS[r].midi);
            sounding.current.add(ROWS[r].midi);
            setCursor([c, r]);
            timers.current.push(
              window.setTimeout(() => {
                noteOff(ROWS[r].midi);
                sounding.current.delete(ROWS[r].midi);
              }, noteMs),
            );
          }, t0),
        );
      });
      at += span;
    }
    timers.current.push(
      window.setTimeout(() => {
        if (run.current !== id) return;
        setPlaying(false);
        setCursor(null);
      }, at + 120),
    );
  };

  const load = (next: boolean[][]) => {
    stop();
    setGrid(next);
  };

  return (
    <div className="right right-autograph">
      <ActionBar label="Autograph" onSpace={() => void print()}>
        <PrimaryButton label="Print" playing={playing} onClick={() => void print()} />
        <Chip onClick={() => load(chimera())}>Chimera</Chip>
        <Chip onClick={() => load(clearGrid())}>Clear</Chip>
        <label className="autograph-speed">
          COLUMN
          <input type="range" min={120} max={320} step={10} value={colMs} onChange={(e) => setColMs(Number(e.target.value))} />
          <span>{colMs} ms</span>
        </label>
        <Chip onClick={() => setAutograph(false)}>Back</Chip>
      </ActionBar>
      <Screen className="s-autograph" title="Autograph" sub="Paint seven rows; the voice prints them">
        <div className="autograph-grid" style={{ gridTemplateColumns: `42px repeat(${COLS}, minmax(7px, 1fr))` }}>
          {ROWS.map((row, r) => (
            <Fragment key={row.note}>
              <span className="autograph-note">{row.note}</span>
              {Array.from({ length: COLS }, (_, c) => (
                <button
                  key={c}
                  type="button"
                  className={`autograph-cell${grid[c][r] ? " on" : ""}${cursor && cursor[0] === c && cursor[1] === r ? " now" : ""}`}
                  aria-label={`${row.note}, column ${c + 1}`}
                  aria-pressed={grid[c][r]}
                  onClick={() => {
                    if (playing) return;
                    setGrid((g) => g.map((col, ci) => (ci === c ? col.map((v, ri) => (ri === r ? !v : v)) : col)));
                  }}
                />
              ))}
            </Fragment>
          ))}
        </div>
        <div className="autograph-letters" style={{ gridTemplateColumns: `42px repeat(${COLS}, minmax(7px, 1fr))` }} aria-hidden="true">
          <span />
          {WORD.split("").map((ch, i) => (
            <span key={i} style={{ gridColumn: `${2 + i * (GLYPH_COLS + GLYPH_GAP)} / span ${GLYPH_COLS}` }}>
              {ch}
            </span>
          ))}
        </div>
        <p className="autograph-read" aria-live="polite">
          {cursor
            ? `${ROWS[cursor[1]].note} · COLUMN ${cursor[0] + 1} / ${COLS}`
            : playing
              ? "SCANNING"
              : "CLICK CELLS TO DRAW, THEN PRINT. SPACE PRINTS TOO."}
        </p>
        <p className="autograph-help">
          Each column is a chord in the bitmap. The engine is monophonic, so a column plays as a fast arpeggio,
          and a dense column takes longer, like a printer slowing on a vertical stroke.
        </p>
      </Screen>
    </div>
  );
}
