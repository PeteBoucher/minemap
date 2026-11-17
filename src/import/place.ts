// Works out where a map screenshot belongs in the world.
//
// A map at zoom level s covers 128·2^s blocks and sits on a fixed grid (see mapCorner), so if the
// player was standing on the map when the screenshot was taken, their position fixes the map's
// corner exactly. Locator maps (made with a compass) draw a white player marker; finding it at the
// spot a zoom level predicts confirms both that the player is on the map and which zoom level it is.
// Plain maps have no marker, so for those the position is only a suggestion the user confirms.
import { mapCorner, mapSize } from "../core/geo";
import type { Crop } from "../core/terrain";
import { type RGBAImage, chroma, luma } from "./image";
import type { Position } from "./ocr";

export interface MarkerCheck {
  scale: number;
  corner: { x: number; z: number; size: number };
  /** Share of the marker-sized area around the predicted spot that is marker-white / outline-black. */
  white: number;
  black: number;
  found: boolean;
}

/** Marker-white and outline-black shares around map pixel (mx, mz) in the screenshot. */
export function markerAt(img: RGBAImage, crop: Crop, mx: number, mz: number): { white: number; black: number } {
  const P = crop.size / 128, cx = crop.x + mx * P, cy = crop.y + mz * P, R = 4 * P;
  let n = 0, white = 0, black = 0;
  for (let y = Math.max(0, Math.round(cy - R)); y <= Math.min(img.height - 1, Math.round(cy + R)); y++)
    for (let x = Math.max(0, Math.round(cx - R)); x <= Math.min(img.width - 1, Math.round(cx + R)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      n++;
      const l = luma(img, x, y);
      if (l > 180 && chroma(img, x, y) < 35) white++;
      else if (l < 30) black++;
    }
  return { white: white / n, black: black / n };
}

/**
 * Thresholds for calling it a player marker. White alone isn't enough (snow is white), so the black
 * outline is required too; set high enough that no fixture picks a wrong zoom level, because a wrong
 * placement is worse than asking the user.
 */
export const MARKER_WHITE = 0.12, MARKER_BLACK = 0.12;

/** For each zoom level 0–4: where the map would be, and whether a player marker sits where it should. */
export function checkScales(img: RGBAImage, crop: Crop, pos: Position): MarkerCheck[] {
  return [0, 1, 2, 3, 4].map((scale) => {
    const corner = mapCorner(pos.x, pos.z, scale), bpp = mapSize(scale) / 128;
    const { white, black } = markerAt(img, crop, (pos.x - corner.x) / bpp, (pos.z - corner.z) / bpp);
    return { scale, corner, white, black, found: white >= MARKER_WHITE && black >= MARKER_BLACK };
  });
}

export interface Placement {
  x: number; z: number; size: number;
  /** "marker": a player marker confirmed the spot and zoom level. "position": assumed the map is around the player. */
  basis: "marker" | "position";
}

/**
 * Best placement for a screenshot taken at `pos`. With a confirmed marker the zoom level is detected;
 * otherwise `fallbackScale` (e.g. the last zoom level the user picked) is assumed.
 */
export function placeFromPosition(img: RGBAImage, crop: Crop, pos: Position, fallbackScale: number): Placement {
  const checks = checkScales(img, crop, pos).filter((c) => c.found);
  if (checks.length) {
    // the strongest marker wins
    const best = checks.reduce((a, b) => (b.white + b.black > a.white + a.black ? b : a));
    return { ...best.corner, basis: "marker" };
  }
  return { ...mapCorner(pos.x, pos.z, fallbackScale), basis: "position" };
}
