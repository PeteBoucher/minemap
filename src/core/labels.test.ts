import { describe, expect, it } from "vitest";
import { placeLabels } from "./labels";

describe("placeLabels", () => {
  it("puts a lone label to the right of its pin", () => {
    expect(placeLabels([{ px: 300, pz: 300, w: 60, visible: true }])).toEqual([{ anchor: "start", x: 12, y: 4 }]);
  });

  it("puts labels near the right edge on the left", () => {
    expect(placeLabels([{ px: 560, pz: 300, w: 60, visible: true }])[0]?.anchor).toBe("end");
  });

  it("moves a label out of a neighbour's way", () => {
    const [a, b] = placeLabels([
      { px: 300, pz: 300, w: 80, visible: true },
      { px: 300, pz: 306, w: 80, visible: true }, // its default spot would overlap a's label
    ]);
    expect(a).toEqual({ anchor: "start", x: 12, y: 4 });
    expect(b).not.toEqual(a);
  });

  it("gives hidden pins no label", () => {
    expect(placeLabels([{ px: -100, pz: 0, w: 40, visible: false }])).toEqual([null]);
  });
});
