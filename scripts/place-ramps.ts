// Finds good spots for jump ramps and stores them in public/data/overvecht.json (`ramps`):
//  - water ramps: a ramp on one bank, a 7-20 m jump over a canal or pond, a free landing beyond;
//  - roof ramps: a ramp against a long flat-roofed low building, so you can drive up onto the roof.
// Each needs a long free run-up (no buildings, trees, hedges, water or railway).
// Run after the other data steps: npx tsx scripts/place-ramps.ts
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData, Pt, Ramp, Loop } from '../src/game/mapData';
import { placeScenery } from '../src/game/scenery';
import { buildWorld, loadMapData } from '../tests/world';
import { Car } from '../src/game/car';
import { CARS } from '../src/game/cars';
import { rampHulls } from '../src/art/rampMeshes';
import { loopSections, loopEntry, LOOP_W } from '../src/game/loops';

const DATA = 'public/data/overvecht.json';
const map: MapData = JSON.parse(readFileSync(DATA, 'utf8'));
const { trees, grid } = placeScenery(map);

// ---- 1 m rasters: water, buildings, obstacles
const H = 760, N = H * 2;
const idx = (x: number, z: number) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
const water = new Uint8Array(N * N), solid = new Uint8Array(N * N);
const fillPoly = (pts: Pt[], arr: Uint8Array, v = 1) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
  for (let z = Math.floor(z0); z <= z1; z++)
    for (let x = Math.floor(x0); x <= x1; x++) {
      const cx = x + 0.5, cz = z + 0.5;
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if (pts[i][1] > cz !== pts[j][1] > cz && cx < ((pts[j][0] - pts[i][0]) * (cz - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
      const k = idx(cx, cz);
      if (c && k >= 0) arr[k] = v;
    }
};
const fillLine = (a: Pt, b: Pt, hw: number, arr: Uint8Array) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let d = 0; d <= len; d += 0.5) {
    const x = a[0] + ((b[0] - a[0]) * d) / (len || 1), z = a[1] + ((b[1] - a[1]) * d) / (len || 1);
    for (let dz = -hw; dz <= hw; dz += 0.5) for (let dx = -hw; dx <= hw; dx += 0.5) if (dx * dx + dz * dz <= hw * hw) { const k = idx(x + dx, z + dz); if (k >= 0) arr[k] = 1; }
  }
};
for (const { pts } of map.water) fillPoly(pts, water);
for (const w of map.waterways) for (let i = 0; i < w.pts.length - 1; i++) fillLine(w.pts[i], w.pts[i + 1], w.width / 2, water);
for (const b of map.buildings) fillPoly(b.pts, solid);
for (const t of trees) fillLine([t.x, t.z], [t.x, t.z], 1.5, solid);
for (const h of map.hedges ?? []) for (let i = 0; i < h.pts.length - 1; i++) fillLine(h.pts[i], h.pts[i + 1], 1, solid);
for (const r of map.rails) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], 14, solid); // dyke
for (const p of map.playgrounds) fillPoly(p.pts, solid);
const at = (arr: Uint8Array, x: number, z: number) => { const k = idx(x, z); return k < 0 ? 1 : arr[k]; };
/** Is a strip (width w) from (x,z) along (ux,uz) for len metres free of `arr`? */
const free = (x: number, z: number, ux: number, uz: number, len: number, w: number, arr: Uint8Array) => {
  for (let d = 0; d <= len; d += 1) for (let s = -w / 2; s <= w / 2; s += 1) if (at(arr, x + ux * d - uz * s, z + uz * d + ux * s)) return false;
  return true;
};
const onRoad = (x: number, z: number) => grid.edgeDistance(x, z) < 0.5;
// Streets cars drive on (footpaths and cycle paths may pass under a ramp's run-up, not streets).
const street = new Uint8Array(N * N);
for (const r of map.roads) if (r.drivable && !r.tunnel) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], r.width / 2 + 0.5, street);
/** Would a ramp of length len (from (x,z) along (ux,uz), width w) stand on a street anywhere? */
const rampOnRoad = (x: number, z: number, ux: number, uz: number, len: number, w: number) => !free(x, z, ux, uz, len, w + 1, street);
const inMap = (x: number, z: number) => Math.abs(x) < 700 && Math.abs(z) < 700;

const ramps: Ramp[] = [];
const far = (x: number, z: number, d: number) => ramps.every((r) => Math.hypot(r.x - x, r.z - z) > d);

