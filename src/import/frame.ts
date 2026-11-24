// Finds a Java Edition held map by the texture of its frame.
//
// Java draws the held map's parchment background 7/128 of the map's width beyond each edge, so the
// frame is a fixed picture tied to the map's square, whatever the map shows. Matching it, rather than
// looking for where frame ends and map begins, copes with unexplored map (the same parchment tint as
// the frame) along any edge. The match is a correlation of brightness, so it holds in shade and at
// night too. The texture is learned from screenshots by scripts/gen-frame-template.ts.
import type { Crop } from "../core/terrain";
import { FRAME_ROWS } from "./frameTemplate";
import { FRAME_H, FRAME_W, type RGBAImage } from "./image";

/** Frame width beyond each edge of the map, in map pixels. */
export const RING = 7;
const N = 128 + 2 * RING;
/** Frame rows used: the top edge and the left and right edges down to the map's bottom. The bottom edge is often under the hotbar. */
export const RING_ROWS = N - RING;

/** The frame cells, one map pixel each, in FRAME_ROWS order: [u, v, side] with u, v from the frame's top left; side 0 top, 1 left, 2 right. */
export const RING_CELLS: [number, number, number][] = [];
for (let v = 0; v < RING_ROWS; v++)
  for (let u = 0; u < N; u++) {
    if (v >= RING && u >= RING && u < N - RING) continue;
    RING_CELLS.push([u, v, v < RING ? 0 : u < RING ? 1 : 2]);
  }

/** FRAME_ROWS letters: brightness relative to the frame's median, from TEMPLATE_MIN in TEMPLATE_STEP steps. Space: no stable value (scenery shows through). */
export const TEMPLATE_CODE = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
export const TEMPLATE_MIN = 0.6, TEMPLATE_STEP = 0.0125;

/** A frame template ready to match: the cells with a value, and those values sharp and blurred. */
export interface FrameTemplate { u: Float64Array; v: Float64Array; side: Uint8Array; sharp: Float64Array; blurred: Float64Array }

export function parseTemplate(rows: string[]): FrameTemplate {
  const chars = rows.join("");
  if (chars.length !== RING_CELLS.length) throw new Error(`frame template has ${chars.length} cells, not ${RING_CELLS.length}`);
  const value = new Map<number, number>();
  RING_CELLS.forEach(([u, v], i) => { if (chars[i] !== " ") value.set(v * N + u, TEMPLATE_MIN + TEMPLATE_CODE.indexOf(chars[i]) * TEMPLATE_STEP); });
  const used = RING_CELLS.filter(([u, v]) => value.has(v * N + u));
  // the coarse search samples sparsely, so it compares with a template blurred over 5×5 map pixels
  const blur = ([u, v]: number[]) => {
    let s = 0, n = 0;
    for (let dv = -2; dv <= 2; dv++) for (let du = -2; du <= 2; du++) {
      const t = value.get((v + dv) * N + u + du);
      if (t !== undefined && u + du >= 0 && u + du < N) { s += t; n++; }
    }
    return s / n;
  };
  return {
    u: Float64Array.from(used, ([u]) => u - RING + 0.5),
    v: Float64Array.from(used, ([, v]) => v - RING + 0.5),
    side: Uint8Array.from(used, ([, , s]) => s),
    sharp: Float64Array.from(used, ([u, v]) => value.get(v * N + u)!),
    blurred: Float64Array.from(used, blur),
  };
}

const TEMPLATE = parseTemplate(FRAME_ROWS);

