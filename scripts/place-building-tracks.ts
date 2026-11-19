// More Hot Wheels tracks, each test-driven with the compact and the sport car in the full world:
//  - "Dakrace" tracks: from the street the track climbs along the wall of a flat-roofed block of
//    flats, swings round in a turning loop off its end and runs the whole length of the roof
//    (a deck on the roof), leaves the roof, curves down round a neighbouring building, does a
//    loop and comes back down to the street.
//  - In open spaces: a banked corkscrew ("Kurkentrekker"), a bridge with a loop over the water
//    ("Kanaalbrug"), a gap jump between two track pieces ("Gatensprong") and two loops in a row
//    ("Dubbele looping").
// Only touches tracks whose id starts with "bt-" (safe to run again). Run after place-tracks and
// place-rail-stunts: npm run place-building-tracks   (backup in scripts/cache/)
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData, Track, Loop } from '../src/game/mapData';
import { loopAt, loopExit, loopSections, trackPosts, LOOP_W, type V3 } from '../src/game/loops';
import { buildWorld, loadMapData, driveTrack } from '../tests/world';
import { addTrackPhysics } from '../src/game/mapPhysics';

const DATA = 'public/data/overvecht.json';
const PREFIX = 'bt-';
mkdirSync('scripts/cache', { recursive: true });
copyFileSync(DATA, 'scripts/cache/overvecht.before-building-tracks.json');
const map: MapData = JSON.parse(readFileSync(DATA, 'utf8'));
map.tracks = (map.tracks ?? []).filter((t) => !t.id.startsWith(PREFIX));
// Optional: only some kinds ("roof spiral canal gap double"), and --dry to not write the result.
const DRY = process.argv.includes('--dry');
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const W = LOOP_W; // track width
const LR = 7, LD = 8.5; // loop radius and sideways offset (as the other tracks)
const GRADE = 0.125; // design climb; the smoothed track must stay under MAX_GRADE
const MAX_GRADE = 0.15; // 8.5°
const STEP = 2.5; // m between path points
const SM = 6, PASSES = 3; // height smoothing, so crests are gentle enough that fast cars stay down
let BANK = +(process.env.BANK ?? 0.75), BANK_K = +(process.env.BANK_K ?? 10); // banking: up to 43°, in a 13 m bend
const UNDER_STREET = 4.8, UNDER_PATH = 2.4, OVER_ROOF = 0.6, STACK = 5.5; // clearances (m)

type P2 = [number, number];
const why: Record<string, number> = {};
const no = (r: string) => ((why[r] = (why[r] ?? 0) + 1), r);

// ---- 1 m rasters (as in place-tracks.ts)
const H = 760, N = H * 2;
const idx = (x: number, z: number) => {
  const i = Math.floor(x + H), j = Math.floor(z + H);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
const bld = new Int32Array(N * N).fill(-1);
const street = new Uint8Array(N * N), path = new Uint8Array(N * N), water = new Uint8Array(N * N);
const low = new Uint8Array(N * N), rail = new Uint8Array(N * N), keep = new Uint8Array(N * N), keepRamp = new Uint8Array(N * N);
const fillPoly = (pts: P2[], set: (k: number) => void) => {
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
for (const r of map.roads) {
  if (r.tunnel) continue;
  // Cycle paths need headroom (cyclists ride under the track); footpaths may be crossed low (walkers have no physics).
  if (r.drivable || r.kind === "cycleway") for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], r.drivable ? r.width / 2 + 1 : r.width / 2 + 0.5, r.drivable ? street : path);
}
for (const { pts } of map.water) fillPoly(pts, (k) => (water[k] = 1));
for (const w of map.waterways) for (let i = 0; i < w.pts.length - 1; i++) fillLine(w.pts[i], w.pts[i + 1], w.width / 2, water);
for (const h of map.hedges ?? []) for (let i = 0; i < h.pts.length - 1; i++) fillLine(h.pts[i], h.pts[i + 1], 1, low);
for (const p of map.playgrounds) fillPoly(p.pts, (k) => (low[k] = 1));
for (const r of map.rails) for (let i = 0; i < r.pts.length - 1; i++) fillLine(r.pts[i], r.pts[i + 1], 14, rail);
// Keep well away from ramps (run-up to landing), loops and the other tracks.
for (const r of map.ramps ?? []) {
  const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
  fillLine([r.x - ux * (r.len / 2 + 40), r.z - uz * (r.len / 2 + 40)], [r.x + ux * (r.len / 2 + 30), r.z + uz * (r.len / 2 + 30)], 7, keepRamp);
}
for (const l of map.loops ?? []) for (const { p } of loopSections(l)) fillLine([p[0], p[2]], [p[0], p[2]], 14, keep);
function keepOff(t: Track) {
  for (const part of t.parts) {
    if (part.kind === 'loop') for (const { p } of loopSections(part.loop)) fillLine([p[0], p[2]], [p[0], p[2]], 12, keep);
    else for (let i = 0; i < part.pts.length - 1; i++) fillLine([part.pts[i][0], part.pts[i][2]], [part.pts[i + 1][0], part.pts[i + 1][2]], 10, keep);
  }
}
for (const t of map.tracks) keepOff(t);
const at = (arr: Uint8Array, x: number, z: number) => { const k = idx(x, z); return k < 0 ? 1 : arr[k]; };
const bAt = (x: number, z: number) => { const k = idx(x, z); return k < 0 ? -1 : bld[k]; };
const inMap = (x: number, z: number) => Math.abs(x) < 690 && Math.abs(z) < 690;
const streetNear = (x: number, z: number, r: number) => {
  for (let a = 0; a < 16; a++) for (let d = 2; d <= r; d += 2) if (at(street, x + Math.cos((a / 8) * Math.PI) * d, z + Math.sin((a / 8) * Math.PI) * d)) return true;
  return false;
};

