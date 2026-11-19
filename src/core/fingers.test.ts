import { describe, expect, it } from "vitest";
import { Fingers } from "./fingers";

describe("Fingers", () => {
  it("a second finger is the pinch partner of the first", () => {
    const f = new Fingers();
    f.down(1, [10, 10], true);
    f.down(2, [50, 10], false);
    expect(f.size).toBe(2);
    expect(f.other(2)).toEqual([10, 10]);
  });

  // Seen on iPhone (issue #7): a pinch redraws the map under the fingers, and iOS then drops
  // the lift-off of a finger whose element was removed. The map kept that "ghost" finger, so the
  // next one-finger touch was handled as a pinch against it and zoomed 5× → 81×.
  it("a new first finger forgets fingers whose lift-off never arrived", () => {
    const f = new Fingers();
    f.down(1, [10, 10], true);
    f.down(2, [50, 10], false);
    f.up(2); // finger 1's lift-off is lost
    f.down(3, [30, 30], true);
    expect(f.size).toBe(1);
    expect(f.other(3)).toBeUndefined();
  });
});
