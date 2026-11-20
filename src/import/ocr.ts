// Reads the "Position: x, y, z" line that Minecraft shows when "Show coordinates" is on.
// The game draws it in a fixed pixel font (white with a dark drop shadow), so instead of a
// general OCR engine we split the line into glyphs and match each against learned templates.
import { readF3Position } from "./f3";
import { GLYPHS } from "./glyphs";
import { type RGBAImage, chroma, luma } from "./image";

/** Glyph feature grid: columns × rows sampled over the glyph's box. */
export const GW = 5, GH = 8;

export interface Glyph {
  x0: number; x1: number;
  /** Ink amounts (0–1) on a GW×GH grid spanning the glyph's columns and the whole line's rows. */
  cells: number[];
  /** Width in font pixels (line height / 8). */
  wu: number;
  /** Font pixels of empty space before this glyph. */
  gap: number;
}

export interface Line { y0: number; y1: number; glyphs: Glyph[] }

/** 0–1 "how much this pixel looks like text": bright and grey. */
function ink(img: RGBAImage, x: number, y: number): number {
  if (chroma(img, x, y) > 45) return 0;
  return Math.max(0, Math.min(1, (luma(img, x, y) - 130) / 80));
}
const isInk = (img: RGBAImage, x: number, y: number) => ink(img, x, y) > 0.5;

/**
 * Text pixel with dark pixels nearby (the drop shadow and the dark box behind the text).
 * Used to find text lines without being fooled by bright snow or sand in the scene.
 */
function isTextEdge(img: RGBAImage, x: number, y: number): boolean {
  if (!isInk(img, x, y) || luma(img, x, y) < 170) return false;
  // dark after (shadow, right or below) AND dark before (box, left or above): a bright scene pixel
  // just outside the box only has dark on one side
  let after = false, before = false;
  for (let d = 1; d <= 4 && !(after && before); d++) {
    if (!after && ((x + d < img.width && luma(img, x + d, y) < 110) || (y + d < img.height && luma(img, x, y + d) < 110))) after = true;
    if (!before && ((x - d >= 0 && luma(img, x - d, y) < 110) || (y - d >= 0 && luma(img, x, y - d) < 110))) before = true;
  }
  return after && before;
}

/**
 * Horizontal bands in the search area that contain text-like pixels, top to bottom.
 * The coordinates box is at the left edge of the screen (of each half, in split-screen).
 */
export function findLines(img: RGBAImage, x0 = 0, x1 = Math.round(img.width * 0.4), y1 = Math.round(img.height * 0.5)): { y0: number; y1: number }[] {
  const minH = Math.max(5, Math.round(img.height * 0.01)), maxH = Math.round(img.height * 0.06);
  const bands: { y0: number; y1: number }[] = [];
  let start = -1;
  for (let y = 0; y <= y1; y++) {
    let n = 0;
    if (y < y1) for (let x = x0; x < x1; x++) if (isTextEdge(img, x, y)) n++;
    if (n >= 3 && start < 0) start = y;
    if ((n < 3 || y === y1) && start >= 0) {
      const h = y - start;
      if (h >= minH && h <= maxH) bands.push({ y0: start, y1: y - 1 });
      start = -1;
    }
  }
  return bands;
}

/** Split a text band into glyphs, left to right, starting at x0. */
export function segment(img: RGBAImage, band: { y0: number; y1: number }, x0 = 0, x1 = Math.round(img.width * 0.4)): Line {
  const H = band.y1 - band.y0 + 1, unit = H / GH;
  const colInk = (x: number) => { for (let y = band.y0; y <= band.y1; y++) if (isInk(img, x, y)) return true; return false; };
  const glyphs: Glyph[] = [];
  let start = -1, lastEnd = x0 - 1;
  for (let x = x0; x <= x1; x++) {
    const on = x < x1 && colInk(x);
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      const gx0 = start, gx1 = x - 1, w = gx1 - gx0 + 1;
      const cells: number[] = [];
      for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
        // average ink over the cell's pixel area
        const ya = band.y0 + (r * H) / GH, yb = band.y0 + ((r + 1) * H) / GH;
        const xa = gx0 + (c * w) / GW, xb = gx0 + ((c + 1) * w) / GW;
        let s = 0, n = 0;
        for (let y = Math.floor(ya); y < Math.max(Math.floor(ya) + 1, Math.ceil(yb)); y++)
          for (let xx = Math.floor(xa); xx < Math.max(Math.floor(xa) + 1, Math.ceil(xb)); xx++) { s += ink(img, xx, y); n++; }
        cells.push(s / n);
      }
      glyphs.push({ x0: gx0, x1: gx1, cells, wu: w / unit, gap: (gx0 - lastEnd - 1) / unit });
      lastEnd = gx1;
      start = -1;
    }
    // stop after a long run of empty space once we have some glyphs: the text box has ended
    if (!on && start < 0 && glyphs.length && (x - lastEnd) / unit > 12) break;
  }
  return { ...band, glyphs };
}

/** Distance between a glyph and a template (lower is closer). */
export function glyphDistance(g: Pick<Glyph, "cells" | "wu">, t: { cells: number[]; wu: number }): number {
  let d = 0;
  for (let i = 0; i < g.cells.length; i++) d += (g.cells[i] - t.cells[i]) ** 2;
  return d / g.cells.length + 0.05 * (g.wu - t.wu) ** 2;
}

/** Best template character for a glyph, with its distance. */
export function classify(g: Glyph): { ch: string; d: number } {
  let best = { ch: "?", d: Infinity };
  for (const t of GLYPHS) {
    const d = glyphDistance(g, t);
    if (d < best.d) best = { ch: t.ch, d };
  }
  return best;
}

/** Glyphs further than this from every template are treated as unreadable. */
export const MAX_DISTANCE = 0.08;

export interface Position { x: number; y: number; z: number }

/** Font pixels of empty space that separate words. */
export const WORD_GAP = 2;

/** Text of a line, with "?" for unreadable glyphs and spaces where the gap is wide. */
export function lineText(line: Line): string {
  return line.glyphs.map((g) => {
    const { ch, d } = classify(g);
    return (g.gap > WORD_GAP ? " " : "") + (d <= MAX_DISTANCE ? ch : "?");
  }).join("").trim();
}

// Three numbers after the label's colon. In split-screen the text is so small that blur can break the
// letters of "Position" into pieces, so the label needn't read, but it must hold no digits: a digit
// misread as the colon would otherwise give a wrong position instead of none.
const POSITION = /^[^\d:]*:\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/;

/** The position in a line's text, or null if it isn't a "Position: x, y, z" line. */
export function positionFromText(text: string): Position | null {
  const m = POSITION.exec(text);
  return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
}

/**
 * The player's position, or null if it can't be read: Bedrock's "Show coordinates" line, or Java
 * Edition's F3 screen (see f3.ts).
 */
export function readPosition(img: RGBAImage): Position | null {
  return readCoordinatesLine(img) ?? readF3Position(img);
}

/** The position from Bedrock's "Position: x, y, z" line. */
function readCoordinatesLine(img: RGBAImage): Position | null {
  // the text box sits at the left edge of each split-screen half; try the left half first
  const halves = [[0, Math.round(img.width * 0.4)], [Math.round(img.width * 0.5), Math.round(img.width * 0.9)]];
  for (const [x0, x1] of halves) {
    for (const band of findLines(img, x0, x1)) {
      const p = positionFromText(lineText(segment(img, band, x0, x1)));
      if (p) return p;
    }
  }
  return null;
}
