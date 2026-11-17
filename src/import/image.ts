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
