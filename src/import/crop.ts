// Finds the held map in a 1280×720 Switch screenshot. Screenshots of other 16:9 sizes are scaled to
// 1280×720 before import, so these coordinates apply to them too.
import { type Crop, SWITCH_CROP } from "../core/terrain";
import { type RGBAImage, rgb } from "./image";

/** Where the map sits when held in single-player and in each half of two-player split-screen. */
export const CROP_CANDIDATES: { name: string; crop: Crop }[] = [
  { name: "full screen", crop: SWITCH_CROP },
  { name: "split-screen left", crop: { x: 49, y: 60, size: 542 } },
  { name: "split-screen right", crop: { x: 689, y: 60, size: 542 } },
];

/** Parchment tint of the map's frame: red > green > blue in fixed proportions, at any brightness. */
function isParchment([r, g, b]: [number, number, number]): boolean {
  return r > 60 && g / r > 0.76 && g / r < 0.93 && b / r > 0.45 && b / r < 0.82;
}

/**
 * Share of points in the band just outside `crop` (where the held map's parchment frame is) that
 * have the parchment tint. Near 1 for the right crop; scenery scores much lower.
 */
export function mapLikeness(img: RGBAImage, crop: Crop): number {
  const sx = img.width / 1280, off = crop.size * 0.012; // inside the solid part of the frame (its outer edge is ragged)
  const at = (x: number, y: number) => rgb(img, Math.max(0, Math.min(img.width - 1, Math.round(x * sx))), Math.max(0, Math.min(img.height - 1, Math.round(y * sx))));
  let hit = 0, n = 0;
  for (let t = 0.05; t < 0.95; t += 0.05) {
    // left, right and top edges of the frame (the bottom is hidden by the hotbar)
    for (const p of [at(crop.x - off, crop.y + t * crop.size), at(crop.x + crop.size + off, crop.y + t * crop.size), at(crop.x + t * crop.size, crop.y - off)]) {
      n++;
      if (isParchment(p)) hit++;
    }
  }
  return hit / n;
}

/** Below this the screenshot probably isn't showing a held map. */
export const MIN_LIKENESS = 0.7;

/** The most map-like candidate crop, or null if none looks like a map. */
export function detectCrop(img: RGBAImage): { name: string; crop: Crop; likeness: number } | null {
  const scored = CROP_CANDIDATES.map((c) => ({ ...c, likeness: mapLikeness(img, c.crop) }));
  const best = scored.reduce((a, b) => (b.likeness > a.likeness ? b : a));
  return best.likeness >= MIN_LIKENESS ? best : null;
}
