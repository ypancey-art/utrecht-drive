// Long Hot Wheels tracks through the city: from a park it climbs up, drives straight through a
// tall building, does a loop high in the air, flies over low roofs and comes back down.
// Every track is test-driven in the real physics world with the starter car.
// Run after place-ramps: npx tsx scripts/place-tracks.ts   -> `tracks` in public/data/overvecht.json
import { readFileSync, writeFileSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData, Track, Loop } from '../src/game/mapData';
import { loopAt, loopExit, loopSections, type V3 } from '../src/game/loops';
import { buildWorld, loadMapData } from '../tests/world';
import { Car } from '../src/game/car';
import { CARS } from '../src/game/cars';

const DATA = 'public/data/overvecht.json';
const map: MapData = JSON.parse(readFileSync(DATA, 'utf8'));

let YT = 6.5; // cruising height of the track surface (m); tried at 6.5 and 5.6
const CEIL = 4.6; // headroom needed inside a building
const GRADE = 0.13; // steepest climb (13 %)
const W = 6; // track width
const LR = 7, LD = 8.5; // loop radius and sideways offset
const TRACKS = 4;

// ---- 1 m rasters: which building is where, streets, water, low obstacles, railway
const H = 760, N = H * 2;
const idx = (x: number, z: number) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
const bld = new Int32Array(N * N).fill(-1);
const street = new Uint8Array(N * N), water = new Uint8Array(N * N), low = new Uint8Array(N * N), rail = new Uint8Array(N * N);
const fillPoly = (pts: [number, number][], set: (k: number) => void) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
  for (let z = Math.floor(z0); z <= z1; z++)
    for (let x = Math.floor(x0); x <= x1; x++) {
      const cx = x + 0.5, cz = z + 0.5;
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        if (pts[i][1] > cz !== pts[j][1] > cz && cx < ((pts[j][0] - pts[i][0]) * (cz - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
      const k = idx(cx, cz);
      if (c && k >= 0) set(k);
    }
};
const fillLine = (a: number[], b: number[], hw: number, arr: Uint8Array) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let d = 0; d <= len; d += 0.5) {
    const x = a[0] + ((b[0] - a[0]) * d) / (len || 1), z = a[1] + ((b[1] - a[1]) * d) / (len || 1);
    for (let dz = -hw; dz <= hw; dz += 0.5) for (let dx = -hw; dx <= hw; dx += 0.5) if (dx * dx + dz * dz <= hw * hw) { const k = idx(x + dx, z + dz); if (k >= 0) arr[k] = 1; }
  }
};
map.buildings.forEach((b, i) => fillPoly(b.pts, (k) => (bld[k] = i)));
for (const r of map.roads) if (r.drivable && !r.tunnel) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], r.width / 2 + 1, street);
for (const { pts } of map.water) fillPoly(pts, (k) => (water[k] = 1));
for (const w of map.waterways) for (let i = 0; i < w.pts.length - 1; i++) fillLine(w.pts[i], w.pts[i + 1], w.width / 2, water);
for (const h of map.hedges ?? []) for (let i = 0; i < h.pts.length - 1; i++) fillLine(h.pts[i], h.pts[i + 1], 1, low);
for (const p of map.playgrounds) fillPoly(p.pts, (k) => (low[k] = 1));
for (const r of map.rails) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], 14, rail);
// Keep clear of ramps and ground loops (and their run-ups).
for (const r of map.ramps ?? []) {
  const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
  fillLine([r.x - ux * (r.len / 2 + 30), r.z - uz * (r.len / 2 + 30)], [r.x + ux * (r.len / 2 + 20), r.z + uz * (r.len / 2 + 20)], 5, low);
}
for (const l of map.loops ?? []) for (const { p } of loopSections(l)) fillLine([p[0], p[2]], [p[0], p[2]], 12, low);
const at = (arr: Uint8Array, x: number, z: number) => { const k = idx(x, z); return k < 0 ? 1 : arr[k]; };
const bAt = (x: number, z: number) => { const k = idx(x, z); return k < 0 ? -1 : bld[k]; };
const ceilingOf = (b: number) => map.buildings[b].eave ?? map.buildings[b].h;
const inMap = (x: number, z: number) => Math.abs(x) < 690 && Math.abs(z) < 690;