// ---- water ramps
const WL = 7, WH = 1.6, W = 6; // W was 4; 50% wider is easier to hit
const cands: (Ramp & { score: number })[] = [];
for (let z = -H + 40; z < H - 40; z += 4)
  for (let x = -H + 40; x < H - 40; x += 4) {
    if (at(water, x, z) || at(solid, x, z)) continue;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
      // The lip is at (x, z); water must start within 3 m ahead.
      let t1 = -1;
      for (let d = 0.5; d <= 3; d += 0.5) if (at(water, x + ux * d, z + uz * d)) { t1 = d; break; }
      if (t1 < 0) continue;
      let t2 = -1;
      for (let d = t1; d <= 24; d += 0.5) if (!at(water, x + ux * d, z + uz * d)) { t2 = d; break; }
      if (t2 < 0 || t2 < 8 || t2 > 21) continue;
      // Landing: 25 m free beyond the far bank; run-up: ramp + 40 m free behind the lip.
      if (!free(x + ux * (t2 + 1), z + uz * (t2 + 1), ux, uz, 25, W, water) || !free(x + ux * (t2 + 1), z + uz * (t2 + 1), ux, uz, 25, W, solid)) continue;
      if (!free(x, z, -ux, -uz, WL + 40, W, water) || !free(x, z, -ux, -uz, WL + 40, W, solid)) continue;
      // The ramp itself must not stand on a road.
      const cx = x - ux * (WL / 2), cz = z - uz * (WL / 2);
      if (rampOnRoad(x - ux * WL, z - uz * WL, ux, uz, WL, W)) continue;
      if (!inMap(x - ux * (WL + 40), z - uz * (WL + 40)) || !inMap(x + ux * (t2 + 26), z + uz * (t2 + 26))) continue;
      cands.push({ x: cx, z: cz, yaw: a, len: WL, h: WH, w: W, kind: 'water', score: -Math.abs(t2 - 14) });
    }
  }
cands.sort((a, b) => b.score - a.score);
for (const c of cands) {
  const nWater = ramps.filter((r) => r.kind === 'water').length;
  if (nWater >= 20) break;
  if (!far(c.x, c.z, nWater < 10 ? 140 : 80)) continue; // the first 10 are spread out; extras (to build) fill in
  const { score: _s, ...r } = c;
  ramps.push(r);
}

