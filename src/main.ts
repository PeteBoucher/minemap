import "./styles.css";
import { BIOMES } from "./core/biomes";
import { type Pace, type TravelCtx, reach } from "./core/travel";
import {
  type MapShot, type Place, type PlaceKind, type World,
  createWorld, deletePlace, deleteWorld, getCurrentWorldId, getImage, getWorld, listMaps, listPlaces, listWorlds,
  newId, requestPersistence, savePlace, saveWorld, setCurrentWorldId,
} from "./store/db";
import { exportWorld, importWorld, loadDemoWorld, migrate } from "./store/migrate";
import { MapView } from "./ui/map";
import { renderBiomeLegend, renderList, renderRoute } from "./ui/panels";
import { terrainFor } from "./ui/terrain";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- state ---------- */
let world: World | null = null;
let places: Place[] = [];
let maps: MapShot[] = [];
const urls = new Map<string, string>(); // imageId -> object URL
let selA: string | undefined, selB: string | undefined;
let terrainAt: TravelCtx["terrainAt"];
let terrainLoading = false;
let terrainVer = 0;
let reachCache: { key: string; val: ReturnType<typeof reach> } | null = null;
let editing: Place | null = null;

const byId = (id?: string) => places.find((p) => p.id === id);
const ctx = (): TravelCtx => ({
  pace: world?.settings.pace ?? "auto",
  pins: places.filter((p) => p.biome).map((p) => ({ x: p.x, z: p.z, biome: p.biome! })),
  terrainAt,
});
function reachOf(p: Place) {
  const c = ctx(), key = `${p.id}|${p.x},${p.z}|${c.pace}|${places.length}|${terrainVer}`;
  if (reachCache?.key !== key) reachCache = { key, val: reach(c, p) };
  return reachCache.val;
}

/* ---------- rendering ---------- */
const mapView = new MapView($("map") as unknown as SVGSVGElement, pick, (step) => {
  $("gridNote").textContent = `Grid: ${step.toLocaleString("en-GB")} blocks`;
});

function render(): void {
  if (!world) return;
  const a = byId(selA), b = byId(selB);
  const r = a ? reachOf(a) : undefined;
  mapView.draw({ places, maps, imageUrl: (id) => urls.get(id), showMaps: world.settings.showMaps, selA: a, selB: b, reach: r });
  $("emptyMap").hidden = places.length > 0 || maps.length > 0;
  $("mapsToggleWrap").hidden = maps.length === 0;
  ($("mapsToggle") as HTMLInputElement).checked = world.settings.showMaps;
  renderList($("list"), places, a, b, { pick, edit: startEdit, remove: removePlace });
  renderRoute($("route"), {
    selA: a, selB: b, ctx: ctx(), reachFull: r?.full, onPace: setPace,
    terrainNote: world.settings.pace === "auto" && terrainLoading ? "Reading terrain from your map screenshots…" : null,
  });
  renderBiomeLegend($("biomeLegend"), places);
}

function pick(id: string): void {
  if (selA === id) [selA, selB] = [selB, undefined];
  else if (selB === id) selB = undefined;
  else if (!selA) selA = id;
  else if (!selB) selB = id;
  else [selA, selB] = [selB, id];
  render();
}

/* ---------- worlds ---------- */
async function refreshWorldSelect(): Promise<World[]> {
  const worlds = await listWorlds(), sel = $("worldSel") as HTMLSelectElement;
  sel.replaceChildren(...worlds.map((w) => new Option(w.name, w.id)));
  if (world) sel.value = world.id;
  return worlds;
}

async function openWorld(id: string | undefined, select?: [string, string]): Promise<void> {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  world = id ? (await getWorld(id)) ?? null : null;
  const worlds = await refreshWorldSelect();
  if (!world && worlds.length) world = worlds[0];
  $("welcome").hidden = !!world;
  $("main").hidden = $("worldbar").hidden = !world;
  if (!world) return;
  await setCurrentWorldId(world.id);
  ($("worldSel") as HTMLSelectElement).value = world.id;
  [places, maps] = await Promise.all([listPlaces(world.id), listMaps(world.id)]);
  for (const m of maps) {
    const img = await getImage(m.imageId);
    if (img) urls.set(m.imageId, URL.createObjectURL(img));
  }
  selA = select ? places.find((p) => p.name === select[0])?.id : undefined;
  selB = select ? places.find((p) => p.name === select[1])?.id : undefined;
  cancelEdit();
  terrainAt = undefined;
  reachCache = null;
  mapView.fit();
  render();
  loadTerrain();
}

async function loadTerrain(): Promise<void> {
  if (!maps.length) return;
  const forWorld = world?.id;
  terrainLoading = true;
  render();
  const lookup = await terrainFor(maps);
  if (world?.id !== forWorld) return;
  terrainAt = lookup;
  terrainLoading = false;
  terrainVer++;
  render();
}

async function updateSettings(patch: Partial<World["settings"]>): Promise<void> {
  if (!world) return;
  world = { ...world, settings: { ...world.settings, ...patch } };
  await saveWorld(world);
  render();
}
const setPace = (pace: Pace) => updateSettings({ pace });

