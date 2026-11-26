import fs from "node:fs";
import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { type Crop, SWITCH_CROP, drawnPart } from "../core/terrain";
import { DEMO_MAPS } from "../store/demoWorld";
import { analyzeScreenshot } from "./analyze";
import { detectCrop } from "./crop";
import javaCrops from "./fixtures/java/crops.json";
import { fitToFrame, frameRect, rgb } from "./image";
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

// iPhone Bedrock holds the map a pixel inside the Switch layout, which is still the closest match:
// the crop's left column and its top and bottom rows are (partly) the map's frame, and drawn they
// show as a pale line between maps. Measured on these shots: the map fills columns 369–911 and
// rows 60–602 of the frame.
describe("drawnPart", () => {
  it.each(["IMG_3768.jpg", "IMG_3775.jpg"])("keeps to the map itself in iPhone shot %s", (file) => {
    const c = drawnPart(detectCrop(fitToFrame(read(`./fixtures/ios/${file}`)))!.crop);
    expect(c.x).toBeGreaterThanOrEqual(369);
    expect(c.y).toBeGreaterThanOrEqual(60);
    expect(c.x + c.size).toBeLessThanOrEqual(912);
    expect(c.y + c.size).toBeLessThanOrEqual(603);
    expect(c.size).toBeGreaterThan(543 - 4); // loses less than a map pixel (4¼ frame pixels)
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
// from the fitted frames, in fixtures/java/crops.json (scripts/gen-frame-template.ts learns the
// frame from them too). View bobbing moves the map down in 14.03.*; in 14.04.* looking further down
// holds it lower and smaller, and its unexplored corner is parchment. Measuring on fitToFrame's
// output is safe: image.test.ts pins its geometry with plain arithmetic.
// `block` is the F3 screen's "Block: x y z" line, read by eye at full size (null: F3 was off).
const JAVA: Record<string, { crop: Crop; block: Position | null }> = Object.fromEntries(Object.entries({
  "2026-11-20_14.00.44.jpg": { x: 1, y: 84, z: 3 },
  "2026-11-20_14.01.00.jpg": { x: 1, y: 84, z: 3 },
  "2026-11-20_14.01.10.jpg": null, // "Saved screenshot" chat line over the map
  "2026-11-20_14.03.39.jpg": null,
  "2026-11-20_14.03.41.jpg": { x: -14, y: 63, z: 83 }, // chat line; F3 over bright water
  "2026-11-20_14.04.33.jpg": { x: 54, y: 63, z: 219 }, // F3 over bright water
  "2026-11-20_14.04.36.jpg": null, // chat line
  "2026-11-20_14.07.04.jpg": null,
  "2026-11-20_14.07.09.jpg": { x: 44, y: 95, z: 51 }, // chat line
  "2026-11-20_14.08.54.jpg": { x: -85, y: 72, z: 2 }, // in shade: the frame is grey-purple
  "2026-11-20_14.08.55.jpg": null, // in shade, chat line
} as Record<string, Position | null>).map(([file, block]) => {
  const crop = (javaCrops as Record<string, Crop>)[file];
  if (!crop) throw new Error(`${file} has no square in fixtures/java/crops.json`);
  return [file, { crop, block }];
}));

// Java screenshots whose maps have unexplored edges. Unexplored map is drawn in the frame's parchment
// tint, so only the edges that explored map reaches can be measured: by hand, in full-size pixels
// (left/top: the map's first column/row; right/bottom: the frame's first, just past the map).
// Where only three edges show, the fourth follows from the map being square (noted). Edges under
// unexplored map can't be measured at all, so some screenshots pin only one or two.
// On main, level4, 10.34.24 and 10.39.01 were found wrong; the others happened to sit at the Switch
// layout and are here to keep them right.
type Edges = Partial<Record<"left" | "top" | "right" | "bottom", number>>;
const UNEXPLORED: Record<string, Edges> = {
  "level4-unexplored-top.jpg": { left: 529, top: 100, right: 1391, bottom: 962 }, // 1920×1142; top from the square
  "2026-11-24_10.31.07.jpg": { right: 1412, bottom: 1005 }, // 1920×1200 from here on
  "2026-11-24_10.32.09.jpg": { right: 1412 }, // almost all unexplored
  "2026-11-24_10.34.24.jpg": { top: 110, right: 1412 }, // held lower: looking down from a boat
  "2026-11-24_10.35.40.jpg": { left: 508, top: 100, right: 1412, bottom: 1005 },
  "2026-11-24_10.39.01.jpg": { left: 508, top: 106, right: 1412, bottom: 1010 },
  "2026-11-24_10.39.18.jpg": { left: 508, bottom: 1005 }, // unexplored top half
};

/** A crop's edges in full-size pixels of a w×h screenshot (undoing fitToFrame; see frameRect). */
function cropEdges(c: Crop, w: number, h: number): Required<Edges> {
  const r = frameRect(w, h), kx = r.sw / r.w, ky = h / r.h;
  const X = (x: number) => r.sx + (x - r.x) * kx, Y = (y: number) => (y - r.y) * ky;
  return { left: X(c.x), top: Y(c.y), right: X(c.x + c.size), bottom: Y(c.y + c.size) };
}
const readJava = (file: string) => read(`./fixtures/java/${file}`);
/** Half a map pixel: 543 / 128 ≈ 4.2 frame pixels per map pixel. */
const HALF_MAP_PX = 2;

/**
 * Measured squares of maps that are tilted (held lower): 14.04.33's left edge slants from x≈804 at
 * the top to ≈787 near the bottom, full-size pixels; 14.04.36 is the same hold without F3. These are
 * stored straightened, into a square as tall as the map is on screen, so only where the square
 * sits is still measured.
 */
const TILTED = new Set(["2026-11-20_14.04.33.jpg", "2026-11-20_14.04.36.jpg"]);

describe("Java Edition screenshots", () => {
  it.each(Object.entries(JAVA))("finds the held map in %s", (file, { crop: want }) => {
    const a = analyzeScreenshot(readJava(file), 0);
    expect([a.frame.width, a.frame.height]).toEqual([1280, 720]);
    expect(a.crop).not.toBeNull();
    for (const k of TILTED.has(file) ? (["x", "y"] as const) : (["x", "y", "size"] as const))
      expect(Math.abs(a.crop![k] - want[k]), k).toBeLessThanOrEqual(HALF_MAP_PX);
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

  // A map pixel is 7 full-size pixels in these screenshots: allow half of one.
  it.each(Object.entries(UNEXPLORED))("finds the held map in %s though its edges are unexplored", (file, edges) => {
    const img = readJava(file), crop = analyzeScreenshot(img, 0).crop;
    expect(crop).not.toBeNull();
    const got = cropEdges(crop!, img.width, img.height);
    for (const [k, want] of Object.entries(edges)) expect(Math.abs(got[k as keyof Edges] - want), k).toBeLessThanOrEqual(3.5);
  });

  it("finds a map held at night while walking, though it is tilted and lit purple", () => {
    // 2026-11-24_10.39.40: the frame is a trapezoid here (its left edge runs from x=506 to 501 down the
    // map), so it is stored straightened, into a square as tall as the map is on screen; this only
    // pins that square to within a map pixel and a half of the lower edges measured.
    // Its top edge is under unexplored map and can't be measured.
    const img = readJava("2026-11-24_10.39.40.jpg"), crop = analyzeScreenshot(img, 0).crop;
    expect(crop).not.toBeNull();
    const got = cropEdges(crop!, img.width, img.height);
    for (const [k, want] of Object.entries({ left: 504, right: 1418.5, bottom: 1023 })) expect(Math.abs(got[k as keyof Edges] - want), k).toBeLessThanOrEqual(10);
  });

  // Looking down while walking tilts the map into a trapezoid. A square crop takes in wedges of
  // frame at the top corners, which show between maps; the map is stored straightened, so the map
  // pixels along the crop's edges are map. Corners measured by hand (full-size pixels, the map's own):
  // - 2026-11-24_12.26.43: (518, 131), (1402, 131), (1424, 1033), (497, 1033): 884 wide at the top,
  //   927 at the bottom; explored all round.
  // - 2026-11-26_11.55.42, tilted far: top left (884, 427), top right (2142, 425), bottom left
  //   (680, 1862); the right edge is at x≈2250 on row 1200. 1258 wide at the top, about 1660 at the
  //   bottom. Only the left edge is checked: its top right is unexplored (the frame's tint), the
  //   hotbar covers the bottom edge, and a beach runs down the right edge (shaded sand is within
  //   this test's reach of the frame's light tone).
  // - switch/2026112612523700 (Bedrock on a Switch, 1280×720): (402, 167), (877, 167), bottom left
  //   (322, 710); a beach hides the bottom right. 475 wide at the top, about 635 at the bottom. The
  //   hotbar covers the bottom edge and the beach the right, so the left and top are checked.
  //   Three more from the same spot: 22600 is held lowest, its bottom corners a pixel or two past the
  //   screenshot's bottom edge.
  type Edge = "top" | "bottom" | "left" | "right";
  it.each([
    ["java/2026-11-24_12.26.43.jpg", { top: [0, 128], bottom: [0, 128], left: [0, 128], right: [0, 128] }],
    ["java/2026-11-26_11.55.42.jpg", { left: [0, 128] }],
    ["switch/2026112612523700.jpg", { top: [0, 128], left: [0, 128] }],
    ["switch/2026112612522600.jpg", { top: [0, 120], left: [0, 128] }], // beach in the top right corner
    ["switch/2026112612522800.jpg", { top: [0, 128], left: [0, 128] }],
    ["switch/2026112612525700.jpg", { top: [0, 128], left: [0, 128] }],
  ] as [string, Partial<Record<Edge, [number, number]>>][])("straightens a map tilted by looking down while walking in %s", (file, edges) => {
    const a = analyzeScreenshot(read(`./fixtures/${file}`), 0), c = a.crop!;
    // the frame's two tones, light and shadow, read off these screenshots
    const isFrame = ([r, g, b]: number[]) => [[215, 192, 150], [150, 135, 108]].some(([R, G, B]) => Math.hypot(r - R, g - G, b - B) < 25);
    const p = c.size / 128, at = (i: number, j: number) => rgb(a.frame, Math.floor(c.x + (i + 0.5) * p), Math.floor(c.y + (j + 0.5) * p));
    const cell: Record<Edge, (k: number) => [number, number]> = { top: (k) => [k, 0], bottom: (k) => [k, 127], left: (k) => [0, k], right: (k) => [127, k] };
    const onFrame: string[] = [];
    for (const [edge, [from, to]] of Object.entries(edges) as [Edge, [number, number]][])
      for (let k = from; k < to; k++) if (isFrame(at(...cell[edge](k)))) onFrame.push(`${edge} ${k}`);
    expect(onFrame).toEqual([]);
  });

  // 2026-11-24_10.56.22: at night, with unexplored map along every edge, the frame's corners fit
  // poorly and come out a little wider at the top. The frame's outer edges are straight (x≈458 and
  // ≈1462 full-size, top to bottom), so it isn't tilted and must be stored as taken.
  it("leaves alone a map whose corners can't be fitted surely (night, unexplored edges)", () => {
    const img = readJava("2026-11-24_10.56.22.jpg"), got = analyzeScreenshot(img, 0).frame.data, want = fitToFrame(img).data;
    expect(got.filter((v, i) => v !== want[i]).length).toBe(0);
  });

  // A map whose bottom is below the screenshot can't be straightened: the rows that would fill the
  // square aren't there. 12.26.43 cut off at row 1000 loses its bottom edge (row 1033) and the frame
  // below it, so it must be stored as taken, not filled with copies of the last row.
  it("doesn't straighten a tilted map that runs off the bottom of the screenshot", () => {
    const src = readJava("2026-11-24_12.26.43.jpg"), H = 1000;
    const img = { width: src.width, height: H, data: src.data.slice(0, src.width * H * 4) };
    const a = analyzeScreenshot(img, 0), want = fitToFrame(img).data;
    expect(a.edition).toBe("java");
    expect(a.frame.data.filter((v, i) => v !== want[i]).length).toBe(0);
  });

  // Maps held level sit exactly at a known Switch or iPhone layout. Fitting corners to their frames
  // wanders more than on Java's (up to 5.5 frame pixels between opposite edges in these), so a map
  // found at a layout is never straightened.
  it.each([...Object.keys(fixtures).map((f) => `../../public/demo/${f}`), "./fixtures/ios/IMG_3768.jpg", "./fixtures/ios/IMG_3775.jpg"])(
    "stores the level Bedrock map in %s as taken", (path) => {
      const img = read(path), got = analyzeScreenshot(img, 0).frame.data, want = fitToFrame(img).data;
      expect(got.filter((v, i) => v !== want[i]).length).toBe(0);
    });

  // Straightening resamples the map, so it must leave maps that aren't tilted exactly as taken.
  it.each(Object.keys(JAVA).filter((f) => !TILTED.has(f)))("stores the untilted map in %s as taken", (file) => {
    const img = readJava(file);
    const got = analyzeScreenshot(img, 0).frame.data, want = fitToFrame(img).data;
    expect(got.filter((v, i) => v !== want[i]).length).toBe(0);
  });

  // Java lights the held map like any other item: under a roof the white player marker comes out
  // cream, about (229, 209, 186), dimmed exactly as the frame is. Zoom levels worked out by hand from
  // the Block line and where the marker is drawn.
  it.each([
    ["2026-11-24_10.39.18.jpg", { x: -832, z: -64, size: 256 }], // under a roof, level 1
    ["2026-11-24_10.39.01.jpg", { x: -832, z: 64, size: 128 }], // under a roof, level 0
    ["2026-11-24_10.31.07.jpg", { x: -320, z: -64, size: 256 }],
    ["2026-11-24_10.32.09.jpg", { x: -576, z: -64, size: 512 }],
    ["2026-11-24_10.34.24.jpg", { x: -576, z: -64, size: 512 }],
    ["2026-11-24_10.35.40.jpg", { x: -576, z: -64, size: 512 }],
    ["level4-unexplored-top.jpg", { x: -64, z: -64, size: 2048 }],
  ])("places %s by its player marker, whatever the light", (file, want) => {
    const a = analyzeScreenshot(readJava(file), 0);
    expect(a.placement).toEqual({ ...want, basis: "marker" });
    // and no other zoom level's spot looks like a marker
    expect(checkScales(a.frame, a.crop!, a.position!, a.edition).filter((c) => c.found).map((c) => c.corner.size)).toEqual([want.size]);
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
