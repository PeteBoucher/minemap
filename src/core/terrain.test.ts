import { describe, expect, it } from "vitest";
import golden from "./prototype.golden.json";
import { type PixelReader, HUD_Y, SWITCH_CROP, TCELL, mapClass, mergeTerrain, terrainFromMap } from "./terrain";

const solid = (rgb: [number, number, number]): PixelReader => () => rgb;
const WATER: [number, number, number] = [0, 48, 144];
const GRASS: [number, number, number] = [120, 168, 72];
const TREE: [number, number, number] = [24, 48, 24];

describe("mapClass", () => {
  it.each(golden.mapClass)("classifies $c like the prototype", ({ c, k }) => {
    expect(mapClass(c[0], c[1], c[2])).toBe(k);
  });
});

describe("terrainFromMap", () => {
  it("covers a 128-block map with 4×4 cells", () => {
    const cells = terrainFromMap({ x: 0, z: 0, size: 128 }, solid(WATER));
    expect(cells).toHaveLength(16);
    expect(cells.every(([, c]) => c.pace === "boat" && c.label === "water (map)")).toBe(true);
  });

  it("gives no terrain for unexplored parchment", () => {
    expect(terrainFromMap({ x: 0, z: 0, size: 128 }, solid([216, 168, 120]))).toEqual([]);
  });

  it("reads the west half as trees and the east half as grass", () => {
    const midX = SWITCH_CROP.x + SWITCH_CROP.size / 2;
    const cells = new Map(terrainFromMap({ x: 0, z: 0, size: 128 }, (x) => (x < midX ? TREE : GRASS)));
    expect(cells.get("0,1")?.pace).toBe("rough");
    expect(cells.get("3,1")?.pace).toBe("open");
  });

  it("skips pixels under the hotbar", () => {
    // everything below HUD_Y is water, the rest unexplored: the bottom row has too few known pixels
    const cells = terrainFromMap({ x: 0, z: 0, size: 128 }, (_x, y) => (y > HUD_Y ? WATER : [216, 168, 120]));
    expect(cells).toEqual([]);
  });
});

describe("mergeTerrain", () => {
  it("lets a smaller, more detailed map win over a bigger one", () => {
    const big = { x: -64, z: -64, size: 256 }, small = { x: 0, z: 0, size: 128 };
    const lookup = mergeTerrain([small, big], [terrainFromMap(small, solid(GRASS)), terrainFromMap(big, solid(WATER))]);
    expect(lookup(10, 10)?.pace).toBe("open");
    expect(lookup(-50, -50)?.pace).toBe("boat");
    expect(lookup(10 + 1000, 10)).toBeUndefined();
    expect(TCELL).toBe(32);
  });
});
