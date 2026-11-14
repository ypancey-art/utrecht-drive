import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapData, Pt, Road } from '../game/mapData';
import { buildBuildings } from './buildingMeshes';
import type { RoadGrid } from '../game/scenery';
import type { WaterMap } from '../game/water';

export const WATER_Y = -0.7; // water surface sits below street level
const BED_Y = -1.8;
const BRIDGE_EXTRA = 4; // bridges are this much wider than the road
import { MAP_HALF_SIZE } from '../game/mapData';
import { palette } from './palette';

// Flat layers are drawn in this order without writing depth, so they never z-fight.
const LAYER = { ground: -20, green: -19, water: -18, path: -17, rail: -16, pavement: -15, road: -14, marking: -13 };

function flatMesh(geo: THREE.BufferGeometry | null, color: number, order: number) {
  if (!geo) return null;
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = order;
  mesh.receiveShadow = true;
  return mesh;
}

function toGeometry(pos: number[]): THREE.BufferGeometry | null {
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

/** Turns polylines into flat ribbons (with round joints) in one geometry. */
function ribbons(lines: { pts: Pt[]; width: number }[]): THREE.BufferGeometry | null {
  const pos: number[] = [];
  for (const { pts, width } of lines) {
    const hw = width / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const nx = (-dz / len) * hw, nz = (dx / len) * hw;
      pos.push(ax + nx, 0, az + nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
      pos.push(ax + nx, 0, az + nz, bx - nx, 0, bz - nz, ax - nx, 0, az - nz);
    }
    for (const [cx, cz] of pts) {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        pos.push(cx, 0, cz, cx + Math.cos(a1) * hw, 0, cz + Math.sin(a1) * hw, cx + Math.cos(a0) * hw, 0, cz + Math.sin(a0) * hw);
      }
    }
  }
  return toGeometry(pos);
}

/** Dashed lane lines between the lanes of each road. */
function laneMarkings(roads: Road[]): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const DASH = 3, GAP = 6, HW = 0.08;
  for (const r of roads) {
    if (r.lanes < 2 || r.width < 5) continue;
    for (let lane = 1; lane < r.lanes; lane++) {
      const offset = -r.width / 2 + (r.width * lane) / r.lanes;
      let phase = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i];
        const [bx, bz] = r.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        const nx = -uz, nz = ux;
        for (let d = phase; d < len; d += DASH + GAP) {
          const e = Math.min(d + DASH, len);
          const sx = ax + ux * d + nx * offset, sz = az + uz * d + nz * offset;
          const ex = ax + ux * e + nx * offset, ez = az + uz * e + nz * offset;
          pos.push(sx + nx * HW, 0, sz + nz * HW, ex + nx * HW, 0, ez + nz * HW, ex - nx * HW, 0, ez - nz * HW);
          pos.push(sx + nx * HW, 0, sz + nz * HW, ex - nx * HW, 0, ez - nz * HW, sx - nx * HW, 0, sz - nz * HW);
          phase = d + DASH + GAP - len;
        }
        if (phase < 0) phase = 0;
      }
    }
  }
  return toGeometry(pos);
}

function openRing(pts: Pt[]): Pt[] {
  const a = pts[0], b = pts[pts.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? pts.slice(0, -1) : pts;
}

/** Flat filled polygons (parks, water) in one geometry. */
function polygons(list: { pts: Pt[] }[]): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const { pts } of list) {
    const ring = openRing(pts);
    if (ring.length < 3) continue;
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    geos.push(g.deleteAttribute('uv'));
  }
  return geos.length ? mergeGeometries(geos) : null;
}