// ---- kickers: a short steep ramp a few metres in front of a low flat-roofed building, to
// jump up onto its roof. Every candidate is test-driven in the real physics world with a slow
// and a fast car; only kickers where the starter car lands on the roof are kept.
const KL = 5, KH = 2.0;
const kickCands: (Ramp & { score: number; wall: string })[] = [];
for (const b of map.buildings) {
  if (b.eave || b.church || b.h < 2.8 || b.h > 6.5) continue;
  const pts = b.pts;
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  if (Math.abs(area / 2) < 120) continue;
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 12) continue;
    const nx = (sign * (bz - az)) / len, nz = (sign * -(bx - ax)) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let roof = 0;
    for (let d = 1; d < 60; d++) { if (!at(solid, mx - nx * d, mz - nz * d)) break; roof = d; }
    if (roof < 14) continue;
    for (const gap of [6, 7, 8, 9, 10, 11, 12]) {
      const lx = mx + nx * gap, lz = mz + nz * gap; // the kicker's lip
      if (!free(mx + nx * 0.8, mz + nz * 0.8, nx, nz, gap + KL + 38, W, solid) || !free(mx, mz, nx, nz, gap + KL + 38, W, water)) continue;
      const cx = lx + nx * (KL / 2), cz = lz + nz * (KL / 2);
      if (rampOnRoad(lx, lz, nx, nz, KL, W)) continue;
      if (!inMap(lx + nx * (KL + 38), lz + nz * (KL + 38))) continue;
      for (const kh of [KH, 2.6]) kickCands.push({ x: cx, z: cz, yaw: Math.atan2(-nz, -nx), len: KL, h: kh, w: W, kind: 'kick', roofH: b.h, score: roof - Math.abs(gap - 9) * 0.1, wall: `${mx},${mz}` });
    }
  }
}
kickCands.sort((a, b) => b.score - a.score);
await RAPIER.init();
let { world } = await buildWorld({ ...loadMapData(), ramps: [], loops: [] });
let rampBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
/** Drives a car (full throttle, steering straight) at a ramp; true if it ends up on the roof. */
function landsOnRoof(r: Ramp, carId: string) {
  const spec = CARS.find((c) => c.id === carId)!;
  const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
  const cols = rampHulls(r).map((h) => world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(h.flat()))!.setFriction(1), rampBody));
  const car = new Car(world, spec.stats, spec.dims);
  car.place(r.x - ux * (r.len / 2 + 36), r.z - uz * (r.len / 2 + 36), ux, uz);
  let ok = false;
  for (let i = 0; i < 60 * 9; i++) {
    const p = car.body.translation(), q = car.body.rotation();
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
    const ang = Math.atan2(fx * uz - fz * ux, fx * ux + fz * uz);
    car.update({ throttle: 1, steer: Math.max(-1, Math.min(1, ang * 3)), handbrake: false }, world.timestep);
    world.step();
    const along = (p.x - r.x) * ux + (p.z - r.z) * uz;
    if (process.env.DEBUG_KICK && i % 6 === 0 && along > -10) console.log(carId, along.toFixed(1), p.y.toFixed(2), car.speed.toFixed(1));
    // Landed: wheels touching something well above the ground, upright, past the wall.
    let contact = 0;
    for (let w = 0; w < 4; w++) if (car.vehicle.wheelIsInContact(w)) contact++;
    if (contact >= 3 && p.y > r.roofH! + 0.3 && along > r.len / 2 + 4 && !car.flipped) { ok = true; break; }
    if (along > r.len / 2 + 60 || (p.y < 1.5 && along > r.len / 2 + 2)) break; // fell short, hit the wall or flew over
  }
  car.dispose();
  for (const col of cols) world.removeCollider(col, false);
  return ok;
}
let tried = 0;
const usedWalls = new Set<string>();
for (const c of kickCands) {
  if (ramps.filter((r) => r.kind === 'kick').length >= 8) break;
  if (usedWalls.has(c.wall) || !far(c.x, c.z, 30)) continue;
  const { score: _s, wall, ...r } = c;
  tried++;
  // The starter car must make it at full throttle; faster cars can ease off, slower ones may need upgrades.
  if (landsOnRoof(r, 'compact')) {
    ramps.push(r);
    usedWalls.add(wall);
    console.log('kicker', r.x.toFixed(0), r.z.toFixed(0), 'roof', r.roofH, 'kicker', r.h, 'minivan', landsOnRoof(r, 'minivan'), 'hyper', landsOnRoof(r, 'hyper'));
  }
}
console.log(`kickers: ${kickCands.length} candidates, ${tried} test-driven`);

// ---- roof ramps: flat roofs 3-8 m high, a long wall with open ground in front of it
const roofCands: (Ramp & { score: number })[] = [];
for (const b of map.buildings) {
  if (b.eave || b.church || b.h < 2.8 || b.h > 12) continue;
  const pts = b.pts;
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  if (Math.abs(area / 2) < 100) continue;
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 8) continue;
    // Outward normal and the middle of the wall.
    const nx = (sign * (bz - az)) / len, nz = (sign * -(bx - ax)) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const L = Math.max(8, b.h * 3.3);
    // The roof must continue a good way past the wall (so you don't fly off straight away).
    let roof = 0;
    for (let d = 1; d < 40; d++) { if (!at(solid, mx - nx * d, mz - nz * d)) break; roof = d; }
    if (roof < 8) continue;
    const sx = mx + nx * 0.6, sz = mz + nz * 0.6; // ramp top lip, against the wall
    if (!free(sx + nx * 0.5, sz + nz * 0.5, nx, nz, L + 28, W, solid) || !free(sx, sz, nx, nz, L + 28, W, water)) continue;
    const cx = sx + nx * (L / 2), cz = sz + nz * (L / 2);
    if (rampOnRoad(sx, sz, nx, nz, L, W)) continue;
    if (!inMap(sx + nx * (L + 28), sz + nz * (L + 28)) || !inMap(mx - nx * roof, mz - nz * roof)) continue;
    roofCands.push({ x: cx, z: cz, yaw: Math.atan2(-nz, -nx), len: L, h: b.h + 0.15, w: W, kind: 'roof', score: roof + len / 2 });
  }
}
roofCands.sort((a, b) => b.score - a.score);
console.log(`roof ramps: ${roofCands.length} candidates`);
for (const c of roofCands) {
  if (ramps.filter((r) => r.kind === 'roof').length >= 18) break;
  if (!far(c.x, c.z, 35)) continue;
  const { score: _s, ...r } = c;
  ramps.push(r);
}
// ---- loops: open, flat ground with a long free run-up into the loop and room to come out.
const loops: Loop[] = [];
const LR = 7, LD = 8.5;
const loopOk = (l: Loop) => {
  const secs = loopSections(l);
  // The loop and its straights: no buildings, trees, water or roads under them.
  for (const { p, side } of secs) {
    if (p[1] > 6) continue;
    for (let a = -LOOP_W / 2 - 1; a <= LOOP_W / 2 + 1; a += 1) {
      const x = p[0] + side[0] * a, z = p[2] + side[2] * a;
      if (!inMap(x, z) || at(solid, x, z) || at(water, x, z) || grid.edgeDistance(x, z) < 1.5) return false;
    }
  }
  const e = loopEntry(l);
  // 50 m run-up (roads are fine here) and 25 m beyond the exit.
  if (!free(e.x - e.dirX, e.z - e.dirZ, -e.dirX, -e.dirZ, 50, LOOP_W, solid) || !free(e.x, e.z, -e.dirX, -e.dirZ, 50, LOOP_W, water)) return false;
  const end = secs[secs.length - 1].p;
  if (!free(end[0], end[2], e.dirX, e.dirZ, 25, LOOP_W, solid) || !free(end[0], end[2], e.dirX, e.dirZ, 25, LOOP_W, water)) return false;
  return inMap(e.x - e.dirX * 50, e.z - e.dirZ * 50) && inMap(end[0] + e.dirX * 25, end[2] + e.dirZ * 25);
};
for (let z = -H + 60; z < H - 60 && loops.length < 8; z += 10)
  for (let x = -H + 60; x < H - 60 && loops.length < 8; x += 10) {
    if (at(solid, x, z) || at(water, x, z)) continue;
    if (!far(x, z, 120) || loops.some((l) => Math.hypot(l.x - x, l.z - z) < 220)) continue;
    for (let k = 0; k < 12; k++) {
      const l = { x, z, yaw: (k / 12) * Math.PI * 2, r: LR, d: LD };
      if (loopOk(l)) { loops.push(l); break; }
    }
  }
