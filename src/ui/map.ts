// SVG map: biome tint, game-map screenshots, grid, compass, day-reach shape, route line and pins.
// Ported from the prototype's draw(), zoomAt(), panBy() and pointer handlers.
import { Fingers } from "../core/fingers";
import { biomeCol } from "../core/biomes";
import { placeLabels } from "../core/labels";
import { SWITCH_CROP } from "../core/terrain";
import { type BiomePin, biomeAt } from "../core/travel";
import type { MapShot, Place } from "../store/db";

const NS = "http://www.w3.org/2000/svg";
const V = 600; // viewBox size

function el(tag: string, attrs: Record<string, string | number>, text?: string | number): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text != null) e.textContent = String(text);
  return e;
}

export interface MapModel {
  places: Place[];
  maps: MapShot[];
  imageUrl: (imageId: string) => string | undefined;
  showMaps: boolean;
  selA?: Place;
  selB?: Place;
  /** One-day reach around selA (solid) and there-and-back (dashed). */
  reach?: { full: number[]; half: number[] };
}

export class MapView {
  private svg: SVGSVGElement;
  private onPick: (id: string) => void;
  private onGrid: (step: number) => void;
  private view: { k: number; cx: number | null; cz: number | null } = { k: 1, cx: null, cz: null };
  private T = { x0: 0, z0: 0, S: 1, span: V };
  private model: MapModel | null = null;
  private dragged = false;

  constructor(svg: SVGSVGElement, onPick: (id: string) => void, onGrid: (step: number) => void) {
    this.svg = svg;
    this.onPick = onPick;
    this.onGrid = onGrid;
    this.bindPointer();
  }

  /** Show everything again (e.g. after switching worlds). */
  fit(): void {
    this.view = { k: 1, cx: null, cz: null };
    this.draw();
  }

  zoomBy(f: number): void {
    this.zoomAt(f);
  }

