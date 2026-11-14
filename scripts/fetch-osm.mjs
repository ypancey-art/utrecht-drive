// Downloads OpenStreetMap data for Overvecht via the Overpass API and
// converts it to a compact JSON in local metres (x = east, z = south).
// Run once: npm run fetch-map  ->  public/data/overvecht.json
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

// Raw Overpass response is cached here; delete it (or pass --refresh) to download again.
const RAW = 'scripts/cache/osm-raw.json';

// Centre: Utrecht Overvecht station. Box ~1.5 km (E-W) x 1.5 km (N-S).
const CENTER = { lat: 52.1108, lon: 5.1215 };
const HALF_LAT = 0.0068; // ~750 m
const HALF_LON = 0.011; // ~750 m at this latitude
const bbox = [
  CENTER.lat - HALF_LAT,
  CENTER.lon - HALF_LON,
  CENTER.lat + HALF_LAT,
  CENTER.lon + HALF_LON,
].join(',');

const query = `
[out:json][timeout:60];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  way["railway"="rail"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"](${bbox});
  way["leisure"~"park|pitch|playground"](${bbox});
  way["landuse"~"grass|forest|recreation_ground|meadow|village_green"](${bbox});
  node["railway"="station"](${bbox});
  node["natural"="tree"](${bbox});
  way["natural"="tree_row"](${bbox});
  way["natural"~"wood|scrub"](${bbox});
);
out body;
>;
out skel qt;
`;

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
async function download() {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of SERVERS) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'overvecht-driving-game/0.1' },
        body: 'data=' + encodeURIComponent(query),
      }).catch((e) => ({ ok: false, status: String(e) }));
      if (res.ok) return res.text();
      console.warn(`${url} failed (${res.status}), trying next server`);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error('All Overpass servers failed');
}
if (process.argv.includes('--refresh') || !existsSync(RAW)) {
  mkdirSync('scripts/cache', { recursive: true });
  writeFileSync(RAW, await download());
}
const osm = JSON.parse(readFileSync(RAW, 'utf8'));

const M_PER_LAT = 111320;
const M_PER_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
const nodes = new Map();
for (const el of osm.elements) {
  if (el.type === 'node') {
    nodes.set(el.id, [
      +((el.lon - CENTER.lon) * M_PER_LON).toFixed(1),
      +(-(el.lat - CENTER.lat) * M_PER_LAT).toFixed(1),
    ]);
  }
}

// Default total width (m) when OSM has no width/lanes tag.
const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 9, secondary: 8, tertiary: 7,
  unclassified: 6, residential: 6, living_street: 5, service: 4,
  cycleway: 2.5, footway: 2, path: 2, pedestrian: 4,
};
const LANE_WIDTH = 3.25;
const SMALL = new Set(['garage', 'garages', 'shed', 'hut', 'roof', 'carport', 'kiosk', 'bunker', 'service', 'container']);
const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'service', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link',
]);

const out = { center: CENTER, roads: [], buildings: [], water: [], waterways: [], rails: [], green: [], woods: [], trees: [], treeRows: [], stations: [] };
for (const el of osm.elements) {
  if (el.type === 'node' && el.tags?.railway === 'station') {
    out.stations.push({ name: el.tags.name ?? '', p: nodes.get(el.id) });
  }
  if (el.type === 'node' && el.tags?.natural === 'tree') out.trees.push(nodes.get(el.id));
  if (el.type !== 'way' || !el.tags) continue;
  const pts = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
  if (pts.length < 2) continue;
  const t = el.tags;
  if (t.highway) {
    const kind = t.highway.replace('_link', '');
    if (!(kind in ROAD_WIDTH)) continue;
    const drivable = DRIVABLE.has(t.highway);
    const oneway = t.oneway === 'yes' || t.junction === 'roundabout' || t.highway.endsWith('_link');
    const tagLanes = parseInt(t.lanes, 10);
    const lanes = drivable ? tagLanes || (oneway || kind === 'service' || kind === 'living_street' ? 1 : 2) : 0;
    const tagWidth = parseFloat(t.width);
    let width;
    if (tagWidth > 1 && tagWidth < 40) width = tagWidth;
    else if (drivable && tagLanes) width = tagLanes * LANE_WIDTH;
    else width = oneway && drivable ? Math.max(ROAD_WIDTH[kind] * 0.6, 4) : ROAD_WIDTH[kind];
    out.roads.push({
      name: t.name ?? '',
      kind,
      drivable,
      width: +width.toFixed(1),
      lanes,
      oneway: oneway || undefined,
      bridge: t.bridge === 'yes' || undefined,
      tunnel: t.tunnel === 'yes' || undefined,
      pts,
    });
  } else if (t.building) {
    const levels = parseFloat(t['building:levels']);
    const type = t.building;
    const guess = SMALL.has(type) ? 3 : type === 'house' || type === 'terrace' || type === 'semidetached_house' ? 7 : type === 'apartments' ? 12 : 9;
    const height = parseFloat(t.height) || (levels ? levels * 3 + (t['roof:shape'] && t['roof:shape'] !== 'flat' ? 2 : 0) : guess);
    const b = { h: +height.toFixed(1), type, pts };
    if (t['building:colour']) b.color = t['building:colour'];
    if (t['roof:colour']) b.roof = t['roof:colour'];
    out.buildings.push(b);
  } else if (t.railway === 'rail') {
    out.rails.push({ pts });
  } else if (t.natural === 'water') {
    out.water.push({ pts });
  } else if (t.waterway) {
    out.waterways.push({ width: t.waterway === 'canal' ? 25 : t.waterway === 'river' ? 15 : 4, pts });
  } else if (t.natural === 'tree_row') {
    out.treeRows.push({ pts });
  } else if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') {
    out.woods.push({ pts });
  } else if (t.leisure || t.landuse) {
    out.green.push({ pts });
  }
}

writeFileSync('public/data/overvecht.json', JSON.stringify(out));
const names = [...new Set(out.roads.map((r) => r.name).filter(Boolean))].sort();
console.log(
  `roads ${out.roads.length}, buildings ${out.buildings.length}, water ${out.water.length}, ` +
    `waterways ${out.waterways.length}, rails ${out.rails.length}, green ${out.green.length}, woods ${out.woods.length}, trees ${out.trees.length}, treeRows ${out.treeRows.length}, stations ${JSON.stringify(out.stations)}`,
);
const widths = {};
for (const r of out.roads.filter((r) => r.drivable)) widths[r.width] = (widths[r.width] ?? 0) + 1;
console.log('drivable road widths (m: count):', JSON.stringify(widths));
