// Sanity checks on the map data (catches a broken data step before it reaches the game).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMapData } from './world';

const map = loadMapData();

test('the map has everything', () => {
  assert.ok(map.roads.length > 1000);
  assert.ok(map.buildings.length > 5000);
  assert.ok(map.buildings.filter((b) => b.lod).length > 3000, '3D building shapes missing');
  assert.ok((map.cityTrees ?? []).length > 5000, 'city trees missing');
  assert.ok((map.hedges ?? []).length > 50, 'hedges missing');
  assert.ok((map.ramps ?? []).length >= 8, 'ramps missing');
  assert.ok(map.buildings.filter((b) => b.facade).length > 200, 'Mapillary façade colours missing');
});

test('3D building data stays inside the binary file', () => {
  const pos = map.lod3d!.pos.length / 3, idx = map.lod3d!.idx;
  for (const b of map.buildings) {
    if (!b.lod) continue;
    const [v0, nv, i0, nWall, nRoof] = b.lod;
    assert.ok(v0 + nv <= pos && i0 + nWall + nRoof <= idx.length);
    for (let k = i0; k < i0 + nWall + nRoof; k++) assert.ok(idx[k] < nv);
  }
});

test('ramps are inside the map and not on a street', () => {
  for (const r of map.ramps ?? []) {
    assert.ok(Math.abs(r.x) < 700 && Math.abs(r.z) < 700, `ramp at ${r.x},${r.z} outside the map`);
    assert.ok(r.h > 0 && r.len > r.h * 2, `ramp at ${r.x},${r.z} is too steep`);
  }
});

test('no hedge crosses a street', () => {
  const cross = (a: number[], b: number[], c: number[], d: number[]) => {
    const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  const streets = map.roads.filter((r) => r.drivable && !r.tunnel);
  for (const h of map.hedges ?? [])
    for (let i = 0; i < h.pts.length - 1; i++)
      for (const r of streets)
        for (let j = 0; j < r.pts.length - 1; j++)
          assert.ok(!cross(h.pts[i], h.pts[i + 1], r.pts[j], r.pts[j + 1]), `hedge crosses ${r.name || r.kind}`);
});
