import { describe, expect, it } from "vitest";
import { dirName, mapCorner, toNether, yaw } from "./geo";

// Map placements recorded by hand in the prototype's MAPS list (x, z = north-west corner).
const PROTOTYPE_MAPS = [
  { x: 1472, z: 960, size: 512 }, { x: 1728, z: 1216, size: 128 }, { x: 704, z: 1600, size: 128 },
  { x: 576, z: 1600, size: 128 }, { x: -3648, z: 9152, size: 512 }, { x: -64, z: -64, size: 2048 },
  { x: 960, z: -64, size: 512 }, { x: 1216, z: 192, size: 256 }, { x: 1344, z: 320, size: 128 },
  { x: -64, z: 960, size: 256 }, { x: -1088, z: 1472, size: 256 }, { x: -1984, z: 4672, size: 128 },
  { x: -320, z: 1984, size: 256 }, { x: -320, z: 2112, size: 128 }, { x: 1472, z: 192, size: 128 },
  { x: 192, z: 1344, size: 128 }, { x: 448, z: 1472, size: 256 }, { x: -1344, z: 3776, size: 256 },
  { x: -832, z: 3520, size: 256 }, { x: 64, z: 2368, size: 128 }, { x: -576, z: 960, size: 256 },
];

describe("mapCorner", () => {
  it.each(PROTOTYPE_MAPS)("any point inside the map at $x,$z ($size) snaps back to its corner", (m) => {
    const scale = Math.log2(m.size / 128);
    for (const [fx, fz] of [[0, 0], [0.5, 0.5], [0.999, 0.01]]) {
      const got = mapCorner(m.x + fx * m.size, m.z + fz * m.size, scale);
      expect(got).toEqual(m);
    }
  });
});

describe("headings", () => {
  it("names compass points with north as −Z", () => {
    expect(dirName(0, -10)).toBe("N");
    expect(dirName(10, 0)).toBe("E");
    expect(dirName(-10, 10)).toBe("SW");
  });
  it("gives in-game yaw (south 0, west 90, north 180, east −90)", () => {
    expect(yaw(0, 10)).toBe(0);
    expect(yaw(-10, 0)).toBe(90);
    expect(Math.abs(yaw(0, -10))).toBe(180);
    expect(yaw(10, 0)).toBe(-90);
  });
  it("converts to Nether coordinates", () => {
    expect(toNether(401, 935)).toEqual({ x: 50, z: 117 });
  });
});
