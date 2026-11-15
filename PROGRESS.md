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

Real-data pass (2026-11-14):
- [x] Buildings now from 3D BAG WFS (`BAG3D:lod12`): footprints, 70th-percentile roof height, eave/ridge for pitched roofs, floors, year built. 6772 buildings, 1940 pitched
- [x] Façade style by year built (`src/art/buildingMeshes.ts`): prewar brick, 1945-75 gallery flats / houses, 1976-95 brown brick, 1996+ modern. Canvas textures, one draw call per style
- [x] Gable roofs on 4-corner pitched buildings, gable ends on party walls (terraced rows), hipped roofs on other small pitched shapes
- [x] Trees from Utrecht tree register (7107 trees, species + planting year). Size = genus max height x growth curve by age (`src/game/scenery.ts`, `GENUS` table); columnar cultivars narrow
- [x] Railway: gravel bed, sleepers (instanced), two steel rails per track
- [x] Water: car sinks (kinematic, drifts, nose-down, fades), "Plons!" message, respawns on nearest road after 3 s. Not when on a road/bridge
- [x] Test URL: `?at=x,z,headingDeg` starts the car at a map position
- Street View can't be used (Google terms); façades are styled from 3D BAG year/height instead
- Tree WFS paging is broken on the ArcGIS server, so the script fetches in 4 x 4 tiles

Game loop, phases 2-5 (2026-11-14/15):
- [x] Start screen (grade + language), progress saved in localStorage (`src/game/progress.ts`)
- [x] Math gate (`src/ui/ui.ts`, `src/game/mathProblems.ts`): multiple choice, keys 1-4; wrong answer = new problem of same type; hint after 2 wrong in a row. Generators for groep 3 to VO 3
- [x] 8 missions on real streets (`src/game/missions.ts`), timer, arrow, coin rewards (small 3 problems/30, medium 4/50, race 5/80)
- [x] Cars: Kenney Car Kit (CC0) GLB models in `public/models/cars`, loaded by `src/art/carModels.ts`, sizes measured for physics. 6 cars + police. Paint = recolour body texel colour
- [x] Garage (`src/ui/garage.ts`): 3D preview, buy (coins + 6 problems), upgrades engine/tires/armour (coins + 3/4/5 problems), paint
- [x] Police (`src/game/police.ts`): crash meter from Rapier contact forces (points = force/(mass*30), max 30), stars at 40/70/90, units route along `RoadGraph` (A*), line of sight by raycast, escape after 10 s unseen, caught when close + slow 1.2 s -> pay 20/star or 2+stars bail problems
- [x] Sunken water + banks, bridge decks (+4 m) with railing colliders, kerbs, trees kept out of water/buildings
- [x] Test URL params: `?at=x,z,deg`, `?grade=g5`, `?wanted=2`, `?garage=sedan`
- [x] 3D building shapes: `npm run fetch-3d` (after fetch-map!) adds LoD2.2 meshes (public/data/buildings3d.bin), aerial roof colours (PDOK, needs macOS sips), church/mosque flags
- Façade colours: no open data exists; walls are styled by year built. Roof colours are real (aerial photo)

World detail (2026-11-15):
- [x] Cars: "Generic passenger car pack" by Comrade1280 (CC BY 4.0) `public/models/cars/car-pack.glb` (meshopt + webp). `src/art/carModels.ts` pulls each car out of the pack (nearest 4 wheels, PCA for direction, scale to length). Model id = "<node>|<length>|<flip>"
- [x] Railway on a 4.5 m dyke (`src/game/railway.ts`), OSM rail bridges = concrete decks with streets underneath (Brailledreef)
- [x] Road decks over water; ditch crossings are culverts (no railings); railings only on real bridges and never on another road
- [x] 41 playgrounds (`src/game/playgrounds.ts`, `src/art/playgroundMeshes.ts`), De Kinderdroom at (-741, 390)
- [x] Façade styles checked against Wikimedia Commons photos (Rode Flat, school Op Dreef, Tuindorpkerk): flat/flatBlue/flatWarm/panel/prewar/church
- [x] Traffic (`src/game/traffic.ts`): directed RoadGraph (one-way), right-hand lane offset, brake for cars ahead; headless test: 10 cars, 0 off-road samples
- [ ] Road tunnels (4 in OSM, incl. the 1992 wegtunnel at the station) and 15 cycle tunnels under the dreven: not built yet (needs a heightfield ground with cuts)
- [ ] Façade colours per building: needs Mapillary token (CC BY-SA street photos) or manual Street View look-ups for a few landmarks (Chrome extension)

Known gaps / next steps:
- Bridges and tunnels are flat (OSM `bridge`/`tunnel` ignored; tunnel roads are hidden)
- Water is not blocking. The canal may be missing if OSM stores it as a multipolygon relation (only ways are fetched)
- Bundle is ~4.9 MB (Rapier "compat" inlines its WASM). Later: switch to `@dimforge/rapier3d` + vite wasm plugin, or lazy-load
- Houses have flat roofs (no pitched roofs yet); car is still a simple box
- Mobile touch controls need rework (user will test later)
- Possible: Mapillary (CC BY-SA street photos, needs free API token) for façade colours

## Session 2026-11-15 (afternoon)
- [x] Railway dyke = one height grid (railway.ts): parallel tracks merged, openings + decks wherever a road/path crosses (Tiberdreef station tunnel opened). Test: scripts/cache/bridgetest.ts via `npx tsx` (not committed).
- [x] Bridge railings never block a joining path/street
- [x] Façade colours from Mapillary (scripts/fetch-facades.mjs, token in ~/.mapillary_token, NEVER commit it). 440 buildings; coverage is the limit
- [x] Cars ~45% faster; Offroad + Pickup; police faster
- [x] Accidents (hitting traffic or people) fill the meter fast; caught = mandatory fine (sums for the rest)
- [x] Sound + original music (src/audio/sound.ts, Web Audio, no files). Copyrighted songs (Billie Jean, Dance Monkey) NOT included, also not as MIDI
- [x] Pedestrians + cyclists on real paths (game/people.ts, art/peopleMeshes.ts); test: `?people`
- [ ] Mobile controls (deferred by user)
- [ ] Cycle tunnels under the dreven (not under the railway) still hidden
- [x] Street View looks per street (src/game/streetLooks.ts + styles row62/row02/timber/woodSlat). Done: Anna van Burendreef. Look by hand in Chrome, add a rule per building group (street + years).
- [x] Hedges + shrub/flower beds from OSM (scripts/fetch-greenery.mjs, run last); hedges are solid. Trees: lobed crowns, darker greens.
- Note: headless screenshots fail while the user's Chrome runs; use the Claude-in-Chrome tab on localhost:5173 instead.
