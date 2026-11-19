// Stunts on the railway dyke: jump ramps on top of the tracks, and a Hot Wheels track that
// leaves the tracks, goes round a building next to the railway (with a loop behind it) and
// comes back onto the tracks. Everything is test-driven in the real physics world.
// Run after place-tracks: npx tsx scripts/place-rail-stunts.ts   -> ramps + tracks in overvecht.json
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData, Ramp, Track, Pt } from '../src/game/mapData';
import { RAIL_H, buildDyke } from '../src/game/railway';
import { loopAt, loopExit, type V3 } from '../src/game/loops';
import { buildWorld, loadMapData } from '../tests/world';
import { Car } from '../src/game/car';
import { CARS } from '../src/game/cars';
import { addRampPhysics, addTrackPhysics } from '../src/game/mapPhysics';
import { rampHulls } from '../src/art/rampMeshes';

const DATA = 'public/data/overvecht.json';
const map: MapData = JSON.parse(readFileSync(DATA, 'utf8'));
map.ramps = (map.ramps ?? []).filter((r) => r.kind !== 'rail'); // safe to run again
map.tracks = (map.tracks ?? []).filter((t) => t.id !== 'railLoop'); // (keeps the other scripts' tracks)

const LR = 7, LD = 8.5; // loop radius and sideways offset (as the other tracks)
const inMap = (x: number, z: number) => Math.abs(x) < 680 && Math.abs(z) < 680;

// ---- straight stretches of track on the dyke (not on a railway bridge, away from openings)
const dyke = buildDyke(JSON.parse(JSON.stringify(map)));
type Straight = { ax: number; az: number; ux: number; uz: number; len: number };
const straights: Straight[] = [];
for (const r of map.rails) {
  if (r.bridge) continue;
  let i = 0;
  while (i < r.pts.length - 1) {
    const [ax, az] = r.pts[i];
    const a0 = Math.atan2(r.pts[i + 1][1] - az, r.pts[i + 1][0] - ax);
    let j = i + 1;
    while (j < r.pts.length - 1 && Math.abs(Math.atan2(r.pts[j + 1][1] - r.pts[j][1], r.pts[j + 1][0] - r.pts[j][0]) - a0) < 0.03) j++;
    const [bx, bz] = r.pts[j], len = Math.hypot(bx - ax, bz - az);
    if (len > 20) straights.push({ ax, az, ux: (bx - ax) / len, uz: (bz - az) / len, len });
    i = j;
  }
}
// OSM splits the railway into many ways: join straights that continue each other.
for (let merged = true; merged; ) {
  merged = false;
  for (const a of straights)
    for (const b of straights) {
      if (a === b || a.ux * b.ux + a.uz * b.uz < 0.9995) continue;
      const ex = a.ax + a.ux * a.len, ez = a.az + a.uz * a.len;
      if (Math.hypot(ex - b.ax, ez - b.az) > 1.5) continue;
      const fx = b.ax + b.ux * b.len, fz = b.az + b.uz * b.len, len = Math.hypot(fx - a.ax, fz - a.az);
      Object.assign(a, { ux: (fx - a.ax) / len, uz: (fz - a.az) / len, len });
      straights.splice(straights.indexOf(b), 1);
      merged = true;
      break;
    }
}
const nearDeck = (x: number, z: number, d: number) =>
  dyke.decks.some((k) => {
    const dx = k.bx - k.ax, dz = k.bz - k.az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - k.ax) * dx + (z - k.az) * dz) / l2));
    return Math.hypot(x - k.ax - dx * t, z - k.az - dz * t) < d;
  });
const clearRun = (s: Straight, a0: number, a1: number) => {
  for (let a = a0; a <= a1; a += 5) {
    const x = s.ax + s.ux * a, z = s.az + s.uz * a;
    if (!inMap(x, z)) return false; // (railway bridge decks are level with the track bed: fine)
  }
  return true;
};
straights.sort((a, b) => b.len - a.len);
console.log(`${straights.length} straights`, straights.map((s) => s.len.toFixed(0)).join(' '));

await RAPIER.init();

