import type { MapData, Pt } from './mapData';

type Poly = { pts: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number };
type Line = { ax: number; az: number; bx: number; bz: number; hw: number };
type Deck = { ax: number; az: number; bx: number; bz: number; width: number };

const CELL = 20;
const ck = (cx: number, cz: number) => cx * 4096 + cz; // numeric cell key (map is well within ±40 km)

/** Puts an item into every grid cell its bounding box (plus a margin) touches. */
function bucket<T>(grid: Map<number, T[]>, item: T, x0: number, z0: number, x1: number, z1: number) {
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      const k = ck(cx, cz);
      const list = grid.get(k);
      if (list) list.push(item);
      else grid.set(k, [item]);
    }
}

/**
 * Answers "is this point in water?" for ponds/canals (polygons) and ditches/streams (lines with a width).
 * Everything is bucketed in a 20 m grid, so a lookup only checks the water nearby.
 */
export class WaterMap {
  private polys = new Map<number, Poly[]>();
  private lines = new Map<number, Line[]>();
  private decks = new Map<number, Deck[]>();
  private static none: never[] = [];

  constructor(map: MapData) {
    for (const { pts } of map.water) {
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      const p = { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
      bucket(this.polys, p, p.minX, p.minZ, p.maxX, p.maxZ);
    }
    for (const w of map.waterways) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
        const l = { ax, az, bx, bz, hw: w.width / 2 };
        bucket(this.lines, l, Math.min(ax, bx) - l.hw, Math.min(az, bz) - l.hw, Math.max(ax, bx) + l.hw, Math.max(az, bz) + l.hw);
      }
    }
  }

  /** Bridge decks: points on a deck are not "in the water". */
  setBridges(decks: Deck[]) {
    this.decks.clear();
    for (const d of decks) {
      const m = d.width / 2 + 0.3;
      bucket(this.decks, d, Math.min(d.ax, d.bx) - m, Math.min(d.az, d.bz) - m, Math.max(d.ax, d.bx) + m, Math.max(d.az, d.bz) + m);
    }
  }

  private cell<T>(grid: Map<number, T[]>, x: number, z: number): T[] {
    return grid.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))) ?? (WaterMap.none as T[]);
  }

  private static pip(x: number, z: number, pts: Pt[]) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  private static lineDist(x: number, z: number, l: Line) {
    const dx = l.bx - l.ax, dz = l.bz - l.az, len2 = dx * dx + dz * dz || 1;
    const s = Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / len2));
    return Math.hypot(x - l.ax - dx * s, z - l.az - dz * s);
  }

  /** In a pond/canal area or a waterway wider than a ditch (not just a ditch). */
  inBigWater(x: number, z: number) {
    for (const l of this.cell(this.lines, x, z)) if (l.hw > 2.5 && WaterMap.lineDist(x, z, l) < l.hw) return true;
    for (const p of this.cell(this.polys, x, z)) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && WaterMap.pip(x, z, p.pts)) return true;
    return false;
  }

  contains(x: number, z: number) {
    for (const d of this.cell(this.decks, x, z)) {
      const dx = d.bx - d.ax, dz = d.bz - d.az, l2 = dx * dx + dz * dz || 1;
      const s = Math.max(0, Math.min(1, ((x - d.ax) * dx + (z - d.az) * dz) / l2));
      if (Math.hypot(x - d.ax - dx * s, z - d.az - dz * s) < d.width / 2 + 0.3) return false;
    }
    for (const p of this.cell(this.polys, x, z)) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && WaterMap.pip(x, z, p.pts)) return true;
    for (const l of this.cell(this.lines, x, z)) if (WaterMap.lineDist(x, z, l) < l.hw) return true;
    return false;
  }
}