// ---- paths: spline through control points, heights from keys, banking from the curvature
/** Catmull-Rom through the points, every STEP m. Also returns the sample index of each control point. */
function spline(ctrl: P2[]) {
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const dense: { p: P2; seg: number }[] = [];
  for (let i = 1; i < P.length - 2; i++)
    for (let k = 0; k < 30; k++) {
      const t = k / 30, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ p: [f(P[i - 1][0], P[i][0], P[i + 1][0], P[i + 2][0]), f(P[i - 1][1], P[i][1], P[i + 1][1], P[i + 2][1])], seg: i - 1 });
    }
  dense.push({ p: ctrl[ctrl.length - 1], seg: ctrl.length - 1 });
  const out: P2[] = [dense[0].p];
  const at = new Array(ctrl.length).fill(-1);
  at[0] = 0;
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    const [ax, az] = dense[i - 1].p, [bx, bz] = dense[i].p;
    let seg = Math.hypot(bx - ax, bz - az), sx = ax, sz = az;
    while (acc + seg >= STEP) {
      const f = (STEP - acc) / seg;
      sx += (bx - sx) * f;
      sz += (bz - sz) * f;
      out.push([sx, sz]);
      seg = Math.hypot(bx - sx, bz - sz);
      acc = 0;
    }
    acc += seg;
    if (at[dense[i].seg] < 0) at[dense[i].seg] = out.length - 1;
  }
  const last = ctrl[ctrl.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > STEP * 0.4) out.push(last);
  else out[out.length - 1] = last;
  at[ctrl.length - 1] = out.length - 1;
  return { pts: out, at };
}
/** Heading change per metre at every point (+ = turning right). */
/** The sharpest bend of a track (1 / radius). */
const sharpest = (t: Track) => Math.max(...t.parts.map((p) => (p.kind === 'path' ? Math.max(...curvature(p.pts.map(([x, , z]): P2 => [x, z])).map(Math.abs)) : 0)));
function curvature(pts: P2[]) {
  const n = pts.length, k = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const a2 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    k[i] = d / STEP;
  }
  return k;
}
interface PathSpec { ctrl: P2[]; keys: (number | null)[] }
interface Part { kind: 'path'; pts: V3[]; bank: number[] }
/** A path piece: points with heights (linear between keys, level stretches kept exactly level,
 *  corners rounded) and banking. Returns a reason if it can't be built. */
function makePath(spec: PathSpec): Part | string {
  // Evenly spaced control points (≤ 5 m apart), so the spline doesn't overshoot where long
  // straights meet tight bends.
  const ctrl: P2[] = [spec.ctrl[0]], ks: (number | null)[] = [spec.keys[0]];
  for (let i = 1; i < spec.ctrl.length; i++) {
    const [ax, az] = spec.ctrl[i - 1], [bx, bz] = spec.ctrl[i], m = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
    for (let j = 1; j < m; j++) (ctrl.push([ax + ((bx - ax) * j) / m, az + ((bz - az) * j) / m]), ks.push(null));
    ctrl.push(spec.ctrl[i]);
    ks.push(spec.keys[i]);
  }
  spec = { ctrl, keys: ks };
  const { pts, at: ci } = spline(spec.ctrl);
  const n = pts.length;
  if (ci.some((v, i) => i > 0 && v < ci[i - 1])) return no('spline order');
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const keys: [number, number][] = [];
  spec.keys.forEach((y, i) => y !== null && keys.push([ci[i], y]));
  let y = new Array(n).fill(0);
  const held = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    let k = 0;
    while (k < keys.length - 1 && keys[k + 1][0] <= i) k++;
    const [ia, ya] = keys[k], [ib, yb] = keys[Math.min(k + 1, keys.length - 1)];
    if (i <= ia || ib === ia) y[i] = i <= ia && k === 0 ? keys[0][1] : ya;
    else y[i] = ya + ((yb - ya) * (s[i] - s[ia])) / (s[ib] - s[ia] || 1);
    if (i >= ia && i <= ib && Math.abs(ya - yb) < 1e-6) held[i] = true;
    if (i <= keys[0][0] || i >= keys[keys.length - 1][0]) held[i] = true;
  }
  // Round off where the grade changes: smooth the grade (not the height), so crests and dips
  // are long and gentle (a fast car must not take off), then add it up again and correct it
  // so every key height is met exactly.
  void held;
  let g = y.slice(1).map((v, i) => v - y[i]);
  for (let pass = 0; pass < PASSES; pass++)
    g = g.map((_, i) => { let a = 0, c = 0; for (let j = i - SM; j <= i + SM; j++) (a += g[Math.max(0, Math.min(g.length - 1, j))]), c++; return a / c; });
  const ys = [y[0]];
  for (let i = 0; i < g.length; i++) ys.push(ys[i] + g[i]);
  for (let k = 0; k < keys.length; k++) {
    const [ia, ya] = keys[k], [ib, yb] = keys[Math.min(k + 1, keys.length - 1)];
    const ea = ya - ys[ia], eb = yb - ys[ib];
    const from = k === 0 ? 0 : ia, to = k === keys.length - 1 ? n - 1 : ib;
    for (let i = from; i <= to; i++) {
      if (k > 0 && i === ia && ia !== 0) continue; // done by the piece before
      const t = ib === ia ? 0 : Math.max(0, Math.min(1, (s[i] - s[ia]) / (s[ib] - s[ia])));
      y[i] = ys[i] + ea + (eb - ea) * t;
    }
  }
  y = y.map((v) => Math.max(0, v));
  for (let i = 1; i < n; i++)
    if (Math.abs(y[i] - y[i - 1]) / (s[i] - s[i - 1] || 1) > MAX_GRADE) {
      if (process.env.DEBUG && (why.steep ?? 0) < 5) console.log('steep at', i, n, y.slice(Math.max(0, i - 6), i + 6).map((v) => v.toFixed(2)).join(' '), 'keys', JSON.stringify(keys));
      return no('steep');
    }
  // Banking: lean into the bends (up to 23°), level at both ends.
  const k = curvature(pts);
  if (k.some((v) => Math.abs(v) > 1 / 10)) {
    if (process.env.DEBUG && (why['tight bend'] ?? 0) < 8) { const i = k.findIndex((v) => Math.abs(v) > 1 / 10); console.log('tight at', i, n, 'R', (1 / Math.abs(k[i])).toFixed(1), JSON.stringify(pts.slice(Math.max(0, i - 3), i + 4).map((p) => p.map((v) => +v.toFixed(1))))); }
    return no('tight bend');
  }
  let bank = k.map((v) => Math.max(-BANK, Math.min(BANK, v * BANK_K)));
  for (let pass = 0; pass < 2; pass++) bank = bank.map((_, i) => { let a = 0, c = 0; for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) (a += bank[j]), c++; return a / c; });
  bank = bank.map((b, i) => b * Math.min(1, s[i] / 10, (s[n - 1] - s[i]) / 10));
  // The deck may only twist slowly (a fast car is thrown off a quick twist): ≤ 1.4° per metre.
  const twist = 0.024 * STEP;
  for (let i = 1; i < n; i++) bank[i] = Math.max(bank[i - 1] - twist, Math.min(bank[i - 1] + twist, bank[i]));
  for (let i = n - 2; i >= 0; i--) bank[i] = Math.max(bank[i + 1] - twist, Math.min(bank[i + 1] + twist, bank[i]));
  return { kind: 'path', pts: pts.map(([x, z], i) => [+x.toFixed(2), +y[i].toFixed(2), +z.toFixed(2)]), bank: bank.map((b) => +b.toFixed(3)) };
}
/** A loop whose lead-in starts at p heading `dir`, and where the track goes on after it. */
function loopFrom(p: P2, dir: number, y: number) {
  const loop = loopAt(p[0], p[1], y, dir, LR, LD);
  const e = loopExit(loop);
  const r = (v: number, d = 2) => +v.toFixed(d);
  return { loop: { ...loop, x: r(loop.x), z: r(loop.z), yaw: r(loop.yaw, 4), r: LR, d: LD, y }, exit: [e.x, e.z] as P2 };
}
type Spec = PathSpec | { loop: Loop };
function assemble(id: string, name: string, specs: Spec[], extra: Partial<Track> = {}): Track | string {
  const parts: Track['parts'] = [];
  for (const sp of specs) {
    if ('loop' in sp) parts.push({ kind: 'loop', loop: sp.loop });
    else {
      const p = makePath(sp);
      if (typeof p === 'string') return p;
      parts.push(p);
    }
  }
  return { id, name, parts, through: [], ...extra };
}

