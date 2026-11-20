// One call that works out everything the importer can tell from a screenshot.
import type { Crop } from "../core/terrain";
import { detectCrop } from "./crop";
import { type RGBAImage, fitToFrame } from "./image";
import { type Position, readPosition } from "./ocr";
import { type Placement, placeFromPosition } from "./place";

export interface Analysis {
  /** The screenshot fitted into the 1280×720 frame: what gets stored, and what `crop` refers to. */
  frame: RGBAImage;
  /** Where the held map is in the frame, or null if it doesn't look like one. */
  crop: Crop | null;
  /** The player's coordinates, or null if none are on screen (or they couldn't be read). */
  position: Position | null;
  /** Suggested placement (needs both of the above). */
  placement: Placement | null;
}

/** `img` is the screenshot as taken, any size: text is read at full size, the map found in the frame. */
export function analyzeScreenshot(img: RGBAImage, fallbackScale: number): Analysis {
  const frame = fitToFrame(img);
  const crop = detectCrop(frame)?.crop ?? null;
  const position = readPosition(img);
  const placement = crop && position ? placeFromPosition(frame, crop, position, fallbackScale) : null;
  return { frame, crop, position, placement };
}
