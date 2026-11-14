// Where trees and street lights go. Shared by the visuals (src/art) and physics,
// and deterministic (seeded), so every player sees the same Overvecht.
import type { MapData, Pt } from './mapData';
import { WaterMap } from './water';

/** kind: 0 round, 1 narrow, 2 conifer, 3 willow (wide, weeping). h = height, crown = crown diameter (m). */
export interface Tree { x: number; z: number; h: number; crown: number; kind: 0 | 1 | 2 | 3 }

// Typical full-grown height (m), crown width as a fraction of height, and shape, per genus.
const GENUS: Record<string, [number, number, Tree['kind']]> = {
  Acer: [18, 0.6, 0], Tilia: [22, 0.55, 0], Ulmus: [20, 0.6, 0], Salix: [15, 0.85, 3], Fraxinus: [22, 0.6, 0],
  Prunus: [8, 0.85, 0], Quercus: [22, 0.65, 0], Alnus: [16, 0.45, 1], Platanus: [25, 0.65, 0], Sorbus: [10, 0.5, 0],
  Betula: [16, 0.45, 1], Carpinus: [14, 0.55, 0], Pyrus: [10, 0.45, 1], Robinia: [18, 0.55, 0], Malus: [7, 0.85, 0],
  Magnolia: [7, 0.9, 0], Crataegus: [7, 0.8, 0], Liquidambar: [16, 0.5, 1], Populus: [28, 0.4, 1], Ginkgo: [15, 0.4, 1],
  Gleditsia: [16, 0.65, 0], Aesculus: [20, 0.65, 0], Fagus: [22, 0.7, 0], Styphnolobium: [15, 0.7, 0],
  Ailanthus: [18, 0.6, 0], Zelkova: [18, 0.65, 0], Ostrya: [14, 0.6, 0], Amelanchier: [6, 0.8, 0],
  Pinus: [18, 0.45, 2], Picea: [20, 0.35, 2], Abies: [20, 0.35, 2], Taxodium: [20, 0.35, 2],
  Metasequoia: [22, 0.3, 2], Taxus: [8, 0.7, 2], Larix: [20, 0.35, 2],
};
const COLUMNAR = /fastigiata|columnar|pyramidal|italica|erecta|obelisk|streetwise/i;

/** Estimated size from species and age: height grows towards the species maximum. */
function cityTreeSize(genus: string, species: string, year: number, rand: () => number) {
  const [maxH, ratio, kind] = GENUS[genus] ?? [14, 0.6, 0];
  const age = year > 1800 ? Math.max(2, 2026 - year) : 30;
  const h = Math.max(3, maxH * (1 - Math.exp(-age / 22)) * (0.9 + rand() * 0.2));
  const narrow = COLUMNAR.test(species);
  return { h, crown: Math.max(1.5, h * (narrow ? 0.3 : ratio)), kind: narrow ? 1 : kind };
}
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
  private cell = 25;
  constructor(map: MapData) {
    const cell = this.cell;
    for (const r of map.roads) {
      const hw = (r.width + (r.bridge ? 4 : 0)) / 2;
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

/** Buildings by grid cell, to keep trees out of walls. */
class BuildingGrid {
  private cells = new Map<string, Pt[][]>();
  private cell = 25;
  constructor(map: MapData) {
    for (const { pts } of map.buildings) {
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      for (let x = Math.floor(Math.min(...xs) / this.cell); x <= Math.floor(Math.max(...xs) / this.cell); x++)
        for (let z = Math.floor(Math.min(...zs) / this.cell); z <= Math.floor(Math.max(...zs) / this.cell); z++) {
          const k = `${x},${z}`;
          (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(pts);
        }
    }
  }
  /** Distance from (x, z) to the nearest building wall; negative when inside a building. */
  wallDistance(x: number, z: number) {
    let best = this.cell;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const pts of this.cells.get(`${cx + dx},${cz + dz}`) ?? []) {
          let d = Infinity;
          for (let i = 0; i < pts.length - 1; i++) {
            const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
            const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
            const s = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
            d = Math.min(d, Math.hypot(x - ax - ex * s, z - az - ez * s));
          }
          if (pointInPolygon(x, z, pts)) return -d;
          best = Math.min(best, d);
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
  const city = map.cityTrees ?? [];
  // With the city register, only fill woods lightly (private/woodland trees aren't all in it).
  scatter(map.woods, city.length ? 1 / 160 : 1 / 70, rand, spots);
  if (!city.length) scatter(map.green, 1 / 900, rand, spots);

  const water = new WaterMap(map);
  const walls = new BuildingGrid(map);
  // Railway tracks (centre lines), to keep trees off the gravel bed.
  const rails = map.rails.flatMap(({ pts }) => pts.slice(1).map((b, i) => [pts[i][0], pts[i][1], b[0], b[1]]));
  const railDistance = (x: number, z: number) => {
    let best = Infinity;
    for (const [ax, az, bx, bz] of rails) {
      if (x < Math.min(ax, bx) - 30 || x > Math.max(ax, bx) + 30 || z < Math.min(az, bz) - 30 || z > Math.max(az, bz) + 30) continue;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      best = Math.min(best, Math.hypot(x - ax - dx * s, z - az - dz * s));
    }
    return best;
  };
  const trees: Tree[] = [];
  // No trees in water or inside buildings; crowns may not grow through walls.
  const add = (t: Tree) => {
    if (water.contains(t.x, t.z)) return;
    const wall = walls.wallDistance(t.x, t.z);
    if (wall < 0.4) return;
    const rail = railDistance(t.x, t.z);
    if (rail < 2.5) return; // on or next to the tracks
    const maxCrown = Math.min(2 * (wall + 0.6), 2 * (rail - 1.6));
    if (t.crown > maxCrown) {
      t.h *= Math.max(0.6, maxCrown / t.crown);
      t.crown = maxCrown;
    }
    trees.push(t);
  };
  for (const t of city) {
    const [x, z] = t.p;
    if (grid.edgeDistance(x, z) < 0.5) continue;
    add({ x, z, ...cityTreeSize(t.genus, t.species, t.year, rand) });
  }
  for (const [x, z] of spots) {
    if (grid.edgeDistance(x, z) < 1.5) continue; // keep roads and paths clear
    const r = rand();
    const h = 9 + rand() * 9;
    const kind = r < 0.7 ? 0 : r < 0.85 ? 1 : 2;
    add({ x, z, h, crown: h * (kind === 0 ? 0.6 : 0.4), kind });
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
