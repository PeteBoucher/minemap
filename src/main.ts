import "./styles.css";
import { BIOMES } from "./core/biomes";
import { FREE, freeLeft } from "./core/license";
import { type Pace, type TravelCtx, reach } from "./core/travel";
import {
  type MapShot, type Place, type PlaceKind, type World,
  createWorld, deleteMap, deletePlace, deleteWorld, getCurrentWorldId, getImage, getWorld, listMaps, listPlaces, listWorlds,
  newId, requestPersistence, saveMap, savePlace, saveWorld, setCurrentWorldId,
} from "./store/db";
import { DEMO_ID, buildDemo } from "./store/demo";
import { exportWorld, importWorld, migrate } from "./store/migrate";
import { importScreenshots } from "./ui/importer";
import { handlePaymentReturn, requireUnlock } from "./ui/paywall";
import { isUnlocked } from "./store/unlock";
import { MapView } from "./ui/map";
import { renderBiomeLegend, renderList, renderRoute } from "./ui/panels";
import { terrainFor } from "./ui/terrain";
import { analyticsAvailable, currentConsent, feedbackAvailable, initAnalytics, setConsent } from "./ui/analytics";
import { openFeedback } from "./ui/feedback";
import type { Answer } from "./core/consent";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- state ---------- */
let world: World | null = null;
let places: Place[] = [];
let maps: MapShot[] = [];
const urls = new Map<string, string>(); // imageId -> object URL (or a plain URL in the demo)
/** The demo world lives only in memory: edits work but are never saved. */
const isDemo = () => world?.id === DEMO_ID;
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
  renderMapsList();
}

function renderMapsList(): void {
  $("mapsList").hidden = maps.length === 0;
  $("mapsSummary").textContent = `${maps.length} map screenshot${maps.length === 1 ? "" : "s"}`;
  $("mapsRows").replaceChildren(...maps.slice().sort((a, b) => b.size - a.size || a.x - b.x || a.z - b.z).map((m) => {
    const row = document.createElement("div");
    row.className = "maprow";
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = urls.get(m.imageId) ?? "";
    const label = document.createElement("span");
    label.textContent = `${m.size.toLocaleString("en-GB")} blocks · from ${m.x}, ${m.z}`;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "act rm";
    rm.textContent = "Remove";
    rm.setAttribute("aria-label", `Remove the map from ${m.x}, ${m.z}`);
    rm.onclick = () => removeMap(m);
    row.append(img, label, rm);
    return row;
  }));
}

/* ---------- map screenshots ---------- */
async function addShots(files: File[]): Promise<void> {
  if (!world || !files.length) return;
  if (!isDemo()) {
    const left = freeLeft("maps", maps.length);
    if (files.length > left && !(await requireUnlock("maps"))) {
      files = files.slice(0, left);
      if (!files.length) return;
    }
    void refreshUnlockItem();
  }
  const w = world;
  const added = await importScreenshots(files, {
    lastScale: () => world?.settings.lastScale ?? 0,
    setLastScale: (s) => { if (world?.settings.lastScale !== s) void updateSettings({ lastScale: s }); },
    addMap: async (m, image) => {
      const shot: MapShot = { id: newId(), worldId: w.id, imageId: newId(), capturedAt: Date.now(), ...m };
      if (w.id !== DEMO_ID) {
        await saveMap(shot, image);
        void requestPersistence();
      }
      maps = [...maps, shot];
      urls.set(shot.imageId, URL.createObjectURL(image));
    },
    addPlace: async ({ name, x, z }) => {
      const p: Place = { id: newId(), worldId: w.id, name, x, z, kind: "place" };
      if (w.id !== DEMO_ID) await savePlace(p);
      places = [...places, p];
    },
  });
  if (world?.id !== w.id) return;
  if (added) {
    if (!world.settings.showMaps) await updateSettings({ showMaps: true });
    mapView.fit();
    void loadTerrain();
  }
  render();
}

async function removeMap(m: MapShot): Promise<void> {
  if (!world || !confirm("Remove this map screenshot?")) return;
  if (!isDemo()) await deleteMap(world.id, m.id);
  maps = maps.filter((x) => x.id !== m.id);
  const u = urls.get(m.imageId);
  if (u?.startsWith("blob:")) URL.revokeObjectURL(u);
  urls.delete(m.imageId);
  void loadTerrain();
  render();
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
  sel.replaceChildren(...worlds.map((w) => new Option(w.name, w.id)), new Option("Demo world (not saved)", DEMO_ID));
  if (world) sel.value = world.id;
  return worlds;
}

async function openWorld(id: string | undefined): Promise<void> {
  for (const u of urls.values()) if (u.startsWith("blob:")) URL.revokeObjectURL(u);
  urls.clear();
  const demo = id === DEMO_ID ? buildDemo() : null;
  world = demo ? demo.world : id ? (await getWorld(id)) ?? null : null;
  const worlds = await refreshWorldSelect();
  if (!world && worlds.length) world = worlds[0];
  $("welcome").hidden = !!world;
  $("main").hidden = $("worldbar").hidden = !world;
  if (!world) return;
  await setCurrentWorldId(world.id);
  ($("worldSel") as HTMLSelectElement).value = world.id;
  $("demoNote").hidden = !demo;
  document.querySelectorAll<HTMLElement>("#worldMenu .saved-only").forEach((e) => (e.hidden = !!demo));
  if (demo) {
    ({ places, maps } = demo);
    demo.imageUrls.forEach((u, k) => urls.set(k, u));
  } else {
    [places, maps] = await Promise.all([listPlaces(world.id), listMaps(world.id)]);
    for (const m of maps) {
      const img = await getImage(m.imageId);
      if (img) urls.set(m.imageId, URL.createObjectURL(img));
    }
  }
  const named = (n: string) => (demo ? places.find((p) => p.name === n)?.id : undefined);
  selA = named("Hobbiton");
  selB = named("World spawn point");
  cancelEdit();
  terrainAt = undefined;
  reachCache = null;
  mapView.fit();
  render();
  loadTerrain();
}

