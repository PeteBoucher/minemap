import fs from "node:fs";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { type Crop, SWITCH_CROP } from "../core/terrain";
import { DEMO_MAPS } from "../store/demoWorld";
import { analyzeScreenshot } from "./analyze";
import { detectCrop } from "./crop";
import fixtures from "./ocr.fixtures.json";
import { type Position, positionFromText, readPosition } from "./ocr";
import { checkScales, placeFromPosition } from "./place";

const read = (path: string) => jpeg.decode(fs.readFileSync(new URL(path, import.meta.url)), { useTArray: true, maxMemoryUsageInMB: 1024 });
const decode = (file: string) => read(`../../public/demo/${file}`);
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
    const { frame, ...rest } = analyzeScreenshot(decode(file.file), 0);
    expect([frame.width, frame.height]).toEqual([1280, 720]);
    expect(rest).toEqual({
      crop: SWITCH_CROP,
      position: { x: 796, y: 78, z: 1676 },
      edition: "bedrock",
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

// Real Java Edition screenshots from a Mac (3024×1898, about 16:10). Map squares measured by hand
// from the fitted frames. View bobbing moves the map down in 14.03.*; in 14.04.* looking further
// down holds it lower and smaller, and its unexplored corner is parchment. Measuring on
// fitToFrame's output is safe: image.test.ts pins its geometry with plain arithmetic.
// `block` is the F3 screen's "Block: x y z" line, read by eye at full size (null: F3 was off).
const JAVA: Record<string, { crop: Crop; block: Position | null }> = {
  "2026-11-20_14.00.44.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: { x: 1, y: 84, z: 3 } },
  "2026-11-20_14.01.00.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: { x: 1, y: 84, z: 3 } },
  "2026-11-20_14.01.10.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: null }, // "Saved screenshot" chat line over the map
  "2026-11-20_14.03.39.jpg": { crop: { x: 368, y: 61.5, size: 543 }, block: null },
  "2026-11-20_14.03.41.jpg": { crop: { x: 368, y: 61.5, size: 543 }, block: { x: -14, y: 63, z: 83 } }, // chat line; F3 over bright water
  "2026-11-20_14.04.33.jpg": { crop: { x: 369.5, y: 67.5, size: 539 }, block: { x: 54, y: 63, z: 219 } }, // F3 over bright water
  "2026-11-20_14.04.36.jpg": { crop: { x: 369.5, y: 67.5, size: 539 }, block: null }, // chat line
  "2026-11-20_14.07.04.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: null },
  "2026-11-20_14.07.09.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: { x: 44, y: 95, z: 51 } }, // chat line
  "2026-11-20_14.08.54.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: { x: -85, y: 72, z: 2 } }, // in shade: the frame is grey-purple
  "2026-11-20_14.08.55.jpg": { crop: { x: 368, y: 59.5, size: 543 }, block: null }, // in shade, chat line
};
const readJava = (file: string) => read(`./fixtures/java/${file}`);
/** Half a map pixel: 543 / 128 ≈ 4.2 frame pixels per map pixel. */
const HALF_MAP_PX = 2;

describe("Java Edition screenshots", () => {
  it.each(Object.entries(JAVA))("finds the held map in %s", (file, { crop: want }) => {
    const a = analyzeScreenshot(readJava(file), 0);
    expect([a.frame.width, a.frame.height]).toEqual([1280, 720]);
    expect(a.crop).not.toBeNull();
    for (const k of ["x", "y", "size"] as const) expect(Math.abs(a.crop![k] - want[k])).toBeLessThanOrEqual(HALF_MAP_PX);
  });

  // These screenshots are also what f3Glyphs.ts was learned from, so this shows the glyphs fit them;
  // scripts/gen-f3-glyphs.ts's leave-one-out check is what shows reading works on new screenshots.
  it.each(Object.entries(JAVA))("reads the F3 screen's block coordinates in %s", (file, { block }) => {
    const a = analyzeScreenshot(readJava(file), 0);
    expect(a.position).toEqual(block);
    expect(a.edition).toBe(block ? "java" : null);
  });

  // F3's box is see-through: over snow and sky it's far lighter, and the scenery right beside it can
  // be as light as the text.
  it.each([
    ["f3-over-white-snow.jpg", { x: 617, y: 184, z: 380 }],
    ["f3-over-sky-and-snow.jpg", { x: 804, y: 252, z: 632 }],
    ["f3-over-snowy-rock.jpg", { x: 617, y: 184, z: 380 }],
  ])("reads the F3 coordinates with bright scenery behind them in %s", (file, block) => {
    expect(analyzeScreenshot(readJava(file), 0).position).toEqual(block);
  });

  it("reads the F3 coordinates at another window size (1920×1200)", () => {
    expect(analyzeScreenshot(readJava("2026-11-20_13.43.40.jpg"), 0).position).toEqual({ x: -7, y: 62, z: 72 });
  });

  it("finds the map in a 32:9 screenshot as in a 16:9 one", () => {
    // a Switch screenshot with scenery-grey added on both sides: 2560×720
    const src = decode(DEMO_MAPS[0].file), W = 2560, data = new Uint8Array(W * 720 * 4).fill(90);
    for (let y = 0; y < 720; y++) data.set(src.data.subarray(y * 1280 * 4, (y + 1) * 1280 * 4), (y * W + 640) * 4);
    expect(analyzeScreenshot({ width: W, height: 720, data }, 0).crop).toEqual(DEMO_MAPS[0].crop ?? SWITCH_CROP);
  });

  it("finds no map in a 1920×1200 screenshot with F3 open and a sword in hand", () => {
    expect(analyzeScreenshot(readJava("2026-11-20_13.43.40.jpg"), 0).crop).toBeNull();
  });
});
