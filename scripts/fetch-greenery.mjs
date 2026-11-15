// Hedges and shrub beds from OpenStreetMap (ODbL). Run after the other fetch steps:
//   npm run fetch-greenery
//  -> adds `hedges` ({pts, h}) and `shrubs` ({pts}) to public/data/overvecht.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const DATA = 'public/data/overvecht.json';
const RAW = 'scripts/cache/osm-greenery.json';
const map = JSON.parse(readFileSync(DATA, 'utf8'));
const { lat: LAT0, lon: LON0 } = map.center;
const M_PER_LAT = 111320, M_PER_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const local = (lat, lon) => [+((lon - LON0) * M_PER_LON).toFixed(1), +(-(lat - LAT0) * M_PER_LAT).toFixed(1)];
const bbox = [LAT0 - 0.0068, LON0 - 0.011, LAT0 + 0.0068, LON0 + 0.011].join(',');
const query = `[out:json][timeout:60];
(way["barrier"="hedge"](${bbox}); way["natural"="shrubbery"](${bbox}); way["landuse"="flowerbed"](${bbox}););
out body; >; out skel qt;`;

if (process.argv.includes('--refresh') || !existsSync(RAW)) {
  mkdirSync('scripts/cache', { recursive: true });
  let text = null;
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'overvecht-driving-game/0.1' }, body: 'data=' + encodeURIComponent(query) }).catch(() => null);
    if (r?.ok) {
      text = await r.text();
      break;
    }
  }
  if (!text) throw new Error('Overpass failed');
  writeFileSync(RAW, text);
}
const osm = JSON.parse(readFileSync(RAW, 'utf8'));
const nodes = new Map(osm.elements.filter((e) => e.type === 'node').map((n) => [n.id, local(n.lat, n.lon)]));
map.hedges = [];
map.shrubs = [];
for (const w of osm.elements) {
  if (w.type !== 'way' || !w.tags) continue;
  const pts = w.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (pts.length < 2) continue;
  if (w.tags.barrier === 'hedge') {
    const h = Math.min(3, Math.max(0.6, parseFloat(w.tags.height) || 1.3));
    map.hedges.push({ pts, h });
  } else if (pts.length >= 4) map.shrubs.push({ pts, flowers: w.tags.landuse === 'flowerbed' || undefined });
}
// Leave a gap wherever a hedge comes onto a road or path (driveways, entrances): cut out every
// part of a hedge that is closer to a road centre line than half the road width plus 1 m.
const roadSegs = map.roads.filter((r) => !r.tunnel).flatMap((r) => r.pts.slice(1).map((b, i) => [r.pts[i], b, r.width / 2 + 1]));
const near = (x, z) => roadSegs.some(([a, b, gap]) => {
  if (Math.abs(x - a[0]) > 60 && Math.abs(x - b[0]) > 60) return false;
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < gap;
});
const cut = [];
for (const h of map.hedges) {
  let cur = [];
  for (let i = 0; i < h.pts.length - 1; i++) {
    const a = h.pts[i], b = h.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 0.5));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const p = [+(a[0] + ((b[0] - a[0]) * k) / n).toFixed(2), +(a[1] + ((b[1] - a[1]) * k) / n).toFixed(2)];
      if (near(p[0], p[1])) {
        if (cur.length >= 2) cut.push({ pts: cur, h: h.h });
        cur = [];
      } else cur.push(p);
    }
  }
  if (cur.length >= 2) cut.push({ pts: cur, h: h.h });
}
// Merge the 0.5 m steps back into straight runs.
for (const c of cut) {
  const out = [c.pts[0]];
  for (let i = 1; i < c.pts.length - 1; i++) {
    const a = out[out.length - 1], b = c.pts[i], d = c.pts[i + 1];
    const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    if (Math.abs(cross) > 0.05) out.push(b);
  }
  out.push(c.pts[c.pts.length - 1]);
  c.pts = out;
}
map.hedges = cut.filter((h) => h.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - h.pts[i][0], p[1] - h.pts[i][1]), 0) > 0.5);
console.log(`${map.hedges.length} hedges, ${map.shrubs.length} shrub/flower beds`);
writeFileSync(DATA, JSON.stringify(map));
