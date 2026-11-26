// Straightens a held map that Java drew tilted, so it can be stored and drawn as a square.
//
// Looking down or up while walking tilts the held map, and Java draws it as a trapezoid. A square crop
// then takes in wedges of the frame at two corners (which show as parchment between neighbouring
// maps) and reads terrain near the others from the wrong map pixels. So the map's corners are fitted
// to the frame (frame.ts), and the square is redrawn from the trapezoid through the perspective
// between them. Everything after (placement, terrain, thumbnails, drawing) sees a plain square.
import type { Crop } from "../core/terrain";
import { fitCorners, lumaPlane, perspective } from "./frame";
import { FRAME_H, FRAME_W, type RGBAImage } from "./image";

/**
 * Least difference between opposite edges, in frame pixels (about a map pixel), for a map to count
 * as tilted. Fitting the corners of an untilted map leaves them up to about 3 apart.
 */
const MIN_TILT = 4;
/**
 * Least frame match for the fitted corners to be trusted. Tilted maps fit at 0.76–0.96; at night with
 * unexplored edges the corners can wander a few pixels at 0.72, which isn't a tilt.
 */
const MIN_MATCH = 0.75;

/** `frame` with the map at `crop` straightened if it's tilted, and the square it now fills; otherwise both as given. */
export function straighten(frame: RGBAImage, crop: Crop): { frame: RGBAImage; crop: Crop } {
  const { corners: q, match } = fitCorners(lumaPlane(frame), crop);
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const top = x1 - x0, bottom = x2 - x3, left = y3 - y0, right = y2 - y1;
  if (match < MIN_MATCH || (Math.abs(top - bottom) < MIN_TILT && Math.abs(left - right) < MIN_TILT)) return { frame, crop };

  // the square: as wide as the trapezoid on average, centred on it, from its top
  const size = (top + bottom) / 2, c = { x: (x0 + x1 + x2 + x3) / 4 - size / 2, y: (y0 + y1) / 2, size };
  const at = perspective(q), src = frame.data, out = new Uint8Array(src);
  const cx0 = Math.max(0, Math.floor(c.x)), cx1 = Math.min(FRAME_W, Math.ceil(c.x + size));
  const cy0 = Math.max(0, Math.floor(c.y)), cy1 = Math.min(FRAME_H, Math.ceil(c.y + size));
  for (let y = cy0; y < cy1; y++)
    for (let x = cx0; x < cx1; x++) {
      // nearest pixel, so the map's pixel art stays crisp
      const [sx, sy] = at((x + 0.5 - c.x) / size, (y + 0.5 - c.y) / size);
      const u = Math.min(FRAME_W - 1, Math.max(0, Math.floor(sx))), v = Math.min(FRAME_H - 1, Math.max(0, Math.floor(sy)));
      const o = (y * FRAME_W + x) * 4, i = (v * FRAME_W + u) * 4;
      out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2]; out[o + 3] = src[i + 3];
    }
  return { frame: { width: FRAME_W, height: FRAME_H, data: out }, crop: c };
}
