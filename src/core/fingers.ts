// Which fingers are on the map, and where. Kept apart from the DOM so the bookkeeping can be tested.

export type Pt = [number, number];

export class Fingers {
  private pts = new Map<number, Pt>();

  /**
   * A finger touched down. `isPrimary` marks the first finger of a new touch, so any finger still
   * listed has lost its lift-off (iOS drops it when a redraw removes the element under the finger).
   */
  down(id: number, at: Pt, isPrimary: boolean): void {
    if (isPrimary) this.pts.clear();
    this.pts.set(id, at);
  }

  up(id: number): void {
    this.pts.delete(id);
  }

  get size(): number {
    return this.pts.size;
  }

  get(id: number): Pt | undefined {
    return this.pts.get(id);
  }

  set(id: number, at: Pt): void {
    if (this.pts.has(id)) this.pts.set(id, at);
  }

  /** Where the other finger of a two-finger pinch is. */
  other(id: number): Pt | undefined {
    for (const [k, v] of this.pts) if (k !== id) return v;
    return undefined;
  }

  ids(): number[] {
    return [...this.pts.keys()];
  }
}
