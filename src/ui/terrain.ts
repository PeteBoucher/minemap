// Builds the terrain lookup for a world from its map screenshots, using a worker.
// Results are cached per screenshot and placement, so moving one map only re-reads that one.
import { mergeTerrain } from "../core/terrain";
import type { TerrainCell } from "../core/travel";
import { type MapShot, getImage } from "../store/db";
import type { TerrainRequest, TerrainResponse } from "./terrain.worker";

type Cells = TerrainResponse["cells"];

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (cells: Cells) => void>();
const cache = new Map<string, Cells>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<TerrainResponse>) => {
      pending.get(e.data.id)?.(e.data.cells);
      pending.delete(e.data.id);
    };
  }
  return worker;
}

const key = (m: MapShot) => `${m.imageId}|${m.x}|${m.z}|${m.size}|${m.crop ? `${m.crop.x},${m.crop.y},${m.crop.size}` : ""}`;

async function cellsFor(m: MapShot): Promise<Cells> {
  const k = key(m);
  const hit = cache.get(k);
  if (hit) return hit;
  const image = await getImage(m.imageId);
  if (!image) return [];
  const cells = await new Promise<Cells>((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage({ id, map: { x: m.x, z: m.z, size: m.size, crop: m.crop }, image } satisfies TerrainRequest);
  });
  cache.set(k, cells);
  return cells;
}

/** Terrain lookup for these maps (smaller, more detailed maps win where they overlap). */
export async function terrainFor(maps: MapShot[]): Promise<(x: number, z: number) => TerrainCell | undefined> {
  const results = await Promise.all(maps.map(cellsFor));
  return mergeTerrain(maps, results);
}