  draw(model: MapModel | null = this.model): void {
    this.model = model;
    const svg = this.svg;
    svg.replaceChildren();
    if (!model) return;
    const P = model.places;

    // fit = the view that shows every place and map; view.k zooms in from there around view.cx, view.cz
    const xs = [...P.map((p) => p.x), ...model.maps.flatMap((m) => [m.x, m.x + m.size])];
    const zs = [...P.map((p) => p.z), ...model.maps.flatMap((m) => [m.z, m.z + m.size])];
    if (!xs.length) { xs.push(-200, 200); zs.push(-200, 200); }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const fitSpan = Math.max(maxX - minX, maxZ - minZ, 400) * 1.35, fcx = (minX + maxX) / 2, fcz = (minZ + maxZ) / 2;
    const { view } = this;
    const span = fitSpan / view.k, slack = (fitSpan - span) / 2;
    const cx = view.cx == null ? fcx : Math.min(fcx + slack, Math.max(fcx - slack, view.cx));
    const cz = view.cz == null ? fcz : Math.min(fcz + slack, Math.max(fcz - slack, view.cz));
    const x0 = cx - span / 2, z0 = cz - span / 2, S = V / span;
    this.T = { x0, z0, S, span };
    const sx = (x: number) => (x - x0) * S, sz = (z: number) => (z - z0) * S;

    // biome tint: tiles take the biome of the nearest place within range, fading with distance
    let cell = 64;
    while (cell * S < 6) cell *= 2; // bigger tiles when zoomed far out
    const pins: BiomePin[] = P.filter((p) => p.biome).map((p) => ({ x: p.x, z: p.z, biome: p.biome! }));
    const cw = (cell * S).toFixed(2), tiles: Record<string, string> = {};
    if (pins.length) {
      for (let gx = Math.floor(x0 / cell) * cell; gx < x0 + span; gx += cell)
        for (let gz = Math.floor(z0 / cell) * cell; gz < z0 + span; gz += cell) {
          const n = biomeAt(pins, gx + cell / 2, gz + cell / 2);
          if (!n) continue;
          const k = n.biome + "|" + (n.d < 150 ? 0.6 : n.d < 300 ? 0.4 : 0.2);
          tiles[k] = (tiles[k] ?? "") + `M${sx(gx).toFixed(2)},${sz(gz).toFixed(2)}h${cw}v${cw}h-${cw}z`;
        }
    }
    for (const k in tiles) {
      const [b, o] = k.split("|");
      svg.append(el("path", { d: tiles[k], fill: biomeCol(b), "fill-opacity": o, "shape-rendering": "crispEdges" }));
    }

    // game map screenshots, biggest first so detailed maps sit on top
    if (model.showMaps) {
      model.maps.slice().sort((a, b) => b.size - a.size).forEach((m, i) => {
        const href = model.imageUrl(m.imageId);
        if (!href) return;
        const C = m.crop ?? SWITCH_CROP, cp = el("clipPath", { id: "mapCrop" + i });
        cp.append(el("rect", { x: C.x, y: C.y, width: C.size, height: C.size }));
        svg.append(cp);
        svg.append(el("image", {
          href, width: 1280, height: 720, "clip-path": `url(#mapCrop${i})`, style: "image-rendering:pixelated",
          transform: `translate(${sx(m.x)},${sz(m.z)}) scale(${(m.size * S) / C.size}) translate(${-C.x},${-C.y})`,
        }));
      });
    }

    // grid
    const step = [50, 100, 250, 500, 1000, 2500, 5000].find((v) => v * S >= 34) ?? 10000;
    this.onGrid(step);
    for (let g = Math.ceil(x0 / step) * step; g < x0 + span; g += step) {
      svg.append(el("line", { x1: sx(g), x2: sx(g), y1: 0, y2: V, stroke: "var(--grid)", "stroke-width": 1 }));
      svg.append(el("text", { x: sx(g) + 3, y: V - 6, "font-size": 10 }, g));
    }
    for (let g = Math.ceil(z0 / step) * step; g < z0 + span; g += step) {
      svg.append(el("line", { y1: sz(g), y2: sz(g), x1: 0, x2: V, stroke: "var(--grid)", "stroke-width": 1 }));
      svg.append(el("text", { x: 4, y: sz(g) - 3, "font-size": 10 }, g));
    }

    // compass
    const c = el("g", { transform: "translate(560,40)" });
    c.append(el("circle", { r: 18, fill: "var(--panel)", stroke: "var(--line)" }));
    c.append(el("path", { d: "M0,-13 L5,2 L0,-2 L-5,2Z", fill: "var(--route)" }));
    c.append(el("text", { y: 12, "text-anchor": "middle", "font-size": 9, style: "fill:var(--ink)" }, "N"));
    svg.append(c);

    // one day's reach around the starting place: solid = one way, dashed = there and back
    const a = model.selA, b = model.selB;
    if (a && model.reach) {
      const { full, half } = model.reach, cx0 = sx(a.x), cz0 = sz(a.z);
      const shape = (rs: number[]) => rs.map((r, k) => {
        const th = (k * 5 * Math.PI) / 180;
        return `${k ? "L" : "M"}${(cx0 + Math.sin(th) * r * S).toFixed(1)},${(cz0 - Math.cos(th) * r * S).toFixed(1)}`;
      }).join("") + "Z";
      svg.append(el("path", { d: shape(full), fill: "var(--route)", "fill-opacity": 0.08, stroke: "var(--route)", "stroke-width": 1.5, "stroke-linejoin": "round" }));
      svg.append(el("path", { d: shape(half), fill: "none", stroke: "var(--route)", "stroke-width": 1.2, "stroke-dasharray": "4 4", "stroke-linejoin": "round" }));
      const lab = (y: number, t: string) => svg.append(el("text", { x: cx0, y, "text-anchor": "middle", "font-size": 10, style: "fill:var(--route);paint-order:stroke;stroke:var(--land);stroke-width:3px" }, t));
      lab(cz0 - full[0] * S - 4, "1 day");
      if (half[0] * S > 40) lab(cz0 - half[0] * S - 4, "there & back");
    }
    if (a && b) {
      svg.append(el("line", { x1: sx(a.x), y1: sz(a.z), x2: sx(b.x), y2: sz(b.z), stroke: "var(--route)", "stroke-width": 2.5, "stroke-dasharray": "6 4" }));
    }

    // pins, then labels placed to avoid each other
    const texts: (SVGTextElement | null)[] = [];
    for (const p of P) {
      const px = sx(p.x), pz = sz(p.z);
      if (px < -20 || px > V + 20 || pz < -20 || pz > V + 20) { texts.push(null); continue; }
      const g = el("g", { transform: `translate(${px},${pz})`, style: "cursor:pointer" });
      const col = p === a ? "var(--accent)" : p === b ? "var(--route)" : p.kind === "portal" ? "var(--accent2)" : "var(--accent)";
      if (p.kind === "portal") g.append(el("rect", { x: -6, y: -9, width: 12, height: 18, fill: col, stroke: "var(--panel)", "stroke-width": 2 }));
      else if (p.kind === "village") g.append(el("circle", { cx: 0, cy: 0, r: 7, fill: col, stroke: "var(--panel)", "stroke-width": 2 }));
      else g.append(el("rect", { x: -7, y: -7, width: 14, height: 14, fill: col, stroke: "var(--panel)", "stroke-width": 2 }));
      const t = el("text", { "font-size": 12, "font-weight": 600, style: "fill:var(--ink);paint-order:stroke;stroke:var(--land);stroke-width:3px" }, p.name) as SVGTextElement;
      g.append(t);
      g.addEventListener("click", () => this.onPick(p.id));
      svg.append(g);
      texts.push(t);
    }
    const spots = placeLabels(P.map((p, i) => {
      const t = texts[i];
      let w = 0;
      try { w = t?.getComputedTextLength() ?? 0; } catch { /* not rendered yet */ }
      return { px: sx(p.x), pz: sz(p.z), w: w || p.name.length * 7.4, visible: !!t };
    }), V);
    spots.forEach((s, i) => {
      const t = texts[i];
      if (!s || !t) return;
      t.setAttribute("x", String(s.x));
      t.setAttribute("y", String(s.y));
      t.setAttribute("text-anchor", s.anchor);
    });
  }

