// How to get coordinates on screen, which differs by edition, with a toggle between the two. Used
// wherever the app tells players what to do in game; the choice is a world setting.
import type { Edition } from "../core/edition";
import { h } from "./dom";

export const DEFAULT_EDITION: Edition = "bedrock";

const HOWTO = {
  /** The places list when it's empty. */
  places: {
    bedrock: "No places yet. Turn on “Show coordinates” in your world settings, then add where you are below.",
    java: "No places yet. Press F3 to see your coordinates (the “Block” line), then add where you are below.",
  },
  /** Under the map screenshots button. */
  shots: {
    bedrock: "Hold a map in game with “Show coordinates” on and take a screenshot. Minemap reads where you were and lines the map up for you.",
    java: "Hold a map in game with F3 open and take a screenshot (F2). Minemap reads where you were and lines the map up for you.",
  },
  /** In the import dialog, when no held map was found: how to retake the screenshot. */
  nomap: {
    bedrock: "This doesn't look like a screenshot of a map held in your hand. Hold the map so it faces you squarely in the middle of the screen, ideally in daylight, and take it again.",
    java: "This doesn't look like a screenshot of a map held in your hand. Look further down so the map faces you squarely (the second number on F3's “Facing” line at about 70 or more), ideally in daylight, and take it again.",
  },
  /** In the import dialog, when a map was found but no coordinates. */
  unread: {
    bedrock: "Found the map, but couldn't read any coordinates. Type any spot that's on this map. Next time, turn on “Show coordinates” in your world settings and Minemap will read them for you.",
    java: "Found the map, but couldn't read any coordinates. Type any spot that's on this map. Next time, press F3 before taking the screenshot and Minemap will read them for you.",
  },
} satisfies Record<string, Record<Edition, string>>;

export type HowTo = keyof typeof HOWTO;

/** The instruction `which` for `edition`. */
export const howTo = (which: HowTo, edition: Edition): string => HOWTO[which][edition];

const LABELS: Record<Edition, string> = { bedrock: "Bedrock", java: "Java" };

/** A two-button Bedrock | Java switch. */
export function editionToggle(edition: Edition, onChange: (e: Edition) => void): HTMLElement {
  const group = h("span", { className: "edition", role: "group", ariaLabel: "Minecraft edition" });
  for (const e of Object.keys(LABELS) as Edition[]) {
    const b = h("button", { type: "button", textContent: LABELS[e] });
    b.setAttribute("aria-pressed", String(e === edition));
    b.onclick = () => { if (e !== edition) onChange(e); };
    group.append(b);
  }
  return group;
}

/** The children of an instruction paragraph: the toggle, then the text for `edition`. */
export const howToContent = (which: HowTo, edition: Edition, onChange: (e: Edition) => void): (Node | string)[] =>
  [editionToggle(edition, onChange), " " + howTo(which, edition)];
