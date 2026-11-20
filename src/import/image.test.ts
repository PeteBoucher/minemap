import { describe, expect, it } from "vitest";
import { type RGBAImage, fitToFrame, rgb } from "./image";

const solid = (width: number, height: number, [r, g, b]: [number, number, number]): RGBAImage => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, 255], i);
  return { width, height, data };
};
const RED: [number, number, number] = [200, 30, 30];
const PAD: [number, number, number] = [0, 0, 0];

describe("fitToFrame", () => {
  it("pads a 16:10 screenshot (Java on a Mac) at the sides instead of stretching it", () => {
    // 160×100 scaled to 720 high is 1152 wide, leaving 64 columns each side
    const out = fitToFrame(solid(160, 100, RED));
    expect([out.width, out.height]).toEqual([1280, 720]);
    expect(rgb(out, 63, 360)).toEqual(PAD);
    expect(rgb(out, 64, 360)).toEqual(RED);
    expect(rgb(out, 1215, 360)).toEqual(RED);
    expect(rgb(out, 1216, 360)).toEqual(PAD);
    expect(rgb(out, 640, 0)).toEqual(RED);
    expect(rgb(out, 640, 719)).toEqual(RED);
  });
});
