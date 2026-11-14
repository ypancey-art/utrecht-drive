// Real 3D building shapes (3D BAG LoD2.2) and roof colours (PDOK aerial photo).
// Run after fetch-osm: npm run fetch-3d
//  -> public/data/buildings3d.bin  (Int16 positions in decimetres, Uint16 indices)
//  -> adds `lod` (offsets into the .bin), `roofColor` and `church` to buildings in overvecht.json
// Downloads are cached in scripts/cache/. Needs macOS `sips` to decode the aerial JPEGs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ShapeUtils, Vector2 } from 'three';
import { toRd } from './rd.mjs';

const DATA = 'public/data/overvecht.json';
const map = JSON.parse(readFileSync(DATA, 'utf8'));
for (const b of map.buildings) delete b.lod, delete b.roofColor, delete b.church; // safe to run again
const bag = JSON.parse(readFileSync('scripts/cache/bag3d.json', 'utf8'));
const osm = JSON.parse(readFileSync('scripts/cache/osm-raw.json', 'utf8'));
const { lat: LAT0, lon: LON0 } = map.center;
const M_PER_LAT = 111320, M_PER_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const local = (lat, lon) => [(lon - LON0) * M_PER_LON, -(lat - LAT0) * M_PER_LAT];

// RD -> local metres: least-squares affine fit on a grid of points (accounts for RD grid rotation).
const fit = (() => {
  const rows = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const lat = LAT0 + i * 0.004, lon = LON0 + j * 0.006;
    rows.push([toRd(lat, lon), local(lat, lon)]);
  }
  const solve = (k) => {
    // Normal equations for [X, Y, 1] -> local[k]
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const [[X, Y], l] of rows) {
      const v = [X - 136800, Y - 458100, 1];
      for (let r = 0; r < 3; r++) {
        b[r] += v[r] * l[k];
        for (let c = 0; c < 3; c++) A[r][c] += v[r] * v[c];
      }
    }
    // Gaussian elimination
    for (let r = 0; r < 3; r++) {
      const p = A[r][r];
      for (let c = r; c < 3; c++) A[r][c] /= p;
      b[r] /= p;
      for (let o = 0; o < 3; o++) if (o !== r) {
        const f = A[o][r];
        for (let c = r; c < 3; c++) A[o][c] -= f * A[r][c];
        b[o] -= f * b[r];
      }
    }
    return b;
  };
  const fx = solve(0), fz = solve(1);
  return (X, Y) => [fx[0] * (X - 136800) + fx[1] * (Y - 458100) + fx[2], fz[0] * (X - 136800) + fz[1] * (Y - 458100) + fz[2]];
})();

mkdirSync('scripts/cache/cityjson', { recursive: true });
const [minX, minY] = toRd(LAT0 - 0.0068, LON0 - 0.011).map(Math.floor);
const [maxX, maxY] = toRd(LAT0 + 0.0068, LON0 + 0.011).map(Math.ceil);

// --- 1. CityJSON pages (50 per page; the API's own "next" link skips items, so page by offset) ---
async function page(offset) {
  const file = `scripts/cache/cityjson/${offset}.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.3dbag.nl/collections/pand/items?bbox=${minX},${minY},${maxX},${maxY}&limit=50&offset=${offset}`);
      if (res.ok) {
        const txt = await res.text();
        writeFileSync(file, txt);
        return JSON.parse(txt);
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('page failed ' + offset);
}
const first = await page(0);
const total = first.numberMatched;
const offsets = [];
for (let o = 50; o < total; o += 50) offsets.push(o);
const pages = [first];
for (let i = 0; i < offsets.length; i += 8) {
  pages.push(...(await Promise.all(offsets.slice(i, i + 8).map(page))));
  process.stdout.write(`\r  3D BAG pages ${Math.min(pages.length, offsets.length + 1)}/${offsets.length + 1}`);
}
console.log();

