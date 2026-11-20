// One call that works out everything the importer can tell from a screenshot.
import type { Crop } from "../core/terrain";
import { detectCrop } from "./crop";
import type { RGBAImage } from "./image";
import { type Position, readPosition } from "./ocr";
import { type Placement, placeFromPosition } from "./place";

export interface Analysis {
  /** Where the held map is in the screenshot, or null if it doesn't look like one. */
  crop: Crop | null;
  /** The player's coordinates, or null if "Show coordinates" wasn't on (or couldn't be read). */
  position: Position | null;
  /** Suggested placement (needs both of the above). */
  placement: Placement | null;
}

/** `img` must be 1280×720: see fitToFrame (tests) and toFrame in the UI. */
export function analyzeScreenshot(img: RGBAImage, fallbackScale: number): Analysis {
  const crop = detectCrop(img)?.crop ?? null;
  const position = readPosition(img);
  const placement = crop && position ? placeFromPosition(img, crop, position, fallbackScale) : null;
  return { crop, position, placement };
}