async function startNewWorld(): Promise<void> {
  const name = prompt("Name your world", (await listWorlds()).length ? "New world" : "My world")?.trim();
  if (!name) return;
  const w = await createWorld(name);
  void requestPersistence();
  await openWorld(w.id);
}

async function startDemo(): Promise<void> {
  const btns = document.querySelectorAll<HTMLButtonElement>("#startDemo, [data-act=demo]");
  btns.forEach((b) => (b.disabled = true));
  try {
    const w = await loadDemoWorld();
    await openWorld(w.id, ["Hobbiton", "World spawn point"]);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

async function worldAction(act: string): Promise<void> {
  ($("worldMenu") as HTMLDetailsElement).open = false;
  if (act === "new") return startNewWorld();
  if (act === "demo") return startDemo();
  if (act === "import") return $("importFile").click();
  if (!world) return;
  if (act === "rename") {
    const name = prompt("Rename world", world.name)?.trim();
    if (!name) return;
    world = { ...world, name };
    await saveWorld(world);
    await refreshWorldSelect();
  } else if (act === "export") {
    const data = await exportWorld(world);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `${world.name.replace(/[^\w -]+/g, "").trim() || "world"}.minemap.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } else if (act === "delete") {
    if (!confirm(`Delete “${world.name}” with its ${places.length} places and ${maps.length} map screenshots? This can't be undone.`)) return;
    await deleteWorld(world.id);
    world = null;
    await openWorld(undefined);
  }
}

/* ---------- place form ---------- */
const form = $("placeForm") as HTMLFormElement;
const f = {
  name: $("newName") as HTMLInputElement,
  x: $("newX") as HTMLInputElement,
  z: $("newZ") as HTMLInputElement,
  biome: $("newBiome") as HTMLSelectElement,
};
Object.keys(BIOMES).sort().forEach((b) => f.biome.add(new Option(b.replace(/_/g, " "), b)));
const kindInput = (k: PlaceKind) => form.querySelector<HTMLInputElement>(`input[name=kind][value=${k}]`)!;

function startEdit(p: Place): void {
  editing = p;
  f.name.value = p.name;
  f.x.value = String(p.x);
  f.z.value = String(p.z);
  f.biome.value = p.biome ?? "";
  kindInput(p.kind).checked = true;
  $("formTitle").textContent = "EDIT PLACE";
  $("formSubmit").textContent = "Save";
  $("formCancel").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  f.name.focus();
}

function cancelEdit(): void {
  editing = null;
  form.reset();
  $("formTitle").textContent = "ADD A PLACE";
  $("formSubmit").textContent = "Add";
  $("formCancel").hidden = true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!world) return;
  const name = f.name.value.trim(), x = Math.round(+f.x.value), z = Math.round(+f.z.value);
  if (!name || !Number.isFinite(x) || !Number.isFinite(z)) return;
  const kind = (form.querySelector<HTMLInputElement>("input[name=kind]:checked")?.value ?? "place") as PlaceKind;
  const p: Place = { ...(editing ?? {}), id: editing?.id ?? newId(), worldId: world.id, name, x, z, kind };
  if (f.biome.value) p.biome = f.biome.value; else delete p.biome;
  await savePlace(p);
  if (!places.length) void requestPersistence();
  places = await listPlaces(world.id);
  cancelEdit();
  render();
});
$("formCancel").onclick = cancelEdit;

async function removePlace(p: Place): Promise<void> {
  if (!world || !confirm(`Delete “${p.name}”?`)) return;
  await deletePlace(world.id, p.id);
  places = places.filter((q) => q.id !== p.id);
  if (selA === p.id) [selA, selB] = [selB, undefined];
  if (selB === p.id) selB = undefined;
  if (editing?.id === p.id) cancelEdit();
  render();
}

/* ---------- wiring ---------- */
$("zoomIn").onclick = () => mapView.zoomBy(1.6);
$("zoomOut").onclick = () => mapView.zoomBy(1 / 1.6);
$("zoomFit").onclick = () => mapView.fit();
$("mapsToggle").onchange = (e) => updateSettings({ showMaps: (e.target as HTMLInputElement).checked });
$("worldSel").onchange = (e) => openWorld((e.target as HTMLSelectElement).value);
$("startNew").onclick = startNewWorld;
$("startDemo").onclick = startDemo;
document.querySelectorAll<HTMLButtonElement>("#worldMenu [data-act]").forEach((b) => (b.onclick = () => worldAction(b.dataset.act!)));
$("importFile").onchange = async (e) => {
  const input = e.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const w = await importWorld(JSON.parse(await file.text()));
    await openWorld(w.id);
  } catch (err) {
    alert(err instanceof SyntaxError ? "That file isn't valid JSON." : (err as Error).message);
  }
};
document.addEventListener("click", (e) => {
  const menu = $("worldMenu") as HTMLDetailsElement;
  if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
});

/* ---------- start ---------- */
(async () => {
  try {
    await migrate();
  } catch (err) {
    document.body.textContent = (err as Error).message;
    return;
  }
  await openWorld(await getCurrentWorldId());
})();