// ---- geometry helpers
type P2 = [number, number];
const rot = (dx: number, dz: number, a: number): P2 => [dx * Math.cos(a) - dz * Math.sin(a), dx * Math.sin(a) + dz * Math.cos(a)];
/** Centripetal Catmull-Rom through the points, resampled every `step` metres. */
function spline(ctrl: P2[], step = 3): P2[] {
  const dense: P2[] = [];
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let k = 0; k < 20; k++) {
      const t = k / 20, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);
  const out: P2[] = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const [ax, az] = dense[i - 1], [bx, bz] = dense[i];
    let seg = Math.hypot(bx - ax, bz - az);
    let sx = ax, sz = az;
    while (acc + seg >= step) {
      const f = (step - acc) / seg;
      sx += (bx - sx) * f;
      sz += (bz - sz) * f;
      out.push([sx, sz]);
      seg = Math.hypot(bx - sx, bz - sz);
      acc = 0;
    }
    acc += seg;
  }
  const last = ctrl[ctrl.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > 0.5) out.push(last);
  else out[out.length - 1] = last;
  return out;
}
/** Sharpest turn along a path (radians per metre). */
function maxCurvature(pts: P2[]) {
  let m = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const a2 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    m = Math.max(m, d / Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  }
  return m;
}

/**
 * Heights along a path that starts (rising) or ends (falling) on the ground, with a flat part
 * at YT. Returns null if the path can't be built (something in the way that it can neither
 * pass over nor drive through). The `flats` index ranges must stay at exactly YT.
 */
function profile(pts: P2[], rising: boolean, flats: [number, number][]) {
  const n = pts.length, step = 3;
  const isFlat = (i: number) => flats.some(([a, b]) => i >= a && i <= b);
  const sGround = (i: number) => (rising ? i : n - 1 - i) * step; // distance from the ground end
  let y = pts.map((_, i) => (isFlat(i) ? YT : Math.min(YT, GRADE * sGround(i))));
  const through = new Map<number, number>();
  for (let iter = 0; iter < 4; iter++) {
    const req = new Array(n).fill(0);
    through.clear();
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];
      const a = pts[Math.min(n - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      const tx = a[0] - b[0], tz = a[1] - b[1], tl = Math.hypot(tx, tz) || 1;
      for (let s = -W / 2 - 1; s <= W / 2 + 1; s += 1) {
        const px = x - (tz / tl) * s, pz = z + (tx / tl) * s;
        if (!inMap(px, pz)) return (no('p:edge'), null);
        const bi = bAt(px, pz);
        if (bi >= 0) {
          const bb = map.buildings[bi];
          if (bb.church) return (no('p:church'), null);
          if (ceilingOf(bi) >= y[i] + CEIL && y[i] >= 1.5) through.set(bi, y[i]);
          else req[i] = Math.max(req[i], bb.h + 2.2);
        }
        if (at(rail, px, pz)) req[i] = Math.max(req[i], 8.5);
        if (at(street, px, pz)) req[i] = Math.max(req[i], 4.8);
        if (at(low, px, pz)) req[i] = Math.max(req[i], 2.8);
        if (at(water, px, pz)) req[i] = Math.max(req[i], 1.2);
      }
    }
    // Lift the track over whatever needs it, never steeper than GRADE.
    const ny = y.slice();
    for (let i = 0; i < n; i++) {
      let need = req[i];
      for (let j = Math.max(0, i - 40); j < Math.min(n, i + 40); j++) need = Math.max(need, req[j] - GRADE * step * Math.abs(i - j));
      ny[i] = Math.max(isFlat(i) ? YT : Math.min(YT, GRADE * sGround(i)), need);
    }
    for (let i = 0; i < n; i++) {
      if (isFlat(i) && Math.abs(ny[i] - YT) > 0.01) return (no('p:flatRaised'), null); // must stay level here
      if (ny[i] > GRADE * sGround(i) + 0.01) return (no('p:groundEnd'), null); // too close to the ground end to climb that high
      if (ny[i] > 15) return (no('p:tooHigh'), null);
    }
    if (ny.every((v, i) => Math.abs(v - y[i]) < 0.01)) break;
    y = ny;
  }
  // Round off crests and dips (a fast car would take off where the climb levels out), but keep
  // the level parts level, the ground end on the ground and every clearance.
  // Fixed: the level part (except where it meets the climb, which gets rounded) and the ground end.
  const fixedAt = (i: number) => flats.some(([a, b]) => i >= a && i <= b && (a === 0 || i >= a + 4) && (b === n - 1 || i <= b - 4)) || i === (rising ? 0 : n - 1);
  const raw = y.slice();
  for (let pass = 0; pass < 3; pass++) {
    const sm = y.slice();
    for (let i = 0; i < n; i++) {
      if (fixedAt(i)) continue;
      let sum = 0, c = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) (sum += y[j]), c++;
      sm[i] = Math.max(sum / c, raw[i] - (raw[i] > YT ? 0 : 0.6)); // never below a needed clearance
    }
    y = sm;
  }
  // Inside a drive-through building the height must not change (the hole is cut for it) and the
  // headroom must still be there.
  for (const [bi] of through)
    for (let i = 0; i < n; i++)
      if (bAt(pts[i][0], pts[i][1]) === bi && (Math.abs(y[i] - raw[i]) > 0.3 || ceilingOf(bi) < y[i] + CEIL)) return (no('p:smoothThrough'), null);
  // Drive-through buildings must have room above the track everywhere inside.
  for (const [bi, yy] of through) if (ceilingOf(bi) < yy + CEIL) return (no('p:ceiling'), null);
  return { y, through: [...through.keys()] };
}

