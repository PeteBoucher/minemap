import fs from "node:fs";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { type Crop, SWITCH_CROP } from "../core/terrain";
import { DEMO_MAPS } from "../store/demoWorld";
import { analyzeScreenshot } from "./analyze";
import { detectCrop } from "./crop";
import fixtures from "./ocr.fixtures.json";
import { fitToFrame } from "./image";
import { positionFromText, readPosition } from "./ocr";
import { checkScales, placeFromPosition } from "./place";

const decode = (file: string) => jpeg.decode(fs.readFileSync(new URL(`../../public/demo/${file}`, import.meta.url)), { useTArray: true });
const expected = (file: string) => {
  const [x, y, z] = (fixtures as Record<string, string>)[file].match(/-?\d+/g)!.map(Number);
  return { x, y, z };
};

describe("readPosition", () => {
  it.each(Object.keys(fixtures))("reads the coordinates in %s", (file) => {
    expect(readPosition(decode(file))).toEqual(expected(file));
  });

  it("reads the numbers even when split-screen blur breaks up the label", () => {
    expect(positionFromText("? ??s itio??: 648, 94, 2823")).toEqual({ x: 648, y: 94, z: 2823 });
  });

  it("rejects a line where a digit was misread as the colon", () => {
    expect(positionFromText("Position: -13:41, 64, 3828")).toBeNull();
  });

  it("returns null when there are no coordinates on screen", () => {
    const blank = { width: 1280, height: 720, data: new Uint8Array(1280 * 720 * 4).fill(90) };
    expect(readPosition(blank)).toBeNull();
  });
});

// Where the map is in fixtures that aren't demo maps (split-screen holds it in the left half).
// Written out, not taken from crop.ts, so the test doesn't check the code against itself.
const NOT_IN_DEMO: Record<string, Crop> = {
  "2026111819161400-11B64E28AD7A49CA9EC8AC007BE858C6.jpg": { x: 49, y: 60, size: 542 },
};

describe("detectCrop", () => {
  it.each(Object.keys(fixtures))("finds the held map in %s", (file) => {
    const m = DEMO_MAPS.find((d) => d.file === file);
    expect(detectCrop(decode(file))?.crop).toEqual(m?.crop ?? NOT_IN_DEMO[file] ?? SWITCH_CROP);
  });

  // Other devices and Java Edition hold the map elsewhere and at other sizes: move and shrink our
  // screenshots and check the search finds the map again, to within about one map pixel.
  it.each([
    ["2026110415391900", 1.0, 40, 30], ["2026110415391900", 0.9, 30, 25],
    ["2026111217323500", 0.85, -60, 10], ["2026101419105900", 1.0, -50, 20],
  ] as const)("finds the map in %s moved and scaled (%f, %i, %i)", (prefix, k, dx, dy) => {
    const file = Object.keys(fixtures).find((f) => f.startsWith(prefix))!, src = decode(file);
    const W = 1280, H = 720, data = new Uint8Array(W * H * 4).fill(70);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.floor((x - dx) / k), sy = Math.floor((y - dy) / k);
      if (sx >= 0 && sy >= 0 && sx < W && sy < H) data.set(src.data.subarray((sy * W + sx) * 4, (sy * W + sx) * 4 + 4), (y * W + x) * 4);
    }
    const got = detectCrop({ width: W, height: H, data })!.crop;
    expect(Math.abs(got.x - (SWITCH_CROP.x * k + dx))).toBeLessThanOrEqual(8);
    expect(Math.abs(got.y - (SWITCH_CROP.y * k + dy))).toBeLessThanOrEqual(8);
    expect(Math.abs(got.size - SWITCH_CROP.size * k)).toBeLessThanOrEqual(10);
  });

  it("finds no map in a screenshot without one", () => {
    const img = decode(Object.keys(fixtures)[0]);
    // paint over the whole picture with grass: no parchment frame anywhere
    for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 96; img.data[i + 1] = 144; img.data[i + 2] = 48; }
    expect(detectCrop(img)).toBeNull();
  });
});

