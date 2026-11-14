import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building, MapData, Pt, Road } from '../game/mapData';
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

/** Tiling window texture: one window per 3.2 m bay and 3 m floor. White = wall (tinted by vertex colour). */
function windowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e4e4e4';
  g.fillRect(0, 58, 64, 6); // floor band
  g.fillStyle = '#3c4a5a';
  g.fillRect(14, 16, 36, 30); // glass
  g.fillStyle = '#6d8296';
  g.fillRect(14, 16, 36, 7); // sky reflection
  g.fillStyle = '#f2f2f2';
  g.fillRect(31, 16, 2, 30); // frame
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function parseColor(value: string | undefined, fallback: number, out: THREE.Color) {
  out.setHex(fallback);
  if (!value) return out;
  try {
    return out.copy(new THREE.Color().setStyle(value, THREE.SRGBColorSpace));
  } catch {
    return out;
  }
}

/** Buildings: walls with windows + roofs, merged into two draw calls. */
function buildings(list: Building[]): THREE.Group {
  const wall = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] };
  const roof = { pos: [] as number[], nor: [] as number[], col: [] as number[] };
  const wc = new THREE.Color(), rc = new THREE.Color();
  const BAY = 3.2, FLOOR = 3;

  list.forEach((b, idx) => {
    const ring = openRing(b.pts);
    if (ring.length < 3) return;
    const h = b.h;
    const small = h <= 4;
    const isHouse = /house|terrace|detached|bungalow/.test(b.type) || (h <= 8 && !small);
    const walls = h > 13 ? palette.flats : isHouse ? palette.houses : [...palette.flats, ...palette.houses];
    parseColor(b.color, walls[idx % walls.length], wc);
    parseColor(b.roof, (isHouse ? palette.roofHouse : palette.roofFlat)[idx % 3], rc);

    // Signed area tells us which way the ring winds, so normals point outwards.
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      area += x0 * z1 - x1 * z0;
    }
    const sign = area > 0 ? 1 : -1;
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = (sign * (bz - az)) / len, nz = (sign * -(bx - ax)) / len;
      const u0 = small ? 0.02 : u / BAY, u1 = small ? 0.02 : (u + len) / BAY;
      const v1 = small ? 0.02 : h / FLOOR;
      // Two triangles, wound so the front faces outwards (normal n).
      const quad = [[ax, 0, az, u0, 0], [bx, 0, bz, u1, 0], [bx, h, bz, u1, v1], [ax, h, az, u0, v1]];
      const order = sign > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const k of order) {
        const [x, y, z, uu, vv] = quad[k];
        wall.pos.push(x, y, z);
        wall.nor.push(nx, 0, nz);
        wall.uv.push(uu, vv);
        wall.col.push(wc.r, wc.g, wc.b);
      }
      u += len;
    }

    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    for (const [a, bb, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const p = [contour[a], contour[bb], contour[c]];
      // Make sure the triangle faces up.
      const cross = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x);
      if (cross > 0) p.reverse();
      for (const v of p) {
        roof.pos.push(v.x, h, v.y);
        roof.nor.push(0, 1, 0);
        roof.col.push(rc.r, rc.g, rc.b);
      }
    }
  });

  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wall.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(wall.nor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(wall.uv, 2));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(wall.col, 3));
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(roof.pos, 3));
  rg.setAttribute('normal', new THREE.Float32BufferAttribute(roof.nor, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(roof.col, 3));

  const wallMesh = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ vertexColors: true, map: windowTexture() }));
  const roofMesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const group = new THREE.Group();
  for (const m of [wallMesh, roofMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
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

export function buildMapMeshes(map: MapData): THREE.Group {
  const group = new THREE.Group();
  const size = MAP_HALF_SIZE * 2 + 400;
  const ground = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const add = (m: THREE.Object3D | null) => m && group.add(m);
  const streets = map.roads.filter((r) => r.drivable && !r.tunnel);

  add(flatMesh(ground, palette.ground, LAYER.ground));
  add(flatMesh(polygons([...map.green, ...map.woods]), palette.green, LAYER.green));
  const water = [polygons(map.water), ribbons(map.waterways)].filter(Boolean) as THREE.BufferGeometry[];
  if (water.length) add(flatMesh(mergeGeometries(water.map((g) => (g.index ? g.toNonIndexed() : g))), palette.water, LAYER.water));
  add(flatMesh(ribbons(map.roads.filter((r) => !r.drivable)), palette.path, LAYER.path));
  add(flatMesh(ribbons(map.rails.map((r) => ({ pts: r.pts, width: 3 }))), palette.rail, LAYER.rail));
  // Pavements: a wider light strip under the bigger streets.
  const paved = streets.filter((r) => r.kind !== 'service' && r.width >= 4.5);
  add(flatMesh(ribbons(paved.map((r) => ({ pts: r.pts, width: r.width + 3.5 }))), palette.pavement, LAYER.pavement));
  add(flatMesh(ribbons(streets), palette.road, LAYER.road));
  add(flatMesh(laneMarkings(streets), palette.marking, LAYER.marking));
  add(buildings(map.buildings));
  for (const s of map.stations) add(stationMarker(s.name, s.p[0], s.p[1]));
  return group;
}
