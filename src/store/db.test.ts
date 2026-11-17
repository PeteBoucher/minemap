import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { clear, get, set } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createWorld, deleteMap, deletePlace, deleteWorld, getCurrentWorldId, getImage, listMaps, listPlaces,
  listWorlds, newId, saveMap, savePlace, setCurrentWorldId,
} from "./db";
import { DEMO_MAPS, DEMO_PLACES } from "./demoWorld";
import { SCHEMA_VERSION, exportWorld, importWorld, loadDemoWorld, migrate } from "./migrate";

const jpeg = (n = 3) => new Blob([new Uint8Array(n).fill(7)], { type: "image/jpeg" });
const demoFile = (url: string) => readFile(new URL(`../../public/${url.replace(/^\//, "")}`, import.meta.url)).then((b) => new Blob([b], { type: "image/jpeg" }));

beforeEach(() => clear());

describe("worlds", () => {
  it("creates, lists and switches worlds", async () => {
    const a = await createWorld("Survival");
    const b = await createWorld("Creative", { pace: "open" });
    expect((await listWorlds()).map((w) => w.name)).toEqual(["Survival", "Creative"]);
    expect(b.settings).toEqual({ pace: "open", showMaps: true, platform: "switch" });
    await setCurrentWorldId(a.id);
    expect(await getCurrentWorldId()).toBe(a.id);
  });

  it("deleting a world removes its places, maps and screenshots", async () => {
    const w = await createWorld("Gone");
    const keep = await createWorld("Kept");
    await setCurrentWorldId(w.id);
    await savePlace({ id: newId(), worldId: w.id, name: "Base", x: 1, z: 2, kind: "place" });
    await savePlace({ id: newId(), worldId: keep.id, name: "Other", x: 1, z: 2, kind: "place" });
    const imageId = newId();
    await saveMap({ id: newId(), worldId: w.id, x: -64, z: -64, size: 128, imageId }, jpeg());
    await deleteWorld(w.id);
    expect((await listWorlds()).map((x) => x.name)).toEqual(["Kept"]);
    expect(await listPlaces(w.id)).toEqual([]);
    expect(await listMaps(w.id)).toEqual([]);
    expect(await getImage(imageId)).toBeUndefined();
    expect(await getCurrentWorldId()).toBeUndefined();
    expect(await listPlaces(keep.id)).toHaveLength(1);
  });
});

describe("places and maps", () => {
  it("saves, edits and deletes a place", async () => {
    const w = await createWorld("W");
    const p = { id: newId(), worldId: w.id, name: "Portal", x: 401, z: 935, kind: "portal" as const };
    await savePlace(p);
    await savePlace({ ...p, name: "Main portal" });
    expect((await listPlaces(w.id)).map((x) => x.name)).toEqual(["Main portal"]);
    await deletePlace(w.id, p.id);
    expect(await listPlaces(w.id)).toEqual([]);
  });

  it("deleting a map also deletes its screenshot", async () => {
    const w = await createWorld("W");
    const shot = { id: newId(), worldId: w.id, x: -64, z: -64, size: 128, imageId: newId() };
    await saveMap(shot, jpeg());
    expect((await getImage(shot.imageId))?.size).toBe(3);
    await deleteMap(w.id, shot.id);
    expect(await getImage(shot.imageId)).toBeUndefined();
  });
});

describe("migrate", () => {
  it("stamps a fresh store with the current schema", async () => {
    expect(await migrate()).toBe(0);
    expect(await get("schema")).toBe(SCHEMA_VERSION);
  });
  it("refuses data from a newer version", async () => {
    await set("schema", SCHEMA_VERSION + 1);
    await expect(migrate()).rejects.toThrow(/newer version/);
  });
});

describe("demo world", () => {
  it("loads every prototype place and map screenshot", async () => {
    const w = await loadDemoWorld("/", demoFile);
    expect(w.name).toBe("Demo world");
    const places = await listPlaces(w.id), maps = await listMaps(w.id);
    expect(places).toHaveLength(DEMO_PLACES.length);
    expect(places.find((p) => p.name === "Hobbiton")).toMatchObject({ x: 107, z: 836, kind: "village", biome: "plains" });
    expect(maps).toHaveLength(DEMO_MAPS.length);
    expect(maps.find((m) => m.crop)?.crop).toEqual({ x: 49, y: 60, size: 542 });
    const img = await getImage(maps[0].imageId);
    expect(img!.size).toBeGreaterThan(50_000);
  });

  it("skips screenshots that fail to load", async () => {
    const w = await loadDemoWorld("/", async () => { throw new Error("offline"); });
    expect(await listPlaces(w.id)).toHaveLength(DEMO_PLACES.length);
    expect(await listMaps(w.id)).toEqual([]);
  });
});

describe("export / import", () => {
  it("round-trips a world through JSON as a new copy", async () => {
    const w = await createWorld("Mine", { pace: "rough" });
    await savePlace({ id: newId(), worldId: w.id, name: "Home", x: 5, z: -5, kind: "place", biome: "plains", note: "chests" });
    await saveMap({ id: newId(), worldId: w.id, x: -64, z: -64, size: 2048, imageId: newId(), crop: { x: 1, y: 2, size: 3 } }, jpeg(70_000));
    const json = JSON.parse(JSON.stringify(await exportWorld(w)));
    const copy = await importWorld(json);
    expect(copy.id).not.toBe(w.id);
    expect(copy).toMatchObject({ name: "Mine", settings: { pace: "rough" } });
    expect(await listPlaces(copy.id)).toEqual([expect.objectContaining({ name: "Home", x: 5, z: -5, biome: "plains", note: "chests", worldId: copy.id })]);
    const [m] = await listMaps(copy.id);
    expect(m).toMatchObject({ x: -64, z: -64, size: 2048, crop: { x: 1, y: 2, size: 3 } });
    const img = await getImage(m.imageId);
    expect(img!.size).toBe(70_000);
    expect(new Uint8Array(await img!.arrayBuffer())[69_999]).toBe(7);
    expect(await listWorlds()).toHaveLength(2);
  });

  it("rejects files that aren't a Minemap export", async () => {
    await expect(importWorld({ hello: 1 })).rejects.toThrow(/isn't a Minemap/);
    await expect(importWorld({ app: "minemap", schema: 99, world: {}, places: [], maps: [] })).rejects.toThrow(/newer version/);
  });
});
