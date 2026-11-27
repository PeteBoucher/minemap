// End-to-end test of map straightening: import tilted screenshots through the real import dialog in a
// production build, then check the map is stored and drawn straightened.
//
// A held map tilted by looking down while walking is a trapezoid on screen; drawn as a square it
// shows wedges of the frame (parchment) at its top corners. The importer straightens it, and what's
// stored must be the straightened copy (src/import/straighten.ts, src/ui/importer.ts). This reads the
// stored image the map is drawn from, cut to the rect it's drawn through, and checks the map pixels
// along its top and left edges are map, not frame. (The bottom and right of these screenshots are
// hidden by the hotbar and a beach.)
//
// Usage:  npm run build && npm run e2e:straighten
//         E2E_BASE_URL=https://<preview>.vercel.app npm run e2e:straighten   (a deployed build)
//
// Without E2E_BASE_URL it serves dist/ with `vite preview`. Optional:
//   VERCEL_AUTOMATION_BYPASS_SECRET  for a protected Preview (sent only to E2E_BASE_URL)
//   E2E_HEADED=1                     show the browser
import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";

const env = process.env;
const PORT = 4179;
const BYPASS = env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
const fixture = (name: string) => fileURLToPath(new URL(`../src/import/fixtures/switch/${name}`, import.meta.url));

/** Tilted Bedrock maps on a Switch, and the map cells of the top and left edges to check (as in import.test.ts). */
const TILTED: { file: string; top: [number, number]; left: [number, number] }[] = [
  { file: "2026112612522600.jpg", top: [0, 120], left: [0, 128] }, // held lowest; a beach in the top right corner
  { file: "2026112612523700.jpg", top: [0, 128], left: [0, 128] },
];

let failures = 0;
function check(ok: boolean, what: string, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

/** Serve dist/ with `vite preview` and wait until it answers. */
async function serve(): Promise<{ url: string; server: ChildProcess }> {
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "inherit" });
  const url = `http://localhost:${PORT}`;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error(`vite preview exited (${server.exitCode}); run npm run build first`);
    if (await fetch(url).then((r) => r.ok, () => false)) return { url, server };
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error("vite preview didn't start");
}

async function importAndCheck(browser: Browser, base: string, t: (typeof TILTED)[number]) {
  console.log(t.file);
  const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  // tsx compiles named functions in page.evaluate's callback to calls to its __name helper, which the page lacks
  await context.addInitScript("globalThis.__name = (f) => f");
  const page = await context.newPage();
  page.on("pageerror", (e) => check(false, "no page errors", e.message));
  page.on("dialog", (d) => d.accept("Straighten test")); // "Name your world" is a prompt()
  const first = BYPASS ? `${base}/?${new URLSearchParams({ "x-vercel-protection-bypass": BYPASS, "x-vercel-set-bypass-cookie": "true" })}` : base;
  await page.goto(first);
  await page.getByText("No thanks").click({ timeout: 10000 }).catch(() => {}); // analytics consent, if asked
  await page.getByText("Start my world").click({ timeout: 10000 }).catch(() => {});
  await page.locator("#addShots").waitFor({ state: "visible", timeout: 15000 });

  await page.locator("#shotFiles").setInputFiles(fixture(t.file));
  const dlg = page.locator("#importDlg");
  await dlg.waitFor({ state: "visible", timeout: 60000 });
  await dlg.getByRole("button", { name: "Add map" }).click();
  await page.locator("svg image").first().waitFor({ state: "attached", timeout: 15000 });

  // the stored image, sampled at the middle of each map pixel along the edges of the rect it's drawn through
  const frameCells = await page.evaluate(async (t) => {
    const img = document.querySelector("svg image")!, r = document.querySelector("clipPath rect")!;
    const bmp = await createImageBitmap(await (await fetch(img.getAttribute("href")!)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const x = +r.getAttribute("x")!, y = +r.getAttribute("y")!, p = +r.getAttribute("width")! / 128;
    const rgb = (i: number, j: number) => {
      const o = (Math.floor(y + (j + 0.5) * p) * bmp.width + Math.floor(x + (i + 0.5) * p)) * 4;
      return [px[o], px[o + 1], px[o + 2]];
    };
    // the frame's two tones, light and shadow, as in import.test.ts
    const isFrame = ([r, g, b]: number[]) => [[215, 192, 150], [150, 135, 108]].some(([R, G, B]) => Math.hypot(r - R, g - G, b - B) < 25);
    const out: string[] = [];
    for (let k = t.top[0]; k < t.top[1]; k++) if (isFrame(rgb(k, 0))) out.push(`top ${k}`);
    for (let k = t.left[0]; k < t.left[1]; k++) if (isFrame(rgb(0, k))) out.push(`left ${k}`);
    return out;
  }, t);
  check(frameCells.length === 0, "the stored map's top and left edges are map, not frame", frameCells.length ? `frame at ${frameCells.slice(0, 8).join(", ")}${frameCells.length > 8 ? ", …" : ""}` : "");
  await context.close();
}

const own = env.E2E_BASE_URL ? null : await serve();
const base = (env.E2E_BASE_URL ?? own!.url).replace(/\/+$/, "");
const browser = await chromium.launch({ headless: !env.E2E_HEADED });
try {
  for (const t of TILTED) await importAndCheck(browser, base, t);
} finally {
  await browser.close();
  own?.server.kill();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
