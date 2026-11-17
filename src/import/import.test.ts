import fs from "node:fs";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { SWITCH_CROP } from "../core/terrain";
import { DEMO_MAPS } from "../store/demoWorld";
import { analyzeScreenshot } from "./analyze";
import { detectCrop } from "./crop";
import fixtures from "./ocr.fixtures.json";
import { readPosition } from "./ocr";
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

  it("returns null when there are no coordinates on screen", () => {
    const blank = { width: 1280, height: 720, data: new Uint8Array(1280 * 720 * 4).fill(90) };
    expect(readPosition(blank)).toBeNull();
  });
});

describe("detectCrop", () => {
  it.each(Object.keys(fixtures))("finds the held map in %s", (file) => {
    const m = DEMO_MAPS.find((d) => d.file === file);
    expect(detectCrop(decode(file))?.crop).toEqual(m?.crop ?? SWITCH_CROP);
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
