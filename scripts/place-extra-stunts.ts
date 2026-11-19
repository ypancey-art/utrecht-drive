// More stunts on top of what place-ramps / place-tracks / place-rail-stunts made:
//  - jump: free-standing kickers on open grass beside the streets (land on the grass);
//  - gap: ramp pairs, a take-off ramp and a landing ramp across a gap (over a canal if possible);
//  - more water jumps, roof ramps and kickers, and a couple more loops.
// Everything is test-driven with the compact and the sport in the full physics world (the same
// drive as tests/world.test.ts), and checked again at the end with everything in place.
// Extra items carry `extra: true`, so this script can be run again (it replaces them).
// Run last (after place-rail-stunts): npx tsx scripts/place-extra-stunts.ts
// Note: place-ramps.ts rewrites all ramps and loops, so run this again after it.
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData, Pt, Ramp, Loop } from '../src/game/mapData';
import { placeScenery } from '../src/game/scenery';
import { buildWorld, loadMapData, driveRamp, driveLoop, rampRunUp } from '../tests/world';
import { rampHulls } from '../src/art/rampMeshes';
import { addLoopPhysics } from '../src/game/mapPhysics';
import { loopSections, loopEntry, LOOP_W } from '../src/game/loops';

const DATA = 'public/data/overvecht.json';
const map: MapData = JSON.parse(readFileSync(DATA, 'utf8'));
map.ramps = (map.ramps ?? []).filter((r) => !r.extra); // safe to run again
map.loops = (map.loops ?? []).filter((l) => !l.extra);
const before = { ramps: map.ramps.length, loops: map.loops.length };
const { trees, grid } = placeScenery(map);

// ---- 1 m rasters: water, obstacles, streets
const H = 760, N = H * 2;
const idx = (x: number, z: number) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
const water = new Uint8Array(N * N), solid = new Uint8Array(N * N), street = new Uint8Array(N * N), treeR = new Uint8Array(N * N);
const fillPoly = (pts: Pt[], arr: Uint8Array) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
  for (let z = Math.floor(z0); z <= z1; z++)
    for (let x = Math.floor(x0); x <= x1; x++) {
      const cx = x + 0.5, cz = z + 0.5;
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if (pts[i][1] > cz !== pts[j][1] > cz && cx < ((pts[j][0] - pts[i][0]) * (cz - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
      const k = idx(cx, cz);
      if (c && k >= 0) arr[k] = 1;
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
for (const t of trees) fillLine([t.x, t.z], [t.x, t.z], 1.5, treeR);
for (const h of map.hedges ?? []) for (let i = 0; i < h.pts.length - 1; i++) fillLine(h.pts[i], h.pts[i + 1], 1, solid);
for (const r of map.rails) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], 14, solid); // dyke
for (const p of map.playgrounds) fillPoly(p.pts, solid);
// Hot Wheels tracks (and their posts) and the existing loops are in the way too.
for (const t of map.tracks ?? []) for (const part of t.parts) {
  if (part.kind === 'path') for (let i = 0; i < part.pts.length - 1; i++) fillLine([part.pts[i][0], part.pts[i][2]], [part.pts[i + 1][0], part.pts[i + 1][2]], 5, solid);
  else for (const s of loopSections(part.loop)) fillLine([s.p[0], s.p[2]], [s.p[0], s.p[2]], 5, solid);
}
const markLoop = (l: Loop) => {
  for (const s of loopSections(l)) fillLine([s.p[0], s.p[2]], [s.p[0], s.p[2]], LOOP_W / 2 + 2, solid);
};
for (const l of map.loops) markLoop(l);
for (const r of map.roads) if (r.drivable && !r.tunnel) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], r.width / 2 + 0.5, street);
const at = (arr: Uint8Array, x: number, z: number) => { const k = idx(x, z); return k < 0 ? 1 : arr[k]; };
/** Is a strip (width w) from (x,z) along (ux,uz) for len metres free of `arr`? */
const free = (x: number, z: number, ux: number, uz: number, len: number, w: number, arr: Uint8Array) => {
  for (let d = 0; d <= len; d += 1) for (let s = -w / 2; s <= w / 2; s += 1) if (at(arr, x + ux * d - uz * s, z + uz * d + ux * s)) return false;
  return true;
};
// Trees are checked for the jumps; roof ramps and kickers are test-driven past them instead.
const clear = (x: number, z: number, ux: number, uz: number, len: number, w: number, trees = true) => free(x, z, ux, uz, len, w, solid) && free(x, z, ux, uz, len, w, water) && (!trees || free(x, z, ux, uz, len, w, treeR));
const inMap = (x: number, z: number) => Math.abs(x) < 690 && Math.abs(z) < 690;
/** The ground a ramp stands on (curved toe included): no street, building, tree or water under it. */
const footOk = (lx: number, lz: number, ux: number, uz: number, len: number, w: number) => {
  const foot = len + 3;
  const fx = lx - ux * foot, fz = lz - uz * foot;
  return free(fx, fz, ux, uz, foot, w + 1, street) && clear(fx, fz, ux, uz, foot, w + 1);
};

