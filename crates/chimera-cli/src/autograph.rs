//! `render autograph`: CHIMERA signs its own name in a 5x7 typeface, one voice per row.
//!
//! Seven voices are tuned to a whole-tone cluster. The word is scanned column by column; a
//! voice sounds wherever the glyph has ink in its row. The bitmap is therefore the score, and
//! the score is a bitmap. The type is the same 5x7 font `tools/lib/image.ts` uses for labels on
//! the project's plots.
//!
//! The grid written to `autograph.json` and drawn by `tools/autograph-poster.ts` is recovered
//! from each throat's rendered audio, not copied from the score: RMS in each cell decides
//! whether that voice actually sounded. The seven stems are the choir inside `autograph.wav`.

use crate::{Ctx, FS, arg, peak};
use chimera::anatomy::human::{ArticKey, BODY_CHILD, BODY_FEMALE, BODY_MALE, BodyMix, HumanBody};
use chimera::math::{js_max, js_round, log10, pow, sqrt};
use chimera::phonetics::planner::vowel_artic;
use chimera::voice::human_voice::{HumanVoice, SourcePatch};

/// Columns per glyph, and the blank column between glyphs.
const GLYPH_COLS: usize = 5;
const GLYPH_GAP: usize = 1;
/// Seconds per scanned column.
const COL_SECONDS: f64 = 0.2;
/// Silence before the first column, and the held chord after the last.
const INTRO: f64 = 1.2;
const OUTRO_HOLD: f64 = 1.5;
const OUTRO_RELEASE: f64 = 1.1;

const WORD: &str = "CHIMERA";

/// A 5x7 glyph from `tools/lib/image.ts`, rows top to bottom (MSB = leftmost column).
struct Glyph {
    ch: char,
    rows: [u8; 7],
}

const GLYPHS: [Glyph; 7] = [
    Glyph {
        ch: 'C',
        rows: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
    },
    Glyph {
        ch: 'H',
        rows: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
    },
    Glyph {
        ch: 'I',
        rows: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
    },
    Glyph {
        ch: 'M',
        rows: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
    },
    Glyph {
        ch: 'E',
        rows: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
    },
    Glyph {
        ch: 'R',
        rows: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
    },
    Glyph {
        ch: 'A',
        rows: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
    },
];

/// One throat of the seven-headed autograph. The pitches are a whole-tone cluster from G3 to
/// G#4: no row is an octave from another, so the chord stays open and each throat keeps its own
/// colour.
struct Row {
    midi: f64,
    note: &'static str,
    vowel: &'static str,
    vowel_label: &'static str,
    body: HumanBody,
    mix: BodyMix,
    gain: f64,
}

const ROWS: [Row; 7] = [
    Row {
        midi: 68.0,
        note: "G#4",
        vowel: "i",
        vowel_label: "EE",
        body: BODY_CHILD,
        mix: BodyMix::CHILD,
        gain: 0.72,
    },
    Row {
        midi: 65.0,
        note: "F4",
        vowel: "e",
        vowel_label: "EH",
        body: BODY_FEMALE,
        mix: BodyMix::FEMALE,
        gain: 0.95,
    },
    Row {
        midi: 63.0,
        note: "D#4",
        vowel: "a",
        vowel_label: "AH",
        body: BODY_FEMALE,
        mix: BodyMix::FEMALE,
        gain: 1.0,
    },
    Row {
        midi: 61.0,
        note: "C#4",
        vowel: "o",
        vowel_label: "OH",
        body: BODY_FEMALE,
        mix: BodyMix::FEMALE,
        gain: 1.0,
    },
    Row {
        midi: 59.0,
        note: "B3",
        vowel: "u",
        vowel_label: "OO",
        body: BODY_FEMALE,
        mix: BodyMix::FEMALE,
        gain: 1.0,
    },
    Row {
        midi: 57.0,
        note: "A3",
        vowel: "ɔ",
        vowel_label: "AW",
        body: BODY_MALE,
        mix: BodyMix::MALE,
        gain: 1.15,
    },
    Row {
        midi: 55.0,
        note: "G3",
        vowel: "ɑ",
        vowel_label: "AH",
        body: BODY_MALE,
        mix: BodyMix::MALE,
        gain: 1.2,
    },
];

