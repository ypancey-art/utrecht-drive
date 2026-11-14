# Progress log

Read this first in a new session, together with `PLAN.md`.

## How to run
- `npm install` (once)
- `npm run dev` → open http://localhost:5173 (on a phone on the same Wi-Fi, use the "Network" URL Vite prints)
- `npm run fetch-map` rebuilds `public/data/overvecht.json` from the cached raw OSM data in `scripts/cache/` (git-ignored; downloads it if missing). `npm run fetch-map -- --refresh` forces a new download. Overpass servers are often flaky, and the script retries over 3 mirrors
- `npx tsc` type-checks; `npx vite build` builds to `dist/`

## Code layout
| Path | What |
|---|---|
| `scripts/fetch-osm.mjs` | Overpass API → compact JSON in metres (x = east, z = south). Centre 52.1108, 5.1215, box about 1.5 × 1.5 km |
| `src/art/` | **Visual only** (palette, map meshes, car mesh). Swap these for realistic art later |
| `src/game/scenery.ts` | Deterministic tree + street light placement (OSM trees, tree rows, scattered in woods/parks, kept off roads via `RoadGrid`) |
| `src/art/sceneryMeshes.ts` | Instanced low-poly trees (3 kinds) and street lights |
| `src/game/mapData.ts` | Map types, `loadMap`, `nearestRoad` (used for spawn + street name HUD) |
| `src/game/mapPhysics.ts` | Rapier colliders: ground, buildings (one trimesh of walls), map-edge walls |
| `src/game/car.ts` | Car physics on Rapier `DynamicRayCastVehicleController`. Forward = +x, right = +z. `CarStats` drives car differences/upgrades |
| `src/game/input.ts` | Keyboard (arrows/WASD, Space handbrake, R reset) + touch buttons |
| `src/i18n/index.ts` | NL/EN text. All player text must go through `t()` |
| `src/main.ts` | Boot, render loop, chase camera, HUD (speed, street name), auto-reset when flipped |

## Phase 1 (map prototype): status
Done (2026-11-14):
- [x] Vite + TypeScript + Three.js + Rapier project
- [x] OSM data downloaded (1350 roads, 6897 buildings, water, rails, parks, station)
- [x] Low-poly map: ground, parks, water, paths, rails, roads, extruded buildings, station marker
- [x] Drivable car (headless physics test passed: accelerates, 80 km/h cap, brakes, reverses, steers correctly, stops at walls)
- [x] Keyboard + touch controls, chase camera, speed + street name HUD, NL/EN switch
- [x] Checked in headless Chrome (screenshots)
- [ ] Checked on a real phone

Realism pass (2026-11-14):
- [x] Road widths from OSM `width` tag, else lanes × 3.25 m, one-way roads narrower. Lane count stored
- [x] Pavements along streets, dashed lane lines
- [x] Buildings: window texture (3.2 m bays, 3 m floors), separate roofs, heights by building type, OSM colours if tagged
- [x] Trees (923 OSM trees + rows + scattered in woods/parks) with trunk colliders; street lights on named roads
- [x] Sky dome (three Sky) + ACES tone mapping; car no longer creeps when stopped
- [x] Pushed to GitHub: git@github.com:ypancey-art/utrecht-drive.git (public)
- [x] GitHub Pages deploy on push to main → https://ypancey-art.github.io/utrecht-drive/ (needs Settings → Pages → Source: GitHub Actions)

Known gaps / next steps:
- Bridges and tunnels are flat (OSM `bridge`/`tunnel` ignored; tunnel roads are hidden)
- Water is not blocking. The canal may be missing if OSM stores it as a multipolygon relation (only ways are fetched)
- Bundle is ~4.9 MB (Rapier "compat" inlines its WASM). Later: switch to `@dimforge/rapier3d` + vite wasm plugin, or lazy-load
- Building heights default to 9 m when OSM has no levels/height
- Houses have flat roofs (no pitched roofs yet); car is still a simple box
- Then: Phase 2 (core loop: grade select, math gate screen, one mission, coins)