// Distance (m) to the nearest street, for "street-side" spots you can swerve into from the road.
const streetDist = new Float32Array(N * N).fill(1e9);
for (let k = 0; k < N * N; k++) if (street[k]) streetDist[k] = 0;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const k = j * N + i;
  if (i) streetDist[k] = Math.min(streetDist[k], streetDist[k - 1] + 1);
  if (j) streetDist[k] = Math.min(streetDist[k], streetDist[k - N] + 1);
}
for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
  const k = j * N + i;
  if (i < N - 1) streetDist[k] = Math.min(streetDist[k], streetDist[k + 1] + 1);
  if (j < N - 1) streetDist[k] = Math.min(streetDist[k], streetDist[k + N] + 1);
}
const distToStreet = (x: number, z: number) => { const k = idx(x, z); return k < 0 ? 1e9 : streetDist[k]; };

// ---- the physics world (with all existing ramps, loops and tracks), for test drives
await RAPIER.init();
const w = await buildWorld({ ...loadMapData(), ramps: map.ramps, loops: map.loops });
const { world } = w;
const rampBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const addCols = (rs: Ramp[]) => rs.flatMap(rampHulls).map((h) => world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(h.flat()))!.setFriction(1), rampBody));
const removeCols = (cols: RAPIER.Collider[]) => { for (const c of cols) world.removeCollider(c, false); };
/** Test-drives a ramp (and its landing ramp) with the compact and (except kickers) the sport. */
const works = (rs: Ramp[]) => {
  const cols = addCols(rs);
  const ok = rs.every((r) => !driveRamp(w, r, 'compact') && (r.kind === 'kick' || !driveRamp(w, r, 'sport')));
  if (!ok) removeCols(cols);
  return ok;
};

const extras: Ramp[] = [];
const all = () => [...map.ramps!, ...extras];
const far = (x: number, z: number, d: number) => all().every((r) => Math.hypot(r.x - x, r.z - z) > d) && map.loops!.every((l) => Math.hypot(l.x - x, l.z - z) > 45);
/** Marks a placed ramp's run-up and landing as taken, so later ramps keep out of the way. */
const reserve = (r: Ramp, ahead: number) => {
  const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
  const run = rampRunUp(r);
  fillLine([r.x - ux * run, r.z - uz * run], [r.x + ux * ahead, r.z + uz * ahead], 3, solid);
};
type Cand = { rs: Ramp[]; score: number; ahead: number };
/** Greedy: best candidates first, spread out, each one test-driven before it is kept. */
function pick(name: string, cands: Cand[], want: number, spacing: number, sameSpacing: number, maxTries = 80) {
  cands.sort((a, b) => b.score - a.score);
  let got = 0, tried = 0;
  for (const c of cands) {
    if (got >= want || tried >= maxTries) break;
    const r0 = c.rs[0];
    if (!far(r0.x, r0.z, spacing) || !extras.filter((e) => e.kind === r0.kind).every((e) => Math.hypot(e.x - r0.x, e.z - r0.z) > sameSpacing)) continue;
    // Still free (an earlier pick may have reserved this ground)?
    const ux = Math.cos(r0.yaw), uz = Math.sin(r0.yaw), lx = r0.x + (ux * r0.len) / 2, lz = r0.z + (uz * r0.len) / 2;
    if (r0.kind !== 'roof' && r0.kind !== 'kick' && !free(lx - ux * (rampRunUp(r0) + r0.len / 2), lz - uz * (rampRunUp(r0) + r0.len / 2), ux, uz, rampRunUp(r0) + r0.len / 2 + c.ahead, 4, solid)) continue;
    tried++;
    const rs = c.rs.map((r) => ({ ...r, extra: true }));
    if (!works(rs)) continue;
    extras.push(...rs);
    reserve(rs[0], c.ahead);
    got++;
    console.log(name, rs.map((r) => `${r.kind} ${r.x.toFixed(0)},${r.z.toFixed(0)}`).join(' + '));
  }
  console.log(`${name}: ${got} placed (${cands.length} candidates, ${tried} test-driven)`);
}

