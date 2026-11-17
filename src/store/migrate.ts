// Storage schema versioning and whole-world export/import.
import { get, set } from "idb-keyval";
import {
  type MapShot, type Place, type World, DEFAULT_SETTINGS,
  getImage, listMaps, listPlaces, newId, saveMap, savePlaces, saveWorld,
} from "./db";

export const SCHEMA_VERSION = 1;

/** Bring stored data up to SCHEMA_VERSION. Call once at startup before reading anything. */
export async function migrate(): Promise<number> {
  const from = (await get<number>("schema")) ?? 0;
  if (from > SCHEMA_VERSION) throw new Error(`Data was saved by a newer version of Minemap (schema ${from}).`);
  // future steps go here: if (from < 2) { ... }
  if (from !== SCHEMA_VERSION) await set("schema", SCHEMA_VERSION);
  return from;
}

/* ---------- export / import ---------- */

export interface WorldExport {
  app: "minemap";
  schema: number;
  world: Pick<World, "name" | "createdAt" | "settings">;
  places: Omit<Place, "id" | "worldId">[];
  maps: (Omit<MapShot, "id" | "worldId" | "imageId"> & { image?: { type: string; base64: string } })[];
}

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const base64ToBlob = (b64: string, type: string): Blob => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type });

/** A world with its places and screenshots as one JSON-serialisable object (for backup or moving devices). */
export async function exportWorld(world: World): Promise<WorldExport> {
  const [places, maps] = await Promise.all([listPlaces(world.id), listMaps(world.id)]);
  return {
    app: "minemap",
    schema: SCHEMA_VERSION,
    world: { name: world.name, createdAt: world.createdAt, settings: world.settings },
    places: places.map(({ id: _i, worldId: _w, ...p }) => p),
    maps: await Promise.all(maps.map(async ({ id: _i, worldId: _w, imageId, ...m }) => {
      const img = await getImage(imageId);
      return img ? { ...m, image: { type: img.type || "image/jpeg", base64: await blobToBase64(img) } } : m;
    })),
  };
}

/** Add an exported world as a new world (it never overwrites an existing one). */
export async function importWorld(data: unknown): Promise<World> {
  const d = data as Partial<WorldExport>;
  if (d?.app !== "minemap" || !d.world || !Array.isArray(d.places) || !Array.isArray(d.maps)) {
    throw new Error("This file isn't a Minemap world export.");
  }
  if ((d.schema ?? 0) > SCHEMA_VERSION) throw new Error("This world was exported by a newer version of Minemap.");
  const world: World = {
    id: newId(),
    name: d.world.name || "Imported world",
    createdAt: d.world.createdAt ?? Date.now(),
    settings: { ...DEFAULT_SETTINGS, ...d.world.settings },
  };
  await saveWorld(world);
  await savePlaces(world.id, d.places.map((p) => ({ ...p, id: newId(), worldId: world.id })));
  for (const { image, ...m } of d.maps) {
    await saveMap({ ...m, id: newId(), worldId: world.id, imageId: newId() }, image ? base64ToBlob(image.base64, image.type) : undefined);
  }
  return world;
}
