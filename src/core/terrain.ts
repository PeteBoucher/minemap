// Terrain hints read from screenshots of held in-game maps. Ported from the prototype.
// Pure: the caller supplies a pixel reader, so this runs in a worker or a test.
import type { TerrainCell } from "./travel";

/** Size in blocks of the square terrain cells. */
export const TCELL = 32;
/** Screenshot rows below this (in 1280×720 coordinates) are hidden by the hotbar. */
export const HUD_Y = 580;

export interface Crop { x: number; y: number; size: number }
/** Where the map square sits in a 1280×720 Switch screenshot of a held map. */
export const SWITCH_CROP: Crop = { x: 368, y: 59.5, size: 544 };

/**
 * The part of a crop that's drawn on the map: a frame pixel in from each edge. The crop's edge
 * pixels can be partly the map's frame (on iPhone, which holds the map a pixel inside the Switch
 * layout, a whole column of it), and drawn they show as a pale line between neighbouring maps.
 */
export function drawnPart(crop: Crop): Crop {
  return { x: crop.x + 1, y: crop.y + 1, size: crop.size - 2 };
}

/** A map screenshot placed in the world: north-west corner (x, z) and blocks across. */
export interface PlacedMap { x: number; z: number; size: number; crop?: Crop }

type Kind = "grass" | "tree" | "water" | "ice" | "snow" | "stone" | "dirt" | "blank";

/** Map colours measured from Switch screenshots. */
export const MAP_COLOURS: [Kind, number, number, number][] = [
  ["grass", 120, 168, 72], ["grass", 144, 192, 96], ["grass", 96, 144, 48], ["grass", 120, 144, 72], ["grass", 96, 144, 72], ["grass", 96, 120, 48],
  ["tree", 48, 72, 24], ["tree", 24, 48, 24], ["tree", 24, 48, 0], ["tree", 72, 96, 48], ["tree", 24, 72, 24], ["tree", 72, 120, 48],
  ["water", 0, 48, 144], ["water", 0, 48, 168], ["water", 0, 48, 120], ["water", 24, 72, 168], ["water", 24, 48, 120], ["water", 0, 24, 120],
  ["ice", 144, 120, 216], ["ice", 144, 120, 192], ["ice", 120, 120, 192], ["ice", 144, 144, 216], ["ice", 120, 120, 216],
  ["snow", 216, 216, 216], ["snow", 240, 240, 240], ["snow", 216, 216, 192], ["snow", 192, 192, 192], ["snow", 216, 192, 192],
  ["stone", 168, 168, 168], ["stone", 120, 120, 120], ["stone", 96, 96, 96], ["stone", 72, 72, 72], ["stone", 48, 48, 48],
  ["dirt", 120, 96, 72], ["dirt", 72, 48, 24], ["dirt", 120, 96, 48], ["dirt", 96, 72, 48], ["dirt", 48, 48, 24],
  ["blank", 216, 168, 120], ["blank", 216, 168, 144], ["blank", 216, 192, 144], ["blank", 192, 168, 144], ["blank", 168, 144, 96],
];

/** Closest known map colour, or null for unexplored parchment or an unclear colour. */
export function mapClass(r: number, g: number, b: number): Exclude<Kind, "blank"> | null {
  let best: Kind | null = null, bd = 40 * 40 * 3;
  for (const [k, R, G, B] of MAP_COLOURS) {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best === "blank" ? null : best;
}

/** Reads [r, g, b] at 1280×720 screenshot coordinates. */
export type PixelReader = (x: number, y: number) => [number, number, number];

/** Terrain for each TCELL-block cell a map covers, keyed "cx,cz". */
export function terrainFromMap(m: PlacedMap, px: PixelReader): [string, TerrainCell][] {
  const C = m.crop ?? SWITCH_CROP, N = 128, P = C.size / N, bpp = m.size / N;
  const cls: (Kind | null)[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const y = C.y + (j + 0.5) * P;
    cls.push(y > HUD_Y ? null : mapClass(...px(Math.round(C.x + (i + 0.5) * P), Math.round(y))));
  }
  const out: [string, TerrainCell][] = [], clamp = (v: number) => Math.max(0, Math.min(N - 1, v));
  for (let cz = Math.floor(m.z / TCELL); cz * TCELL < m.z + m.size; cz++) for (let cx = Math.floor(m.x / TCELL); cx * TCELL < m.x + m.size; cx++) {
    const mx = (cx + 0.5) * TCELL - m.x, mz = (cz + 0.5) * TCELL - m.z, c: Partial<Record<Kind, number>> = {};
    let total = 0, known = 0;
    for (let j = clamp(Math.floor((mz - TCELL) / bpp)); j <= clamp(Math.floor((mz + TCELL) / bpp)); j++)
      for (let i = clamp(Math.floor((mx - TCELL) / bpp)); i <= clamp(Math.floor((mx + TCELL) / bpp)); i++) {
        total++;
        const k = cls[j * N + i];
        if (k) { known++; c[k] = (c[k] ?? 0) + 1; }
      }
    if (known < 4 || known < total * 0.5) continue;
    const f = (k: Kind) => (c[k] ?? 0) / known, rock = f("stone") + f("dirt");
    let cell: TerrainCell;
    if (f("water") >= 0.6) cell = { pace: "boat", label: "water" };
    else if (f("tree") >= 0.35) cell = { pace: "rough", label: "dense trees" };
    else if (rock >= 0.3) cell = { pace: "rough", label: "rocky" };
    else if (f("tree") >= 0.12 || f("water") >= 0.25 || rock >= 0.12) cell = { pace: "mixed", label: "broken ground" };
    else cell = { pace: "open", label: "open ground" };
    out.push([`${cx},${cz}`, { pace: cell.pace, label: cell.label + " (map)" }]);
  }
  return out;
}

/**
 * Merge terrain from several maps into one lookup. `results` must be in the same order as `maps`;
 * bigger maps are applied first so more detailed (smaller) maps win where they overlap.
 */
export function mergeTerrain(maps: PlacedMap[], results: [string, TerrainCell][][]): (x: number, z: number) => TerrainCell | undefined {
  const cells = new Map<string, TerrainCell>();
  maps.map((m, i) => [m.size, i] as const).sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => results[i].forEach(([k, v]) => cells.set(k, v)));
  return (x, z) => cells.get(`${Math.floor(x / TCELL)},${Math.floor(z / TCELL)}`);
}