async function loadTerrain(): Promise<void> {
  if (!maps.length) {
    terrainAt = undefined;
    terrainVer++;
    return;
  }
  const forWorld = world?.id;
  terrainLoading = true;
  render();
  const lookup = await terrainFor(maps, isDemo()
    ? async (id) => { const u = urls.get(id); return u ? fetch(u).then((r) => (r.ok ? r.blob() : undefined)).catch(() => undefined) : undefined; }
    : getImage);
  if (world?.id !== forWorld) return;
  terrainAt = lookup;
  terrainLoading = false;
  terrainVer++;
  render();
}

async function updateSettings(patch: Partial<World["settings"]>): Promise<void> {
  if (!world) return;
  world = { ...world, settings: { ...world.settings, ...patch } };
  if (!isDemo()) await saveWorld(world);
  render();
}
const setPace = (pace: Pace) => updateSettings({ pace });

async function startNewWorld(): Promise<void> {
  if ((await listWorlds()).length >= FREE.worlds && !(await requireUnlock("worlds"))) return;
  void refreshUnlockItem();
  const name = prompt("Name your world", (await listWorlds()).length ? "New world" : "My world")?.trim();
  if (!name) return;
  const w = await createWorld(name);
  void requestPersistence();
  await openWorld(w.id);
}

const startDemo = () => openWorld(DEMO_ID);

async function worldAction(act: string): Promise<void> {
  ($("worldMenu") as HTMLDetailsElement).open = false;
  if (act === "new") return startNewWorld();
  if (act === "demo") return startDemo();
  if (act === "feedback") return openFeedback();
  if (act === "unlock") { await requireUnlock("worlds"); return refreshUnlockItem(); }
  if (act === "import") {
    if (!(await requireUnlock("backup"))) return;
    return $("importFile").click();
  }
  if (!world || isDemo()) return;
  if (act === "rename") {
    const name = prompt("Rename world", world.name)?.trim();
    if (!name) return;
    world = { ...world, name };
    await saveWorld(world);
    await refreshWorldSelect();
  } else if (act === "export") {
    if (!(await requireUnlock("backup"))) return refreshUnlockItem();
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

/** The ••• menu shows whether this device is unlocked. */
async function refreshUnlockItem(): Promise<void> {
  const item = document.querySelector<HTMLButtonElement>("#worldMenu [data-act=unlock]");
  if (!item) return;
  const ok = await isUnlocked();
  item.textContent = ok ? "Unlocked ✓" : "Unlock everything ($5)…";
  item.disabled = ok;
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
  if (!editing && !isDemo() && places.length >= FREE.places && !(await requireUnlock("places"))) return;
  const kind = (form.querySelector<HTMLInputElement>("input[name=kind]:checked")?.value ?? "place") as PlaceKind;
  const p: Place = { ...(editing ?? {}), id: editing?.id ?? newId(), worldId: world.id, name, x, z, kind };
  if (f.biome.value) p.biome = f.biome.value; else delete p.biome;
  if (isDemo()) {
    places = editing ? places.map((q) => (q.id === p.id ? p : q)) : [...places, p];
  } else {
    await savePlace(p);
    if (!places.length) void requestPersistence();
    places = await listPlaces(world.id);
  }
  cancelEdit();
  render();
});
$("formCancel").onclick = cancelEdit;

async function removePlace(p: Place): Promise<void> {
  if (!world || !confirm(`Delete “${p.name}”?`)) return;
  if (!isDemo()) await deletePlace(world.id, p.id);
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
$("addShots").onclick = () => $("shotFiles").click();
$("shotFiles").onchange = (e) => {
  const input = e.target as HTMLInputElement, files = [...(input.files ?? [])];
  input.value = "";
  void addShots(files);
};
$("mapsToggle").onchange =(e) => updateSettings({ showMaps: (e.target as HTMLInputElement).checked });
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

/* ---------- analytics consent ---------- */
const answerConsent = (answer: Answer) => { setConsent(answer); $("consent").hidden = true; };
$("consentYes").onclick = () => answerConsent("granted");
$("consentNo").onclick = () => answerConsent("denied");
$("analyticsLink").onclick = () => { $("consent").hidden = false; };
$("consent").hidden = !analyticsAvailable || currentConsent() !== null;
$("analyticsFoot").hidden = !analyticsAvailable;

/* ---------- feedback (#14) ---------- */
$("feedbackLink").onclick = openFeedback;
$("feedbackTab").onclick = openFeedback;
// Hidden in a build without a PostHog key: there's nowhere to send it.
$("feedbackTab").hidden = $("feedbackFoot").hidden = !feedbackAvailable;
document.querySelectorAll<HTMLElement>("#worldMenu .feedback-item").forEach((e) => (e.hidden = !feedbackAvailable));
initAnalytics();

/* ---------- start ---------- */
(async () => {
  try {
    await migrate();
  } catch (err) {
    document.body.textContent = (err as Error).message;
    return;
  }
  await openWorld(await getCurrentWorldId());
  await handlePaymentReturn();
  void refreshUnlockItem();
})();
