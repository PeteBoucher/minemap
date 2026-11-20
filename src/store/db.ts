// On-device storage (IndexedDB via idb-keyval). Everything lives in one key-value store:
//   "worlds"          World[]
//   "current"         id of the open world
//   "schema"          storage schema version (see migrate.ts)
//   "places:<world>"  Place[]
//   "maps:<world>"    MapShot[]
//   "img:<id>"        Blob of a map screenshot
// Lists are small (hundreds of items), so whole-array read-modify-write with update() is fine.
import { del, delMany, get, set, update } from "idb-keyval";
import type { Edition } from "../core/edition";
import type { Crop } from "../core/terrain";
import type { Pace } from "../core/travel";

export type PlaceKind = "place" | "portal" | "village";
export type Platform = "switch" | "other";

export interface WorldSettings {
  pace: Pace;
  showMaps: boolean;
  platform: Platform;
  /** Zoom level last chosen when importing a map screenshot (0–4). */
  lastScale?: number;
  /** Bedrock or Java, for in-game instructions; unset means Bedrock. */
  edition?: Edition;
}
export interface World { id: string; name: string; createdAt: number; settings: WorldSettings }
export interface Place { id: string; worldId: string; name: string; x: number; z: number; kind: PlaceKind; biome?: string; note?: string }
export interface MapShot { id: string; worldId: string; x: number; z: number; size: number; crop?: Crop; imageId: string; capturedAt?: number }

export const DEFAULT_SETTINGS: WorldSettings = { pace: "auto", showMaps: true, platform: "switch" };

const K = {
  worlds: "worlds",
  current: "current",
  places: (w: string) => `places:${w}`,
  maps: (w: string) => `maps:${w}`,
  img: (id: string) => `img:${id}`,
};

export const newId = (): string => crypto.randomUUID();

/** Insert or replace by id. */
const upsert = <T extends { id: string }>(item: T) => (list: T[] = []): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  return i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
};
const without = <T extends { id: string }>(id: string) => (list: T[] = []): T[] => list.filter((x) => x.id !== id);

/* ---------- worlds ---------- */

export async function listWorlds(): Promise<World[]> {
  return (await get<World[]>(K.worlds)) ?? [];
}

export async function getWorld(id: string): Promise<World | undefined> {
  return (await listWorlds()).find((w) => w.id === id);
}

export async function createWorld(name: string, settings: Partial<WorldSettings> = {}): Promise<World> {
  const world: World = { id: newId(), name, createdAt: Date.now(), settings: { ...DEFAULT_SETTINGS, ...settings } };
  await update(K.worlds, upsert(world));
  return world;
}

export async function saveWorld(world: World): Promise<void> {
  await update(K.worlds, upsert(world));
}

/** Delete a world with all its places, maps and screenshots. */
export async function deleteWorld(id: string): Promise<void> {
  const maps = await listMaps(id);
  await delMany([K.places(id), K.maps(id), ...maps.map((m) => K.img(m.imageId))]);
  await update(K.worlds, without<World>(id));
  if ((await get(K.current)) === id) await del(K.current);
}

export async function getCurrentWorldId(): Promise<string | undefined> {
  return get<string>(K.current);
}

export async function setCurrentWorldId(id: string): Promise<void> {
  await set(K.current, id);
}

/* ---------- places ---------- */

export async function listPlaces(worldId: string): Promise<Place[]> {
  return (await get<Place[]>(K.places(worldId))) ?? [];
}

export async function savePlace(place: Place): Promise<void> {
  await update(K.places(place.worldId), upsert(place));
}

export async function savePlaces(worldId: string, places: Place[]): Promise<void> {
  await update(K.places(worldId), (list: Place[] = []) => places.reduce((l, p) => upsert(p)(l), list));
}

export async function deletePlace(worldId: string, id: string): Promise<void> {
  await update(K.places(worldId), without<Place>(id));
}

/* ---------- map screenshots ---------- */

export async function listMaps(worldId: string): Promise<MapShot[]> {
  return (await get<MapShot[]>(K.maps(worldId))) ?? [];
}

/** Save a map's placement, and its screenshot when given (stored under shot.imageId). */
export async function saveMap(shot: MapShot, image?: Blob): Promise<void> {
  if (image) await set(K.img(shot.imageId), image);
  await update(K.maps(shot.worldId), upsert(shot));
}

export async function deleteMap(worldId: string, id: string): Promise<void> {
  const shot = (await listMaps(worldId)).find((m) => m.id === id);
  await update(K.maps(worldId), without<MapShot>(id));
  if (shot) await del(K.img(shot.imageId));
}

export async function getImage(imageId: string): Promise<Blob | undefined> {
  return get<Blob>(K.img(imageId));
}

/* ---------- persistence ---------- */

/** Ask the browser not to clear our data under storage pressure. Returns whether it agreed. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