// The first loops are there from the start; the others can be built in the game (one each).
loops.forEach((l, i) => { if (i >= 4) l.build = `loop${i + 1}`; });
for (const l of loops) for (const k of ['x', 'z', 'yaw'] as const) l[k] = +l[k].toFixed(2);
(map as MapData).loops = loops;

// Final check with everything in place: a ramp placed later may stand in a kicker's way.
({ world } = await buildWorld({ ...loadMapData(), ramps, loops }));
rampBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
for (const r of [...ramps]) {
  if (r.kind !== 'kick' || landsOnRoof(r, 'compact')) continue;
  console.log('dropped kicker', r.x.toFixed(0), r.z.toFixed(0), '(blocked by another ramp)');
  ramps.splice(ramps.indexOf(r), 1);
}
console.log(`${loops.length} loops`);
for (const l of loops) console.log('loop', l.x, l.z, ((l.yaw * 180) / Math.PI).toFixed(0));

// Extra ramps can be built in the game, one group per quarter of the map: the first 10 water
// ramps, the first 8 roof ramps and all kickers are there from the start.
{
  const quarter = (r: Ramp) => `ramps${r.z < 0 ? 'N' : 'S'}${r.x < 0 ? 'W' : 'E'}`;
  let w = 0, rf = 0;
  for (const r of ramps) {
    if (r.kind === 'water' && w++ >= 10) r.build = quarter(r);
    if (r.kind === 'roof' && rf++ >= 8) r.build = quarter(r);
  }
  console.log('to build:', JSON.stringify(Object.entries(ramps.reduce((m, r) => (r.build ? { ...m, [r.build]: (m[r.build] ?? 0) + 1 } : m), {} as Record<string, number>))));
}
for (const r of ramps) for (const k of ['x', 'z', 'yaw', 'len', 'h'] as const) r[k] = +r[k].toFixed(2);
(map as MapData & { ramps: Ramp[] }).ramps = ramps;
console.log(`${ramps.filter((r) => r.kind === 'water').length} water ramps, ${ramps.filter((r) => r.kind === 'roof').length} roof ramps, ${ramps.filter((r) => r.kind === 'kick').length} kickers`);
for (const r of ramps) console.log(r.kind, r.x, r.z, ((r.yaw * 180) / Math.PI).toFixed(0), r.h);
// Don't save the in-memory lod3d typed arrays.
delete (map as Partial<MapData>).lod3d;
writeFileSync(DATA, JSON.stringify(map));