/** Brightness of each pixel of a 1280×720 frame. */
export function lumaPlane(img: RGBAImage): Float32Array {
  const L = new Float32Array(FRAME_W * FRAME_H), d = img.data;
  for (let i = 0; i < L.length; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return L;
}

/** `L` averaged over (2r+1)² boxes, for the coarse search. */
function blurPlane(L: Float32Array, r: number): Float32Array {
  const W = FRAME_W, H = FRAME_H, S = new Float64Array((W + 1) * (H + 1)), B = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0, row = 0; x < W; x++) {
    row += L[y * W + x];
    S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    B[y * W + x] = (S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return B;
}

/** Brightness at (x, y), bilinear between pixel centres (or the nearest pixel); NaN off the frame. */
export function sample(L: Float32Array, x: number, y: number, bilinear = true): number {
  const W = FRAME_W, H = FRAME_H;
  if (!bilinear) { const u = Math.floor(x), v = Math.floor(y); return u < 0 || v < 0 || u >= W || v >= H ? NaN : L[v * W + u]; }
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) return NaN;
  const o = y0 * W + x0;
  return (L[o] * (1 - fx) + L[o + 1] * fx) * (1 - fy) + (L[o + W] * (1 - fx) + L[o + W + 1] * fx) * fy;
}

const sums = new Float64Array(18);

/**
 * How well the frame around square `c` matches the template: the correlation of brightness on each
 * of the top, left and right edges (so light that varies across the frame matters less), averaged.
 * 1 is a perfect match. `stride` skips cells for speed.
 */
export function frameMatch(L: Float32Array, c: Crop, { t = TEMPLATE, stride = 1, coarse = false } = {}): number {
  const p = c.size / 128, want = coarse ? t.blurred : t.sharp;
  sums.fill(0);
  for (let k = 0; k < want.length; k += stride) {
    const a = sample(L, c.x + t.u[k] * p, c.y + t.v[k] * p, !coarse);
    if (a !== a) return -1; // the frame runs off the screenshot
    const b = want[k], o = t.side[k] * 6;
    sums[o]++; sums[o + 1] += a; sums[o + 2] += b; sums[o + 3] += a * a; sums[o + 4] += b * b; sums[o + 5] += a * b;
  }
  let total = 0;
  for (let o = 0; o < 18; o += 6) {
    const n = sums[o], cov = sums[o + 5] - (sums[o + 1] * sums[o + 2]) / n;
    const va = sums[o + 3] - sums[o + 1] ** 2 / n, vb = sums[o + 4] - sums[o + 2] ** 2 / n;
    total += va > 1e-6 ? cov / Math.sqrt(va * vb) : 0;
  }
  return total / 3;
}

/** Where to look: square sizes [from, to, step], the range for the square's centre x, top y [from, to], and the step. */
interface Window { sizes: [number, number, number]; cx: [number, number]; y: [number, number]; step: number }
/** Java draws a map held in both hands at a fixed field of view: about 540 wide, centred, near the top. */
const BOTH_HANDS: Window = { sizes: [480, 620, 4], cx: [600, 680], y: [10, 140], step: 4 };
/** Anywhere else (a map held in one hand, or another layout). */
const ANYWHERE: Window = { sizes: [280, 680, 16], cx: [0, FRAME_W], y: [8, 260], step: 8 };

/** The best-matching square in a window: a coarse pass on blurred brightness, then finer passes around its best few. */
function searchWindow(L: Float32Array, B: Float32Array, w: Window, t: FrameTemplate): { crop: Crop; match: number } {
  const coarse: { c: Crop; s: number }[] = [];
  for (let size = w.sizes[0]; size <= w.sizes[1]; size += w.sizes[2])
    for (let y = w.y[0]; y <= w.y[1] && y + size / 2 <= FRAME_H; y += w.step)
      for (let x = Math.max(8, w.cx[0] - size / 2); x + size / 2 <= w.cx[1] && x + size <= FRAME_W - 8; x += w.step) {
        const c = { x, y, size }, s = frameMatch(B, c, { t, stride: 3, coarse: true });
        if (s > 0.2) coarse.push({ c, s });
      }
  coarse.sort((a, b) => b.s - a.s);
  // the best few that are well apart: F3's text and other stripes can rival the map at this stage
  const picks: Crop[] = [];
  for (const { c } of coarse) {
    if (picks.length >= 8) break;
    if (picks.every((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) + Math.abs(p.size - c.size) > 24)) picks.push(c);
  }
  let best = { c: { x: 0, y: 0, size: 0 }, s: -2 };
  for (const c0 of picks)
    for (let ds = -8; ds <= 8; ds += 2) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const c = { x: c0.x + dx, y: c0.y + dy, size: c0.size + ds }, s = frameMatch(L, c, { t, stride: 3 });
      if (s > best.s) best = { c, s };
    }
  // polish with every cell, a pixel then half a pixel at a time
  let { c } = best, s = frameMatch(L, c, { t });
  for (const step of [1, 0.5])
    for (let improved = true; improved;) {
      improved = false;
      for (const [dx, dy, ds] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [-1, -1, 2], [1, 1, -2]]) {
        const n = { x: c.x + dx * step, y: c.y + dy * step, size: c.size + ds * step }, ns = frameMatch(L, n, { t });
        if (ns > s + 1e-9) { c = n; s = ns; improved = true; }
      }
    }
  return { crop: c, match: s };
}

/** Below this the square's surroundings don't look like a Java map frame. Real frames score 0.75–0.97; other screenshots below 0.4. */
export const MIN_FRAME_MATCH = 0.6;

/** The held map's square in a 1280×720 frame's brightness (see lumaPlane), or null if no Java map frame matches. */
export function findJavaMap(L: Float32Array, t = TEMPLATE): { crop: Crop; match: number } | null {
  const B = blurPlane(L, 5);
  let found = searchWindow(L, B, BOTH_HANDS, t);
  if (found.match < MIN_FRAME_MATCH) found = searchWindow(L, B, ANYWHERE, t);
  return found.match >= MIN_FRAME_MATCH ? found : null;
}
