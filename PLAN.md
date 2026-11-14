# Overvecht Driving Game: Plan v1

## Concept
Kids (groep 3 to VO) drive around a 3D version of the real Utrecht Overvecht. They do missions and races, earn coins and upgrade their car. Solving math problems unlocks missions and upgrades. Crashing too often makes the police chase you.

## Decisions so far
| Topic | Decision |
|---|---|
| Platform | Browser game for phone (touch controls) and PC (keyboard) |
| Tech (proposed) | Three.js (3D), Rapier (physics), TypeScript + Vite |
| Map | OpenStreetMap data for the area around Utrecht Overvecht station (about 1 × 1.5 km, centred near lat 52.11, lon 5.11): Donaudreef, Moezeldreef, Tiberdreef, Jacoba van Beierendreef, Linnaeuslaan, the railway and the canal. Converted to 3D once (e.g. via the Overpass API) and saved with the game. |
| Visual style | Low-poly first. The art is kept separate from the game logic so it can be swapped for a more realistic look later. |
| Languages | Dutch + English, switchable. All text lives in translation files, so more languages (e.g. Macedonian) can be added later. |
| Players | Kids, groep 3–8 and VO |
| Math gates | 3 problems is the base. Bigger rewards and upgrades need more problems. |
| Caught by police | Player chooses: pay coins OR solve a "bail" math problem |
| Traffic | Start simple, with no or very little traffic. AI traffic later. |
| Save/profiles | Later |

## Math by grade (draft, check against the Dutch curriculum)
- **Groep 3:** add/subtract to 20
- **Groep 4:** add/subtract to 100; times tables 1, 2, 5, 10
- **Groep 5:** all times tables; add/subtract to 1000; simple division
- **Groep 6:** bigger multiplication/division; simple fractions; money sums
- **Groep 7:** fractions, decimals, basic percentages, measurement units
- **Groep 8:** percentages, ratios, mixed word problems
- **VO 1–2:** negative numbers, order of operations, simple equations, area/perimeter
- **VO 3:** linear equations, powers/roots, Pythagoras

## Math gate scaling (draft)
| Unlock | Problems |
|---|---|
| Small mission / basic upgrade | 3 |
| Medium mission / mid upgrade | 4 |
| Race / top upgrade | 5 |
| New car | 6 |

Wrong answers: still open. Proposal: give a new problem of the same type, and show a hint after 2 wrong answers in a row.

## Cars (v1)
Three starter cars:
- Small hatchback: agile, average speed
- Sports car: fast, fragile
- Van/SUV: tough, slow

Upgrades: engine, tires/handling, armour (crash resistance), paint.

## Missions (v1)
- Checkpoint race around the blocks
- Timed delivery between two addresses
- "Station dash": reach Utrecht Overvecht station before the train leaves
- Parking challenge (later)

## Police
- **Crash meter:** every collision adds to the meter (more at higher impact speed). The meter slowly drains over time.
- **Wanted stars:** when the meter passes a threshold you get 1 star and a police car chases you. More crashes give more stars and more police.
- **Escape:** stay out of police sight for X seconds.
- **Caught:** the car stops. Choose to pay coins or solve a bail problem.

## Build phases
1. **Map prototype:** OSM → 3D Overvecht, one drivable car, touch + keyboard controls
2. **Core loop:** grade select, language switch, math gate screen, one mission, coins
3. **Cars:** car select + upgrades
4. **Police:** crash meter, wanted stars, chase, caught screen
5. **Content:** races + more missions
6. **Later:** traffic, saved profiles, more languages, realistic art

## Open questions
- What happens after a wrong answer?
- Car names/looks
- Mission ideas tied to specific Overvecht places