fn hz(midi: f64) -> f64 {
    440.0 * pow(2.0, (midi - 69.0) / 12.0)
}

/// The word as columns of seven row bits, and where each letter starts and ends.
fn typeset() -> (Vec<[bool; 7]>, Vec<(char, usize, usize)>) {
    let width = WORD.chars().count() * (GLYPH_COLS + GLYPH_GAP) - GLYPH_GAP;
    let mut cols = vec![[false; 7]; width];
    let mut spans = Vec::new();
    let mut x = 0;
    for g in &GLYPHS {
        let start = x;
        for c in 0..GLYPH_COLS {
            let bit = 1 << (GLYPH_COLS - 1 - c);
            for (r, row) in g.rows.iter().enumerate() {
                cols[x + c][r] = row & bit != 0;
            }
        }
        x += GLYPH_COLS;
        spans.push((g.ch, start, x));
        x += GLYPH_GAP;
    }
    (cols, spans)
}

/// Contiguous runs of ink in one row: one note per run, not per cell.
fn runs(cols: &[[bool; 7]], row: usize) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    let mut c = 0;
    while c < cols.len() {
        if !cols[c][row] {
            c += 1;
            continue;
        }
        let start = c;
        while c < cols.len() && cols[c][row] {
            c += 1;
        }
        let t0 = INTRO + start as f64 * COL_SECONDS;
        let t1 = INTRO + c as f64 * COL_SECONDS - 0.035;
        out.push((t0, t1));
    }
    out
}

/// A small Schroeder room: four damped combs and two allpasses.
fn room(x: &[f32], wet: f64) -> Vec<f32> {
    let mut out = vec![0f32; x.len()];
    for delay in [0.0297, 0.0371, 0.0411, 0.0437] {
        let n = (delay * FS) as usize;
        let mut buf = vec![0f32; n];
        let mut idx = 0;
        let mut lp = 0f32;
        for i in 0..x.len() {
            let y = buf[idx];
            lp = y * 0.62 + lp * 0.38;
            buf[idx] = x[i] + lp * 0.79;
            idx = (idx + 1) % n;
            out[i] += y * 0.25;
        }
    }
    for delay in [0.0051, 0.0017] {
        let n = (delay * FS) as usize;
        let mut buf = vec![0f32; n];
        let mut idx = 0;
        for i in 0..x.len() {
            let y = buf[idx];
            let v = out[i] + y * 0.5;
            buf[idx] = v;
            out[i] = y - v * 0.5;
            idx = (idx + 1) % n;
        }
    }
    for (o, d) in out.iter_mut().zip(x) {
        *o = *d + *o * wet as f32;
    }
    out
}

fn mix_into(dst: &mut [f32], src: &[f32], gain: f64) {
    for (d, s) in dst.iter_mut().zip(src) {
        *d += *s * gain as f32;
    }
}

