// Where trees and street lights go. Shared by the visuals (src/art) and physics,
// and deterministic (seeded), so every player sees the same Overvecht.
import type { MapData, Pt } from './mapData';

export interface Tree { x: number; z: number; scale: number; kind: 0 | 1 | 2 } // 0 round, 1 tall round, 2 pine
export interface Lamp { x: number; z: number; dirX: number; dirZ: number } // dir = towards the road

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grid of road segments for fast "how far from the road edge" checks. */
export class RoadGrid {
  private cells = new Map<string, number[]>(); // flat [ax, az, bx, bz, halfWidth, ...]
  constructor(map: MapData, private cell = 25) {
    for (const r of map.roads) {
      const hw = r.width / 2;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i];
        const [bx, bz] = r.pts[i + 1];
        const x0 = Math.floor((Math.min(ax, bx) - hw) / cell), x1 = Math.floor((Math.max(ax, bx) + hw) / cell);
        const z0 = Math.floor((Math.min(az, bz) - hw) / cell), z1 = Math.floor((Math.max(az, bz) + hw) / cell);
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const k = `${x},${z}`;
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(ax, az, bx, bz, hw);
          }
      }
    }
  }
  /** Distance from (x, z) to the nearest road edge (negative = on the road). Capped at one cell. */
  edgeDistance(x: number, z: number) {
    const list = this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    let best = this.cell;
    if (!list) return best;
    for (let i = 0; i < list.length; i += 5) {
      const ax = list[i], az = list[i + 1], dx = list[i + 2] - ax, dz = list[i + 3] - az;
      const len2 = dx * dx + dz * dz || 1;
      const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - ax - dx * s, z - az - dz * s) - list[i + 4];
      if (d < best) best = d;
    }
    return best;
  }
}

function pointInPolygon(x: number, z: number, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function scatter(area: { pts: Pt[] }[], perM2: number, rand: () => number, out: Pt[]) {
  for (const { pts } of area) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const n = Math.min(400, Math.round((maxX - minX) * (maxZ - minZ) * perM2));
    for (let i = 0; i < n; i++) {
      const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
      if (pointInPolygon(x, z, pts)) out.push([x, z]);
    }
  }
}

export function placeScenery(map: MapData) {
  const rand = rng(1974);
  const grid = new RoadGrid(map);
  const spots: Pt[] = [...map.trees];
  for (const { pts } of map.treeRows) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 9));
      for (let k = 0; k < n; k++) spots.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
  }
  scatter(map.woods, 1 / 70, rand, spots);
  scatter(map.green, 1 / 900, rand, spots);

  const trees: Tree[] = [];
  for (const [x, z] of spots) {
    if (grid.edgeDistance(x, z) < 1.5) continue; // keep roads and paths clear
    const r = rand();
    trees.push({ x, z, scale: 0.75 + rand() * 0.6, kind: r < 0.6 ? 0 : r < 0.85 ? 1 : 2 });
  }

  // Street lights on one side of the bigger named roads, about every 35 m.
  const lamps: Lamp[] = [];
  for (const road of map.roads) {
    if (!road.drivable || !road.name || road.kind === 'service' || road.tunnel || road.width < 4.5) continue;
    const side = road.oneway ? 1 : -1;
    let walked = 0;
    let next = 15;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const nx = -uz * side, nz = ux * side; // sideways
      const off = road.width / 2 + 1.3;
      for (; next < walked + len; next += 35) {
        const d = next - walked;
        const x = ax + ux * d + nx * off, z = az + uz * d + nz * off;
        if (grid.edgeDistance(x, z) > 0.4) lamps.push({ x, z, dirX: -nx, dirZ: -nz });
      }
      walked += len;
    }
  }
  return { trees, lamps, grid };
}