  /* ---- zoom and pan ---- */

  private svgPt(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.svg.getBoundingClientRect();
    return [((e.clientX - r.left) * V) / r.width, ((e.clientY - r.top) * V) / r.height];
  }

  /** Zoom by factor f, keeping the map point under (ux, uy) where it is. */
  private zoomAt(f: number, ux = V / 2, uy = V / 2): void {
    const k = Math.min(200, Math.max(1, this.view.k * f));
    if (k === 1) { this.fit(); return; }
    const T = this.T, wx = T.x0 + ux / T.S, wz = T.z0 + uy / T.S, span = (T.span * this.view.k) / k;
    this.view = { k, cx: wx + ((V / 2 - ux) * span) / V, cz: wz + ((V / 2 - uy) * span) / V };
    this.draw();
  }

  private panBy(dx: number, dz: number): void {
    if (this.view.k === 1) return;
    const T = this.T;
    this.view.cx = T.x0 + T.span / 2 - dx / T.S;
    this.view.cz = T.z0 + T.span / 2 - dz / T.S;
    this.draw();
  }

  private bindPointer(): void {
    const svg = this.svg, ptrs = new Fingers();
    svg.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomAt(Math.exp(-e.deltaY * 0.0015), ...this.svgPt(e)); }, { passive: false });
    svg.addEventListener("pointerdown", (e) => {
      ptrs.down(e.pointerId, this.svgPt(e), e.isPrimary);
      if (ptrs.size === 1) this.dragged = false;
      // A pinch redraws the map under both fingers. Capture them on the svg, which is never redrawn,
      // or iOS sends their lift-off to the removed element and the map never hears it (issue #7).
      // Single taps stay uncaptured so their click still reaches the place that was tapped.
      if (ptrs.size === 2) for (const id of ptrs.ids()) { try { svg.setPointerCapture(id); } catch { /* finger already gone */ } }
    });
    svg.addEventListener("pointermove", (e) => {
      const was = ptrs.get(e.pointerId);
      if (!was) return;
      const now = this.svgPt(e);
      if (ptrs.size === 1) {
        if (!this.dragged && Math.hypot(now[0] - was[0], now[1] - was[1]) < 5) return; // still a tap
        if (!this.dragged) { this.dragged = true; svg.setPointerCapture(e.pointerId); svg.style.cursor = "grabbing"; }
        ptrs.set(e.pointerId, now);
        this.panBy(now[0] - was[0], now[1] - was[1]);
      } else if (ptrs.size === 2) {
        // pinch: zoom by the change in finger spacing, around the midpoint
        const other = ptrs.other(e.pointerId)!;
        const d0 = Math.hypot(was[0] - other[0], was[1] - other[1]), d1 = Math.hypot(now[0] - other[0], now[1] - other[1]);
        this.dragged = true;
        ptrs.set(e.pointerId, now);
        if (d0 > 0) this.zoomAt(d1 / d0, (now[0] + other[0]) / 2, (now[1] + other[1]) / 2);
      }
    });
    const lift = (e: PointerEvent) => { ptrs.up(e.pointerId); svg.style.cursor = ""; };
    svg.addEventListener("pointerup", lift);
    svg.addEventListener("pointercancel", lift);
    // a drag or pinch must not also count as tapping a place
    svg.addEventListener("click", (e) => { if (this.dragged) { e.stopPropagation(); this.dragged = false; } }, true);
  }
}