// ---- checks against the map
/** Does the track run into itself? Where it passes over itself there must be room in between. */
function selfCross(pts3: { p: V3; s: number }[]) {
  for (let i = 0; i < pts3.length; i++)
    for (let j = i + 1; j < pts3.length; j++) {
      if (pts3[j].s - pts3[i].s < 30) continue;
      const a = pts3[i].p, b = pts3[j].p;
      if (Math.abs(a[0] - b[0]) > W + 2 || Math.abs(a[2] - b[2]) > W + 2) continue;
      if (Math.hypot(a[0] - b[0], a[2] - b[2]) < W + 2 && Math.abs(a[1] - b[1]) < STACK) return true;
    }
  return false;
}
/** All centre-line points of a track (paths and loops) in driving order, with the distance driven. */
function trackPoints(t: Track) {
  const out: { p: V3; s: number }[] = [];
  let s = 0;
  for (const part of t.parts) {
    if (part.kind === 'loop') for (const { p } of loopSections(part.loop)) out.push({ p, s: (s += 1.6) });
    else part.pts.forEach((p, i) => out.push({ p, s: i ? (s += STEP) : s }));
  }
  return out;
}
let lastHit = "";
const roofOf = new Map<number, number>(); // building -> top of its roof under the deck (roof tracks)
// Highest point of every building (3D BAG roof shape where we have it), to pass over it.
const topOf = (() => {
  const full = loadMapData(), lod = full.lod3d!;
  return full.buildings.map((b) => {
    let top = Math.max(b.h, b.ridge ?? 0);
    if (b.lod) {
      const [v0, , i0, nWall, nRoof] = b.lod;
      for (let t = nWall; t < nWall + nRoof; t++) top = Math.max(top, lod.pos[(v0 + lod.idx[i0 + t]) * 3 + 1] / 10);
    }
    return top;
  });
})();
/** '' if the track fits here. `self`: also check that it doesn't run into itself (doesn't change
 *  when a track is only moved, so the open-space search does that once per shape). */
function check(t: Track, self = true): string {
  const over = new Set(t.over ?? []);
  for (const part of t.parts) {
    const err = checkPart(part, over);
    if (err) return err;
  }
  if (self && selfCross(trackPoints(t))) return no('self');
  return checkEnds(t);
}
/** One path piece or loop against the map. */
function checkPart(part: Track['parts'][number], over = new Set<number>()): string {
  {
    if (part.kind === 'loop') {
      const l = part.loop, ly = l.y ?? 0;
      const secs = loopSections(l);
      for (const { p } of secs) {
        for (let s = -W / 2 - 0.5; s <= W / 2 + 0.5; s += 1) {
          const x = p[0] - Math.sin(l.yaw) * s, z = p[2] + Math.cos(l.yaw) * s;
          if (!inMap(x, z)) return no('edge');
          const b = bAt(x, z);
          if (b >= 0 && map.buildings[b].h > ly - 1) return no('loop: building');
          if (at(rail, x, z) || at(keep, x, z) || at(keepRamp, x, z)) return no('loop: rail/keep');
          if (ly < UNDER_STREET && at(street, x, z)) return no('loop: street');
          if (ly < UNDER_PATH && (at(path, x, z) || at(low, x, z))) return no('loop: path');
          if (ly < 1.5 && at(water, x, z)) return no('loop: water');
        }
      }
      for (const q of trackPosts({ id: '', name: '', through: [], parts: [part] }, () => true)) {
        if (at(street, q.x, q.z) || at(path, q.x, q.z) || bAt(q.x, q.z) >= 0 || at(rail, q.x, q.z)) return no('loop: post');
      }
      return '';
    }
    for (let i = 0; i < part.pts.length; i++) {
      const [x, y, z] = part.pts[i];
      const a = part.pts[Math.min(part.pts.length - 1, i + 1)], b = part.pts[Math.max(0, i - 1)];
      const tx = a[0] - b[0], tz = a[2] - b[2], tl = Math.hypot(tx, tz) || 1;
      for (let s = -W / 2 - 1; s <= W / 2 + 1; s += 1) {
        const px = x - (tz / tl) * s, pz = z + (tx / tl) * s;
        if (!inMap(px, pz)) return no('edge');
        const inner = Math.abs(s) <= W / 2 + 0.5;
        const bi = bAt(px, pz);
        if (bi >= 0 && inner) {
          if (over.has(bi)) {
            if (y < (roofOf.get(bi) ?? 99) + 0.25 && y < map.buildings[bi].h + OVER_ROOF) return no('roof: under deck');
          } else if (y < topOf[bi] + OVER_ROOF) return ((lastHit = `b${bi} top ${topOf[bi].toFixed(1)} y ${y.toFixed(1)} at ${px.toFixed(0)},${pz.toFixed(0)}`), no('building'));
        }
        if (at(rail, px, pz)) return no('rail');
        if (at(keep, px, pz) || (y < 9 && at(keepRamp, px, pz))) return no('keep'); // high above a ramp is fine
        if (y < UNDER_STREET && at(street, px, pz)) return no('street');
        if (inner && y < UNDER_PATH && (at(path, px, pz) || at(low, px, pz))) return no('path/hedge');
        if (inner && y < 1.5 && at(water, px, pz)) return no('water');
      }
    }
  }
  return '';
}
function checkEnds(t: Track): string {
  // Start and end on open ground, near a street, with room to drive on and off.
  const paths = t.parts.filter((p) => p.kind === 'path') as Part[];
  const first = paths[0].pts, last = paths[paths.length - 1].pts;
  for (const [p, q, sign] of [[first[0], first[2], -1], [last[last.length - 1], last[last.length - 3], 1]] as const) {
    const dx = p[0] - q[0], dz = p[2] - q[2], l = Math.hypot(dx, dz);
    for (let d = 0; d <= 14; d += 1) {
      const x = p[0] + (dx / l) * d, z = p[2] + (dz / l) * d;
      if (bAt(x, z) >= 0 || at(water, x, z) || at(low, x, z) || at(rail, x, z) || !inMap(x, z)) return no(sign < 0 ? 'start' : 'end');
    }
  }
  if (!streetNear(first[0][0], first[0][2], 30)) return no('start far from street');
  return '';
}

