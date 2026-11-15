// Builds the game world without a browser (data + physics), shared by the tests.
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import type { MapData } from '../src/game/mapData';
import { buildDyke } from '../src/game/railway';
import { placeScenery } from '../src/game/scenery';
import { WaterMap } from '../src/game/water';
import { bridgeSegments } from '../src/art/mapMeshes';
import { buildMapPhysics, addHedgePhysics, addRampPhysics, addLoopPhysics } from '../src/game/mapPhysics';
import { rampPoints } from '../src/art/rampMeshes';

export function loadMapData(): MapData {
  const map = JSON.parse(readFileSync('public/data/overvecht.json', 'utf8')) as MapData;
  const bin = readFileSync('public/data/buildings3d.bin');
  const info = map.lodInfo!;
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  map.lod3d = { pos: new Int16Array(buf, 0, info.positions), idx: new Uint16Array(buf, info.positions * 2, info.indices) };
  return map;
}

let cached: ReturnType<typeof buildWorld> | null = null;
/** Builds the world for a map (by default the one in public/data). */
export async function buildWorld(map: MapData = loadMapData()) {
  await RAPIER.init();
  const dyke = buildDyke(map);
  const scenery = placeScenery(map);
  const water = new WaterMap(map);
  const decks = bridgeSegments(map, water, scenery.grid);
  water.setBridges(decks);
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  buildMapPhysics(world, map, scenery.trees, decks, dyke);
  addHedgePhysics(world, map.hedges ?? []);
  addRampPhysics(world, (map.ramps ?? []).map(rampPoints));
  addLoopPhysics(world, map.loops ?? []);
  world.step();
  return { RAPIER, map, dyke, scenery, water, decks, world };
}
/** The full world (built once per test file). */
export const gameWorld = () => (cached ??= buildWorld());
