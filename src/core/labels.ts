// Place-name label placement, ported from the prototype's draw():
// try spots around each pin and keep the one that overlaps other pins and labels least.

export interface LabelInput {
  /** Pin position in view coordinates (0–size). */
  px: number;
  pz: number;
  /** Rendered label width. */
  w: number;
  /** Off-screen pins still block space but get no label. */
  visible: boolean;
}
export interface LabelSpot { anchor: "start" | "end" | "middle"; x: number; y: number }

type Box = [number, number, number, number];

const SPOTS: [LabelSpot["anchor"], number, number][] = [
  ["start", 12, 4], ["end", -12, 4], ["start", 10, -9], ["start", 10, 17],
  ["end", -10, -9], ["end", -10, 17], ["middle", 0, -13], ["middle", 0, 22],
];
/** Pins near the right edge try left-hand spots first. */
const RIGHT_EDGE_ORDER = [1, 0, 4, 5, 2, 3, 6, 7];

const over = (a: Box, b: Box) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Label offset (relative to its pin) for each input, or null for pins that aren't visible. */
export function placeLabels(items: LabelInput[], size = 600): (LabelSpot | null)[] {
  const boxes: Box[] = items.map((p) => [p.px - 9, p.pz - 10, p.px + 9, p.pz + 10]);
  const view: Box = [0, 0, size, size];
  return items.map(({ px, pz, w, visible }) => {
    if (!visible) return null;
    const spots = px >= size * 0.7 ? RIGHT_EDGE_ORDER.map((k) => SPOTS[k]) : SPOTS;
    let best: { cost: number; spot: LabelSpot; box: Box } | null = null;
    for (const [anchor, x, y] of spots) {
      const bx = px + x - (anchor === "end" ? w : anchor === "middle" ? w / 2 : 0);
      const box: Box = [bx - 1, pz + y - 11, bx + w + 1, pz + y + 3];
      // overlap with everything placed so far, plus a heavy penalty for running off the view
      const cost = boxes.reduce((n, o) => n + over(box, o), 0) + 3 * ((w + 2) * 14 - over(box, view));
      if (!best || cost < best.cost) best = { cost, spot: { anchor, x, y }, box };
      if (cost < 0.5) break;
    }
    boxes.push(best!.box);
    return best!.spot;
  });
}