const W = 4;
// ---- more roof ramps (as in place-ramps.ts)
{
  const cands: Cand[] = [];
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
      const nx = (sign * (bz - az)) / len, nz = (sign * -(bx - ax)) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const L = Math.max(8, b.h * 3.3);
      let roof = 0;
      for (let d = 1; d < 40; d++) { if (!at(solid, mx - nx * d, mz - nz * d)) break; roof = d; }
      if (roof < 8) continue;
      const sx = mx + nx * 0.6, sz = mz + nz * 0.6;
      if (!clear(sx + nx * 0.5, sz + nz * 0.5, nx, nz, L + 28, W, false) || !free(sx, sz, nx, nz, L + 3, W + 1, street)) continue;
      if (!inMap(sx + nx * (L + 28), sz + nz * (L + 28)) || !inMap(mx - nx * roof, mz - nz * roof)) continue;
      cands.push({ rs: [{ x: sx + nx * (L / 2), z: sz + nz * (L / 2), yaw: Math.atan2(-nz, -nx), len: L, h: b.h + 0.15, w: W, kind: 'roof' }], score: roof + len / 2, ahead: 0 });
    }
  }
  pick('roof', cands, 5, 35, 60);
}

// ---- more kickers onto low flat roofs (as in place-ramps.ts; the compact must land on the roof)
{
  const KL = 5;
  const cands: Cand[] = [];
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
      for (const gap of [8, 10, 6, 12]) {
        const lx = mx + nx * gap, lz = mz + nz * gap;
        if (!clear(mx + nx * 0.8, mz + nz * 0.8, nx, nz, gap + KL + 38, W, false) || !free(lx, lz, nx, nz, KL + 3, W + 1, street)) continue;
        if (!inMap(lx + nx * (KL + 38), lz + nz * (KL + 38))) continue;
        cands.push({ rs: [{ x: lx + nx * (KL / 2), z: lz + nz * (KL / 2), yaw: Math.atan2(-nz, -nx), len: KL, h: b.h > 4.5 ? 2.6 : 2.0, w: W, kind: 'kick', roofH: b.h }], score: roof - Math.abs(gap - 9) * 0.1, ahead: 0 });
        break;
      }
    }
  }
  pick('kick', cands, 3, 30, 60, 40);
}

// ---- more water jumps (as in place-ramps.ts)
{
  const WL = 7, WH = 1.6;
  const cands: Cand[] = [];
  for (let z = -H + 40; z < H - 40; z += 4)
    for (let x = -H + 40; x < H - 40; x += 4) {
      if (at(water, x, z) || at(solid, x, z)) continue;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
        let t1 = -1;
        for (let d = 0.5; d <= 3; d += 0.5) if (at(water, x + ux * d, z + uz * d)) { t1 = d; break; }
        if (t1 < 0) continue;
        let t2 = -1;
        for (let d = t1; d <= 24; d += 0.5) if (!at(water, x + ux * d, z + uz * d)) { t2 = d; break; }
        if (t2 < 0 || t2 < 7 || t2 > 20) continue;
        if (!clear(x + ux * (t2 + 1), z + uz * (t2 + 1), ux, uz, 25, W)) continue;
        if (!clear(x, z, -ux, -uz, WL + 40, W) || !footOk(x, z, ux, uz, WL, W)) continue;
        if (!inMap(x - ux * (WL + 40), z - uz * (WL + 40)) || !inMap(x + ux * (t2 + 26), z + uz * (t2 + 26))) continue;
        cands.push({ rs: [{ x: x - ux * (WL / 2), z: z - uz * (WL / 2), yaw: a, len: WL, h: WH, w: W, kind: 'water' }], score: -Math.abs(t2 - 13), ahead: t2 + 25 });
      }
    }
  pick('water', cands, 10, 50, 55);
}

