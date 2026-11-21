# Autograph: the voice signs its own name

An experiment, not a product feature. `chimera render autograph` gives the engine seven throats
and uses the project's own 5x7 plot font as the score. The word is **CHIMERA**.

## The score is a bitmap

Each glyph is five columns of seven row bits (the `FONT` in `tools/lib/image.ts`). The renderer
scans the word one column at a time, 200 ms a column, and a voice sounds wherever its row has
ink. A horizontal stroke is one held note; a vertical stroke is a chord; a letter gap is a rest.
The type is the score, and the audio is the type.

## Seven throats

One `HumanVoice` per row, each with its own body and vowel:

| row | note | vowel | body |
|----:|:-----|:------|:-----|
| 0 | G#4 | /i/ | child |
| 1 | F4 | /e/ | female |
| 2 | D#4 | /a/ | female |
| 3 | C#4 | /o/ | female |
| 4 | B3 | /u/ | female |
| 5 | A3 | /ɔ/ | male |
| 6 | G3 | /ɑ/ | male |

The pitches are a whole-tone cluster, G3 A3 B3 C#4 D#4 F4 G#4: no row is an octave above
another, so the chord stays open. A male G2 and D3 pedal under the whole piece, entering under the
intro, and a small Schroeder room sits on the mix.

## Read back from the audio

The grid written to `autograph.json` is not copied from the score. For every cell, the renderer
measures RMS in that row's rendered stem inside that cell's window. A cell is ink when its RMS is
at least 12% of that row's loudest cell. All 113 ink cells and all 174 rests are recovered, with
no false onsets. The seven stems are the choir inside the WAV; two pedals and a small room are
added after. The poster draws the recovered grid over the intended one, so a mismatch would
show red.

## Run it

```sh
cargo run --release -p chimera-cli -- render autograph out/autograph
bun tools/autograph-poster.ts out/autograph/autograph.json out/autograph/autograph.wav out/autograph/autograph.png
bun tools/autograph-player.ts out/autograph/autograph.json out/autograph/autograph.wav out/autograph/autograph.html --embed
bun tools/spectrogram.ts out/autograph/autograph.wav out/autograph/autograph-spectrogram.png "AUTOGRAPH" 1600 30
```

`autograph.html` (with `--embed`) is one self-contained file: the grid, the WAV, and a live
spectrum. Open it from disk, press play, and the scanner prints the word column by column while
the seven fundamentals rise out of the mix.

Outputs: `autograph.wav`, `autograph.json`, `autograph.png` (the poster), and
`autograph-spectrogram.png`.