// ---- test drives: one world with everything in it, the candidate added and removed again
await RAPIER.init();
let W0 = await buildWorld({ ...loadMapData(), tracks: map.tracks });
const postOk = (x: number, z: number) => W0.scenery.grid.edgeDistance(x, z) > 1.2;
function drive(t: Track) {
  const handles = addTrackPhysics(W0.world, [t], postOk);
  const body = W0.world.getCollider([...handles][0]).parent()!;
  const res: string[] = [];
  for (const id of ['compact', 'sport']) {
    const err = driveTrack(W0, t, id, { strict: true, ease: id !== 'compact' }); // the sport lifts off before sharp bends
    if (err) res.push(`${id}: ${err}`);
    if (err) break;
  }
  W0.world.removeRigidBody(body);
  return res.join('; ');
}
// Roof heights: a ray down onto the real (3D BAG) roof.
function roofAt(x: number, z: number) {
  const hit = W0.world.castRay(new RAPIER.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 }), 80, true);
  return hit ? 80 - hit.timeOfImpact : 0;
}

const lengthOf = (t: Track) => t.parts.reduce((a, p) => a + (p.kind === 'path' ? (p.pts.length - 1) * STEP : 2 * Math.PI * LR + 30), 0);
const centreOf = (t: Track): P2 => {
  const all = t.parts.flatMap((p) => (p.kind === 'path' ? p.pts : []));
  return [all.reduce((a, p) => a + p[0], 0) / all.length, all.reduce((a, p) => a + p[2], 0) / all.length];
};
const chosen: Track[] = [];
const farFromOthers = (t: Track, d: number) => {
  const c = centreOf(t);
  return [...map.tracks!, ...chosen].every((o) => Math.hypot(centreOf(o)[0] - c[0], centreOf(o)[1] - c[1]) > d);
};
async function accept(t: Track) {
  chosen.push(t);
  keepOff(t);
  map.tracks!.push(t);
  W0 = await buildWorld({ ...loadMapData(), tracks: map.tracks });
  console.log(`  + ${t.id} "${t.name}" at ${centreOf(t).map((v) => v.toFixed(0))}, ${lengthOf(t).toFixed(0)} m`);
}
const nearestStreetName = (x: number, z: number) => {
  let best = '', bd = Infinity;
  for (const r of map.roads) if (r.name && r.drivable) for (const [px, pz] of r.pts) { const d = Math.hypot(px - x, pz - z); if (d < bd) (bd = d), (best = r.name); }
  return best;
};

// ---- 1. Dakrace: up a block of flats, over its roof, round the neighbour, loop, down
/** Smallest box around a footprint: centre, long-axis angle, half length and half width. */
function box(pts: P2[]) {
  let best = { area: Infinity, a: 0, c: [0, 0] as P2, L: 0, Wb: 0 };
  for (let k = 0; k < 90; k++) {
    const a = (k / 90) * Math.PI, c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of pts) {
      const u = x * c + z * s, v = -x * s + z * c;
      (u0 = Math.min(u0, u)), (u1 = Math.max(u1, u)), (v0 = Math.min(v0, v)), (v1 = Math.max(v1, v));
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      const long = u1 - u0 >= v1 - v0;
      best = { area, a: long ? a : a + Math.PI / 2, c: [um * c - vm * s, um * s + vm * c], L: Math.max(u1 - u0, v1 - v0) / 2, Wb: Math.min(u1 - u0, v1 - v0) / 2 };
    }
  }
  return best;
}
const polyArea = (pts: P2[]) => { let a = 0; for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return Math.abs(a / 2); };
const centroid = (pts: P2[]): P2 => { const r = pts.slice(0, -1); return [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length]; };

/** Points every ~4 m along a chain of arcs [length, curvature (+ = right)] from p heading `h`. */
function arcs(p: P2, h: number, segs: [number, number][], step = 4) {
  const out: P2[] = [];
  let [x, z] = p;
  for (const [len, k] of segs) {
    const n = Math.max(1, Math.ceil(len / step)), d = len / n;
    for (let i = 0; i < n; i++) {
      // Exact arc step (chord of the arc).
      const dh = k * d, ch = Math.abs(k) < 1e-9 ? d : (2 * Math.sin(dh / 2)) / k;
      x += Math.cos(h + dh / 2) * ch;
      z += Math.sin(h + dh / 2) * ch;
      h += dh;
      out.push([x, z]);
    }
  }
  return { pts: out, end: [x, z] as P2, h };
}

/** Keys for control points: the given heights at the given distances along them. */
function keysAt(ctrl: P2[], at: [number, number][]) {
  const s = [0];
  for (let i = 1; i < ctrl.length; i++) s.push(s[i - 1] + Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1]));
  const keys: (number | null)[] = ctrl.map(() => null);
  for (const [d, y] of at) {
    let best = 0;
    for (let i = 0; i < s.length; i++) if (Math.abs(s[i] - d) < Math.abs(s[best] - d)) best = i;
    keys[best] = y;
  }
  return { keys, len: s[s.length - 1] };
}