// ---- candidates: one per tall building and direction
interface Cand { track: Track; score: number; centre: P2 }
const cands: Cand[] = [];
const why: Record<string, number> = {};
const no = (r: string) => { why[r] = (why[r] ?? 0) + 1; };
const tall = map.buildings.map((b, i) => i).filter((i) => !map.buildings[i].church && ceilingOf(i) >= 5.6 + CEIL + 0.5);
/** Straight lines through a building's centre that a track could drive along (in 16 directions). */
interface Chord { bi: number; a: number; dx: number; dz: number; pin: P2; pout: P2 }
function chordsOf(bi: number): Chord[] {
  const b = map.buildings[bi];
  let cx = 0, cz = 0;
  const ring = b.pts.slice(0, -1);
  for (const [x, z] of ring) (cx += x), (cz += z);
  (cx /= ring.length), (cz /= ring.length);
  if (bAt(cx, cz) !== bi) return [];
  const out: Chord[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let back = 0, fwd = 0;
    while (back < 60 && bAt(cx - dx * back, cz - dz * back) === bi) back += 0.5;
    while (fwd < 60 && bAt(cx + dx * fwd, cz + dz * fwd) === bi) fwd += 0.5;
    const len = back + fwd;
    if (len < 8 || len > 40) continue;
    let ok = true;
    for (let t = -back + 1; t < fwd - 1 && ok; t += 2)
      for (const s of [-W / 2, W / 2]) if (bAt(cx + dx * t - dz * s, cz + dz * t + dx * s) !== bi) ok = false;
    if (ok) out.push({ bi, a, dx, dz, pin: [cx - dx * (back + 0.5), cz - dz * (back + 0.5)], pout: [cx + dx * (fwd + 0.5), cz + dz * (fwd + 0.5)] });
  }
  return out;
}
const allChords = tall.flatMap(chordsOf);
console.log(`${tall.length} buildings tall enough to drive through`);
for (const yt of [6.5, 5.6])
for (const bi of tall) {
  YT = yt;
  if (ceilingOf(bi) < YT + CEIL + 0.5) continue;
  const b = map.buildings[bi];
  let cx = 0, cz = 0;
  const ring = b.pts.slice(0, -1);
  for (const [x, z] of ring) (cx += x), (cz += z);
  (cx /= ring.length), (cz /= ring.length);
  if (bAt(cx, cz) !== bi) continue;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    // Where does a straight line through the centre enter and leave the building?
    let back = 0, fwd = 0;
    while (back < 60 && bAt(cx - dx * back, cz - dz * back) === bi) back += 0.5;
    while (fwd < 60 && bAt(cx + dx * fwd, cz + dz * fwd) === bi) fwd += 0.5;
    const len = back + fwd;
    if (len < 8 || len > 40) { no('length'); continue; }
    // The width of the hole must fit too: check both track edges are inside the same building.
    let ok = true;
    for (let t = -back + 1; t < fwd - 1 && ok; t += 2)
      for (const s of [-W / 2, W / 2]) if (bAt(cx + dx * t - dz * s, cz + dz * t + dx * s) !== bi) ok = false;
    if (!ok) { no('narrow'); continue; }
    const pin: P2 = [cx - dx * (back + 0.5), cz - dz * (back + 0.5)];
    const pout: P2 = [cx + dx * (fwd + 0.5), cz + dz * (fwd + 0.5)];
    // The loop comes right after the building, up in the air.
    const C: P2 = [pout[0] + dx * 12, pout[1] + dz * 12];
    const loop: Loop = loopAt(C[0], C[1], YT, a, LR, LD);
    const ex = loopExit(loop);
    let loopOk = true;
    for (const { p } of loopSections(loop))
      for (let s = -W / 2 - 1; s <= W / 2 + 1 && loopOk; s += 2) {
        const bj = bAt(p[0] + s * -dz, p[2] + s * dx);
        if (!inMap(p[0], p[2]) || (bj >= 0 && map.buildings[bj].h > YT - 0.5) || at(rail, p[0], p[2])) loopOk = false;
      }
    if (!loopOk) { no('loop'); continue; }
    const bends = [0, 0.3, -0.3, 0.5, -0.5, 0.7, -0.7];
    // Part 1: ground -> climb -> straight approach -> through the building -> to the loop.
    // Try bends and lengths until the climb fits (it must not cross a street while still low).
    const A: P2 = [pin[0] - dx * 24, pin[1] - dz * 24];
    let part1: { p: P2[]; y: number[]; through: number[] } | null = null;
    search1: for (const t1 of bends)
      for (const ab of [30, 50])
        for (const bs of [35, 55, 80]) {
          const d1 = rot(-dx, -dz, t1), d2 = rot(-dx, -dz, t1 * 1.7);
          const B: P2 = [A[0] + d1[0] * ab, A[1] + d1[1] * ab];
          const S: P2 = [B[0] + d2[0] * bs, B[1] + d2[1] * bs];
          if (at(water, S[0], S[1]) || at(street, S[0], S[1])) continue;
          const p = spline([S, B, A, pin, pout, C]);
          if (maxCurvature(p) > 0.035) { no('curve1'); continue; }
          const flatFrom = p.findIndex(([x, z]) => Math.hypot(x - A[0], z - A[1]) < 2);
          if (flatFrom < 0) continue;
          const pr = profile(p, true, [[flatFrom, p.length - 1]]);
          if (!pr) { no('profile1'); continue; }
          if (!pr.through.includes(bi)) { no('notThrough'); continue; }
          part1 = { p, ...pr };
          break search1;
        }
    if (!part1) continue;
    // Part 2: from the loop, level for a bit, then (if one fits) on through a second tall
    // building, and curving back down to the ground.
    const F: P2 = [ex.x + dx * 20, ex.z + dz * 20];
    let part2: { p: P2[]; y: number[]; through: number[] } | null = null;
    const next = allChords
      .filter((c) => c.bi !== bi && c.dx * dx + c.dz * dz > 0.35)
      .map((c) => ({ c, dist: Math.hypot(c.pin[0] - F[0], c.pin[1] - F[1]) }))
      .filter(({ c, dist }) => dist > 50 && dist < 260 && ((c.pin[0] - F[0]) * dx + (c.pin[1] - F[1]) * dz) / dist > 0.4)
      .sort((p, q) => p.dist - q.dist)
      .slice(0, 14);
    search2b: for (const { c } of next)
      for (const t2 of bends)
        for (const ge of [35, 55, 80]) {
          const A2: P2 = [c.pin[0] - c.dx * 26, c.pin[1] - c.dz * 26];
          const P3: P2 = [c.pout[0] + c.dx * 15, c.pout[1] + c.dz * 15];
          const d3 = rot(c.dx, c.dz, t2), d4 = rot(c.dx, c.dz, t2 * 1.7);
          const G: P2 = [P3[0] + d3[0] * 35, P3[1] + d3[1] * 35];
          const E: P2 = [G[0] + d4[0] * ge, G[1] + d4[1] * ge];
          if (at(water, E[0], E[1]) || at(street, E[0], E[1])) continue;
          const p = spline([[ex.x, ex.z], F, A2, c.pin, c.pout, P3, G, E]);
          if (maxCurvature(p) > 0.045) { no('curveChain'); continue; }
          const near = (q: P2) => p.findIndex(([x, z]) => Math.hypot(x - q[0], z - q[1]) < 2);
          const iF = near(F), iA = near(A2), iP = near(P3);
          if (iF < 0 || iA < 0 || iP < 0 || iA < iF) continue;
          const pr = profile(p, false, [[0, iF], [iA, iP]]);
          if (!pr) { no('profileChain'); continue; }
          if (!pr.through.includes(c.bi)) { no('chainNotThrough'); continue; }
          part2 = { p, ...pr };
          break search2b;
        }
    // Otherwise: stay up in the air for a long ride over the neighbourhood (the longest that
    // fits), then come down.
    if (!part2) {
      for (const t2 of bends)
        for (const turn of [0.35, -0.35, 0.6, -0.6]) {
          const d3 = rot(dx, dz, t2), d4 = rot(d3[0], d3[1], turn), d5 = rot(d4[0], d4[1], turn);
          const G1: P2 = [F[0] + d3[0] * 45, F[1] + d3[1] * 45];
          const G2: P2 = [G1[0] + d4[0] * 55, G1[1] + d4[1] * 55];
          const G3: P2 = [G2[0] + d5[0] * 45, G2[1] + d5[1] * 45];
          const E: P2 = [G3[0] + d5[0] * 50, G3[1] + d5[1] * 50];
          if (at(water, E[0], E[1]) || at(street, E[0], E[1])) continue;
          const p = spline([[ex.x, ex.z], F, G1, G2, G3, E]);
          if (maxCurvature(p) > 0.035) { no('curveLong'); continue; }
          const iG = p.findIndex(([x, z]) => Math.hypot(x - G2[0], z - G2[1]) < 2);
          if (iG < 0) continue;
          const pr = profile(p, false, [[0, iG]]);
          if (!pr) { no('profileLong'); continue; }
          if (!part2 || p.length > part2.p.length) part2 = { p, ...pr };
        }
    }
    if (!part2) search2: for (const t2 of bends)
      for (const fg of [30, 50])
        for (const ge of [35, 55, 80]) {
          const d3 = rot(dx, dz, t2), d4 = rot(dx, dz, t2 * 1.7);
          const G: P2 = [F[0] + d3[0] * fg, F[1] + d3[1] * fg];
          const E: P2 = [G[0] + d4[0] * ge, G[1] + d4[1] * ge];
          if (at(water, E[0], E[1]) || at(street, E[0], E[1])) continue;
          const p = spline([[ex.x, ex.z], F, G, E]);
          if (maxCurvature(p) > 0.035) { no('curve2'); continue; }
          const flatTo = p.findIndex(([x, z]) => Math.hypot(x - F[0], z - F[1]) < 2);
          if (flatTo < 0) continue;
          const pr = profile(p, false, [[0, flatTo]]);
          if (!pr) { no('profile2'); continue; }
          part2 = { p, ...pr };
          break search2;
        }
    if (!part2) continue;
    {
      const pr1 = part1, pr2 = part2;
      const pts1: V3[] = pr1.p.map(([x, z], i) => [+x.toFixed(2), +pr1.y[i].toFixed(2), +z.toFixed(2)]);
      const pts2: V3[] = pr2.p.map(([x, z], i) => [+x.toFixed(2), +pr2.y[i].toFixed(2), +z.toFixed(2)]);
      const thr = [...new Set([...pr1.through, ...pr2.through])];
      const over = new Set<number>();
      for (const [x, y, z] of [...pts1, ...pts2]) { const bj = bAt(x, z); if (bj >= 0 && !thr.includes(bj) && y > 1) over.add(bj); }
      const name = (() => {
        let best = '', bd = Infinity;
        for (const r of map.roads) if (r.name) for (const [x, z] of r.pts) { const d = Math.hypot(x - cx, z - cz); if (d < bd) (bd = d), (best = r.name); }
        return best;
      })();
      cands.push({
        track: { id: '', name, parts: [{ kind: 'path', pts: pts1 }, { kind: 'loop', loop }, { kind: 'path', pts: pts2 }], through: thr.map((j) => ({ b: j, y: YT })) },
        score: thr.length * 10 + over.size * 3 + ((pts1.length + pts2.length) * 3) / 15 + Math.random(),
        centre: [cx, cz],
      });
    }
  }
}
cands.sort((a, b) => b.score - a.score);
console.log(`${cands.length} candidate tracks`, why);

