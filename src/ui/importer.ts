// Screenshot import dialog: one step per screenshot. Shows the map found in the screenshot, what was
// read from it, and where it will go; the user confirms, adjusts the zoom level or spot, or skips.
import type { Edition } from "../core/edition";
import { mapCorner, mapSize } from "../core/geo";
import type { Crop } from "../core/terrain";
import { type Analysis, analyzeScreenshot } from "../import/analyze";
import type { RGBAImage } from "../import/image";
import { h } from "./dom";
import { howToContent } from "./howto";

export interface ImportHost {
  /** Zoom level to assume when it can't be detected (the last one the user chose). */
  lastScale(): number;
  setLastScale(scale: number): void;
  addMap(map: { x: number; z: number; size: number; crop: Crop }, image: Blob): Promise<void>;
  addPlace(place: { name: string; x: number; z: number }): Promise<void>;
  /** The world's edition, for instructions; set from a screenshot whose coordinates were read. */
  edition(): Edition;
  setEdition(edition: Edition): void;
}

/** The screenshot fitted into the 1280×720 frame (the size the importer and map drawing work in). */
interface Shot { blob: Blob; canvas: HTMLCanvasElement }

/** The screenshot's pixels at full size: coordinates are read from these before it's shrunk. */
async function readPixels(file: File): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

/** Draw the analysed frame onto a canvas and encode it for storage. */
async function toShot(file: File, original: ImageData, frame: RGBAImage): Promise<Shot> {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const data = new Uint8ClampedArray(frame.data);
  canvas.getContext("2d")!.putImageData(new ImageData(data, frame.width, frame.height), 0, 0);
  // keep the original file when it's already the frame's size, otherwise store the fitted copy
  const blob = original.width === frame.width && original.height === frame.height && file.type === "image/jpeg"
    ? file
    : await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode image"))), "image/jpeg", 0.9));
  return { blob, canvas };
}

const nf = (v: number) => v.toLocaleString("en-GB");

/** Run the import dialog over `files`. Returns how many maps were added. */
export async function importScreenshots(files: File[], host: ImportHost): Promise<number> {
  const dlg = document.getElementById("importDlg") as HTMLDialogElement;
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    let shot: Shot | null = null, a: Analysis | null = null, error = "";
    try {
      const original = await readPixels(files[i]);
      a = analyzeScreenshot(original, host.lastScale());
      if (a.edition) host.setEdition(a.edition);
      shot = await toShot(files[i], original, a.frame);
    } catch (e) { error = (e as Error).message; }
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
    else if (!pos) {
      const unread = (e: Edition) => status.replaceChildren(...howToContent("unread", e, (n) => { host.setEdition(n); unread(n); }));
      unread(host.edition());
    }
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