describe("analyzeScreenshot", () => {
  it("reads, finds and places a locator map in one go", () => {
    const file = DEMO_MAPS.find((m) => m.file.startsWith("2026102414202700"))!;
    expect(analyzeScreenshot(decode(file.file), 0)).toEqual({
      crop: SWITCH_CROP,
      position: { x: 796, y: 78, z: 1676 },
      placement: { x: -64, z: -64, size: 2048, basis: "marker" },
    });
  });
});

describe("placement", () => {
  const cases = DEMO_MAPS.map((m) => {
    const pos = expected(m.file);
    const inside = pos.x >= m.x && pos.x < m.x + m.size && pos.z >= m.z && pos.z < m.z + m.size;
    return { ...m, pos, inside, scale: Math.log2(m.size / 128) };
  });

  it.each(cases)("never confirms a wrong zoom level or a map the player isn't on ($file)", (m) => {
    const img = decode(m.file), found = checkScales(img, m.crop ?? SWITCH_CROP, m.pos).filter((c) => c.found);
    if (!m.inside) expect(found).toEqual([]);
    else for (const c of found) expect(c.scale).toBe(m.scale);
  });

  it("finds the player marker and zoom level on locator maps", () => {
    const auto = cases.filter((m) => placeFromPosition(decode(m.file), m.crop ?? SWITCH_CROP, m.pos, 0).basis === "marker");
    expect(auto.length).toBeGreaterThanOrEqual(7);
    for (const m of auto) expect(placeFromPosition(decode(m.file), m.crop ?? SWITCH_CROP, m.pos, 0)).toMatchObject({ x: m.x, z: m.z, size: m.size });
  });

  it.each(cases.filter((m) => m.inside))("places $file exactly when the zoom level is known", (m) => {
    expect(placeFromPosition(decode(m.file), m.crop ?? SWITCH_CROP, m.pos, m.scale)).toMatchObject({ x: m.x, z: m.z, size: m.size });
  });
});

// Real Java Edition screenshots from a Mac (3024×1898, about 16:10), fitted into the frame. Map
// squares measured by hand from the fitted frames. View bobbing moves the map down in 14.03.*; in
// 14.04.* looking further down holds it lower and smaller, and its unexplored corner is parchment.
const JAVA: Record<string, Crop> = {
  "2026-11-20_14.00.44.jpg": { x: 368, y: 59.5, size: 543 }, // F3 open
  "2026-11-20_14.01.00.jpg": { x: 368, y: 59.5, size: 543 }, // F3
  "2026-11-20_14.01.10.jpg": { x: 368, y: 59.5, size: 543 }, // "Saved screenshot" chat line over the map
  "2026-11-20_14.03.39.jpg": { x: 368, y: 61.5, size: 543 },
  "2026-11-20_14.03.41.jpg": { x: 368, y: 61.5, size: 543 }, // F3, chat line
  "2026-11-20_14.04.33.jpg": { x: 369.5, y: 67.5, size: 539 }, // F3, chat line
  "2026-11-20_14.04.36.jpg": { x: 369.5, y: 67.5, size: 539 }, // chat line
  "2026-11-20_14.07.04.jpg": { x: 368, y: 59.5, size: 543 },
  "2026-11-20_14.07.09.jpg": { x: 368, y: 59.5, size: 543 }, // F3, chat line
  "2026-11-20_14.08.54.jpg": { x: 368, y: 59.5, size: 543 }, // in shade: the frame is grey-purple
  "2026-11-20_14.08.55.jpg": { x: 368, y: 59.5, size: 543 }, // in shade, chat line
};
const decodeJava = (file: string) =>
  fitToFrame(jpeg.decode(fs.readFileSync(new URL(`./fixtures/java/${file}`, import.meta.url)), { useTArray: true, maxMemoryUsageInMB: 1024 }));

describe("Java Edition screenshots", () => {
  it.each(Object.entries(JAVA))("finds the held map in %s", (file, want) => {
    const got = detectCrop(decodeJava(file))?.crop;
    expect(got).toBeDefined();
    // within half a map pixel (543 / 128 ≈ 4.2 frame pixels per map pixel)
    expect(Math.abs(got!.x - want.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(got!.y - want.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(got!.size - want.size)).toBeLessThanOrEqual(2);
  });
});
