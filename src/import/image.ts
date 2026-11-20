// Minimal image type shared by the importer: browser ImageData and decoded JPEGs in tests both fit it.
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Perceived brightness 0–255 at (x, y). */
export function luma(img: RGBAImage, x: number, y: number): number {
  const o = (y * img.width + x) * 4, d = img.data;
  return 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
}

/** Max minus min channel at (x, y): 0 for greys. */
export function chroma(img: RGBAImage, x: number, y: number): number {
  const o = (y * img.width + x) * 4, d = img.data;
  return Math.max(d[o], d[o + 1], d[o + 2]) - Math.min(d[o], d[o + 1], d[o + 2]);
}

/** [r, g, b] at (x, y). */
export function rgb(img: RGBAImage, x: number, y: number): [number, number, number] {
  const o = (y * img.width + x) * 4, d = img.data;
  return [d[o], d[o + 1], d[o + 2]];
}

/** The importer works on screenshots fitted into this frame, the size of a Switch screenshot. */
export const FRAME_W = 1280, FRAME_H = 720;

/**
 * How a w×h screenshot goes into the frame: the source columns used (`sx`, `sw`) and where they land
 * (`x`, `y`, `w`, `h`). Narrower than 16:9 (a 16:10 Mac screen): scaled to fit and padded at the
 * sides. Wider (21:9, 32:9): the middle 16:9 is kept, because the game sizes and centres the held
 * map by the screen's height, so it lands where it does in any 16:9 screenshot.
 */
export function frameRect(w: number, h: number): { sx: number; sw: number; x: number; y: number; w: number; h: number } {
  const sw = Math.min(w, Math.round((h * FRAME_W) / FRAME_H)), sx = Math.floor((w - sw) / 2);
  const k = Math.min(FRAME_W / sw, FRAME_H / h), fw = Math.round(sw * k), fh = Math.round(h * k);
  return { sx, sw, x: Math.floor((FRAME_W - fw) / 2), y: Math.floor((FRAME_H - fh) / 2), w: fw, h: fh };
}

/** `img` fitted into the frame (see frameRect), averaging the pixels each frame pixel covers; padding is black. */
export function fitToFrame(img: RGBAImage): RGBAImage {
  const r = frameRect(img.width, img.height), out = new Uint8Array(FRAME_W * FRAME_H * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const kx = r.sw / r.w, ky = img.height / r.h, d = img.data;
  for (let y = 0; y < r.h; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < r.w; x++) {
      const x0 = r.sx + Math.floor(x * kx), x1 = Math.max(x0 + 1, r.sx + Math.floor((x + 1) * kx));
      let R = 0, G = 0, B = 0;
      for (let v = y0; v < y1; v++) for (let u = x0; u < x1; u++) {
        const o = (v * img.width + u) * 4;
        R += d[o]; G += d[o + 1]; B += d[o + 2];
      }
      const n = (y1 - y0) * (x1 - x0), o = ((r.y + y) * FRAME_W + r.x + x) * 4;
      out[o] = Math.round(R / n); out[o + 1] = Math.round(G / n); out[o + 2] = Math.round(B / n);
    }
  }
  return { width: FRAME_W, height: FRAME_H, data: out };
}