const k2len = (c: P2[]) => c.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - c[i][0], p[1] - c[i][1]), 0);
/**
 * Shortest bend - straight - bend from p0 (heading h0) to p1 (heading h1) with bends of radius r
 * (a Dubins path). Returns the pieces for arcs(), or null.
 */
function dubins(p0: P2, h0: number, p1: P2, h1: number, r: number): [number, number][] | null {
  const n = (h: number): P2 => [-Math.sin(h), Math.cos(h)]; // to the right
  const mod = (v: number) => ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let best: [number, number][] | null = null, bestLen = Infinity;
  for (const s1 of [1, -1])
    for (const s2 of [1, -1]) {
      const c0: P2 = [p0[0] + s1 * r * n(h0)[0], p0[1] + s1 * r * n(h0)[1]];
      const c1: P2 = [p1[0] + s2 * r * n(h1)[0], p1[1] + s2 * r * n(h1)[1]];
      const dx = c1[0] - c0[0], dz = c1[1] - c0[1], d = Math.hypot(dx, dz), phi = Math.atan2(dz, dx);
      let th: number, L: number;
      if (s1 === s2) (th = phi), (L = d);
      else {
        if (d < 2 * r) continue;
        th = phi + Math.asin((2 * s1 * r) / d);
        L = d * Math.cos(phi - th);
      }
      if (s1 !== s2 && L < 20) continue; // no quick S-bends
      const d1 = mod(s1 * (th - h0)), d2 = mod(s2 * (h1 - th));
      if (d1 > 1.6 * Math.PI || d2 > 1.6 * Math.PI) continue; // no going round in circles
      const len = r * (d1 + d2) + L;
      if (len < bestLen) (bestLen = len), (best = [[r * d1 + 1e-6, s1 / r], [L, 0], [r * d2 + 1e-6, s2 / r]]);
    }
  return best;
}

function roofTracks(ai: number): { t: Track; score: number }[] {
  const A = map.buildings[ai];
  const bx = box(A.pts);
  const { L, Wb } = bx;
  if (polyArea(A.pts) < 0.8 * 4 * L * Wb) return (no('A: not a box'), []);
  const out: { t: Track; score: number }[] = [];
  for (const flip of [0, Math.PI]) {
    const a = bx.a + flip, ca = Math.cos(a), sa = Math.sin(a);
    const F = (u: number, v: number): P2 => [bx.c[0] + ca * u - sa * v, bx.c[1] + sa * u + ca * v];
    if (flip === 0) {
      // The roof under the deck must be flat; the deck goes just above its highest point.
      let lo = Infinity, hi = -Infinity;
      for (let u = -L + 1; u <= L - 1; u += 2)
        for (const v of [-3.5, 0, 3.5]) {
          const [x, z] = F(u, v);
          if (bAt(x, z) !== ai) continue;
          const y = roofAt(x, z);
          (lo = Math.min(lo, y)), (hi = Math.max(hi, y));
        }
      if (!(hi - lo < 1.2) || hi > A.h + 2) return (no('A: roof not flat'), []);
      roofOf.set(ai, Math.max(hi, A.h));
    }
    const over = new Set([ai]);
    // The deck just above the roof (or a bit higher, to clear the same-height block next door).
    for (const margin of [0.35, 0.8]) {
    const yR = +(roofOf.get(ai)! + margin).toFixed(2);
    const E1 = F(L + 12, 0);
    // Part 2 (after the roof): over to the side of a neighbouring building B, along it and round
    // its end (B on the inside of the bend) while coming down, then a loop, then down to the street.
    const downs: { ctrl: P2[]; keys: (number | null)[]; loop: Loop; tail: PathSpec; B: number }[] = [];
    const lead = arcs(E1, a, [[8, 0]]).end;
    for (let bj = 0; bj < map.buildings.length; bj++) {
      if (bj === ai) continue;
      const B = map.buildings[bj];
      const c0 = centroid(B.pts);
      if (Math.abs(c0[0] - E1[0]) > 150 || Math.abs(c0[1] - E1[1]) > 150 || B.h < 6 || B.church) continue;
      const ob = box(B.pts);
      if (ob.L > 70 || polyArea(B.pts) < 0.6 * 4 * ob.L * ob.Wb) continue;
      const ax: P2 = [Math.cos(ob.a), Math.sin(ob.a)], nx: P2 = [-ax[1], ax[0]];
      for (const e of [1, -1])
        for (const sB of [1, -1])
          for (const clear of [6.5, 12]) {
            const dB = ob.Wb + clear;
            if (dB < 20) continue;
            for (const sideLen of [20])
            for (const turnDeg of [180, 90])
            for (const rate of [1, 0.4, 0]) {
              // Along B's side towards its end e, B on the side sB of the track.
              const hB = Math.atan2(e * ax[1], e * ax[0]);
              const off = -sB * dB; // B to the right (sB = 1): the track is on B's left
              const lat: P2 = [-Math.sin(hB) * off, Math.cos(hB) * off];
              const endC: P2 = [ob.c[0] + ax[0] * e * ob.L, ob.c[1] + ax[1] * e * ob.L];
              const S0: P2 = [endC[0] + lat[0] - Math.cos(hB) * sideLen, endC[1] + lat[1] - Math.sin(hB) * sideLen];
              // Must be ahead of the roof's end, and not need a U-turn to get there.
              const dx = S0[0] - lead[0], dz = S0[1] - lead[1], dist = Math.hypot(dx, dz);
              if (dist < 10 || dist > 130) continue;
              let dh = hB - a;
              while (dh > Math.PI) dh -= 2 * Math.PI;
              while (dh < -Math.PI) dh += 2 * Math.PI;
              void dh;
              const ring = arcs(S0, hB, [[sideLen, 0], [(turnDeg / 180) * Math.PI * dB, sB / dB], [12, 0]], 4);
              for (const rr of [24]) {
                const dj = dubins(lead, a, S0, hB, rr);
                if (!dj) continue;
                const join = arcs(lead, a, dj).pts;
                const Pout = ring.end, hx = ring.h, hdx = Math.cos(hx), hdz = Math.sin(hx);
                const ctrl = [lead, ...join, ...ring.pts];
                const len = k2len([E1, ...ctrl]);
                const yL = +Math.max(5.5, yR - GRADE * rate * len).toFixed(2);
                const Q: P2 = [Pout[0] + hdx * 25, Pout[1] + hdz * 25]; // straight before the loop (no steering in it)
                ctrl.push(Q);
                const keys = ctrl.map(() => null as number | null);
                keys[keys.length - 1] = keys[keys.length - 2] = yL;
                // Check this half on its own first (from the end of the roof).
                const pre = makePath({ ctrl: [F(L - 6, 0), F(L + 2, 0), E1, ...ctrl], keys: [yR, yR, yR, ...keys] });
                if (process.env.DUMP === String(ai)) dump.push({ id: typeof pre === 'string' ? pre : checkPart(pre, over) + ' ' + lastHit, name: '', through: [], parts: [{ kind: 'path', pts: [F(L - 6, 0), F(L + 2, 0), E1, ...ctrl].map(([x, z]) => [x, 0, z] as V3) }] });
                if (typeof pre === 'string' || checkPart(pre, over)) continue;
                const lp = loopFrom(Q, hx, yL);
                if (checkPart({ kind: 'loop', loop: lp.loop })) continue;
                for (const tail of connectors(lp.exit, hx, yL, 'down').slice(0, 4)) downs.push({ ctrl, keys, loop: lp.loop, tail, B: bj });
              }
            }
          }
    }
    if (!downs.length) { no('B: none'); continue; }
    // A few different ones (different neighbours first).
    downs.sort(() => Math.random() - 0.5);
    const seen = new Map<number, number>();
    const someDowns = downs.filter((d) => { const n = seen.get(d.B) ?? 0; seen.set(d.B, n + 1); return n < 3; }).slice(0, 24);
    // The way up: a ramp from the ground that arrives in line with the roof, 12 m before its
    // edge, at deck height. The deck runs the whole length of the roof.
    const roofSpec = { ctrl: ([[-L - 12, 0], [-L - 2, 0], [0, 0], [L + 2, 0], [L + 12, 0]] as P2[]).map(([u, v]) => F(u, v)), keys: [yR, yR, yR, yR, yR] };
    for (const up of connectors(F(-L - 12, 0), a, yR, 'up', [0, 15, 40]).slice(0, 10))
      for (const d of someDowns) {
        const t = assemble('', '', [
          { ctrl: [...up.ctrl.slice(0, -1), ...roofSpec.ctrl, ...d.ctrl], keys: [...up.keys.slice(0, -1), ...roofSpec.keys, ...d.keys] },
          { loop: d.loop },
          d.tail,
        ], { over: [ai] });
        if (typeof t === 'string') continue;
        if (check(t)) continue;
        out.push({ t, score: Math.min(yR, 16) * 3 + L - margin * 5 - 300 * sharpest(t) + Math.random() * 5 });
      }
    }
  }
  return out;
}

