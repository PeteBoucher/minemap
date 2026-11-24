// Works out where a map screenshot belongs in the world.
//
// A map at zoom level s covers 128·2^s blocks and sits on a fixed grid (see mapCorner), so if the
// player was standing on the map when the screenshot was taken, their position fixes the map's
// corner exactly. Locator maps (made with a compass) draw a white player marker; finding it at the
// spot a zoom level predicts confirms both that the player is on the map and which zoom level it is.
// Plain maps have no marker, so for those the position is only a suggestion the user confirms.
import type { Edition } from "../core/edition";
import { mapCorner, mapSize } from "../core/geo";
import type { Crop } from "../core/terrain";
import { type RGBAImage, luma, rgb } from "./image";
import type { Position } from "./ocr";

export interface MarkerCheck {
  scale: number;
  corner: { x: number; z: number; size: number };
  /** Share of the marker-sized area around the predicted spot that is marker-white / outline-black. */
  white: number;
  black: number;
  found: boolean;
}

/** The light tone of Java's map frame in full daylight. */
const FRAME_DAYLIGHT = [214, 190, 150];

/**
 * How brightly the held map is lit, per colour channel (1 = daylight), read off its frame. Java lights
 * the held map like any other item, so under a roof, in shade or at night everything on it is dimmed
 * and tinted alike, the frame and the white player marker included: (0.90, 0.82, 0.73) under a roof.
 */
export function mapLight(img: RGBAImage, crop: Crop): [number, number, number] {
  // the frame's solid part, 3½ map pixels outside the left, right and top edges
  const P = crop.size / 128, d = 3.5 * P, tones: [number, number, number][] = [];
  for (let k = 8; k < 128; k += 4) {
    const t = k * P;
    for (const [x, y] of [[crop.x - d, crop.y + t], [crop.x + crop.size + d, crop.y + t], [crop.x + t, crop.y - d]]) {
      const px = Math.round(x), py = Math.round(y);
      if (px >= 0 && py >= 0 && px < img.width && py < img.height) tones.push(rgb(img, px, py));
    }
  }
  if (!tones.length) return [1, 1, 1];
  // the frame has a light and a dark tone, and hands or text may cover some of it: take a bright one, not the brightest
  tones.sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
  const tone = tones[Math.floor(tones.length * 0.8)];
  // never brighter than daylight, and never so dark that undoing it would turn noise into white
  return tone.map((v, i) => Math.min(1, Math.max(0.2, v / FRAME_DAYLIGHT[i]))) as [number, number, number];
}

/**
 * Marker-white and outline-black shares around map pixel (mx, mz) in the screenshot. `light` (see
 * mapLight) is undone first, so a marker dimmed with the rest of the map still counts as white.
 */
export function markerAt(img: RGBAImage, crop: Crop, mx: number, mz: number, light: [number, number, number] = [1, 1, 1]): { white: number; black: number } {
  const P = crop.size / 128, cx = crop.x + mx * P, cy = crop.y + mz * P, R = 4 * P;
  let n = 0, white = 0, black = 0;
  for (let y = Math.max(0, Math.round(cy - R)); y <= Math.min(img.height - 1, Math.round(cy + R)); y++)
    for (let x = Math.max(0, Math.round(cx - R)); x <= Math.min(img.width - 1, Math.round(cx + R)); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      n++;
      const [r, g, b] = rgb(img, x, y).map((v, i) => Math.min(255, v / light[i]));
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (l > 180 && Math.max(r, g, b) - Math.min(r, g, b) < 35) white++;
      else if (luma(img, x, y) < 30) black++;
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
export function checkScales(img: RGBAImage, crop: Crop, pos: Position, edition: Edition | null = null): MarkerCheck[] {
  // Only Java's frame tells the light: the Switch draws markers pure white whatever its frame's tone.
  const light = edition === "java" ? mapLight(img, crop) : undefined;
  return [0, 1, 2, 3, 4].map((scale) => {
    const corner = mapCorner(pos.x, pos.z, scale), bpp = mapSize(scale) / 128;
    const { white, black } = markerAt(img, crop, (pos.x - corner.x) / bpp, (pos.z - corner.z) / bpp, light);
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
 * otherwise `fallbackScale` (e.g. the last zoom level the user picked) is assumed. `edition` is whose
 * coordinates `pos` came from.
 */
export function placeFromPosition(img: RGBAImage, crop: Crop, pos: Position, fallbackScale: number, edition: Edition | null = null): Placement {
  const checks = checkScales(img, crop, pos, edition).filter((c) => c.found);
  if (checks.length) {
    // the strongest marker wins
    const best = checks.reduce((a, b) => (b.white + b.black > a.white + a.black ? b : a));
    return { ...best.corner, basis: "marker" };
  }
  return { ...mapCorner(pos.x, pos.z, fallbackScale), basis: "position" };
}
