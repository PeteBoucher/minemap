// Place list, route panel and biome legend. Ported from the prototype's list(), route() and biomeLegend().
import { biomeCol } from "../core/biomes";
import { coordsText, dirName, toNether, yaw } from "../core/geo";
import { DAYLIGHT, PACES, type Pace, STEP, type TravelCtx, dayVerdict, travel } from "../core/travel";
import type { Edition } from "../core/edition";
import type { Place } from "../store/db";
import { howToContent } from "./howto";

const nf = (v: number) => Math.round(v).toLocaleString("en-GB");
const KIND_ORDER = { place: 0, portal: 1, village: 2 } as const;

export interface ListHandlers {
  pick: (id: string) => void;
  edit: (p: Place) => void;
  remove: (p: Place) => void;
  /** Shown with the instructions when there are no places yet. */
  edition: Edition;
  setEdition: (e: Edition) => void;
}

export function renderList(L: HTMLElement, places: Place[], selA: Place | undefined, selB: Place | undefined, h: ListHandlers): void {
  L.replaceChildren();
  if (!places.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.append(...howToContent("places", h.edition, h.setEdition));
    L.append(p);
    return;
  }
  places.slice()
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name))
    .forEach((p) => {
      const row = document.createElement("div");
      row.className = "row" + (p === selA ? " sel-a" : p === selB ? " sel-b" : "");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "place";
      b.setAttribute("aria-pressed", String(p === selA || p === selB));
      const dot = document.createElement("i");
      dot.className = "dot" + (p.kind === "portal" ? " portal" : p.kind === "village" ? " village" : "");
      const name = document.createElement("span");
      name.className = "pname";
      name.textContent = p.name;
      const n = toNether(p.x, p.z);
      const coords = document.createElement("span");
      coords.className = "coords";
      coords.innerHTML = `${p.x}, ${p.z}<br><span class="n">N ${n.x}, ${n.z}</span>`;
      b.append(dot, name, coords);
      b.onclick = () => h.pick(p.id);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "act";
      edit.textContent = "✎";
      edit.title = "Edit";
      edit.setAttribute("aria-label", `Edit ${p.name}`);
      edit.onclick = () => h.edit(p);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "act rm";
      rm.textContent = "×";
      rm.title = "Delete";
      rm.setAttribute("aria-label", `Delete ${p.name}`);
      rm.onclick = () => h.remove(p);
      row.append(b, edit, rm);
      L.append(row);
    });
}

function paceSelect(pace: Pace, onPace: (p: Pace) => void, terrainNote: string | null): HTMLElement {
  const s = document.createElement("select");
  s.setAttribute("aria-label", "Travel pace");
  for (const k of Object.keys(PACES) as Pace[]) {
    const v = PACES[k];
    s.add(new Option(v.bps ? `${v.label} · ${nf(v.bps * DAYLIGHT * 60)} blocks/day` : v.label, k));
  }
  s.value = pace;
  s.onchange = () => onPace(s.value as Pace);
  const w = document.createElement("label");
  w.className = "pace";
  w.append("Pace ", s);
  if (!terrainNote) return w;
  const box = document.createElement("div"), n = document.createElement("p");
  n.className = "note";
  n.textContent = terrainNote;
  box.append(w, n);
  return box;
}

export interface RouteInput {
  selA?: Place;
  selB?: Place;
  ctx: TravelCtx;
  reachFull?: number[];
  onPace: (p: Pace) => void;
  terrainNote: string | null;
}

export function renderRoute(R: HTMLElement, { selA: a, selB: b, ctx, reachFull, onPace, terrainNote }: RouteInput): void {
  R.replaceChildren();
  const h = document.createElement("h2");
  h.textContent = "ROUTE";
  R.append(h);
  if (!a || !b) {
    const p = document.createElement("p");
    p.textContent = a ? "Now pick where you're going." : "Pick where you are, then where you're going.";
    R.append(p);
    if (a && reachFull) {
      const lo = Math.min(...reachFull), hi = Math.max(...reachFull);
      const n = document.createElement("p");
      n.textContent = `Shaded: how far you get from ${a.name} in one day's daylight (${hi - lo < 20 ? "about " + nf(hi) : nf(lo) + "–" + nf(hi)} blocks, depending on direction). Dashed: out and back before dark.`;
      R.append(n);
    }
    R.append(paceSelect(ctx.pace, onPace, terrainNote));
    return;
  }
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.round(Math.hypot(dx, dz));
  const tr = travel(ctx, a, b), mins = tr.secs / 60;
  const fmt = (m: number) => (m < 1 ? "under 1 min" : `${Math.round(m)} min`);
  // biggest stretches of terrain along the line, e.g. "jungle 420 · forest 310"
  const terrain = Object.entries(tr.by).sort((p, q) => q[1] - p[1]).filter(([, v]) => v >= STEP).slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${nf(v)}`).join(" · ");
  const v = dayVerdict(mins, d);
  const title = document.createElement("p");
  title.textContent = `${a.name} → ${b.name}`;
  const dl = document.createElement("dl");
  dl.className = "stats";
  const rows: [string, string, string?][] = [
    ["To", coordsText(b.x, b.z)],
    ["Distance", `${d.toLocaleString("en-GB")} blocks`, "big"],
    ["Heading", `${dirName(dx, dz)} · face ${yaw(dx, dz)}°`],
    ["Go", `${Math.abs(dx)} ${dx >= 0 ? "east (+X)" : "west (−X)"}, ${Math.abs(dz)} ${dz >= 0 ? "south (+Z)" : "north (−Z)"}`],
    ...(ctx.pace === "auto" && terrain ? [["Terrain", terrain] as [string, string]] : []),
    ["Travel", `${fmt(mins)} of ${DAYLIGHT} min daylight`],
    ["Daylight", v.text, `verdict ${v.level}`],
    ["Via Nether", `${nf(d / 8)} blocks`],
  ];
  for (const [k, val, cls] of rows) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = val;
    if (cls) dd.className = cls;
    dl.append(dt, dd);
  }
  R.append(title, dl, paceSelect(ctx.pace, onPace, terrainNote));
}

export function renderBiomeLegend(L: HTMLElement, places: Place[]): void {
  L.replaceChildren();
  [...new Set(places.map((p) => p.biome).filter((b): b is string => !!b))].sort().forEach((b) => {
    const s = document.createElement("span"), i = document.createElement("i");
    i.className = "dot";
    i.style.background = biomeCol(b);
    s.append(i, b.replace(/_/g, " "));
    L.append(s);
  });
}