/**
 * Ways between the ground and a point P up in the air (height y, travelling along heading h
 * there): straight on, then up to two bends, then straight down to the ground and a run on the
 * ground. 'down' leaves P; 'up' arrives at P (built backwards). Only those that fit the map.
 */
function connectors(P: P2, h: number, y: number, dir: 'up' | 'down', firsts = [0, 15, 35], hold = 8): PathSpec[] {
  const total = hold + y / GRADE + 18, R = 30;
  const out: { spec: PathSpec; cost: number }[] = [];
  for (const s1 of firsts)
    for (const g1 of [0, 45, -45, 90, -90, 135, -135, 180, -180])
      for (const s2 of g1 ? [0, 30, 50] : [0])
        for (const g2 of g1 ? [0, 45, -45, 90, -90] : [0]) {
          if (g1 * g2 < 0 && s2 < 25) continue; // no quick S-bends (fast cars get thrown off)
          const segs: [number, number][] = [[hold + s1, 0]];
          if (g1) segs.push([(Math.abs(g1) * Math.PI * R) / 180, Math.sign(g1) / R]);
          if (s2) segs.push([s2, 0]);
          if (g2) segs.push([(Math.abs(g2) * Math.PI * R) / 180, Math.sign(g2) / R]);
          const used = segs.reduce((a, s) => a + s[0], 0);
          if (used > total - 18) continue; // must end with a straight run onto the ground
          segs.push([total - used, 0]);
          const pts = [P, ...arcs(P, dir === 'down' ? h : h + Math.PI, segs).pts];
          const k = keysAt(pts, [[0, y], [hold, y], [total - 18, 0], [total, 0]]);
          const spec = dir === 'down' ? { ctrl: pts, keys: k.keys } : { ctrl: pts.reverse(), keys: k.keys.reverse() };
          const p = makePath(spec);
          if (typeof p === 'string' || checkPart(p)) continue;
          out.push({ spec, cost: Math.abs(g1) + Math.abs(g2) + s1 / 10 + Math.random() * 10 });
        }
  return out.sort((a, b) => a.cost - b.cost).map((o) => o.spec);
}

