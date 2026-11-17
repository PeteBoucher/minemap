// Finds the held map in a screenshot that has been scaled to 1280×720.
//
// The map is drawn inside a parchment frame. A candidate square fits when the band just outside it
// has the parchment tint (the frame) and the band just inside it does not look like the frame
// (the map itself). The known Switch layouts are tried first; otherwise the whole screen is
// searched, coarse then fine, so other layouts (Java Edition, other consoles) are found too.
import { type Crop, SWITCH_CROP } from "../core/terrain";
import { type RGBAImage, rgb } from "./image";

/** Where the map sits when held on the Switch: single-player and each half of split-screen. */
export const CROP_CANDIDATES: { name: string; crop: Crop }[] = [
  { name: "full screen", crop: SWITCH_CROP },
  { name: "split-screen left", crop: { x: 49, y: 60, size: 542 } },
  { name: "split-screen right", crop: { x: 689, y: 60, size: 542 } },
];

type RGB = [number, number, number];

/** Parchment tint of the map's frame: red > green > blue in fixed proportions, at any brightness. */
function isParchment([r, g, b]: RGB): boolean {
  return r > 60 && g / r > 0.76 && g / r < 0.93 && b / r > 0.45 && b / r < 0.82;
}

/** Rows below this are often covered by the hotbar, so the frame's bottom edge is never used. */
const HUD_Y = 580;

function sampler(img: RGBAImage) {
  const sx = img.width / 1280, sy = img.height / 720;
  return (x: number, y: number): RGB | null => {
    const px = Math.round(x * sx), py = Math.round(y * sy);
    return px < 0 || py < 0 || px >= img.width || py >= img.height ? null : rgb(img, px, py);
  };
}

/** Points along the left, right and top edges at a signed distance `d` outside the square (negative = inside). */
function edgePoints(c: Crop, d: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, y = c.y + t * c.size, x = c.x + t * c.size;
    if (y < HUD_Y) pts.push([c.x - d, y], [c.x + c.size + d, y]);
    pts.push([x, c.y - d]);
  }
  return pts;
}

/**
 * Share of the band just outside `crop` that has the parchment tint. Near 1 when the square sits
 * exactly inside a map frame; scenery scores much lower.
 */
export function mapLikeness(img: RGBAImage, crop: Crop): number {
  const at = sampler(img);
  let hit = 0, n = 0;
  // inside the solid part of the frame (its outer edge is ragged)
  for (const [x, y] of edgePoints(crop, crop.size * 0.012, 18)) {
    const p = at(x, y);
    n++;
    if (p && isParchment(p)) hit++;
  }
  return n ? hit / n : 0;
}

/**
 * Fit score 0–2: share of parchment just outside (at two depths) plus share of non-parchment just
 * inside. The inside term stops the square from growing into the frame (both of its tones are
 * parchment-tinted); the outside term stops it shrinking into the map.
 */
export function fitScore(img: RGBAImage, c: Crop, n = 16): number {
  const at = sampler(img);
  const share = (pts: [number, number][], want: boolean) =>
    pts.filter(([x, y]) => { const p = at(x, y); return !!p && isParchment(p) === want; }).length / pts.length;
  const out = (share(edgePoints(c, c.size * 0.006, n), true) + share(edgePoints(c, c.size * 0.015, n), true)) / 2;
  if (out < 0.5) return out;
  return out + share(edgePoints(c, -c.size * 0.006, n), false);
}

/** Below this the screenshot probably isn't showing a held map. */
export const MIN_LIKENESS = 0.7;
const MIN_FIT = 1.3;
/** Sample points per edge when fitting. */
const FIT_N = 24;

/** Search the whole screen for the best-fitting square: a coarse pass, then a fine pass around the best few. */
function searchCrop(img: RGBAImage): Crop | null {
  const coarse: { c: Crop; s: number }[] = [];
  for (let size = 280; size <= 680; size += 16)
    for (let y = 8; y <= 260 && y + size * 0.5 <= 720; y += 8)
      for (let x = 8; x + size <= 1272; x += 8) {
        const c = { x, y, size }, s = mapLikeness(img, c);
        if (s >= 0.6) coarse.push({ c, s });
      }
  coarse.sort((a, b) => b.s - a.s);
  let best: { c: Crop; s: number } | null = null;
  // The same sample density throughout: a sparse sample can be fooled by the frame's notched edge.
  for (const { c: c0 } of coarse.slice(0, 4)) {
    for (let ds = -16; ds <= 16; ds += 4)
      for (let dy = -8; dy <= 8; dy += 2)
        for (let dx = -8; dx <= 8; dx += 2) {
          const c = { x: c0.x + dx, y: c0.y + dy, size: c0.size + ds }, s = fitScore(img, c, FIT_N);
          if (!best || s > best.s) best = { c, s };
        }
  }
  if (!best) return null;
  // final polish one pixel at a time
  let { c } = best, s = best.s;
  for (let improved = true, guard = 0; improved && guard < 200; guard++) {
    improved = false;
    for (const [dx, dy, ds] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [-1, -1, 2], [1, 1, -2]]) {
      const n = { x: c.x + dx, y: c.y + dy, size: c.size + ds }, ns = fitScore(img, n, FIT_N);
      if (ns > s + 1e-9) { c = n; s = ns; improved = true; }
    }
  }
  return s >= MIN_FIT ? c : null;
}

/** The held map's square in a 1280×720 screenshot, or null if there doesn't seem to be one. */
export function detectCrop(img: RGBAImage): { name: string; crop: Crop; likeness: number } | null {
  const presets = CROP_CANDIDATES.map((c) => ({ ...c, likeness: mapLikeness(img, c.crop) }));
  const preset = presets.reduce((a, b) => (b.likeness > a.likeness ? b : a));
  const presetFit = preset.likeness >= 0.9 ? fitScore(img, preset.crop, FIT_N) : 0;
  if (presetFit >= 1.8) return preset; // a clean fit at a known layout
  // Otherwise search too. A known layout is kept unless the search fits clearly better: maps with
  // unexplored or sandy edges fit less cleanly, but sand AROUND the map can fake a preset.
  const found = searchCrop(img);
  const foundFit = found ? fitScore(img, found, FIT_N) : 0;
  if (found && foundFit > presetFit + PRESET_BONUS) return { name: "found", crop: found, likeness: mapLikeness(img, found) };
  return presetFit > 0 ? preset : null;
}

/** How much better a searched fit must be to override a known layout. */
const PRESET_BONUS = 0.25;
