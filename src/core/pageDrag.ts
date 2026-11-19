// What a one-finger drag on the map does, and where it scrolls the page. Kept apart from the DOM so it can be tested.

export type DragAction = "pan" | "scroll" | "none";

/**
 * Fully zoomed out there is nothing to pan, so a finger scrolls the page instead (issue #7). The map keeps
 * the gesture rather than handing it to the browser, so a second finger that lands late still pinches the
 * map instead of zooming the whole page. A mouse already has the wheel and scrollbar, so it does nothing.
 */
export function dragAction(zoomedOut: boolean, pointerType: string): DragAction {
  if (!zoomedOut) return "pan";
  return pointerType === "touch" ? "scroll" : "none";
}

/**
 * Page scroll for a finger dragging the page. Works from where the drag began, never from the page's
 * current scroll: Safari reports that a frame late, and relative steps then fight it and flicker.
 */
export class PageDrag {
  private from: { screenY: number; scrollY: number } | null = null;

  /** Where to scroll the page to for a finger now at `screenY`. The first call after a reset anchors the drag. */
  target(screenY: number, scrollY: number): number {
    this.from ??= { screenY, scrollY };
    return this.from.scrollY + this.from.screenY - screenY;
  }

  /** A finger went down or lifted: the next drag starts afresh. */
  reset(): void {
    this.from = null;
  }
}
