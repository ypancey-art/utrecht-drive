// Finds good spots for jump ramps and stores them in public/data/overvecht.json (`ramps`):
//  - water ramps: a ramp on one bank, a 7-20 m jump over a canal or pond, a free landing beyond;
//  - roof ramps: a ramp against a long flat-roofed low building, so you can drive up onto the roof.
// Each needs a long free run-up (no buildings, trees, hedges, water or railway).
// Run after the other data steps: npx tsx scripts/place-ramps.ts
import { readFileSync, writeFileSync } from 'node:fs';
import type { MapData, Pt } from '../src/game/mapData';
import { placeScenery } from '../src/game/scenery';

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
const inMap = (x: number, z: number) => Math.abs(x) < 700 && Math.abs(z) < 700;

export interface Ramp { x: number; z: number; yaw: number; len: number; h: number; w: number; kind: 'water' | 'roof' }
const ramps: Ramp[] = [];
const far = (x: number, z: number, d: number) => ramps.every((r) => Math.hypot(r.x - x, r.z - z) > d);

// ---- water ramps
const WL = 7, WH = 1.6, W = 4;
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
      if (onRoad(cx, cz) || onRoad(x, z) || onRoad(x - ux * WL, z - uz * WL)) continue;
      if (!inMap(x - ux * (WL + 40), z - uz * (WL + 40)) || !inMap(x + ux * (t2 + 26), z + uz * (t2 + 26))) continue;
      cands.push({ x: cx, z: cz, yaw: a, len: WL, h: WH, w: W, kind: 'water', score: -Math.abs(t2 - 14) });
    }
  }
cands.sort((a, b) => b.score - a.score);
for (const c of cands) {
  if (ramps.filter((r) => r.kind === 'water').length >= 10) break;
  if (!far(c.x, c.z, 140)) continue;
  const { score: _s, ...r } = c;
  ramps.push(r);
}

// ---- roof ramps: flat roofs 3-8 m high, a long wall with open ground in front of it
const roofCands: (Ramp & { score: number })[] = [];
for (const b of map.buildings) {
  if (b.eave || b.church || b.h < 3 || b.h > 8) continue;
  const pts = b.pts;
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) area += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  if (Math.abs(area / 2) < 250) continue;
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 14) continue;
    // Outward normal and the middle of the wall.
    const nx = (sign * (bz - az)) / len, nz = (sign * -(bx - ax)) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const L = Math.max(8, b.h * 3.3);
    // The roof must continue a good way past the wall (so you don't fly off straight away).
    let roof = 0;
    for (let d = 1; d < 40; d++) { if (!at(solid, mx - nx * d, mz - nz * d)) break; roof = d; }
    if (roof < 12) continue;
    const sx = mx + nx * 0.6, sz = mz + nz * 0.6; // ramp top lip, against the wall
    if (!free(sx + nx * 0.5, sz + nz * 0.5, nx, nz, L + 35, W, solid) || !free(sx, sz, nx, nz, L + 35, W, water)) continue;
    const cx = sx + nx * (L / 2), cz = sz + nz * (L / 2);
    if (onRoad(cx, cz) || onRoad(sx + nx * L, sz + nz * L)) continue;
    if (!inMap(sx + nx * (L + 35), sz + nz * (L + 35)) || !inMap(mx - nx * roof, mz - nz * roof)) continue;
    roofCands.push({ x: cx, z: cz, yaw: Math.atan2(-nz, -nx), len: L, h: b.h + 0.15, w: W, kind: 'roof', score: roof + len / 2 });
  }
}
roofCands.sort((a, b) => b.score - a.score);
for (const c of roofCands) {
  if (ramps.filter((r) => r.kind === 'roof').length >= 8) break;
  if (!far(c.x, c.z, 140)) continue;
  const { score: _s, ...r } = c;
  ramps.push(r);
}
for (const r of ramps) for (const k of ['x', 'z', 'yaw', 'len', 'h'] as const) r[k] = +r[k].toFixed(2);
(map as MapData & { ramps: Ramp[] }).ramps = ramps;
console.log(`${ramps.filter((r) => r.kind === 'water').length} water ramps, ${ramps.filter((r) => r.kind === 'roof').length} roof ramps`);
for (const r of ramps) console.log(r.kind, r.x, r.z, ((r.yaw * 180) / Math.PI).toFixed(0), r.h);
// Don't save the in-memory lod3d typed arrays.
delete (map as Partial<MapData>).lod3d;
writeFileSync(DATA, JSON.stringify(map));