// ---- 1. ramps on the tracks
const RL = 8, RH = 1.4, RW = 3.6; // wider rail ramps (4.5, 5.4) flipped the sport car; you line up on the tracks anyway
async function testRamp(r: Ramp) {
  const { world } = await buildWorld({ ...loadMapData(), ramps: [], tracks: [], loops: [] });
  addRampPhysics(world, rampHulls(r));
  const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
  let ok = true;
  for (const id of ['compact', 'sport']) {
    const spec = CARS.find((c) => c.id === id)!;
    const car = new Car(world, spec.stats, spec.dims);
    car.place(r.x - ux * 40, r.z - uz * 40, ux, uz, RAIL_H);
    let maxY = 0, landed = false;
    for (let i = 0; i < 60 * 8; i++) {
      const p = car.body.translation(), q = car.body.rotation();
      const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
      // Keep to the track line.
      const side = (p.x - r.x) * -uz + (p.z - r.z) * ux;
      const ang = Math.atan2(fx * uz - fz * ux, fx * ux + fz * uz) - side * 0.15;
      car.update({ throttle: 1, steer: Math.max(-1, Math.min(1, ang * 3)), handbrake: false }, world.timestep);
      world.step();
      maxY = Math.max(maxY, p.y);
      const along = (p.x - r.x) * ux + (p.z - r.z) * uz;
      if (along > 15 && car.grounded && p.y > RAIL_H - 0.5) landed = true;
      if (along > 100 && car.grounded) break;
      if (along > 160) break;
    }
    const good = maxY > RAIL_H + 2.5 && landed && !car.flipped && car.body.translation().y > RAIL_H - 0.5;
    if (!good) console.log(`  ramp ${r.x},${r.z} ${id}: maxY ${maxY.toFixed(1)} landed ${landed} y ${car.body.translation().y.toFixed(1)} flipped ${car.flipped} grounded ${car.grounded}`);
    ok &&= good;
    car.dispose();
  }
  return ok;
}
const ramps: Ramp[] = [];
for (const s of straights) {
  if (ramps.length >= 4) break;
  for (let a = 45; a + 100 < s.len && ramps.length < 4; a += 60) {
    if (!clearRun(s, a - 45, a + 100)) continue;
    const x = +(s.ax + s.ux * a).toFixed(2), z = +(s.az + s.uz * a).toFixed(2);
    if (ramps.some((r) => Math.hypot(r.x - x, r.z - z) < 180)) continue;
    // Alternate the jumping direction.
    const back = ramps.length % 2 === 1;
    const r: Ramp = { x, z, yaw: +Math.atan2(back ? -s.uz : s.uz, back ? -s.ux : s.ux).toFixed(4), len: RL, h: RH, w: RW, kind: 'rail', y: RAIL_H };
    if (await testRamp(r)) {
      ramps.push(r);
      console.log(`rail ramp ${ramps.length} at ${x},${z}`);
    }
  }
}

// ---- 2. a track round a building beside the railway
type Poly = Pt[];
const segD = (x: number, z: number, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
const inside = (x: number, z: number, p: Poly) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  return c;
};
const polyDist = (x: number, z: number, p: Poly) => {
  if (inside(x, z, p)) return 0;
  let d = Infinity;
  for (let i = 0; i < p.length; i++) d = Math.min(d, segD(x, z, p[i], p[(i + 1) % p.length]));
  return d;
};
/** Catmull-Rom through the control points, every ~3 m. */
function spline(ctrl: Pt[], step = 3): Pt[] {
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]], dense: Pt[] = [];
  for (let i = 1; i < P.length - 2; i++)
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(P[i - 1][0], P[i][0], P[i + 1][0], P[i + 2][0]), f(P[i - 1][1], P[i][1], P[i + 1][1], P[i + 2][1])]);
    }
  dense.push(ctrl[ctrl.length - 1]);
  const out: Pt[] = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    if (acc >= step || i === dense.length - 1) (out.push(dense[i]), (acc = 0));
  }
  return out;
}

