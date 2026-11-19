// Builds the game world without a browser (data + physics), shared by the tests.
import RAPIER from '@dimforge/rapier3d-compat';
import { readFileSync } from 'node:fs';
import type { MapData, Ramp, Loop, Track } from '../src/game/mapData';
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

/**
 * Drives a Hot Wheels track from start to end at full throttle, steering at a point ~8 m ahead
 * on the centre line (not inside loops). '' if the car gets over the top of every loop and
 * reaches the end upright. `strict`: it must also never drop off the track (a planned gap is
 * flown over, above the track) and never roll over outside a loop. Shared by tests/world.test.ts and the placement scripts.
 */
const EASE_ACC = 14; // m/s²: how hard a careful driver takes a bend (walls and banking help)
export function driveTrack({ world }: Pick<World, 'world'>, t: Track, carId: string, opts: { strict?: boolean; ease?: boolean; log?: (s: string) => void } = {}): string {
  const spec = CARS.find((c) => c.id === carId)!;
  const paths = t.parts.filter((p) => p.kind === 'path').map((p) => (p as { pts: [number, number, number][] }).pts);
  const loops = t.parts.filter((p) => p.kind === 'loop').map((p) => (p as { loop: Loop }).loop);
  const all = paths.flat();
  const [sx, sy, sz] = all[0], [nx, , nz] = all[2], l = Math.hypot(nx - sx, nz - sz);
  const car = new Car(world, spec.stats, spec.dims);
  // Tracks start on the ground (or on the railway dyke: y = the track bed).
  car.place(sx - ((nx - sx) / l) * 10, sz - ((nz - sz) / l) * 10, (nx - sx) / l, (nz - sz) / l, sy);
  const end = all[all.length - 1];
  const tops = loops.map(() => 0);
  let reached = false, fell = '', flipAt = '';
  for (let i = 0; i < 60 * 60 && !reached; i++) {
    const p = car.body.translation(), q = car.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    let best = 0, bd = Infinity;
    for (let k = 0; k < all.length; k++) {
      const d = (all[k][0] - p.x) ** 2 + (all[k][2] - p.z) ** 2 + (all[k][1] - p.y) ** 2;
      if (d < bd) (bd = d), (best = k);
    }
    // Look ahead ~9 m, further at speed (like a driver looking further down the road).
    const v = car.body.linvel(), ahead = Math.max(9, Math.hypot(v.x, v.z) * 0.35);
    let k = best, d = 0;
    while (k < all.length - 1 && d < ahead) (d += Math.hypot(all[k + 1][0] - all[k][0], all[k + 1][2] - all[k][2])), k++;
    const tg = all[k];
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
    const ang = Math.atan2(fx * (tg[2] - p.z) - fz * (tg[0] - p.x), fx * (tg[0] - p.x) + fz * (tg[2] - p.z));
    const inLoop = loops.findIndex((lp) => Math.hypot(p.x - lp.x, p.z - lp.z) < 20 && p.y > (lp.y ?? 0) - 1);
    // `ease`: like a player, lift off the throttle when going too fast for a bend coming up
    // (the next 50 m). Otherwise full throttle all the way.
    let throttle = 1;
    if (opts.ease && inLoop < 0) {
      let kMax = 0, dd = 0, kHere = 0;
      for (let j = best + 1; j < all.length - 1 && dd < 50; j++) {
        const a0 = Math.atan2(all[j][2] - all[j - 1][2], all[j][0] - all[j - 1][0]), a1 = Math.atan2(all[j + 1][2] - all[j][2], all[j + 1][0] - all[j][0]);
        const seg = Math.hypot(all[j + 1][0] - all[j][0], all[j + 1][2] - all[j][2]);
        dd += seg;
        const kk = seg > 0.5 ? Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))) / seg : 0;
        kMax = Math.max(kMax, kk);
        if (dd < 8) kHere = Math.max(kHere, kk);
      }
      const vMax = kMax > 0 ? Math.sqrt(EASE_ACC / kMax) : Infinity, sp = Math.hypot(v.x, v.z);
      // Brake (in pulses, like ABS, so the wheels don't lock) only on the straight before it.
      throttle = sp > vMax * 1.1 && kHere < 0.02 && i % 3 === 0 ? -1 : sp > vMax ? 0 : 1;
    }
    car.update({ throttle, steer: inLoop >= 0 || upY < 0.7 ? 0 : Math.max(-1, Math.min(1, ang * 2)), handbrake: false }, world.timestep);
    world.step();
    if (inLoop >= 0) tops[inLoop] = Math.max(tops[inLoop], p.y);
    if (opts.log && i % 15 === 0) opts.log(`t ${(i / 60).toFixed(2)} pt ${best}/${all.length} ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} track y ${all[best][1].toFixed(1)} v ${Math.hypot(v.x, v.z).toFixed(1)} up ${upY.toFixed(2)} throttle ${throttle} loop ${inLoop}`);
    if (inLoop < 0 && upY < 0.3 && !flipAt) flipAt = ` (upside down at ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)}, point ${best}/${all.length})`;
    // Dropped off: well below the nearest bit of track.
    if (opts.strict && inLoop < 0 && Math.hypot(all[best][0] - p.x, all[best][2] - p.z) < 10 && p.y < all[best][1] - 2.5) {
      fell = `fell off at ${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} (point ${best}/${all.length})`;
      break;
    }
    if (Math.hypot(p.x - end[0], p.z - end[2]) < 8 && p.y < end[1] + 2.5) reached = true;
  }
  const flipped = car.flipped;
  car.dispose();
  if (fell) return fell;
  if (opts.strict && flipAt) return 'rolled over' + flipAt;
  const low = loops.findIndex((lp, k) => tops[k] <= (lp.y ?? 0) + lp.r * 2 - 1.5);
  if (low >= 0) return `did not get over the top of loop ${low + 1} (${tops[low].toFixed(1)} m)`;
  if (!reached) return 'did not reach the end' + flipAt;
  return flipped ? 'flipped at the end' + flipAt : '';
}