// ---- ramp pairs: take-off ramp, a gap (grass or a canal), and a landing ramp facing back
{
  const TL = 7, TH = 1.8, LL = 10, LH = 1.6;
  const cands: Cand[] = [];
  for (let z = -H + 50; z < H - 50; z += 5)
    for (let x = -H + 50; x < H - 50; x += 5) {
      if (at(water, x, z) || at(solid, x, z) || at(street, x, z)) continue;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
        if (!footOk(x, z, ux, uz, TL, W) || !clear(x, z, -ux, -uz, TL + 40, W + 1)) continue;
        for (const G of [12, 14, 10]) {
          // The gap: nothing solid in it; water is the best gap of all.
          if (!free(x, z, ux, uz, G, W + 2, solid)) continue;
          const gx = x + ux * G, gz = z + uz * G; // the landing ramp's lip
          if (!footOk(gx, gz, -ux, -uz, LL, W)) continue;
          const ex = gx + ux * (LL + 3), ez = gz + uz * (LL + 3);
          if (!clear(ex, ez, ux, uz, 28, W + 2) || !inMap(ex + ux * 28, ez + uz * 28) || !inMap(x - ux * (TL + 40), z - uz * (TL + 40))) continue;
          let wet = 0;
          for (let d = 1; d < G; d++) if (at(water, x + ux * d, z + uz * d)) wet++;
          if (wet && (at(water, x + ux, z + uz) || at(water, gx - ux, gz - uz))) continue; // dry banks either side
          const near = distToStreet(x - ux * (TL + 30), z - uz * (TL + 30));
          cands.push({
            rs: [
              { x: x - ux * (TL / 2), z: z - uz * (TL / 2), yaw: a, len: TL, h: TH, w: W, kind: 'gap' },
              { x: gx + ux * (LL / 2), z: gz + uz * (LL / 2), yaw: a + Math.PI, len: LL, h: LH, w: W, kind: 'land' },
            ],
            score: (wet > 4 ? 20 : 0) + G * 0.3 - Math.min(20, near) * 0.2,
            ahead: G + LL + 30,
          });
          break;
        }
      }
    }
  pick('gap', cands, 5, 80, 120);
}

// ---- street-side kickers on open grass: swerve off the street, jump, land on the grass
{
  const sizes = [{ len: 6, h: 1.5 }, { len: 7.5, h: 2.1 }];
  const cands: Cand[] = [];
  for (let z = -H + 50; z < H - 50; z += 5)
    for (let x = -H + 50; x < H - 50; x += 5) {
      if (at(water, x, z) || at(solid, x, z) || at(street, x, z)) continue;
      const ds = distToStreet(x, z);
      if (ds < 4 || ds > 25) continue;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
        for (const [si, s] of sizes.entries()) {
          if (!footOk(x, z, ux, uz, s.len, W) || !clear(x, z, -ux, -uz, s.len + 40, W + 1)) continue;
          if (!clear(x, z, ux, uz, 42, W + 3) || !free(x, z, ux, uz, 30, W + 2, street)) continue; // land on grass, not on the road
          if (!inMap(x + ux * 42, z + uz * 42) || !inMap(x - ux * (s.len + 40), z - uz * (s.len + 40))) continue;
          // Best: close to a street, with the run-up starting at the street (easy to find from the road).
          const start = distToStreet(x - ux * (s.len + 30), z - uz * (s.len + 30));
          cands.push({ rs: [{ x: x - ux * (s.len / 2), z: z - uz * (s.len / 2), yaw: a, len: s.len, h: s.h, w: W, kind: 'jump' }], score: -Math.abs(ds - 9) * 0.3 - start * 0.2 + si * 0.5 + Math.random() * 0.5, ahead: 42 });
        }
      }
    }
  pick('jump', cands, 16, 60, 85, 120);
}