async function testTrack(t: Track) {
  const { world } = await buildWorld({ ...loadMapData(), ramps: [], tracks: [], loops: [] });
  addTrackPhysics(world, [t]);
  const p1 = (t.parts[0] as { pts: V3[] }).pts, p2 = (t.parts[2] as { pts: V3[] }).pts;
  const loop = (t.parts[1] as { loop: { x: number; z: number; y?: number } }).loop;
  const all = [...p1, ...p2], end = p2[p2.length - 1];
  const res: string[] = [];
  let ok = true;
  for (const id of ['compact', 'sport']) {
    const spec = CARS.find((c) => c.id === id)!;
    const car = new Car(world, spec.stats, spec.dims);
    const [sx, , sz] = p1[0], [nx, , nz] = p1[2], l = Math.hypot(nx - sx, nz - sz);
    car.place(sx - ((nx - sx) / l) * 25, sz - ((nz - sz) / l) * 25, (nx - sx) / l, (nz - sz) / l, RAIL_H);
    let top = 0, reached = false, fell = false, flipAt = '';
    for (let i = 0; i < 60 * 40; i++) {
      const p = car.body.translation(), q = car.body.rotation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      let best = 0, bd = Infinity;
      for (let k = 0; k < all.length; k++) {
        const d = (all[k][0] - p.x) ** 2 + (all[k][2] - p.z) ** 2 + (all[k][1] - p.y) ** 2;
        if (d < bd) (bd = d), (best = k);
      }
      const tg = all[Math.min(all.length - 1, best + 3)];
      const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
      const ang = Math.atan2(fx * (tg[2] - p.z) - fz * (tg[0] - p.x), fx * (tg[0] - p.x) + fz * (tg[2] - p.z));
      const inLoop = Math.hypot(p.x - loop.x, p.z - loop.z) < 20 && p.y > RAIL_H - 1;
      car.update({ throttle: 1, steer: inLoop || upY < 0.7 ? 0 : Math.max(-1, Math.min(1, ang * 2)), handbrake: false }, world.timestep);
      world.step();
      if (inLoop) top = Math.max(top, p.y);
      if (upY < 0.3 && !inLoop && !flipAt) flipAt = `${p.x.toFixed(0)},${p.y.toFixed(1)},${p.z.toFixed(0)} at point ${best}/${all.length}`;
      if (!inLoop && bd < 100 && p.y < all[best][1] - 2.5) { fell = true; break; }
      if (Math.hypot(p.x - end[0], p.z - end[2]) < 6 && p.y > RAIL_H - 1) { reached = true; break; }
    }
    const good = reached && !fell && !car.flipped && top > RAIL_H + 2 * LR - 1.5;
    res.push(`${id}: reached ${reached} fell ${fell} top ${top.toFixed(1)} flipped ${car.flipped} ${flipAt}`);
    ok &&= good;
    car.dispose();
    if (!good) break;
  }
  return { ok, res: res.join(', ') };
}

