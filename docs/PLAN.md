# Minemap: build the prototype into an installable PWA (phase 1)

## Context
`~/Documents/MinecraftMap/minecraft-map-editable.html` is a single-file prototype for one person's Switch Minecraft world. It does these things:
- keeps a list of saved places
- converts coordinates for the Nether
- gives distance and heading between two places
- estimates how far you can travel in one day of daylight
- overlays photos of in-game maps and reads terrain from their colours

The market and cost/benefit analysis recommended testing demand with a cheap web app first: an installable PWA, data kept on the device, and a $5 one-time unlock. Only build more if people use it and pay. Phase 1 therefore covers three things:
- a new project at `~/projects/minemap` using Vite and TypeScript, no framework
- the prototype's logic ported into tested modules
- the step that matters most: importing a screenshot and placing the map automatically

The go/no-go check after launch: at least 300 people using it each week and at least 2% paying.

Settled decisions:
- Location: `~/projects/minemap`, as a new git repo. The prototype stays untouched.
- Stack: Vite and TypeScript with no framework, plus `vite-plugin-pwa` and `idb-keyval`.
- Phase 1 scope: data stays on the device, no accounts, a Stripe unlock.

## Architecture

```
minemap/
  index.html
  src/
    main.ts                 bootstrap: load the current world, render, register the service worker
    core/                   pure functions with no DOM access (ported from the prototype, unit-tested)
      geo.ts                dirName, yaw, toNether, mapCorner(x, z, scale)
      biomes.ts             BIOMES colours, BIOME_PACE
      travel.ts             PACES, biomeAt, bpsAt, travel, reach (terrain lookup passed in, no globals)
      terrain.ts            MAP_COLOURS, mapClass, terrainFromMap
      labels.ts             label placement (the box-overlap search inside draw())
    import/
      crop.ts               find the held-map square in a screenshot (Switch presets first, then a whole-screen search)
      ocr.ts                read "Position: x, y, z" from the screenshot (template-match the game's pixel font)
      f3.ts                 read Java Edition's F3 screen (its "Block: x y z" line, checked against "XYZ:")
      place.ts              screenshot -> {x, z, size}: OCR'd coordinates + scale -> mapCorner
    store/
      db.ts                 IndexedDB: worlds, places, maps (image blobs stored separately), settings
      migrate.ts            schema version; import of the prototype's `base` and `MAPS` arrays
    ui/
      map.ts                SVG draw, zoom, pan and pinch (from the prototype's draw and zoomAt)
      list.ts, route.ts     place list and route panel (from list() and route())
      worlds.ts             create, switch, rename, delete worlds; export/import a world as JSON
      importer.ts           screenshot picker (multiple, plus Android share target) -> preview -> confirm/adjust
      placeForm.ts          add/edit a place (replaces "Copy as code": edits now persist)
      paywall.ts            free limits, unlock flow, licence check
    styles.css              the prototype's CSS tokens and layout, moved as is
  api/
    unlock.ts, restore.ts   Vercel endpoints (Edge runtime): check the Stripe session, return a signed licence
  server/                   the endpoints' logic, tested without Stripe
  public/                   icons, manifest assets
  public/demo/              the demo world's screenshots, known {x, z, size} in store/demoWorld.ts, plus a few extra import test fixtures
  src/import/fixtures/java/ Java Edition test screenshots (kept out of public/, so not deployed)
```