// ---- more loops: open, flat ground, a long run-up and room to come out (as in place-ramps.ts)
const newLoops: Loop[] = [];
{
  const LR = 7, LD = 8.5;
  const loopOk = (l: Loop) => {
    for (const { p, side } of loopSections(l)) {
      if (p[1] > 6) continue;
      for (let a = -LOOP_W / 2 - 1; a <= LOOP_W / 2 + 1; a += 1) {
        const x = p[0] + side[0] * a, z = p[2] + side[2] * a;
        if (!inMap(x, z) || at(solid, x, z) || at(water, x, z) || grid.edgeDistance(x, z) < 1.5) return false;
      }
    }
    const e = loopEntry(l), secs = loopSections(l), end = secs[secs.length - 1].p;
    if (!clear(e.x - e.dirX, e.z - e.dirZ, -e.dirX, -e.dirZ, 50, LOOP_W)) return false;
    if (!clear(end[0], end[2], e.dirX, e.dirZ, 25, LOOP_W)) return false;
    return inMap(e.x - e.dirX * 50, e.z - e.dirZ * 50) && inMap(end[0] + e.dirX * 25, end[2] + e.dirZ * 25);
  };
  const loopsAll = () => [...map.loops!, ...newLoops];
  for (let z = -H + 70; z < H - 70 && newLoops.length < 2; z += 8)
    for (let x = -H + 70; x < H - 70 && newLoops.length < 2; x += 8) {
      if (at(solid, x, z) || at(water, x, z) || Math.abs(x) > 670 || Math.abs(z) > 670) continue;
      if (loopsAll().some((l) => Math.hypot(l.x - x, l.z - z) < 215) || !all().every((r) => Math.hypot(r.x - x, r.z - z) > 50)) continue;
      for (let k = 0; k < 16; k++) {
        const l: Loop = { x, z, yaw: (k / 16) * Math.PI * 2, r: LR, d: LD };
        if (!loopOk(l)) continue;
        const handles = addLoopPhysics(world, [l]);
        if (!driveLoop(w, l, 'compact') && !driveLoop(w, l, 'sport')) {
          for (const f of ['x', 'z', 'yaw'] as const) l[f] = +l[f].toFixed(2);
          newLoops.push({ ...l, extra: true });
          markLoop(l);
          console.log('loop', l.x, l.z);
          break;
        }
        for (const h of handles) world.removeCollider(world.getCollider(h), false);
      }
    }
}

// ---- final check with everything in place: drop extras that break something
for (const r of extras) for (const k of ['x', 'z', 'yaw', 'len', 'h'] as const) r[k] = +r[k].toFixed(2);
for (let round = 0; ; round++) {
  const fw = await buildWorld({ ...loadMapData(), ramps: all(), loops: [...map.loops, ...newLoops] });
  const bad: (Ramp | Loop)[] = [];
  for (const r of all()) {
    for (const id of r.kind === 'kick' ? ['compact'] : ['compact', 'sport']) {
      const err = driveRamp(fw, r, id);
      if (!err) continue;
      console.log(`round ${round}: ${r.kind} ramp at ${r.x},${r.z} fails with the ${id}: ${err}`);
      // A take-off and its landing ramp go together; an old ramp that fails blames the nearest extra.
      const blame = r.extra ? r : [...extras].sort((a, b) => Math.hypot(a.x - r.x, a.z - r.z) - Math.hypot(b.x - r.x, b.z - r.z))[0];
      bad.push(blame);
      break;
    }
  }
  for (const l of [...map.loops, ...newLoops])
    for (const id of ['compact', 'sport']) {
      const err = driveLoop(fw, l, id);
      if (!err) continue;
      console.log(`round ${round}: loop at ${l.x},${l.z} fails with the ${id}: ${err}`);
      bad.push(l.extra ? l : [...extras].sort((a, b) => Math.hypot(a.x - l.x, a.z - l.z) - Math.hypot(b.x - l.x, b.z - l.z))[0]);
      break;
    }
  if (!bad.length) break;
  for (const b of bad) {
    const li = newLoops.indexOf(b as Loop);
    if (li >= 0) newLoops.splice(li, 1);
    const i = extras.indexOf(b as Ramp);
    if (i < 0) continue;
    // Remove a pair together.
    const pair = extras[i].kind === 'gap' ? [i, i + 1] : extras[i].kind === 'land' ? [i - 1, i] : [i];
    for (const j of pair.reverse()) extras.splice(j, 1);
  }
}

map.ramps = all();
map.loops = [...map.loops, ...newLoops];
const count = (k: string) => extras.filter((r) => r.kind === k).length;
console.log(`ramps ${before.ramps} -> ${map.ramps.length} (+${count('jump')} jump, +${count('gap')} pairs, +${count('water')} water, +${count('roof')} roof, +${count('kick')} kick); loops ${before.loops} -> ${map.loops.length}`);
delete (map as Partial<MapData>).lod3d;
writeFileSync(DATA, JSON.stringify(map));