const tracks: Track[] = [];
const cands: { t: Track; h: number; label: string }[] = [];
const why: Record<string, number> = {};
const no = (k: string) => (why[k] = (why[k] ?? 0) + 1);
const C = 7; // clearance from the building to the track centre line
for (const s of straights) {
  const nx = -s.uz, nz = s.ux; // one side of the railway (the other: side = -1)
  for (const side of [1, -1]) {
    for (let bi = 0; bi < map.buildings.length; bi++) {
      const b = map.buildings[bi];
      // The building in this railway's frame: along (a) and out to the side (o).
      const ab = b.pts.map(([x, z]) => (x - s.ax) * s.ux + (z - s.az) * s.uz);
      const ob = b.pts.map(([x, z]) => ((x - s.ax) * nx + (z - s.az) * nz) * side);
      const a0 = Math.min(...ab), a1 = Math.max(...ab), o0 = Math.min(...ob), o1 = Math.max(...ob);
      if (o0 < 8 || o0 > 45 || a1 - a0 > 110 || o1 - o0 > 60 || a1 < 0 || a0 > s.len) continue;
      no('near');
      // Frame: start on the track, out past the building's near end, behind it (with the loop),
      // back past its far end and onto the track again.
      const aL = a0 - C - 6;
      const P = (a: number, o: number): Pt => [s.ax + s.ux * a + nx * o * side, s.az + s.uz * a + nz * o * side];
      const dirBack = Math.atan2(s.uz, s.ux);
      // The loop on the straight behind the building; it shifts the track sideways by LD.
      // The loop moves the track sideways by LD: if that is towards the building, start further out.
      let back = o1 + C;
      let loopStart = P(aL + 16, back);
      let loop = loopAt(loopStart[0], loopStart[1], RAIL_H, dirBack, LR, LD);
      let ex = loopExit(loop);
      if (((ex.x - s.ax) * nx + (ex.z - s.az) * nz) * side < back) {
        back += LD;
        loopStart = P(aL + 16, back);
        loop = loopAt(loopStart[0], loopStart[1], RAIL_H, dirBack, LR, LD);
        ex = loopExit(loop);
      }
      const exA = (ex.x - s.ax) * s.ux + (ex.z - s.az) * s.uz, exO = ((ex.x - s.ax) * nx + (ex.z - s.az) * nz) * side;
      if (exO < o1 + C - 0.5) { no('loop swings in'); continue; }
      const aR = Math.max(a1 + C + 6, exA + 14);
      if (aL - 46 < 0 || aR + 46 > s.len || !clearRun(s, aL - 46, aR + 46)) { no('rail run'); if (why['rail run'] < 12) console.log(`   rail run: aL ${aL.toFixed(0)} aR ${aR.toFixed(0)} len ${s.len.toFixed(0)} exA ${exA.toFixed(0)} bld ${a0.toFixed(0)}..${a1.toFixed(0)}`); continue; }
      const path1 = spline([P(aL - 44, 0), P(aL - 32, 0), P(aL - 20, 0.5), P(aL - 8, 5), P(aL - 1, 14), P(aL + 3, back - 9), P(aL + 7, back - 1.5), P(aL + 12, back), loopStart]);
      const path2 = spline([[ex.x, ex.z], P(exA + 4, exO), P(aR - 3, exO - 2), P(aR, exO - 10), P(aR + 1, 14), P(aR + 8, 5), P(aR + 20, 0.5), P(aR + 32, 0), P(aR + 44, 0)]);
      // Clear of every other building, inside the map, not over water near the loop posts.
      const pts = [...path1, ...path2];
      let clear = pts.every(([x, z]) => inMap(x, z));
      for (let k = 0; clear && k < map.buildings.length; k++) {
        const o = map.buildings[k];
        if (Math.abs(o.pts[0][0] - pts[0][0]) > 300 || Math.abs(o.pts[0][1] - pts[0][1]) > 300) continue;
        if (k !== bi && o.h < RAIL_H - 1.2) continue; // low sheds and garages: the track passes over them
        const need = k === bi ? C - 2 : 4;
        if (pts.some(([x, z]) => polyDist(x, z, o.pts) < need)) clear = false;
        const lc: Pt[] = [[loop.x, loop.z], [ex.x, ex.z]];
        if (k !== bi && lc.some(([x, z]) => polyDist(x, z, o.pts) < LR + 2)) clear = false;
      }
      if (!clear) { no('blocked'); if (why.blocked < 10) console.log(`   blocked: bld ${bi} h ${b.h}`); continue; }
      const y = (p: Pt): V3 => [+p[0].toFixed(2), RAIL_H, +p[1].toFixed(2)];
      const t: Track = {
        id: 'railLoop', name: 'Spoorlus', free: true, through: [],
        parts: [{ kind: 'path', pts: path1.map(y) }, { kind: 'loop', loop: { ...loop, x: +loop.x.toFixed(2), z: +loop.z.toFixed(2), yaw: +loop.yaw.toFixed(4) } }, { kind: 'path', pts: path2.map(y) }],
      };
      // Not on top of a rail ramp.
      if (ramps.some((r) => pts.some(([x, z]) => Math.hypot(x - r.x, z - r.z) < 25))) continue;
      cands.push({ t, h: b.h, label: `building ${bi} (h ${b.h}) at ${P((a0 + a1) / 2, (o0 + o1) / 2).map((v) => v.toFixed(0))}` });
    }
  }
}

cands.sort((a, b) => b.h - a.h);
console.log(`${cands.length} track candidates`);
for (const c of cands.slice(0, 15)) {
  const { ok, res } = await testTrack(c.t);
  console.log(`track round ${c.label}: ${res}`);
  if (ok) {
    tracks.push(c.t);
    break;
  }
}
map.ramps.push(...ramps);
map.tracks.push(...tracks);
console.log(`${ramps.length} rail ramps, ${tracks.length} rail track`, JSON.stringify(why));
writeFileSync(DATA, JSON.stringify(map));