## What to reuse from the prototype
All of these are in `~/Documents/MinecraftMap/minecraft-map-editable.html`:
- **Copy the CSS tokens and dark-mode theme** as they are.
- **Port to `core/travel.ts` almost unchanged:** `travel`, `reach`, `biomeAt`, `bpsAt`, `PACES`, `BIOME_PACE`, `DAYLIGHT`/`SPARE`. Change one thing: take the list of biome pins and a `terrainAt` function as arguments instead of reading globals, so they can be unit-tested.
- **Port to `core/terrain.ts`:** `terrainFromMap` and `MAP_COLOURS`. Run them in a Web Worker on `ImageBitmap`s from IndexedDB, not in `loadTerrain()`. That removes the prototype's "needs a local web server" problem, because pixels read from a user-chosen file never hit the browser's cross-origin block.
- **Split `draw()`** into map drawing (`ui/map.ts`) and label placement (`core/labels.ts`). Port `zoomAt`, `panBy` and the pointer and pinch handlers as they are.
- **Keep the `CROP` preset** (`{x:368, y:59.5, size:544}` for 1280×720 Switch captures) and the split-screen crop override. These become the default in `import/crop.ts`.
- **Keep the existing `MAPS` entries.** Each records a screenshot's file, x, z and size, so every entry is a test case for automatic placement.

## Key mechanism: placing a map automatically
- A Minecraft map at zoom level `s` covers `size = 128·2^s` blocks.
- Its north-west corner sits on a fixed grid: `corner = floor((pos + 64) / size) · size − 64`. This matches every entry in the prototype's `MAPS` list. For example, x=1472 at size 512 gives (1472+64)/512 = 3 exactly.
- With "Show coordinates" on, the screenshot shows the player's position. Read it with OCR, take the zoom level (asked once and remembered, then detected from the map later), and `mapCorner` gives an exact position.
- **Fallback when no coordinates are visible:** the user taps "I was standing at…" or drags the map into place, and it snaps to the grid.
- **OCR approach:** the game font is fixed-width pixel glyphs. Threshold the white-on-dark text box in the top-left, split it into characters, and match each against about 13 glyph templates (0–9, minus sign, comma, space). Build the templates from the fixture screenshots. No OCR library is needed.

**Learned in step 5 (as built):**
- Your position only places the map if you're standing on it. In 7 of the 22 demo screenshots the player is holding a map of somewhere else. A **player marker** check decides: locator maps (made with a compass) draw a white marker with a black outline, and if it sits where a zoom level predicts, the map and its zoom level are confirmed (`basis: "marker"`, 7 of 22 demo maps, none wrong). Plain maps have no marker, so the position is only a suggestion, which the user confirms or corrects by entering a spot on the map.
- The map's location in the screenshot is found from the colour of its **parchment frame** (`import/crop.ts`): the known Switch layouts first (full screen, or the left or right half in split-screen), then a search of the whole screen for other layouts. Screenshots that aren't 16:9 (Java Edition on a 16:10 Mac screen, or in a window) are fitted into the 1280×720 frame without stretching (`fitToFrame`): narrower than 16:9 is padded black at the sides; wider (21:9, 32:9) keeps its middle 16:9, because the game sizes and centres the held map by the screen's height, so it lands where it does in any 16:9 screenshot. `analyzeScreenshot` takes the screenshot as taken and returns this frame, which is what's stored; coordinates are read from the full-size original. Eleven real Java screenshots (`src/import/fixtures/java/`) are found to within half a map pixel, including two held lower (looking further down) and two in shade, where Java lights the frame bluish. A Java screenshot with no map finds none.
- Java Edition shows no "Position:" line; its **F3 screen** has the coordinates instead (`import/f3.ts`). F3 text is crisp (each font pixel 2 or 3 screen pixels) and stacked from the top on a fixed pitch, so the first line gives the scale and where every line is, and each glyph is cut back to its exact font-pixel bitmap and looked up. The "Block: x y z" line is used; the "XYZ:" line rounded down must agree when it also reads, so a misread digit gives no position rather than a wrong one. Bitmaps are generated by `scripts/gen-f3-glyphs.ts` from `src/import/fixtures/java/f3.json`; in a leave-one-out check, 7 of 7 screenshots read exactly, at 3024×1898 and 1920×1200. The player marker isn't found on a map held in shade (it's dimmed), so those fall back to a suggested placement.
- Templates are generated by `scripts/gen-glyphs.ts` from `src/import/ocr.fixtures.json`. In a leave-one-out check, 23 of 25 screenshots read exactly. The two misses are the only split-screen examples, too few to teach each other; there are no small 0 or − yet.
- Deferred: the Android share target (needs a custom service worker) and dragging maps into place on the map.