// --- 2. LoD2.2 meshes for buildings with non-flat roofs ---
const wanted = new Map(); // BAG id -> index in map.buildings
// map.buildings were made from bag (same order, skipping some); match by footprint centroid.
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const byCell = new Map();
map.buildings.forEach((b, i) => {
  const [x, z] = centroid(b.pts);
  const k = `${Math.round(x / 2)},${Math.round(z / 2)}`;
  byCell.set(k, [...(byCell.get(k) ?? []), i]);
});
for (const f of bag) {
  const p = f.properties;
  if (p.b3_dak_type === 'horizontal' || !f.geometry) continue;
  const ring = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0]).map(([a, b]) => (a > 40 ? local(a, b) : local(b, a)));
  const [x, z] = centroid(ring);
  const idx = byCell.get(`${Math.round(x / 2)},${Math.round(z / 2)}`)?.[0];
  if (idx !== undefined) wanted.set(p.identificatie, idx);
}

const positions = [], indices = [];
let lodCount = 0;
for (const pg of pages) {
  if (!pg.metadata?.transform || !pg.features) continue;
  const [sx, sy, sz] = pg.metadata.transform.scale, [tx, ty, tz] = pg.metadata.transform.translate;
  for (const feat of pg.features) {
    const idx = wanted.get(feat.id);
    if (idx === undefined || map.buildings[idx].lod) continue;
    const ground = bag.find((f) => f.properties.identificatie === feat.id)?.properties.b3_h_maaiveld ?? 0;
    const V = feat.vertices.map(([x, y, z]) => {
      const [lx, lz] = fit(x * sx + tx, y * sy + ty);
      return [lx, z * sz + tz - ground, lz];
    });
    const vStart = positions.length / 3, wallIdx = [], roofIdx = [];
    const used = new Map();
    const vid = (i) => {
      if (!used.has(i)) {
        used.set(i, positions.length / 3 - vStart);
        positions.push(...V[i]);
      }
      return used.get(i);
    };
    for (const obj of Object.values(feat.CityObjects)) {
      if (obj.type !== 'BuildingPart') continue;
      const geom = obj.geometry?.find((g) => g.lod === '2.2');
      if (!geom || geom.type !== 'Solid') continue;
      const surfaces = geom.boundaries[0];
      const sem = geom.semantics;
      surfaces.forEach((rings, si) => {
        const type = sem?.surfaces?.[sem.values?.[0]?.[si]]?.type ?? 'WallSurface';
        if (type === 'GroundSurface') return;
        // Triangulate in the polygon's own plane (drop the axis it faces most).
        const pts = rings.map((r) => r.map((i) => V[i]));
        const o = pts[0];
        let nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < o.length; i++) {
          const a = o[i], b = o[(i + 1) % o.length];
          nx += (a[1] - b[1]) * (a[2] + b[2]);
          ny += (a[2] - b[2]) * (a[0] + b[0]);
          nz += (a[0] - b[0]) * (a[1] + b[1]);
        }
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        const proj = ax >= ay && ax >= az ? (p) => new Vector2(p[1], p[2]) : ay >= az ? (p) => new Vector2(p[0], p[2]) : (p) => new Vector2(p[0], p[1]);
        const contour = pts[0].map(proj), holes = pts.slice(1).map((h) => h.map(proj));
        const flat = rings.flat();
        const allPts = pts.flat();
        for (const tri of ShapeUtils.triangulateShape(contour, holes)) {
          // Keep the triangle facing the same way as the original polygon (outwards).
          const [a, b, c] = tri.map((t) => allPts[t]);
          const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
          const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
          const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          const order = cx * nx + cy * ny + cz * nz < 0 ? [tri[0], tri[2], tri[1]] : tri;
          const target = type === 'RoofSurface' ? roofIdx : wallIdx;
          target.push(...order.map((t) => vid(flat[t])));
        }
      });
    }
    const nv = positions.length / 3 - vStart;
    if (!nv || nv > 65000) {
      positions.length = vStart * 3;
      continue;
    }
    const iStart = indices.length;
    indices.push(...wallIdx, ...roofIdx);
    map.buildings[idx].lod = [vStart, nv, iStart, wallIdx.length, roofIdx.length];
    lodCount++;
  }
}
console.log(`LoD2.2 meshes: ${lodCount} buildings, ${positions.length / 3} vertices, ${indices.length / 3} triangles`);

