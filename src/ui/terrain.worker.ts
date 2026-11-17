// Reads terrain hints from one map screenshot off the main thread.
import { type PlacedMap, terrainFromMap } from "../core/terrain";

export interface TerrainRequest { id: number; map: PlacedMap; image: Blob }
export interface TerrainResponse { id: number; cells: ReturnType<typeof terrainFromMap>; error?: string }

self.onmessage = async (e: MessageEvent<TerrainRequest>) => {
  const { id, map, image } = e.data;
  try {
    const bmp = await createImageBitmap(image);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data, sc = c.width / 1280;
    const cells = terrainFromMap(map, (x, y) => {
      const o = (Math.min(c.height - 1, Math.round(y * sc)) * c.width + Math.min(c.width - 1, Math.round(x * sc))) * 4;
      return [d[o], d[o + 1], d[o + 2]];
    });
    self.postMessage({ id, cells } satisfies TerrainResponse);
  } catch (err) {
    self.postMessage({ id, cells: [], error: String(err) } satisfies TerrainResponse);
  }
};
