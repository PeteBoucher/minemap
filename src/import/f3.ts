// Reads the player's position from Java Edition's F3 debug screen.
//
// F3 draws its lines at the top left in the game's pixel font: light grey on a dark box, no shadow,
// and crisp, each font pixel a whole number of screen pixels (2 or 3 on a Mac). So each glyph is cut
// back to its exact font-pixel bitmap and looked up among bitmaps learned from labelled screenshots
// (scripts/gen-f3-glyphs.ts). Two lines say where the player is:
//   XYZ: -6.313 / 62.11076 / 72.688
//   Block: -7 62 72
// The Block line is what's used (whole blocks, like Bedrock's "Position:"); the XYZ line, rounded
// down, must agree when it reads too, because a wrong position is worse than none.
import { F3_GLYPHS } from "./f3Glyphs";
import { type RGBAImage, chroma, luma } from "./image";
import type { Position } from "./ocr";

/** F3 text: light grey (224, 224, 224 when drawn). */
const isText = (img: RGBAImage, x: number, y: number) => luma(img, x, y) >= 180 && chroma(img, x, y) < 50;

/** Text with the dark box beside it, so a bright scene (snow, sky) isn't taken for text. */
function isBoxedText(img: RGBAImage, x: number, y: number): boolean {
  if (!isText(img, x, y)) return false;
  for (let d = 1; d <= 4; d++) if ((x - d >= 0 && luma(img, x - d, y) < 120) || (x + d < img.width && luma(img, x + d, y) < 120)) return true;
  return false;
}

export interface F3Glyph {
  /** Font pixels, rows top to bottom joined by "/", "#" for ink: e.g. "#.#/###/..#". */
  bitmap: string;
  /** Empty font pixels before this glyph. */
  gap: number;
}

/** Glyph rows: caps and digits fill rows 0–6, descenders reach row 7. */
const ROWS = 8;
/** F3 lines are this many font pixels apart. */
const PITCH = 9;
/** Wider than any glyph of the font, in font pixels: past the end of a line's box (the scene). */
const MAX_GLYPH = 7;
/** Empty font pixels that mean a space between words (glyphs within a word are 1 apart). */
const SPACE = 3;

/**
 * Every line of the F3 screen, as glyph bitmaps. F3 stacks its lines from the top of the screen on
 * a fixed pitch, so the first line gives the font pixel size and where the rest are; searching for
 * each line instead would be fooled by bright scenery (a snowy map) beside the text.
 */
export function f3Lines(img: RGBAImage): F3Glyph[][] {
  const x1 = Math.round(img.width * 0.5), first = firstLine(img, x1);
  if (!first) return [];
  const { y0, s } = first, lines: F3Glyph[][] = [];
  for (let y = y0; y + 7 * s <= img.height * 0.6; y += PITCH * s) {
    const line = readLine(img, y, s, x1);
    if (line.length) lines.push(line);
  }
  return lines;
}

/** The top line's first row and font pixel size, or null if the top left has no F3-like text. */
function firstLine(img: RGBAImage, x1: number): { y0: number; s: number } | null {
  let start = -1;
  for (let y = 0; y < img.height * 0.1; y++) {
    let n = 0;
    for (let x = 0; x < x1 && n < 3; x++) if (isBoxedText(img, x, y)) n++;
    if (n >= 3 && start < 0) start = y;
    if (n < 3 && start >= 0) {
      const s = strokeWidth(img, start, y - 1, x1), rows = (y - start) / s;
      if (s >= 1 && rows > 6.5 && rows < ROWS + 0.5) return { y0: start, s };
      start = -1;
    }
  }
  return null;
}

/** The most common width of a run of text pixels in rows y0–y1: one font pixel, as most strokes are. */
function strokeWidth(img: RGBAImage, y0: number, y1: number, x1: number): number {
  const runs = new Map<number, number>();
  for (let y = y0; y <= y1; y++)
    for (let x = 0, run = 0; x <= x1; x++) {
      if (x < x1 && isBoxedText(img, x, y)) run++;
      else if (run) { runs.set(run, (runs.get(run) ?? 0) + 1); run = 0; }
    }
  return [...runs].reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0])[0];
}

/** The glyphs of the line whose top row is y0, left to right, up to where its box ends. */
function readLine(img: RGBAImage, y0: number, s: number, x1: number): F3Glyph[] {
  const y1 = Math.min(img.height - 1, Math.round(y0 + ROWS * s) - 1);
  const colInk = (x: number) => { for (let y = y0; y <= y1; y++) if (isText(img, x, y)) return true; return false; };
  const glyphs: F3Glyph[] = [];
  let gx0 = -1, lastEnd = -1;
  for (let x = 0; x <= x1; x++) {
    const on = x < x1 && colInk(x);
    if (on && gx0 < 0) gx0 = x;
    if (!on && gx0 >= 0) {
      const cols = Math.round((x - gx0) / s);
      if (cols > MAX_GLYPH) break;
      const rowsOut: string[] = [];
      for (let r = 0; r < ROWS; r++) {
        let row = "";
        for (let c = 0; c < Math.max(1, cols); c++) {
          const px = Math.floor(gx0 + (c + 0.5) * s), py = Math.floor(y0 + (r + 0.5) * s);
          row += py <= y1 && isText(img, px, py) ? "#" : ".";
        }
        rowsOut.push(row);
      }
      glyphs.push({ bitmap: rowsOut.join("/"), gap: lastEnd < 0 ? 0 : Math.round((gx0 - lastEnd - 1) / s) });
      lastEnd = x - 1;
      gx0 = -1;
    }
    // a long empty run once there is text: the line has ended
    if (!on && gx0 < 0 && lastEnd >= 0 && (x - lastEnd) / s > 12) break;
  }
  return glyphs;
}

/** Text of a line: "?" for a glyph not among the learned bitmaps. */
export function f3Text(line: F3Glyph[]): string {
  return line.map((g) => (g.gap >= SPACE ? " " : "") + (F3_GLYPHS[g.bitmap] ?? "?")).join("").trim();
}

const BLOCK = /^Block: (-?\d+) (-?\d+) (-?\d+)(?: |$)/;
const XYZ = /^XYZ: (-?\d+\.\d+) \/ (-?\d+\.\d+) \/ (-?\d+\.\d+)(?: |$)/;

/**
 * The block position in F3 lines' text: the Block line, checked against the XYZ line rounded down
 * when both are there. Null if neither reads, or they disagree.
 */
export function f3PositionFromText(texts: string[]): Position | null {
  let block: Position | null = null, xyz: Position | null = null;
  for (const text of texts) {
    const b = BLOCK.exec(text), p = XYZ.exec(text);
    if (b) block = { x: +b[1], y: +b[2], z: +b[3] };
    if (p) xyz = { x: Math.floor(+p[1]), y: Math.floor(+p[2]), z: Math.floor(+p[3]) };
  }
  if (block && xyz && (block.x !== xyz.x || block.y !== xyz.y || block.z !== xyz.z)) return null;
  return block ?? xyz;
}

/** The player's block position from a screenshot with F3 open, or null if it can't be read surely. */
export function readF3Position(img: RGBAImage): Position | null {
  return f3PositionFromText(f3Lines(img).map(f3Text));
}