// --- 3. Churches and mosques from OSM ---
const nodes = new Map(osm.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
const pip = (x, z, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
for (const w of osm.elements) {
  const t = w.tags ?? {};
  if (w.type !== 'way' || !(t.building === 'church' || t.building === 'chapel' || t.building === 'mosque' || t.amenity === 'place_of_worship')) continue;
  const pts = w.nodes.map((id) => nodes.get(id)).filter(Boolean).map((n) => local(n.lat, n.lon));
  for (const b of map.buildings) {
    const [cx, cz] = centroid(b.pts);
    if (pip(cx, cz, pts) || pts.some(([x, z]) => pip(x, z, b.pts))) b.church = t.building === 'mosque' || t.religion === 'muslim' ? 'mosque' : 'church';
  }
}
console.log('places of worship:', map.buildings.filter((b) => b.church).length, 'building parts');

// --- 4. Roof colours from the PDOK aerial photo (CC BY 4.0), 0.5 m per pixel ---
const TILE = 500, PX = 1000;
function readBmp(file) {
  const b = readFileSync(file);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
  const rowLen = Math.ceil((w * bpp) / 4) * 4;
  return { w, h: Math.abs(h), at: (x, y) => {
    const row = h > 0 ? Math.abs(h) - 1 - y : y;
    const o = off + row * rowLen + x * bpp;
    return [b[o + 2], b[o + 1], b[o]];
  } };
}
const tiles = new Map();
async function aerial(tx, ty) {
  const key = `${tx},${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const jpg = `scripts/cache/aerial-${tx}-${ty}.jpg`, bmp = jpg.replace('.jpg', '.bmp');
  if (!existsSync(bmp)) {
    const url = `https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR&styles=&crs=EPSG:28992&bbox=${tx},${ty},${tx + TILE},${ty + TILE}&width=${PX}&height=${PX}&format=image/jpeg`;
    writeFileSync(jpg, Buffer.from(await (await fetch(url)).arrayBuffer()));
    execFileSync('sips', ['-s', 'format', 'bmp', jpg, '--out', bmp], { stdio: 'ignore' });
  }
  const img = readBmp(bmp);
  tiles.set(key, img);
  return img;
}
// local -> RD: invert the affine fit numerically (Newton, 2 steps is plenty).
const toRdLocal = (x, z) => {
  let X = 136800 + x, Y = 458100 - z;
  for (let i = 0; i < 4; i++) {
    const [lx, lz] = fit(X, Y), [lx2] = fit(X + 1, Y), [, lz2] = fit(X, Y + 1);
    X -= (lx - x) / (lx2 - lx);
    Y -= (lz - z) / (lz2 - lz);
  }
  return [X, Y];
};
let coloured = 0;
for (const b of map.buildings) {
  const [cx, cz] = centroid(b.pts);
  // Sample the centroid and points halfway to each corner; take the median colour.
  const samples = [];
  for (const p of [[cx, cz], ...b.pts.slice(0, 8).map(([x, z]) => [(x + cx) / 2, (z + cz) / 2])]) {
    if (!pip(p[0], p[1], b.pts)) continue;
    const [X, Y] = toRdLocal(p[0], p[1]);
    const tx = Math.floor(X / TILE) * TILE, ty = Math.floor(Y / TILE) * TILE;
    const img = await aerial(tx, ty);
    const px = Math.min(PX - 1, Math.floor(((X - tx) / TILE) * PX)), py = Math.min(PX - 1, Math.floor(((ty + TILE - Y) / TILE) * PX));
    samples.push(img.at(px, py));
  }
  if (!samples.length) continue;
  const med = [0, 1, 2].map((c) => samples.map((s) => s[c]).sort((a, z) => a - z)[samples.length >> 1]);
  b.roofColor = (med[0] << 16) | (med[1] << 8) | med[2];
  coloured++;
}
console.log('roof colours:', coloured, 'buildings, aerial tiles:', tiles.size);

const buf = Buffer.alloc(positions.length * 2 + indices.length * 2);
positions.forEach((v, i) => buf.writeInt16LE(Math.round(v * 10), i * 2));
indices.forEach((v, i) => buf.writeUInt16LE(v, positions.length * 2 + i * 2));
writeFileSync('public/data/buildings3d.bin', buf);
map.lodInfo = { positions: positions.length, indices: indices.length };
writeFileSync(DATA, JSON.stringify(map));
console.log(`buildings3d.bin ${(buf.length / 1e6).toFixed(1)} MB`);