/** Railway: gravel bed, sleepers and two steel rails per track. */
function railways(rails: { pts: Pt[] }[]): THREE.Group {
  const group = new THREE.Group();
  const bed = ribbons(rails.map((r) => ({ pts: r.pts, width: 3.2 })));
  const bedMesh = flatMesh(bed, palette.ballast, LAYER.rail);
  if (bedMesh) group.add(bedMesh);

  const GAUGE = 1.435, SPACING = 0.9;
  const sleepers: THREE.Matrix4[] = [];
  const steel: number[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (const { pts } of rails) {
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      q.setFromAxisAngle(up, Math.atan2(-uz, ux));
      let d = carry;
      for (; d < len; d += SPACING) sleepers.push(m.compose(p.set(ax + ux * d, 0.06, az + uz * d), q, one).clone());
      carry = d - len;
      // Two rails as thin raised boxes (top + both sides).
      for (const side of [-1, 1]) {
        const ox = -uz * side * (GAUGE / 2), oz = ux * side * (GAUGE / 2);
        const w = 0.04, H = 0.17;
        const x0 = ax + ox, z0 = az + oz, x1 = bx + ox, z1 = bz + oz;
        const sx = -uz * w, sz = ux * w;
        const quad = (a: number[], b: number[], c: number[], d2: number[]) => steel.push(...a, ...b, ...c, ...a, ...c, ...d2);
        quad([x0 + sx, H, z0 + sz], [x1 + sx, H, z1 + sz], [x1 - sx, H, z1 - sz], [x0 - sx, H, z0 - sz]);
        quad([x0 + sx, 0.05, z0 + sz], [x1 + sx, 0.05, z1 + sz], [x1 + sx, H, z1 + sz], [x0 + sx, H, z0 + sz]);
        quad([x0 - sx, 0.05, z0 - sz], [x1 - sx, 0.05, z1 - sz], [x1 - sx, H, z1 - sz], [x0 - sx, H, z0 - sz]);
      }
    }
  }
  const sleeperMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.25, 0.12, 2.5),
    new THREE.MeshLambertMaterial({ color: palette.sleeper }),
    Math.max(1, sleepers.length),
  );
  sleepers.forEach((mat, i) => sleeperMesh.setMatrixAt(i, mat));
  sleeperMesh.count = sleepers.length;
  sleeperMesh.receiveShadow = true;
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(steel, 3));
  rg.computeVertexNormals();
  const railMesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: palette.steel, side: THREE.DoubleSide }));
  group.add(sleeperMesh, railMesh);
  return group;
}

function stationMarker(name: string, x: number, z: number): THREE.Object3D {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 8), new THREE.MeshLambertMaterial({ color: 0x333333 }));
  pole.position.y = 7;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.6), new THREE.MeshLambertMaterial({ color: palette.station }));
  sign.position.y = 15;
  group.add(pole, sign);
  group.position.set(x, 0, z);
  group.name = name;
  return group;
}

/** Vertical strips along polylines (canal banks, kerbs, bridge sides), all in one geometry. */
function walls(lines: [number, number, number, number][], y0: number, y1: number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  for (const [ax, az, bx, bz] of lines) pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Outline segments of water areas and both banks of waterways. */
function waterEdges(map: MapData) {
  const out: [number, number, number, number][] = [];
  for (const { pts } of map.water) for (let i = 0; i < pts.length - 1; i++) out.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
  for (const { pts, width } of map.waterways) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = (-(bz - az) / len) * (width / 2), nz = ((bx - ax) / len) * (width / 2);
      out.push([ax + nx, az + nz, bx + nx, bz + nz], [ax - nx, az - nz, bx - nx, bz - nz]);
    }
  }
  return out;
}

/** Road and path pieces that cross water: these become bridge decks. */
export function bridgeSegments(map: MapData, water: WaterMap) {
  const segs: { ax: number; az: number; bx: number; bz: number; width: number }[] = [];
  for (const r of map.roads) {
    if (r.tunnel) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n;
        const x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
        if (water.contains((x0 + x1) / 2, (z0 + z1) / 2) || r.bridge) segs.push({ ax: x0, az: z0, bx: x1, bz: z1, width: r.width + BRIDGE_EXTRA });
      }
    }
  }
  return segs;
}

