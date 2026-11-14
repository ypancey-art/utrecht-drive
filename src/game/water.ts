import type { MapData, Pt } from './mapData';

/** Answers "is this point in water?" for ponds/canals (polygons) and ditches/streams (lines with a width). */
export class WaterMap {
  private polys: { pts: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  private lines: { ax: number; az: number; bx: number; bz: number; hw: number }[] = [];

  constructor(map: MapData) {
    for (const { pts } of map.water) {
      const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
      this.polys.push({ pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
    }
    for (const w of map.waterways) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
        this.lines.push({ ax, az, bx, bz, hw: w.width / 2 });
      }
    }
  }

  contains(x: number, z: number) {
    for (const p of this.polys) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      let inside = false;
      for (let i = 0, j = p.pts.length - 1; i < p.pts.length; j = i++) {
        const [xi, zi] = p.pts[i], [xj, zj] = p.pts[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    for (const l of this.lines) {
      const dx = l.bx - l.ax, dz = l.bz - l.az;
      const len2 = dx * dx + dz * dz || 1;
      const s = Math.max(0, Math.min(1, ((x - l.ax) * dx + (z - l.az) * dz) / len2));
      if (Math.hypot(x - l.ax - dx * s, z - l.az - dz * s) < l.hw) return true;
    }
    return false;
  }
}
