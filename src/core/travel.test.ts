import { describe, expect, it } from "vitest";
import { DEMO_PLACES } from "../store/demoWorld";
import golden from "./prototype.golden.json";
import { type BiomePin, type Pace, type TravelCtx, DAYLIGHT, biomeAt, bpsAt, dayVerdict, reach, reachCovers, travel } from "./travel";

const pins: BiomePin[] = DEMO_PLACES.filter((p) => p.biome).map((p) => ({ x: p.x, z: p.z, biome: p.biome! }));
const P = DEMO_PLACES;

// Reference outputs from running the prototype's own code (scripts/golden-from-prototype.mjs),
// with no map-screenshot terrain loaded.
describe.each(golden.runs)("matches the prototype with pace $pace", (run) => {
  const ctx: TravelCtx = { pace: run.pace as Pace, pins };
  it.each(run.travel)("travel time from place $i to $j", ({ i, j, secs, by }) => {
    const got = travel(ctx, P[i], P[j]);
    expect(got.secs).toBeCloseTo(secs, 6);
    expect(Object.keys(got.by).sort()).toEqual(Object.keys(by).sort());
    for (const [k, v] of Object.entries(by)) expect(got.by[k]).toBeCloseTo(v as number, 6);
  });
  it.each(run.reach)("one-day reach from place $i", ({ i, full, half }) => {
    const got = reach(ctx, P[i]);
    got.full.forEach((r, k) => expect(r).toBeCloseTo(full[k], 6));
    got.half.forEach((r, k) => expect(r).toBeCloseTo(half[k], 6));
  });
});

describe("travel basics", () => {
  it("on fixed open ground reaches 1,800 blocks in a day and 900 there-and-back", () => {
    const { full, half } = reach({ pace: "open", pins: [] }, { x: 0, z: 0 });
    expect(full.every((r) => Math.abs(r - 3 * DAYLIGHT * 60) < 1e-6)).toBe(true);
    expect(half.every((r) => Math.abs(r - 900) < 1e-6)).toBe(true);
  });
  it("ignores biome pins further than 450 blocks away", () => {
    expect(biomeAt([{ x: 0, z: 0, biome: "ocean" }], 449, 0)?.biome).toBe("ocean");
    expect(biomeAt([{ x: 0, z: 0, biome: "ocean" }], 451, 0)).toBeNull();
  });
  it("lets map terrain beat the biome guess on auto pace", () => {
    const ctx: TravelCtx = { pace: "auto", pins: [{ x: 0, z: 0, biome: "plains" }], terrainAt: () => ({ pace: "boat", label: "water (map)" }) };
    expect(bpsAt(ctx, 0, 0)).toBe(6);
    expect(Object.keys(travel(ctx, { x: 0, z: 0 }, { x: 100, z: 0 }).by)).toEqual(["water (map)"]);
    expect(bpsAt({ ...ctx, pace: "rough" }, 0, 0)).toBe(0.75);
  });
});

describe("dayVerdict", () => {
  it("grades a trip against one day's daylight", () => {
    expect(dayVerdict(5, 900).level).toBe("ok");
    expect(dayVerdict(9, 1600).level).toBe("warn");
    expect(dayVerdict(20, 3000)).toMatchObject({ level: "bad", days: 3 });
    expect(dayVerdict(20, 3000).text).toBe("Too far for one day · plan 3 days, a shelter every ~1,000 blocks");
  });
});

describe("reachCovers", () => {
  const view = { x0: -200, z0: -200, span: 400 }; // blocks -200..200 both ways
  const round = (r: number) => Array(72).fill(r);

  it("is true when a day's reach is bigger than the whole view", () => {
    expect(reachCovers(round(1000), { x: 0, z: 0 }, view)).toBe(true);
  });

  it("is false when the view's corners are beyond the reach", () => {
    // corners are 283 blocks from the middle
    expect(reachCovers(round(250), { x: 0, z: 0 }, view)).toBe(false);
  });

  it("works for a starting place outside the view", () => {
    // the furthest corner, (-200, ±200), is 728 blocks from (500, 0)
    expect(reachCovers(round(1000), { x: 500, z: 0 }, view)).toBe(true);
    expect(reachCovers(round(700), { x: 500, z: 0 }, view)).toBe(false);
  });

  it("is false when the reach falls short in one direction (slow terrain to the east)", () => {
    const rs = round(1000);
    for (let k = 15; k <= 21; k++) rs[k] = 100; // 75°–105°: east
    expect(reachCovers(rs, { x: 0, z: 0 }, view)).toBe(false);
  });
});
