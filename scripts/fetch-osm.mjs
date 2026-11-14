// Downloads OpenStreetMap data for Overvecht via the Overpass API and
// converts it to a compact JSON in local metres (x = east, z = south).
// Run once: npm run fetch-map  ->  public/data/overvecht.json
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { toRd } from './rd.mjs';

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

// --- Extra open data (also cached) ---
const [rdMinX, rdMinY] = toRd(CENTER.lat - HALF_LAT, CENTER.lon - HALF_LON).map(Math.floor);
const [rdMaxX, rdMaxY] = toRd(CENTER.lat + HALF_LAT, CENTER.lon + HALF_LON).map(Math.ceil);
const rdBbox = `${rdMinX},${rdMinY},${rdMaxX},${rdMaxY},urn:ogc:def:crs:EPSG::28992`;

/** Pages through a WFS layer as GeoJSON in WGS84 (lon, lat). */
async function wfsAll(base, typeName, extra = '') {
  const features = [];
  for (let start = 0; ; start += 1000) {
    const url = `${base}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${typeName}&count=1000&startIndex=${start}` +
      `&bbox=${rdBbox}&outputFormat=${extra.includes('GEOJSON') ? 'GEOJSON' : 'application/json&srsName=EPSG:4326'}${extra.replace('GEOJSON', '')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${typeName}: ${res.status}`);
    const page = await res.json();
    features.push(...page.features);
    console.log(`  ${typeName}: ${features.length}`);
    if (page.features.length < 1000) return features;
  }
}
async function cached(file, make) {
  const path = `scripts/cache/${file}`;
  if (process.argv.includes('--refresh') || !existsSync(path)) writeFileSync(path, JSON.stringify(await make()));
  return JSON.parse(readFileSync(path, 'utf8'));
}
mkdirSync('scripts/cache', { recursive: true });
// 3D BAG (CC BY 4.0): official footprints + laser-measured heights + year built.
const BAG_FIELDS = 'geom,identificatie,b3_h_70p,b3_h_min,b3_h_max,b3_h_nok,b3_dak_type,b3_h_maaiveld,b3_bouwlagen,oorspronkelijkbouwjaar,status';
const bag = await cached('bag3d.json', () => wfsAll('https://data.3dbag.nl/api/BAG3D/wfs', 'BAG3D:lod12', `&propertyName=${BAG_FIELDS}`));
// Gemeente Utrecht tree register (CC BY-SA 4.0): species + planting year per tree.
const TREES_WFS = 'https://dservices-eu1.arcgis.com/SMnoOtmU2UWf0vRp/arcgis/services/bomenkaart_2026/WFSServer';
// This ArcGIS server's paging is unreliable, so fetch in 4 x 4 tiles (max 3000 per request).
async function treesTiled(layer) {
  const byId = new Map();
  const N = 4, w = (rdMaxX - rdMinX) / N, h = (rdMaxY - rdMinY) / N;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const bb = [rdMinX + i * w, rdMinY + j * h, rdMinX + (i + 1) * w, rdMinY + (j + 1) * h].map(Math.round).join(',');
      const url = `${TREES_WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&count=3000` +
        `&bbox=${bb},urn:ogc:def:crs:EPSG::28992&outputFormat=GEOJSON`;
      const page = await (await fetch(url)).json();
      if (page.features.length >= 3000) throw new Error(`${layer}: tile too full, use more tiles`);
      for (const f of page.features) byId.set(f.properties.OBJECTID ?? f.id, f);
    }
  console.log(`  ${layer}: ${byId.size}`);
  return [...byId.values()];
}
const cityTrees = await cached('trees.json', async () => [
  ...(await treesTiled('bomenkaart_2026:Park_en_Straatbomen')),
  ...(await treesTiled('bomenkaart_2026:bomen_in_bosplantsoen')),
]);

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