## Data model (IndexedDB)
- `World {id, name, createdAt, settings:{pace, showMaps, platform}}`
- `Place {id, worldId, name, x, z, kind:'place'|'portal'|'village', biome?, note?}`
- `MapShot {id, worldId, x, z, size, crop, imageId, capturedAt}` plus `images: Blob` stored by `imageId`
- Call `navigator.storage.persist()` on first save. If the browser doesn't grant it, show a prompt to install the app or export a backup.

## Payments: Stripe unlock with no accounts
- **Free tier:** 1 world, 30 places and 5 map screenshots. All route and travel features are free.
- **Unlock ($5 one-time):** unlimited worlds and screenshots, plus world export/import.
- **Checkout:** a Stripe Payment Link sends the buyer to `/unlocked?session_id=…`. `api/unlock.ts` checks the session with Stripe's API and returns an ECDSA P-256 signed licence `{email, sid, iat}`.
- **Verification:** the app checks the licence offline using a public key built into it, and stores it in IndexedDB.
- **Restore purchase:** enter your email, the function looks up the Stripe customer and re-issues the licence.
- **Secrets:** the Stripe key and signing key are Vercel environment variables and are never in the repo. Setup steps: [PAYMENTS.md](PAYMENTS.md).

## Build order (about 2 weeks)
1. **Scaffold.** Run `npm create vite` (vanilla-ts), then add Vitest, `vite-plugin-pwa` (manifest, offline caching, `share_target` for Android) and `idb-keyval`. Run `git init` and add `.gitignore`.
2. **Port `core/` and write its tests first.** Tests cover `mapCorner` against all 22 `MAPS` fixtures, plus `travel`, `reach`, `dirName`, `yaw` and Nether conversion, using numbers taken from the prototype.
3. **Storage.** Build `store/db.ts` and `migrate.ts`, including a "Load demo world" that imports the prototype's `base` and `MAPS` data and images (it doubles as the onboarding example).
4. **UI port.** Map, list, route, the add/edit place form and the world switcher, matching what the prototype does now.
5. **Screenshot import.** Build crop, OCR and placement, a preview showing the map ghosted in its computed position, and confirm/nudge controls. Run terrain extraction in a worker.
6. **Paywall and unlock function.** Use Stripe test mode end to end.
7. **Launch polish.** Landing section, icons, PostHog analytics (events: world_created, screenshot_imported, auto_place_success/fail, paywall_shown, unlocked), privacy note, and the name "Minemap — a map companion for Minecraft". Mojang's guidelines don't allow "Minecraft" in the product name.
8. **Deploy** to Vercel, then post to r/Minecraft, r/NintendoSwitch and the Bedrock communities.

## Verification
- **Unit tests:** `npm test`. Vitest covers `core/` and `import/`. Automatic placement should be exact on at least 20 of the 22 fixture screenshots. OCR should read every fixture that shows coordinates.
- **Same behaviour as the prototype:** with the demo world loaded, distance, heading, travel time and the day-reach shape for the default pair (Hobbiton → World spawn point) match the prototype in a browser.
- **PWA:**
  - Run `npm run build && npm run preview`. Lighthouse should mark the PWA as installable.
  - Load once, go offline, reload. Everything should still work.
- **Phone:**
  - Install on iOS Safari and Android Chrome.
  - On Android, share a Switch screenshot to the app. On iOS, use the file picker.
  - In both cases the map should be placed correctly.
- **Payments:** in Stripe test mode, buy, check the limits lift, clear site data, restore by email, and check the unlock comes back.
- **Analytics:** events show up in PostHog.

## Later phases (out of scope for now)
- Cloud sync and family sharing (e.g. Neon plus auth).
- Wrapping with Capacitor for the App Store and Google Play, using RevenueCat for in-app purchases.
- Detecting the map automatically on Xbox, PlayStation and mobile screenshots. (Other resolutions and shapes are fitted to 1280×720; Java Edition on a Mac is tested.)
