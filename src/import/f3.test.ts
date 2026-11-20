import { describe, expect, it } from "vitest";
import { f3PositionFromText } from "./f3";

describe("f3PositionFromText", () => {
  it("takes the Block line when the XYZ line agrees", () => {
    expect(f3PositionFromText(["XYZ: -6.313 / 62.11076 / 72.688", "Block: -7 62 72", "Chunk: -1 3 4 [31 4 in r.-1.0.mca]"])).toEqual({ x: -7, y: 62, z: 72 });
  });

  it("gives no position when the two lines disagree (a misread digit)", () => {
    expect(f3PositionFromText(["XYZ: 1.558 / 84.00000 / 3.621", "Block: 7 84 3"])).toBeNull();
  });

  it("rounds the XYZ line down, towards minus, to check the Block line", () => {
    expect(f3PositionFromText(["XYZ: -6.313 / 62.11076 / -0.5", "Block: -7 62 -1"])).toEqual({ x: -7, y: 62, z: -1 });
  });

  it("gives no position when only one of the two lines reads", () => {
    expect(f3PositionFromText(["XYZ: -6.313 / 62.11076 / 72.688", "Bl?ck: -7 62 72"])).toBeNull();
    expect(f3PositionFromText(["XYZ: -6.3?3 / 62.11076 / 72.688", "Block: -7 62 72"])).toBeNull();
  });

  it("ignores other lines that start with three numbers", () => {
    expect(f3PositionFromText(["Chunk: 0 5 0 [0 0 in r.0.0.mca]", "Section-relative: 01 04 03"])).toBeNull();
  });
});