const roofCands: { t: Track; score: number; ai: number }[] = [];
const testedTracks: Track[] = []; // debugging (--dry): every test-driven roof track, id = result
const dump: Track[] = []; // debugging: DUMP=<building> writes the tried shapes to scripts/cache
if (!ONLY.length || ONLY.includes('roof')) {
  const flats = map.buildings.map((b, i) => i).filter((i) => {
    if (process.env.DUMP && process.env.DUMP !== String(i)) return false;
    const b = map.buildings[i];
    if (b.eave || b.ridge || b.church || b.h < 8 || b.h > 22) return false;
    const bx = box(b.pts);
    return bx.L * 2 >= 35 && bx.L * 2 <= 160 && bx.Wb * 2 >= 8 && bx.Wb * 2 <= 24;
  });
  console.log(`${flats.length} flat-roofed blocks to try`);
  for (const ai of flats) {
    const before = { ...why };
    const cs = roofTracks(ai);
    for (const c of cs) roofCands.push({ ...c, ai });
    if (process.env.DEBUG) {
      const b = map.buildings[ai], bx = box(b.pts);
      const diff = Object.fromEntries(Object.entries(why).map(([k, v]) => [k, v - (before[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
      console.log(`  block ${ai} at ${bx.c.map((v) => v.toFixed(0))} ${(2 * bx.L).toFixed(0)}x${(2 * bx.Wb).toFixed(0)} h ${b.h}: ${cs.length} fit`, JSON.stringify(diff));
    }
  }
  if (dump.length) writeFileSync('scripts/cache/dump.json', JSON.stringify(dump.slice(0, 400)));
  if (DRY) writeFileSync('scripts/cache/roofcands.json', JSON.stringify(roofCands.slice(0, 20).map((c) => c.t)));
  roofCands.sort((a, b) => b.score - a.score);
  console.log(`${roofCands.length} roof track candidates`, JSON.stringify(why));
  let n = 0, tested = 0;
  const tried = new Map<number, number>();
  for (const c of roofCands) {
    if (n >= 2 || tested > 80) break;
    if ((tried.get(c.ai) ?? 0) >= 10) continue; // a few variants per building
    if (!farFromOthers(c.t, 250)) continue;
    if (check(c.t)) continue; // (the tracks chosen so far are in the keep-out raster now)
    tried.set(c.ai, (tried.get(c.ai) ?? 0) + 1);
    tested++;
    const err = drive(c.t);
    testedTracks.push({ ...c.t, id: err });
    const [cx, cz] = centreOf(c.t);
    console.log(`roof track on building ${c.ai} (h ${map.buildings[c.ai].h}) near ${cx.toFixed(0)},${cz.toFixed(0)}: ${err || 'OK'}`);
    if (err) continue;
    n++;
    c.t.id = `${PREFIX}roof${n}`;
    c.t.name = n === 1 ? 'Dakrace' : `Dakrace ${nearestStreetName(cx, cz)}`;
    c.t.free = n === 1;
    await accept(c.t);
  }
}

// ---- 2. tracks in open spaces: built once around (0, 0) heading +x, then moved and turned
interface Tpl { kind: string; name: string; free: boolean; variants: () => { t: Track; tag: string }[]; score: (t: Track) => number; needs?: (t: Track) => boolean }
const straight = (u0: number, u1: number, v = 0, step = 5): P2[] => {
  const out: P2[] = [];
  const n = Math.max(1, Math.round(Math.abs(u1 - u0) / step));
  for (let i = 0; i <= n; i++) out.push([u0 + ((u1 - u0) * i) / n, v]);
  return out;
};
/** A piece given in the frame of the last loop's exit (u ahead, v to the right). */
interface Rel { rel: P2[]; keys: (number | null)[] }
const fromExit = (rel: P2[], keys: (number | null)[]): Rel => ({ rel, keys });
/** Path pieces and loops in driving order; a loop starts where the piece before it ends. */
function seq(...items: (PathSpec | Rel | { loopY: number })[]): Track | string {
  const specs: Spec[] = [];
  let exit: P2 = [0, 0], dir = 0;
  for (const it of items) {
    if ('loopY' in it) {
      const c = (specs[specs.length - 1] as PathSpec).ctrl, a = c[c.length - 1], b = c[c.length - 2];
      const { loop } = loopFrom(a, Math.atan2(a[1] - b[1], a[0] - b[0]), it.loopY);
      specs.push({ loop });
      const e = loopExit(loop);
      (exit = [e.x, e.z]), (dir = Math.atan2(e.dirZ, e.dirX));
    } else if ('rel' in it) {
      specs.push({ ctrl: it.rel.map(([u, v]): P2 => [exit[0] + Math.cos(dir) * u - Math.sin(dir) * v, exit[1] + Math.sin(dir) * u + Math.cos(dir) * v]), keys: it.keys });
    } else specs.push(it);
  }
  return assemble('', '', specs);
}

const climbTo = (y: number) => y / (GRADE * 0.9);
const tpls: Tpl[] = [
  {
    kind: 'spiral', name: 'Kurkentrekker', free: true,
    // Up a long straight, then a banked corkscrew down (1¼ turns), and a loop on the ground.
    variants: () => {
      const out: { t: Track; tag: string }[] = [];
      for (const R of [16, 20])
        for (const sd of [1, -1]) {
          const top = 11;
          const lc = climbTo(top);
          const turns = 1.25, T = turns * 2 * Math.PI;
          const drop = Math.min(top, GRADE * R * T);
          const C: P2 = [lc, sd * R], th0 = -sd * Math.PI / 2;
          const helix: P2[] = [];
          for (let d = 12; d <= turns * 360; d += 12) {
            const th = th0 + (sd * d * Math.PI) / 180;
            helix.push([C[0] + R * Math.cos(th), C[1] + R * Math.sin(th)]);
          }
          const hEnd = helix[helix.length - 1], hd = th0 + sd * T + (sd * Math.PI) / 2;
          const ctrl = [...straight(-18, lc), ...helix, [hEnd[0] + Math.cos(hd) * 14, hEnd[1] + Math.sin(hd) * 14] as P2];
          const keys = ctrl.map(() => null as number | null);
          keys[0] = keys[1] = 0;
          keys[straight(-18, lc).length - 1] = top;
          keys[keys.length - 2] = top - drop;
          keys[keys.length - 1] = top - drop;
          if (top - drop > 0.01) continue;
          const t = seq({ ctrl, keys }, { loopY: 0 }, fromExit([[0, 0], [12, 0], [24, 0]], [0, 0, 0]));
          if (typeof t !== 'string') out.push({ t, tag: `R${R} ${sd > 0 ? 'right' : 'left'}` });
        }
      return out;
    },
    score: () => 0,
  },
  {
    kind: 'canal', name: 'Kanaalbrug', free: false,
    // Up, a loop high above the bank, then straight over the water and down on the other side.
    variants: () => {
      const out: { t: Track; tag: string }[] = [];
      for (const y of [6, 7.5])
        for (const span of [30, 50]) {
          const lc = climbTo(y);
          const c1 = straight(-16, lc + 14);
          const k1 = c1.map(() => null as number | null);
          k1[0] = k1[1] = 0;
          k1[k1.length - 2] = k1[k1.length - 1] = y;
          for (let i = 0; i < c1.length; i++) if (c1[i][0] >= lc - 0.1) k1[i] = y;
          const dn = climbTo(y);
          const t = seq({ ctrl: c1, keys: k1 }, { loopY: y }, fromExit([[0, 0], [span / 2, 0], [span, 0], [span + dn / 2, 0], [span + dn, 0], [span + dn + 16, 0]], [y, y, y, null, 0, 0]));
          if (typeof t !== 'string') out.push({ t, tag: `y${y} span${span}` });
        }
      return out;
    },
    // As much water under it as possible.
    score: (t) => t.parts.reduce((a, p) => a + (p.kind === 'path' ? p.pts.filter(([x, y, z]) => y > 3 && at(water, x, z)).length : 0), 0),
    needs: (t) => t.parts.some((p) => p.kind === 'path' && p.pts.filter(([x, y, z]) => y > 3 && at(water, x, z)).length >= 4),
  },
  {
    kind: 'gap', name: 'Gatensprong', free: false,
    // Up, a kicker at the top, fly over a gap onto a downhill landing piece, a loop at the bottom.
    variants: () => {
      const out: { t: Track; tag: string }[] = [];
      for (const top of [6.5, 8])
        for (const gap of [7, 10])
          for (const drop of [0.8, 1.6]) {
            const lc = climbTo(top);
            const c1: P2[] = [...straight(-16, lc + 14), [lc + 20, 0], [lc + 26, 0]];
            const k1 = c1.map(() => null as number | null);
            k1[0] = k1[1] = 0;
            for (let i = 0; i < c1.length; i++) if (c1[i][0] >= lc - 0.1) k1[i] = top;
            k1[k1.length - 2] = top + 0.3;
            k1[k1.length - 1] = top + 0.8;
            const y2 = top + 0.8 - drop, u2 = lc + 26 + gap, dn = climbTo(y2);
            const c2: P2[] = [[u2, 0], [u2 + 6, 0], [u2 + dn / 2, 0], [u2 + dn + 6, 0], [u2 + dn + 26, 0]];
            const t = seq({ ctrl: c1, keys: k1 }, { ctrl: c2, keys: [y2, null, null, 0, 0] }, { loopY: 0 }, fromExit([[0, 0], [12, 0], [26, 0]], [0, 0, 0]));
            if (typeof t !== 'string') out.push({ t, tag: `top${top} gap${gap} drop${drop}` });
          }
      return out;
    },
    score: () => 0,
  },
  {
    kind: 'double', name: 'Dubbele looping', free: false,
    // Up, two loops in a row high in the air, a banked bend and back down.
    variants: () => {
      const out: { t: Track; tag: string }[] = [];
      for (const y of [5.5, 7])
        for (const bend of [0, 25, -25]) {
          const lc = climbTo(y);
          const c1 = straight(-16, lc + 14);
          const k1 = c1.map((p) => (p[0] >= lc - 0.1 ? y : null) as number | null);
          k1[0] = k1[1] = 0;
          const dn = climbTo(y), b = (bend * Math.PI) / 180;
          const tail: P2[] = [[0, 0], [10, 0], [22, Math.tan(b / 2) * 6], [22 + Math.cos(b) * dn * 0.5, Math.sin(b) * dn * 0.5 + Math.tan(b / 2) * 6], [22 + Math.cos(b) * (dn + 10), Math.sin(b) * (dn + 10)], [22 + Math.cos(b) * (dn + 28), Math.sin(b) * (dn + 28)]];
          const t = seq({ ctrl: c1, keys: k1 }, { loopY: y }, fromExit([[0, 0], [8, 0], [16, 0]], [y, y, y]), { loopY: y }, fromExit(tail, [y, y, y, null, 0, 0]));
          if (typeof t !== 'string') out.push({ t, tag: `y${y} bend${bend}` });
        }
      return out;
    },
    score: () => 0,
  },
];

/** The track moved to (x, z) and turned by `a`. */
function place(t: Track, x: number, z: number, a: number): Track {
  const c = Math.cos(a), s = Math.sin(a);
  const tr = (px: number, pz: number): [number, number] => [+(x + c * px - s * pz).toFixed(2), +(z + s * px + c * pz).toFixed(2)];
  return {
    ...t,
    parts: t.parts.map((p) => {
      if (p.kind === 'loop') {
        const [lx, lz] = tr(p.loop.x, p.loop.z);
        return { kind: 'loop', loop: { ...p.loop, x: lx, z: lz, yaw: +(p.loop.yaw + a).toFixed(4) } };
      }
      return { ...p, pts: p.pts.map(([px, py, pz]) => { const [wx, wz] = tr(px, pz); return [wx, py, wz] as V3; }) };
    }),
  };
}

for (const tpl of tpls) {
  if (ONLY.length && !ONLY.includes(tpl.kind)) continue;
  // The shape must not run into itself (checked once, before it is moved around).
  const vs = tpl.variants().filter((v) => !selfCross(trackPoints(v.t)));
  console.log(`${tpl.name}: ${vs.length} shapes`, JSON.stringify(why));
  if (process.env.SHAPES_ONLY) continue;
  const cands: { t: Track; score: number; label: string }[] = [];
  for (const k in why) delete why[k];
  for (const v of vs)
    for (let x = -680; x <= 680; x += 12)
      for (let z = -680; z <= 680; z += 12) {
        if (at(keep, x, z) || at(street, x, z) || bAt(x, z) >= 0 || at(water, x, z)) continue;
        if (!streetNear(x, z, 30)) continue;
        for (let k = 0; k < 24; k++) {
          const t = place(v.t, x, z, (k / 24) * Math.PI * 2);
          if (check(t, false)) continue;
          if (tpl.needs && !tpl.needs(t)) { no('needs'); continue; }
          cands.push({ t, score: tpl.score(t) + Math.random(), label: `${v.tag} at ${x},${z} heading ${k * 15}` });
        }
      }
  console.log(`  ${cands.length} places fit`, JSON.stringify(why));
  // Spread the tracks over the map: far from the other tracks first (and the template's own wish).
  const spread = (t: Track) => {
    const c = centreOf(t);
    return Math.min(400, ...[...map.tracks!].map((o) => Math.hypot(centreOf(o)[0] - c[0], centreOf(o)[1] - c[1])));
  };
  for (const c of cands) c.score = c.score * 20 + spread(c.t);
  cands.sort((a, b) => b.score - a.score);
  let tested = 0;
  for (const c of cands) {
    if (tested >= 30) break;
    if (!farFromOthers(c.t, 220)) continue;
    if (check(c.t, false)) continue; // (the tracks chosen so far are in the keep-out raster now)
    tested++;
    const err = drive(c.t);
    console.log(`  ${tpl.name} ${c.label}: ${err || 'OK'}`);
    if (err) continue;
    c.t.id = `${PREFIX}${tpl.kind}`;
    c.t.name = tpl.name;
    c.t.free = tpl.free;
    await accept(c.t);
    break;
  }
}

console.log(`${chosen.length} new tracks:`, chosen.map((t) => `${t.id} ${t.name}${t.free ? ' (free)' : ''}`).join(', '));
delete (map as Partial<MapData>).lod3d;
if (DRY) writeFileSync('scripts/cache/building-tracks.dry.json', JSON.stringify(chosen));
if (DRY) writeFileSync('scripts/cache/tested.json', JSON.stringify(testedTracks));
else writeFileSync(DATA, JSON.stringify(map));
