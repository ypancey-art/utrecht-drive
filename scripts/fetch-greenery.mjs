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
// Leave a gap where a hedge crosses a road or path (driveways, entrances).
const roadSegs = map.roads.filter((r) => !r.tunnel).flatMap((r) => r.pts.slice(1).map((b, i) => [r.pts[i], b, r.width / 2 + 1]));
const crossAt = (a, b, c, d) => {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
};
const cut = [];
for (const h of map.hedges) {
  let cur = [h.pts[0]];
  for (let i = 0; i < h.pts.length - 1; i++) {
    const a = h.pts[i], b = h.pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const hits = roadSegs.map(([c, d, gap]) => [crossAt(a, b, c, d), gap]).filter(([t]) => t >= 0).sort((x, y) => x[0] - y[0]);
    for (const [t, gap] of hits) {
      const g = gap / len;
      const p0 = [a[0] + (b[0] - a[0]) * Math.max(0, t - g), a[1] + (b[1] - a[1]) * Math.max(0, t - g)];
      const p1 = [a[0] + (b[0] - a[0]) * Math.min(1, t + g), a[1] + (b[1] - a[1]) * Math.min(1, t + g)];
      cur.push(p0);
      if (cur.length >= 2) cut.push({ pts: cur, h: h.h });
      cur = [p1];
    }
    cur.push(b);
  }
  if (cur.length >= 2) cut.push({ pts: cur, h: h.h });
}
map.hedges = cut.filter((h) => h.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - h.pts[i][0], p[1] - h.pts[i][1]), 0) > 0.5);
console.log(`${map.hedges.length} hedges, ${map.shrubs.length} shrub/flower beds`);
writeFileSync(DATA, JSON.stringify(map));