function bridges(map: MapData, water: WaterMap): THREE.Group {
  const g = new THREE.Group();
  const segs = bridgeSegments(map, water);
  // Extend each piece a little so neighbouring pieces overlap without gaps.
  const deck = ribbons(segs.map((s) => {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1, ux = (s.bx - s.ax) / len, uz = (s.bz - s.az) / len;
    return { pts: [[s.ax - ux * 0.3, s.az - uz * 0.3], [s.bx + ux * 0.3, s.bz + uz * 0.3]] as Pt[], width: s.width };
  }));
  if (deck) {
    deck.translate(0, 0.04, 0);
    const m = new THREE.Mesh(deck, new THREE.MeshLambertMaterial({ color: palette.bridge }));
    m.receiveShadow = true;
    g.add(m);
  }
  const sides: [number, number, number, number][] = [];
  for (const s of segs) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
    const nx = (-(s.bz - s.az) / len) * (s.width / 2), nz = ((s.bx - s.ax) / len) * (s.width / 2);
    sides.push([s.ax + nx, s.az + nz, s.bx + nx, s.bz + nz], [s.ax - nx, s.az - nz, s.bx - nx, s.bz - nz]);
  }
  const mat = new THREE.MeshLambertMaterial({ color: palette.bridgeSide, side: THREE.DoubleSide });
  const side = walls(sides, BED_Y + 0.4, 0.04);
  if (side) g.add(new THREE.Mesh(side, mat));
  const rail = walls(sides, 0.04, 1.0);
  if (rail) {
    const rm = new THREE.Mesh(rail, new THREE.MeshLambertMaterial({ color: palette.railing, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    rm.castShadow = true;
    g.add(rm);
  }
  return g;
}

/** Sunken water: bed, banks and a see-through surface. */
function waterHole(map: MapData, water: WaterMap): THREE.Group {
  const g = new THREE.Group();
  const parts = [polygons(map.water), ribbons(map.waterways)].filter(Boolean) as THREE.BufferGeometry[];
  if (!parts.length) return g;
  const area = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  const bed = new THREE.Mesh(area.clone().translate(0, BED_Y, 0), new THREE.MeshLambertMaterial({ color: palette.waterBed, side: THREE.DoubleSide }));
  const surface = new THREE.Mesh(
    area.clone().translate(0, WATER_Y, 0),
    new THREE.MeshLambertMaterial({ color: palette.water, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
  );
  surface.receiveShadow = true;
  // Only real banks: skip edge pieces with water on both sides (where a ditch joins a canal).
  const edges = waterEdges(map).filter(([ax, az, bx, bz]) => {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, nx = (-(bz - az) / len) * 0.8, nz = ((bx - ax) / len) * 0.8;
    return !(water.contains(mx + nx, mz + nz) && water.contains(mx - nx, mz - nz));
  });
  const banks = walls(edges, BED_Y, 0.02);
  g.add(bed, surface);
  if (banks) g.add(new THREE.Mesh(banks, new THREE.MeshLambertMaterial({ color: palette.bank, side: THREE.DoubleSide })));
  return g;
}

/** Kerbs along both edges of the streets, with gaps at junctions, crossings and water. */
function kerbs(roads: Road[], grid: RoadGrid, water: WaterMap): THREE.Group {
  const faces: [number, number, number, number][] = [];
  const tops: { pts: Pt[]; width: number }[] = [];
  for (const r of roads) {
    if (r.kind === 'service' || r.width < 4.5) continue;
    const hw = r.width / 2;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
      const n = Math.ceil(len / 2);
      for (let k = 0; k < n; k++) {
        const d0 = (len * k) / n, d1 = (len * (k + 1)) / n, dm = (d0 + d1) / 2;
        for (const side of [-1, 1]) {
          const o = side * hw;
          const tx = ax + ux * dm + nx * (o + side * 0.4), tz = az + uz * dm + nz * (o + side * 0.4);
          if (grid.edgeDistance(tx, tz) < 0 || water.contains(tx, tz)) continue; // another road or water there
          const p0: Pt = [ax + ux * d0 + nx * o, az + uz * d0 + nz * o], p1: Pt = [ax + ux * d1 + nx * o, az + uz * d1 + nz * o];
          faces.push([p0[0], p0[1], p1[0], p1[1]]);
          tops.push({ pts: [[p0[0] + nx * side * 0.08, p0[1] + nz * side * 0.08], [p1[0] + nx * side * 0.08, p1[1] + nz * side * 0.08]], width: 0.16 });
        }
      }
    }
  }
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: palette.kerb, side: THREE.DoubleSide });
  const face = walls(faces, 0, 0.12);
  if (face) g.add(new THREE.Mesh(face, mat));
  const top = ribbons(tops);
  if (top) {
    top.translate(0, 0.12, 0);
    g.add(new THREE.Mesh(top, mat));
  }
  return g;
}

export function buildMapMeshes(map: MapData, grid: RoadGrid, water: WaterMap): THREE.Group {
  const group = new THREE.Group();
  const size = MAP_HALF_SIZE * 2 + 400;
  const ground = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const add = (m: THREE.Object3D | null) => m && group.add(m);
  const streets = map.roads.filter((r) => r.drivable && !r.tunnel);

  add(flatMesh(ground, palette.ground, LAYER.ground));
  add(flatMesh(polygons([...map.green, ...map.woods]), palette.green, LAYER.green));
  add(flatMesh(ribbons(map.roads.filter((r) => !r.drivable)), palette.path, LAYER.path));
  add(railways(map.rails));
  // Pavements: a wider light strip under the bigger streets.
  const paved = streets.filter((r) => r.kind !== 'service' && r.width >= 4.5);
  add(flatMesh(ribbons(paved.map((r) => ({ pts: r.pts, width: r.width + 3.5 }))), palette.pavement, LAYER.pavement));
  add(flatMesh(ribbons(streets), palette.road, LAYER.road));
  add(flatMesh(laneMarkings(streets), palette.marking, LAYER.marking));
  add(waterHole(map, water));
  add(bridges(map, water));
  add(kerbs(streets, grid, water));
  add(buildBuildings(map.buildings, map.lod3d));
  for (const s of map.stations) add(stationMarker(s.name, s.p[0], s.p[1]));
  return group;
}