const local = (lon, lat) => [
  +((lon - CENTER.lon) * M_PER_LON).toFixed(1),
  +(-(lat - CENTER.lat) * M_PER_LAT).toFixed(1),
];
/** GeoJSON coordinate pair: [lon, lat], or [lat, lon] if a server flipped the axes. */
const fromGeo = ([a, b]) => (a > 40 ? local(b, a) : local(a, b));

const out = { center: CENTER, roads: [], buildings: [], water: [], waterways: [], rails: [], green: [], woods: [], trees: [], treeRows: [], playgrounds: [], stations: [] };
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
    out.rails.push({ pts, bridge: t.bridge === 'yes' || undefined });
  } else if (t.natural === 'water') {
    out.water.push({ pts });
  } else if (t.waterway) {
    const ww = parseFloat(t.width);
    out.waterways.push({ width: ww > 0 && ww < 80 ? ww : t.waterway === 'canal' ? 10 : t.waterway === 'river' ? 15 : 3, pts });
  } else if (t.natural === 'tree_row') {
    out.treeRows.push({ pts });
  } else if (t.natural === 'wood' || t.natural === 'scrub' || t.landuse === 'forest') {
    out.woods.push({ pts });
  } else if (t.leisure || t.landuse) {
    out.green.push({ pts });
    if (t.leisure === 'playground') out.playgrounds.push({ name: t.name ?? '', water: /water/i.test(t.name ?? '') || undefined, pts });
  }
}

// Buildings from 3D BAG replace the OSM ones (better footprints + real heights).
const bagBuildings = [];
for (const f of bag) {
  const p = f.properties;
  if (!f.geometry || /gesloopt|niet gerealiseerd|ingetrokken/i.test(p.status ?? '')) continue;
  const rings = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((poly) => poly[0]) : [f.geometry.coordinates[0]];
  const ground = p.b3_h_maaiveld ?? 0;
  const h = (p.b3_h_70p ?? 0) - ground;
  if (!(h > 1)) continue;
  for (const ring of rings) {
    const b = { h: +h.toFixed(1), type: '', year: p.oorspronkelijkbouwjaar ?? 0, floors: p.b3_bouwlagen ?? 0, pts: ring.map(fromGeo) };
    if (p.b3_dak_type === 'slanted' && p.b3_h_nok) {
      b.eave = +Math.max(2.5, (p.b3_h_min ?? p.b3_h_70p) - ground).toFixed(1);
      b.ridge = +(p.b3_h_nok - ground).toFixed(1);
      if (b.ridge - b.eave < 1) delete b.eave, delete b.ridge;
    }
    bagBuildings.push(b);
  }
}
if (bagBuildings.length > 1000) out.buildings = bagBuildings;

// City trees replace OSM single trees/rows (the register is complete for public trees).
out.cityTrees = cityTrees
  .filter((f) => f.geometry?.type === 'Point')
  .map((f) => ({ p: fromGeo(f.geometry.coordinates), genus: f.properties.Legenda ?? '', species: f.properties.Wetenschap ?? '', year: f.properties.plantjaar ?? 0 }));
if (out.cityTrees.length > 500) {
  out.trees = [];
  out.treeRows = [];
}

writeFileSync('public/data/overvecht.json', JSON.stringify(out));
const names = [...new Set(out.roads.map((r) => r.name).filter(Boolean))].sort();
console.log(
  `roads ${out.roads.length}, buildings ${out.buildings.length}, water ${out.water.length}, ` +
    `waterways ${out.waterways.length}, rails ${out.rails.length}, green ${out.green.length}, woods ${out.woods.length}, trees ${out.trees.length}, treeRows ${out.treeRows.length}, stations ${JSON.stringify(out.stations)}`,
);
const widths = {};
for (const r of out.roads.filter((r) => r.drivable)) widths[r.width] = (widths[r.width] ?? 0) + 1;
console.log(`3D BAG buildings ${bagBuildings.length} (pitched ${bagBuildings.filter((b) => b.ridge).length}), city trees ${out.cityTrees.length}`);
console.log('drivable road widths (m: count):', JSON.stringify(widths));