fn smoothstep(x: f64) -> f64 {
    let u = x.clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

/// One throat, sounding only where its row has ink. The gate follows the note runs exactly, so
/// a rest is a rest and the bitmap can be read back from the audio.
fn render_row(
    row: &Row,
    cols: &[[bool; 7]],
    r: usize,
    n_samples: usize,
    word_end: f64,
) -> Result<Vec<f32>, String> {
    let mut v = HumanVoice::new(FS, row.body, 2);
    v.set_source(&SourcePatch {
        f0: Some(hz(row.midi)),
        pressure: Some(8.2),
        tension: Some(0.52),
        vibrato_depth: Some(9.0),
        vibrato_rate: Some(5.1),
        breathiness: Some(0.04),
        voiced: Some(true),
        ..Default::default()
    });
    let mut artic = vowel_artic(row.vowel, row.mix)
        .ok_or_else(|| format!("no calibrated /{}/ for this body", row.vowel))?;
    artic.set(ArticKey::TtCurl, 0.0);
    v.set_articulation(&artic, Some(true));

    let spans = runs(cols, r);
    let mut out = vec![0f32; n_samples];
    let mut i = 0;
    while i < n_samples {
        let t = i as f64 / FS;
        let gate = if t >= word_end && t < word_end + OUTRO_HOLD {
            1.0
        } else if t >= INTRO && t < word_end {
            if spans.iter().any(|(a, b)| t >= *a && t < *b) {
                1.0
            } else {
                0.0
            }
        } else {
            0.0
        };
        v.set_gate(gate);
        let end = (i + 128).min(n_samples);
        v.render(&mut out[i..end]);
        i = end;
    }
    Ok(out)
}

/// RMS of one cell in a rendered stem: did this throat sound here?
fn cell_rms(x: &[f32], c: usize) -> f64 {
    let a = ((INTRO + c as f64 * COL_SECONDS + 0.05) * FS) as usize;
    let b = ((INTRO + c as f64 * COL_SECONDS + 0.16) * FS) as usize;
    let b = b.min(x.len());
    if a >= b {
        return 0.0;
    }
    let sum: f64 = x[a..b].iter().map(|v| (*v as f64) * (*v as f64)).sum();
    sqrt(sum / (b - a) as f64)
}

pub fn run(ctx: &Ctx, a: &[String]) -> Result<(), String> {
    let out_dir = arg(a, 0, "out/autograph");
    std::fs::create_dir_all(out_dir).map_err(|e| format!("{out_dir}: {e}"))?;
    let (cols, letter_spans) = typeset();
    let n_cols = cols.len();
    let word_end = INTRO + n_cols as f64 * COL_SECONDS;
    let total = word_end + OUTRO_HOLD + OUTRO_RELEASE;
    let n_samples = js_round(total * FS) as usize;

    let mut stems: Vec<Vec<f32>> = Vec::with_capacity(ROWS.len());
    for (r, row) in ROWS.iter().enumerate() {
        stems.push(render_row(row, &cols, r, n_samples, word_end)?);
    }

    // Read the bitmap back out of each throat's own audio. The seven stems are the choir inside the WAV.
    let row_top: Vec<f64> = (0..7)
        .map(|r| (0..n_cols).fold(0.0, |m, c| js_max(m, cell_rms(&stems[r], c))))
        .collect();
    let detected: Vec<[bool; 7]> = (0..n_cols)
        .map(|c| {
            let mut on = [false; 7];
            for r in 0..7 {
                on[r] = row_top[r] > 0.0 && cell_rms(&stems[r], c) / row_top[r] > 0.12;
            }
            on
        })
        .collect();

    let (mut ink, mut hit, mut rest, mut false_on) = (0usize, 0usize, 0usize, 0usize);
    for (c, d) in cols.iter().zip(&detected) {
        for r in 0..7 {
            if c[r] {
                ink += 1;
                if d[r] {
                    hit += 1;
                }
            } else {
                rest += 1;
                if d[r] {
                    false_on += 1;
                }
            }
        }
    }

    // Two male pedals under the whole piece: G2 for systems that can, D3 for the ones that cannot.
    // They enter under the intro, so the first note is not the first sound.
    let pedal = |midi: f64| -> Result<Vec<f32>, String> {
        let mut v = HumanVoice::new(FS, BODY_MALE, 2);
        v.set_source(&SourcePatch {
            f0: Some(hz(midi)),
            pressure: Some(9.5),
            tension: Some(0.48),
            vibrato_depth: Some(6.0),
            voiced: Some(true),
            ..Default::default()
        });
        if let Some(artic) = vowel_artic("ɑ", BodyMix::MALE) {
            v.set_articulation(&artic, Some(true));
        }
        let mut buf = vec![0f32; n_samples];
        let mut i = 0;
        while i < n_samples {
            v.set_gate(1.0);
            let end = (i + 128).min(n_samples);
            v.render(&mut buf[i..end]);
            i = end;
        }
        for (i, b) in buf.iter_mut().enumerate() {
            let t = i as f64 / FS;
            *b *= (smoothstep(t / 2.2) * (0.55 + 0.45 * smoothstep((t - word_end) / 0.8))) as f32;
        }
        Ok(buf)
    };
    let g2 = pedal(43.0)?;
    let d3 = pedal(50.0)?;

    let mut mix = vec![0f32; n_samples];
    for (row, stem) in ROWS.iter().zip(&stems) {
        mix_into(&mut mix, stem, row.gain);
    }
    mix_into(&mut mix, &g2, 0.5);
    mix_into(&mut mix, &d3, 0.35);
    let mut mix = room(&mix, 0.2);

    // A slow lift into the word, and the release of the room at the tail.
    for (i, x) in mix.iter_mut().enumerate() {
        let t = i as f64 / FS;
        *x *= (0.82 + 0.18 * smoothstep(t / INTRO)) as f32;
    }
    let p = peak(&mix).max(1e-9);
    let norm = 0.9 / p;
    for x in &mut mix {
        *x = (*x * norm as f32).clamp(-1.0, 1.0);
    }

    ctx.write_wav(&format!("{out_dir}/autograph.wav"), &mix)?;

    // ---- the poster's data: intended and heard, plus everything the drawing needs
    let letters: Vec<serde_json::Value> = letter_spans
        .iter()
        .map(|(ch, c0, c1)| serde_json::json!({"ch": ch.to_string(), "col0": c0, "col1": c1}))
        .collect();
    let rows: Vec<serde_json::Value> = ROWS
        .iter()
        .map(|r| {
            serde_json::json!({
                "midi": r.midi, "note": r.note, "vowel": r.vowel, "vowelLabel": r.vowel_label,
                "body": r.body.name,
            })
        })
        .collect();
    let as_bools = |g: &[[bool; 7]]| -> Vec<Vec<bool>> {
        g.iter().map(|c| (0..7).map(|r| c[r]).collect()).collect()
    };
    let meta = serde_json::json!({
        "word": WORD,
        "rowCount": ROWS.len(),
        "colCount": n_cols,
        "colSeconds": COL_SECONDS,
        "intro": INTRO,
        "wordEnd": word_end,
        "duration": total,
        "rows": rows,
        "letters": letters,
        "intended": as_bools(&cols),
        "detected": as_bools(&detected),
        "stats": {
            "ink": ink, "hit": hit, "rest": rest, "falseOn": false_on,
        },
    });
    std::fs::write(
        format!("{out_dir}/autograph.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    println!(
        "wrote {out_dir}/autograph.wav  {total:.2} s  peak {:.3}",
        peak(&mix)
    );
    println!(
        "{WORD}: 7 throats, {n_cols} columns, {:.1} s of type  ({ink} ink cells, {rest} rests)",
        n_cols as f64 * COL_SECONDS
    );
    println!(
        "read back from the stems: {hit}/{ink} ink, {false_on} false onsets  ({:.1} dB peak)",
        20.0 * log10(peak(&mix).max(1e-9))
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_word_typesets_to_forty_one_columns() {
        let (cols, spans) = typeset();
        assert_eq!(cols.len(), 41);
        assert_eq!(spans.len(), 7);
        assert_eq!(spans[0], ('C', 0, 5));
        assert_eq!(spans[6], ('A', 36, 41));
        let ink = cols
            .iter()
            .map(|c| c.iter().filter(|b| **b).count())
            .sum::<usize>();
        assert_eq!(ink, 113);
    }

    #[test]
    fn the_first_and_last_columns_are_the_letters_they_should_be() {
        let (cols, _) = typeset();
        // C opens with its round back, A closes with its two feet and crossbar
        assert_eq!(cols[0].iter().filter(|b| **b).count(), 5);
        assert_eq!(cols[40].iter().filter(|b| **b).count(), 6);
    }

    #[test]
    fn a_run_never_crosses_a_letter_gap() {
        let (cols, _) = typeset();
        let spans = runs(&cols, 0);
        // the top row: C, the two posts of H, I, the two posts of M, E, R, A
        assert_eq!(spans.len(), 9);
        for (a, b) in spans {
            assert!(b > a);
            let c0 = ((a - INTRO) / COL_SECONDS).round() as usize;
            let c1 = ((b - INTRO) / COL_SECONDS).floor() as usize;
            assert!(!(c0..=c1).any(|c| c % (GLYPH_COLS + GLYPH_GAP) == GLYPH_COLS));
        }
    }
}