// ---- test-drive: the starter car must get from the start to the end. Each candidate gets a
// fresh world with the track in it (the map physics cuts the holes in the building walls).
await RAPIER.init();
const { addTrackPhysics } = await import('../src/game/mapPhysics');
async function testDrive(t: Track, carId: string) {
  const { world } = await buildWorld({ ...loadMapData(), tracks: [t] });
  addTrackPhysics(world, [t]);
  const spec = CARS.find((c) => c.id === carId)!;
  const path = [...(t.parts[0] as { pts: V3[] }).pts];
  const end = (t.parts[2] as { pts: V3[] }).pts;
  const loop = (t.parts[1] as { loop: Loop }).loop;
  const [sx, , sz] = path[0], [nx, , nz] = path[2];
  const l = Math.hypot(nx - sx, nz - sz);
  const car = new Car(world, spec.stats, spec.dims);
  car.place(sx - ((nx - sx) / l) * 10, sz - ((nz - sz) / l) * 10, (nx - sx) / l, (nz - sz) / l);
  const all = [...path, ...end];
  let maxLoopY = 0, reached = false, fell = false;
  for (let i = 0; i < 60 * 40; i++) {
    const p = car.body.translation(), q = car.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    // Steer at a point 8 m ahead on the centre line (nearest point, then ahead).
    let best = 0, bd = Infinity;
    for (let k = 0; k < all.length; k++) { const d = (all[k][0] - p.x) ** 2 + (all[k][2] - p.z) ** 2 + (all[k][1] - p.y) ** 2; if (d < bd) (bd = d), (best = k); }
    const tgt = all[Math.min(all.length - 1, best + 3)];
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
    const ang = Math.atan2(fx * (tgt[2] - p.z) - fz * (tgt[0] - p.x), fx * (tgt[0] - p.x) + fz * (tgt[2] - p.z));
    const inLoop = Math.hypot(p.x - loop.x, p.z - loop.z) < 20 && p.y > (loop.y ?? 0) - 1;
    car.update({ throttle: 1, steer: inLoop || upY < 0.7 ? 0 : Math.max(-1, Math.min(1, ang * 2)), handbrake: false }, world.timestep);
    world.step();
    if (inLoop) maxLoopY = Math.max(maxLoopY, p.y);
    // Fell off: well below the track centre line nearby.
    if (bd < 100 && all[best][1] > 3 && p.y < all[best][1] - 3 && !inLoop) { fell = true; break; }
    const e = end[end.length - 1];
    if (Math.hypot(p.x - e[0], p.z - e[2]) < 8 && p.y < 2.5) { reached = true; break; }
  }
  const ok = reached && !fell && maxLoopY > (loop.y ?? 0) + 2 * LR - 1.5 && !car.flipped;
  car.dispose();
  return { ok, reached, fell, maxLoopY };
}

