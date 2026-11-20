// Screenshot import dialog: one step per screenshot. Shows the map found in the screenshot, what was
// read from it, and where it will go; the user confirms, adjusts the zoom level or spot, or skips.
import { mapCorner, mapSize } from "../core/geo";
import type { Crop } from "../core/terrain";
import { type Analysis, analyzeScreenshot } from "../import/analyze";
import type { RGBAImage } from "../import/image";
import { h } from "./dom";

export interface ImportHost {
  /** Zoom level to assume when it can't be detected (the last one the user chose). */
  lastScale(): number;
  setLastScale(scale: number): void;
  addMap(map: { x: number; z: number; size: number; crop: Crop }, image: Blob): Promise<void>;
  addPlace(place: { name: string; x: number; z: number }): Promise<void>;
}

/** A screenshot drawn at 1280×720 (the size the importer and map drawing work in). */
interface Shot { img: RGBAImage; blob: Blob; canvas: HTMLCanvasElement }

async function toSwitchSize(file: File): Promise<Shot> {
  const bmp = await createImageBitmap(file);
  if (Math.abs(bmp.width / bmp.height - 16 / 9) > 0.02) {
    throw new Error("Only full-screen 16:9 game screenshots (like the Switch's) are supported for now.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, 1280, 720);
  const img = ctx.getImageData(0, 0, 1280, 720);
  // keep the original file when it's already the right size, otherwise store the resized copy
  const blob = bmp.width === 1280 && file.type === "image/jpeg"
    ? file
    : await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode image"))), "image/jpeg", 0.9));
  return { img, blob, canvas };
}

const nf = (v: number) => v.toLocaleString("en-GB");

/** Run the import dialog over `files`. Returns how many maps were added. */
export async function importScreenshots(files: File[], host: ImportHost): Promise<number> {
  const dlg = document.getElementById("importDlg") as HTMLDialogElement;
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    let shot: Shot | null = null, error = "";
    try { shot = await toSwitchSize(files[i]); } catch (e) { error = (e as Error).message; }
    const a = shot ? analyzeScreenshot(shot.img, host.lastScale()) : null;
    const result = await step(dlg, { index: i, total: files.length, name: files[i].name, shot, analysis: a, error, host });
    if (result === "cancel") break;
    if (result === "added") added++;
  }
  dlg.close();
  return added;
}

interface StepInput { index: number; total: number; name: string; shot: Shot | null; analysis: Analysis | null; error: string; host: ImportHost }

function step(dlg: HTMLDialogElement, s: StepInput): Promise<"added" | "skipped" | "cancel"> {
  return new Promise((resolve) => {
    const { shot, analysis: a, host } = s;
    const crop = a?.crop ?? null, pos = a?.position ?? null, placement = a?.placement ?? null;

    const title = h("h2", {}, s.total > 1 ? `SCREENSHOT ${s.index + 1} OF ${s.total}` : "ADD A MAP SCREENSHOT");
    const status = h("p", { className: "status" });
    const body = h("div", { className: "imp" });

    // preview of the map found in the screenshot
    const thumb = h("canvas", { width: 256, height: 256, className: "thumb" });
    if (shot && crop) thumb.getContext("2d")!.drawImage(shot.canvas, crop.x, crop.y, crop.size, crop.size, 0, 0, 256, 256);
    else if (shot) { thumb.width = 320; thumb.height = 180; thumb.getContext("2d")!.drawImage(shot.canvas, 0, 0, 320, 180); }

    // zoom level and a spot that's on the map
    const scaleSel = h("select", { ariaLabel: "Zoom level" });
    for (let z = 0; z <= 4; z++) scaleSel.add(new Option(`Level ${z} · ${nf(mapSize(z))} blocks across`, String(z)));
    scaleSel.value = String(placement ? Math.log2(placement.size / 128) : host.lastScale());
    const sx = h("input", { type: "number", placeholder: "X", ariaLabel: "X", value: pos ? String(pos.x) : "" });
    const sz = h("input", { type: "number", placeholder: "Z", ariaLabel: "Z", value: pos ? String(pos.z) : "" });
    const covers = h("p", { className: "covers" });

    const savePlace = h("input", { type: "checkbox" });
    const placeName = h("input", { placeholder: "Place name", ariaLabel: "Place name" });
    const placeRow = h("label", { className: "check" }, savePlace, " Also save where I was standing as a place ", placeName);

    const skip = h("button", { type: "button", className: "btn ghost", textContent: s.total > 1 ? "Skip" : "Cancel" });
    const cancelAll = h("button", { type: "button", className: "btn ghost", textContent: "Stop importing", hidden: s.total < 2 || s.index === s.total - 1 });
    const add = h("button", { type: "button", className: "btn", textContent: "Add map" });

    const spot = () => (sx.value !== "" && sz.value !== "" ? { x: Math.round(+sx.value), z: Math.round(+sz.value) } : null);
    const corner = () => { const p = spot(); return crop && p ? mapCorner(p.x, p.z, +scaleSel.value) : null; };
    function refresh(): void {
      const c = corner();
      covers.textContent = c ? `Map covers X ${nf(c.x)} to ${nf(c.x + c.size)}, Z ${nf(c.z)} to ${nf(c.z + c.size)}` : "";
      add.disabled = !c && !(savePlace.checked && pos && placeName.value.trim());
      add.textContent = c || crop ? "Add map" : "Save place";
      add.hidden = !crop && !pos; // nothing this screenshot can add
      placeName.disabled = !savePlace.checked;
    }

    if (s.error) status.textContent = s.error;
    else if (!crop) status.textContent = "This doesn't look like a screenshot of a map held in your hand." + (pos ? " You can still save where you were standing." : "");
    else if (!pos) status.textContent = "Found the map, but no coordinates on screen. Type any spot that's on this map. (In Bedrock Edition, turn on “Show coordinates” in your world settings and Minemap will read them for you.)";
    else if (placement?.basis === "marker") status.textContent = `Read your position (${nf(pos.x)}, ${nf(pos.z)}) and found your marker on the map, so it's placed exactly and the zoom level is set for you.`;
    else status.textContent = `Read your position (${nf(pos.x)}, ${nf(pos.z)}). Placed assuming you were standing on this map — check the zoom level. If the map shows somewhere else, type a spot that's on it.`;

    const fields = h("div", { className: "fields" });
    if (crop) fields.append(h("label", {}, "Zoom level ", scaleSel), h("div", { className: "spot" }, "A spot on this map ", sx, sz), covers);
    if (pos) fields.append(placeRow);
    body.append(thumb, h("div", {}, status, fields));

    dlg.replaceChildren(h("form", { method: "dialog" }, title, h("p", { className: "fname" }, s.name), body, h("menu", {}, cancelAll, skip, add)));
    [scaleSel, sx, sz, savePlace, placeName].forEach((el) => el.addEventListener("input", refresh));
    refresh();

    const done = (r: "added" | "skipped" | "cancel") => { dlg.oncancel = null; resolve(r); };
    skip.onclick = () => done(s.total > 1 ? "skipped" : "cancel");
    cancelAll.onclick = () => done("cancel");
    dlg.oncancel = (e) => { e.preventDefault(); done("cancel"); };
    add.onclick = async () => {
      add.disabled = true;
      const c = corner();
      if (c && shot && crop) {
        host.setLastScale(+scaleSel.value);
        await host.addMap({ ...c, crop }, shot.blob);
      }
      if (savePlace.checked && pos && placeName.value.trim()) await host.addPlace({ name: placeName.value.trim(), x: pos.x, z: pos.z });
      done(c ? "added" : "skipped");
    };
    if (!dlg.open) dlg.showModal();
  });
}
