// Builds the game world without a browser (data + physics), shared by the tests.
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import type { MapData, Ramp, Loop } from '../src/game/mapData';
import { Car } from '../src/game/car';
import { CARS } from '../src/game/cars';
import { loopEntry } from '../src/game/loops';
import { buildDyke } from '../src/game/railway';
import { placeScenery } from '../src/game/scenery';
import { WaterMap } from '../src/game/water';
import { bridgeSegments } from '../src/art/mapMeshes';
import { buildMapPhysics, addHedgePhysics, addRampPhysics, addLoopPhysics, addTrackPhysics } from '../src/game/mapPhysics';
import { rampHulls } from '../src/art/rampMeshes';

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
  addRampPhysics(world, (map.ramps ?? []).flatMap(rampHulls));
  addLoopPhysics(world, map.loops ?? []);
  // Everything that can be built is in the test world, so the tests cover it all.
  addTrackPhysics(world, map.tracks ?? [], (x, z) => scenery.grid.edgeDistance(x, z) > 1.2);
  world.step();
  return { RAPIER, map, dyke, scenery, water, decks, world };
}
/** The full world (built once per test file). */
export const gameWorld = () => (cached ??= buildWorld());

type World = Awaited<ReturnType<typeof buildWorld>>;
/** Run-up (m behind the ramp's centre) that the placement scripts keep free for each kind of ramp. */
export const rampRunUp = (r: Ramp) => r.len / 2 + (r.kind === 'water' ? 38 : r.kind === 'roof' ? 26 : 36);

/**
 * Test-drives one ramp at full throttle, straight on, like a player would. Returns an error
 * message, or '' if the ramp works with this car. 'land' ramps are driven from their take-off
 * ('gap') ramp. Shared by tests/world.test.ts and the placement scripts.
 */
export function driveRamp({ world, water, scenery }: Pick<World, 'world' | 'water' | 'scenery'>, r: Ramp, carId: string): string {
  if (r.kind === 'land') return '';
  const spec = CARS.find((c) => c.id === carId)!;
  const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
  const car = new Car(world, spec.stats, spec.dims);
  car.place(r.x - ux * rampRunUp(r), r.z - uz * rampRunUp(r), ux, uz, r.y ?? 0);
  // How far past the ramp's centre the run ends (once the car is back on its wheels).
  const end = r.len / 2 + (r.kind === 'roof' ? 12 : r.kind === 'kick' ? 60 : r.kind === 'rail' ? 90 : r.kind === 'jump' ? 40 : r.kind === 'gap' ? 55 : 30);
  const mustLand = r.kind === 'rail' || r.kind === 'jump' || r.kind === 'gap';
  let sank = false, maxY = 0, landed = false, reached = false, air = 0;
  for (let i = 0; i < 60 * 9; i++) {
    const p = car.body.translation(), q = car.body.rotation();
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
    // On the narrow railway dyke: also keep to the line of the ramp.
    const side = r.kind === 'rail' ? (p.x - r.x) * -uz + (p.z - r.z) * ux : 0;
    const ang = Math.atan2(fx * uz - fz * ux, fx * ux + fz * uz) - side * 0.15;
    car.update({ throttle: 1, steer: Math.max(-1, Math.min(1, ang * 3)), handbrake: false }, world.timestep);
    world.step();
    maxY = Math.max(maxY, p.y);
    if (!car.grounded) air += world.timestep;
    if (r.kind === 'kick' && car.grounded && !car.flipped && p.y > r.roofH! + 0.3) {
      landed = true;
      break;
    }
    if (p.y < 1.2 && water.contains(p.x, p.z) && scenery.grid.edgeDistance(p.x, p.z) > 0.3) {
      sank = true;
      break;
    }
    if ((p.x - r.x) * ux + (p.z - r.z) * uz > end && (!mustLand || car.grounded)) {
      reached = true;
      break;
    }
  }
  const y = car.body.translation().y, flipped = car.flipped;
  car.dispose();
  if (sank) return 'the car sank';
  if (flipped) return 'the car flipped';
  if (r.kind === 'kick') return landed ? '' : 'did not land on the roof';
  if (r.kind === 'roof') return y > r.h ? '' : `did not get onto the roof (y ${y.toFixed(1)})`;
  if (r.kind === 'rail') return maxY > r.y! + 2.5 && y > r.y! - 0.5 ? '' : `no jump, or fell off the railway (y ${y.toFixed(1)})`;
  if (r.kind === 'jump' || r.kind === 'gap') {
    if (!reached) return 'did not get past the landing';
    return air > 0.6 && maxY > r.h + 1.5 ? '' : `no real jump (air ${air.toFixed(2)} s, max ${maxY.toFixed(1)} m)`;
  }
  return maxY > 2.5 ? '' : 'no real jump';
}

/** Drives a loop straight on at full throttle; '' if the car goes all the way round and comes out upright. */
export function driveLoop({ world }: Pick<World, 'world'>, l: Loop, carId: string): string {
  const spec = CARS.find((c) => c.id === carId)!;
  const e = loopEntry(l);
  const car = new Car(world, spec.stats, spec.dims);
  car.place(e.x - e.dirX * 45, e.z - e.dirZ * 45, e.dirX, e.dirZ);
  let maxY = 0, out = false;
  for (let i = 0; i < 60 * 14; i++) {
    car.update({ throttle: 1, steer: 0, handbrake: false }, world.timestep);
    world.step();
    const p = car.body.translation();
    maxY = Math.max(maxY, p.y);
    const along = (p.x - l.x) * e.dirX + (p.z - l.z) * e.dirZ;
    if (maxY > l.r * 2 - 1 && along > 14 && p.y < 1.5) {
      out = true;
      break;
    }
  }
  const flipped = car.flipped;
  car.dispose();
  if (maxY <= l.r * 2 - 1) return `did not reach the top (max ${maxY.toFixed(1)} m)`;
  return out && !flipped ? '' : 'did not come out on its wheels';
}
