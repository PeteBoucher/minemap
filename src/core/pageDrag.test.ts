import { describe, expect, it } from "vitest";
import { PageDrag, dragAction } from "./pageDrag";

describe("dragAction", () => {
  it("zoomed in, any drag pans the map", () => {
    expect(dragAction(false, "touch")).toBe("pan");
    expect(dragAction(false, "mouse")).toBe("pan");
  });

  it("fully zoomed out, a finger scrolls the page but a mouse does nothing", () => {
    expect(dragAction(true, "touch")).toBe("scroll");
    expect(dragAction(true, "mouse")).toBe("none");
  });
});

describe("PageDrag", () => {
  it("scrolls by how far the finger has moved on screen since the drag began", () => {
    const d = new PageDrag();
    expect(d.target(500, 100)).toBe(100);
    expect(d.target(450, 100)).toBe(150);
    expect(d.target(380, 150)).toBe(220);
  });

  it("ignores a page scroll position that lags behind (Safari reports it a frame late)", () => {
    const d = new PageDrag();
    d.target(500, 100);
    expect(d.target(450, 100)).toBe(150);
    expect(d.target(400, 120)).toBe(200); // stale 120, not the 150 we asked for
  });

  it("a new drag starts from wherever the page is then", () => {
    const d = new PageDrag();
    d.target(500, 100);
    d.target(300, 100);
    d.reset();
    expect(d.target(600, 900)).toBe(900);
    expect(d.target(550, 900)).toBe(950);
  });
});
