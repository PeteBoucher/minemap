// Travel time and one-day reach. Ported from the prototype; the inputs that were
// globals there (biome pins, chosen pace, map terrain) are passed in as a TravelCtx.
import { BIOME_PACE } from "./biomes";

/** Usable minutes of daylight in a Minecraft day, and minutes kept back to build or reach a shelter. */
export const DAYLIGHT = 10;
export const SPARE = 2;

export type PaceKey = "open" | "mixed" | "rough" | "boat";
export type Pace = "auto" | PaceKey;

/** Straight-line blocks per second, allowing for detours, climbing and fighting (a clear sprint is about 5.6). */
export const PACES: Record<Pace, { label: string; bps?: number }> = {
  auto: { label: "Auto (from biomes)" },
  open: { label: "Open ground", bps: 3 },
  mixed: { label: "Mixed", bps: 1.5 },
  rough: { label: "Jungle / mountains", bps: 0.75 },
  boat: { label: "Open water (boat)", bps: 6 },
};

/** Pace for ground with no known biome or terrain. */
export const UNKNOWN_PACE: PaceKey = "mixed";
/** A biome pin describes the ground up to this many blocks away. */
export const BIOME_RANGE = 450;
/** Blocks per sampling step along a route. */
export const STEP = 16;

export interface BiomePin { x: number; z: number; biome: string }
export interface TerrainCell { pace: PaceKey; label: string }
export interface Point { x: number; z: number }

export interface TravelCtx {
  pace: Pace;
  /** Places that have a biome set. */
  pins: BiomePin[];
  /** Terrain read from map screenshots; beats the biome guess when pace is "auto". */
  terrainAt?: (x: number, z: number) => TerrainCell | undefined;
}

const bps = (k: PaceKey): number => PACES[k].bps!;

/** Nearest biome pin within BIOME_RANGE blocks, or null. */
export function biomeAt(pins: BiomePin[], x: number, z: number): { biome: string; d: number } | null {
  let near: BiomePin | null = null;
  let nd = BIOME_RANGE;
  for (const p of pins) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < nd) { nd = d; near = p; }
  }
  return near ? { biome: near.biome, d: nd } : null;
}

/** Travel speed in blocks per second at (x, z). */
export function bpsAt(ctx: TravelCtx, x: number, z: number): number {
  if (ctx.pace !== "auto") return bps(ctx.pace);
  const t = ctx.terrainAt?.(x, z);
  if (t) return bps(t.pace);
  const n = biomeAt(ctx.pins, x, z);
  return bps((n && BIOME_PACE[n.biome]) || UNKNOWN_PACE);
}

/** Seconds to travel a→b in a straight line, plus blocks covered in each kind of ground. */
export function travel(ctx: TravelCtx, a: Point, b: Point): { secs: number; by: Record<string, number> } {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(d / STEP)), seg = d / n, by: Record<string, number> = {};
  let secs = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = a.x + dx * t, z = a.z + dz * t;
    const tm = ctx.pace === "auto" ? ctx.terrainAt?.(x, z) : undefined;
    const bm = biomeAt(ctx.pins, x, z);
    const k = tm ? tm.label : bm ? bm.biome : "unknown";
    secs += seg / bpsAt(ctx, x, z);
    by[k] = (by[k] ?? 0) + seg;
  }
  return { secs, by };
}

/** Number of directions reach() samples (every 5°, index 0 = north, clockwise). */
export const REACH_DIRS = 72;

/** The outline of a reach (see reach()) around `a`, as world points, one per direction. */
export function reachOutline(radii: number[], a: Point): Point[] {
  return radii.map((r, k) => {
    const th = (k * 360 / REACH_DIRS * Math.PI) / 180;
    return { x: a.x + Math.sin(th) * r, z: a.z - Math.cos(th) * r };
  });
}

/** Whether point p is inside the polygon (even-odd rule). */
function inside(poly: Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Whether a reach around `a` covers the whole square view (x0, z0 to x0 + span, z0 + span): its
 * edges all inside the outline, and no point of the outline inside it. Drawn then, the reach would
 * only tint everything.
 */
export function reachCovers(radii: number[], a: Point, view: { x0: number; z0: number; span: number }): boolean {
  const poly = reachOutline(radii, a), { x0, z0, span } = view, N = 64;
  for (const q of poly) if (q.x > x0 && q.x < x0 + span && q.z > z0 && q.z < z0 + span) return false;
  for (let i = 0; i <= N; i++) {
    const t = x0 + (span * i) / N, u = z0 + (span * i) / N;
    for (const p of [{ x: t, z: z0 }, { x: t, z: z0 + span }, { x: x0, z: u }, { x: x0 + span, z: u }])
      if (!inside(poly, p)) return false;
  }
  return true;
}

/**
 * How far you get from `a` in each of 72 directions:
 * `full` in one day's daylight, `half` in half a day (there and back).
 */
export function reach(ctx: TravelCtx, a: Point): { full: number[]; half: number[] } {
  const budget = DAYLIGHT * 60, full: number[] = [], half: number[] = [];
  for (let k = 0; k < REACH_DIRS; k++) {
    const th = (k * 5 * Math.PI) / 180, ux = Math.sin(th), uz = -Math.cos(th);
    let r = 0, t = 0, h: number | null = null;
    while (r < 5000) {
      const v = bpsAt(ctx, a.x + ux * (r + STEP / 2), a.z + uz * (r + STEP / 2)), dt = STEP / v;
      if (h == null && t + dt > budget / 2) h = r + (budget / 2 - t) * v;
      if (t + dt > budget) { r += (budget - t) * v; break; }
      t += dt; r += STEP;
    }
    full.push(r);
    half.push(h ?? r);
  }
  return { full, half };
}

export type VerdictLevel = "ok" | "warn" | "bad";

/** Whether a trip of `mins` minutes over `dist` blocks fits in a day, as shown in the route panel. */
export function dayVerdict(mins: number, dist: number): { level: VerdictLevel; text: string; days: number } {
  const fmt = (m: number) => (m < 1 ? "under 1 min" : `${Math.round(m)} min`);
  if (mins <= DAYLIGHT - SPARE) return { level: "ok", text: `Fits in one day · ${fmt(DAYLIGHT - mins)} spare`, days: 1 };
  if (mins <= DAYLIGHT) return { level: "warn", text: "Tight · little time left to build a shelter", days: 1 };
  const days = Math.ceil(mins / (DAYLIGHT - SPARE));
  return {
    level: "bad",
    text: `Too far for one day · plan ${days} days, a shelter every ~${Math.round(dist / days).toLocaleString("en-GB")} blocks`,
    days,
  };
}
