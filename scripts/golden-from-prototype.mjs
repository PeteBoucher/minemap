// Run the prototype's own logic in Node to capture demo data and reference outputs.
// Usage: node scripts/golden-from-prototype.mjs docs/prototype.html .
import fs from "node:fs"; import vm from "node:vm";
const [proto, outDir] = process.argv.slice(2);
const html = fs.readFileSync(proto, "utf8");
const js = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
const chunk = js.slice(js.indexOf("const base=["), js.indexOf("let showMaps"));
const ctx = { Math, JSON, console, Promise, Map, Object };
vm.createContext(ctx);
vm.runInContext(chunk + `
const places=()=>base;
globalThis.out={base,MAPS,CROP,
  run(paceKey,pairs,origins){pace=paceKey;reachCache={};const P=base;
    return {pace:paceKey,
      travel:pairs.map(([i,j])=>({i,j,...travel(P[i],P[j])})),
      reach:origins.map(i=>{reachCache={};return {i,...reach(P[i])}})};
  },
  mapClass:[[120,168,72],[0,48,150],[216,168,120],[10,200,10],[170,170,165],[100,70,50]].map(c=>({c,k:mapClass(...c)})),
};`, ctx);
const o = ctx.out;
const pairs = [[1,0],[0,25],[5,11],[26,31],[33,34],[13,59]], origins = [1,0,27,25];
const golden = { pairs, origins, runs: ["auto","open","mixed","rough","boat"].map(p => o.run(p,pairs,origins)), mapClass: o.mapClass };
fs.writeFileSync(`${outDir}/src/core/prototype.golden.json`, JSON.stringify(golden));
const places = o.base.map(p => ({ name: p.name, x: p.x, z: p.z, ...(p.biome ? { biome: p.biome } : {}),
  kind: p.portal ? "portal" : p.village ? "village" : "place" }));
const maps = o.MAPS.map(m => ({ file: m.file.replace("images/", ""), x: m.x, z: m.z, size: m.size, ...(m.crop ? { crop: m.crop } : {}) }));
const ts = `// Demo world: the original prototype's places and map screenshots (generated from docs/prototype.html).
export type PlaceKind = "place" | "portal" | "village";
export interface DemoPlace { name: string; x: number; z: number; biome?: string; kind: PlaceKind }
export interface DemoMap { file: string; x: number; z: number; size: number; crop?: { x: number; y: number; size: number } }

export const DEMO_PLACES: DemoPlace[] = ${JSON.stringify(places, null, 1).replace(/\n\s*/g, " ").replace(/\}, \{/g, "},\n  {")};

export const DEMO_MAPS: DemoMap[] = ${JSON.stringify(maps, null, 1).replace(/\n\s*/g, " ").replace(/\}, \{/g, "},\n  {")};
`;
fs.writeFileSync(`${outDir}/src/store/demoWorld.ts`, ts);
console.log(places.length, "places,", maps.length, "maps; pair names:", pairs.map(([i,j]) => o.base[i].name + "→" + o.base[j].name).join(" | "));
console.log("auto H→spawn secs", golden.runs[0].travel[0].secs.toFixed(1), "reach N", golden.runs[0].reach[0].full[0].toFixed(1));
