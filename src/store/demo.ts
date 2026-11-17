// The built-in demo world. It is built in memory from bundled data every time it's opened and is
// never written to storage, so changes made while exploring it are simply dropped.
import { DEFAULT_SETTINGS, type MapShot, type Place, type World } from "./db";
import { DEMO_MAPS, DEMO_PLACES } from "./demoWorld";

export const DEMO_ID = "demo";

export interface DemoData {
  world: World;
  places: Place[];
  maps: MapShot[];
  /** Screenshot URL by imageId (the demo's screenshots are served from public/demo/). */
  imageUrls: Map<string, string>;
}

export function buildDemo(base: string = import.meta.env?.BASE_URL ?? "/"): DemoData {
  const world: World = { id: DEMO_ID, name: "Demo world", createdAt: 0, settings: { ...DEFAULT_SETTINGS } };
  const places = DEMO_PLACES.map((p, i) => ({ id: `demo-place-${i}`, worldId: DEMO_ID, ...p }));
  const maps = DEMO_MAPS.map(({ file, ...m }) => ({ id: `demo-map-${file}`, worldId: DEMO_ID, imageId: file, ...m }));
  const imageUrls = new Map(DEMO_MAPS.map((m) => [m.file, `${base}demo/${m.file}`]));
  return { world, places, maps, imageUrls };
}
