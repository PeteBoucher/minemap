// Pure coordinate helpers, ported from the prototype (docs/prototype.html).

/** Compass point (N, NE, …) for a move of dx, dz. North is −Z. */
export function dirName(dx: number, dz: number): string {
  const a = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(a / 45) % 8];
}

/** In-game facing angle (F3/debug yaw) for a move of dx, dz. */
export function yaw(dx: number, dz: number): number {
  return Math.round((Math.atan2(-dx, dz) * 180) / Math.PI) || 0; // no −0
}

/** Matching Nether coordinates (overworld ÷ 8). */
export function toNether(x: number, z: number): { x: number; z: number } {
  return { x: Math.round(x / 8), z: Math.round(z / 8) };
}

/** A position as you'd type it in game, with its Nether match: "726, 1740 · Nether 91, 218". */
export function coordsText(x: number, z: number): string {
  const n = toNether(x, z);
  return `${x}, ${z} · Nether ${n.x}, ${n.z}`;
}

/** Blocks covered by a map at zoom level 0–4: 128, 256, 512, 1024, 2048. */
export const mapSize = (scale: number): number => 128 * 2 ** scale;

/**
 * North-west corner of the map that covers position (x, z) at the given zoom level.
 * Maps sit on a fixed grid offset by −64, so a held map's location follows from
 * where the player stood when it was made.
 */
export function mapCorner(x: number, z: number, scale: number): { x: number; z: number; size: number } {
  const size = mapSize(scale);
  const snap = (v: number) => Math.floor((v + 64) / size) * size - 64;
  return { x: snap(x), z: snap(z), size };
}
