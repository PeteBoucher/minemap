// One call that works out everything the importer can tell from a screenshot.
import type { Edition } from "../core/edition";
import type { Crop } from "../core/terrain";
import { detectCrop } from "./crop";
import { readF3Position } from "./f3";
import { type RGBAImage, fitToFrame } from "./image";
import { type Position, readPosition } from "./ocr";
import { type Placement, placeFromPosition } from "./place";
import { straighten } from "./straighten";

export interface Analysis {
  /** The screenshot fitted into the 1280×720 frame: what gets stored, and what `crop` refers to. */
  frame: RGBAImage;
  /** Where the held map is in the frame, or null if it doesn't look like one. */
  crop: Crop | null;
  /** The player's coordinates, or null if none are on screen (or they couldn't be read). */
  position: Position | null;
  /** Whose coordinates those were: Bedrock's "Position:" line or Java's F3 screen. */
  edition: Edition | null;
  /** Suggested placement (needs a crop and a position). */
  placement: Placement | null;
}

/** `img` is the screenshot as taken, any size: text is read at full size, the map found in the frame. */
export function analyzeScreenshot(img: RGBAImage, fallbackScale: number): Analysis {
  const fitted = fitToFrame(img);
  const bedrock = readPosition(img), java = bedrock ? null : readF3Position(img);
  const position = bedrock ?? java, edition = bedrock ? "bedrock" : java ? "java" : null;
  const found = detectCrop(fitted, edition)?.crop ?? null;
  // Java draws the held map in perspective, so walking can tilt it (Bedrock's layouts are fixed)
  const { frame, crop } = found && edition === "java" ? straighten(fitted, found) : { frame: fitted, crop: found };
  const placement = crop && position ? placeFromPosition(frame, crop, position, fallbackScale, edition) : null;
  return { frame, crop, position, edition, placement };
}