const chosen: Cand[] = [];
let tested = 0;
for (const c of cands) {
  if (chosen.length >= TRACKS || tested > 60) break;
  if (chosen.some((o) => Math.hypot(o.centre[0] - c.centre[0], o.centre[1] - c.centre[1]) < 300)) continue;
  // Keep tracks from crossing each other.
  const pts = c.track.parts.flatMap((p) => (p.kind === 'path' ? p.pts : []));
  if (chosen.some((o) => o.track.parts.some((p) => p.kind === 'path' && p.pts.some((q) => pts.some((r) => Math.hypot(q[0] - r[0], q[2] - r[2]) < 12))))) continue;
  tested++;
  const r1 = await testDrive(c.track, 'compact');
  const r2 = r1.ok ? await testDrive(c.track, 'hyper') : null;
  console.log(`test ${c.track.name}: through ${c.track.through.length}, score ${c.score.toFixed(0)}: compact`, JSON.stringify(r1), 'hyper', JSON.stringify(r2));
  if (!r1.ok || !r2?.ok) continue;
  chosen.push(c);
}
// Keep the tracks made by the other scripts (Spoorlus, the bt- tracks of place-building-tracks).
map.tracks = [...chosen.map((c, i) => ({ ...c.track, id: `track${i + 1}` })), ...(map.tracks ?? []).filter((t) => !/^track\d+$/.test(t.id))];
console.log(`${map.tracks.length} tracks:`, map.tracks.map((t) => `${t.id} ${t.name} (${t.through.length} through)`).join(', '));
delete (map as Partial<MapData>).lod3d;
writeFileSync(DATA, JSON.stringify(map));
