import type { MapData, Pt } from './mapData';

/** Street (or path) network: OSM ways that share a point are connected. Used for police, traffic and people. */
export class RoadGraph {
  pts: Pt[] = [];
  edges: number[][] = [];
  private index = new Map<string, number>();
  private grid = new Map<string, number[]>();
  private cell = 30;

  /** directed: follow one-way streets (for normal traffic; the police ignore them). */
  constructor(map: MapData, directed = false, use: (r: MapData['roads'][number]) => boolean = (r) => r.drivable && !r.tunnel) {
    const id = (p: Pt) => {
      const k = `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      let i = this.index.get(k);
      if (i === undefined) {
        i = this.pts.length;
        this.index.set(k, i);
        this.pts.push(p);
        this.edges.push([]);
        const g = this.gkey(p[0], p[1]);
        (this.grid.get(g) ?? this.grid.set(g, []).get(g)!).push(i);
      }
      return i;
    };
    for (const r of map.roads) {
      if (!use(r)) continue;
      // Split long segments so routes have waypoints at least every 15 m.
      let prev = id(r.pts[0]);
      for (let k = 1; k < r.pts.length; k++) {
        const [ax, az] = r.pts[k - 1], [bx, bz] = r.pts[k];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 15);
        for (let s = 1; s <= n; s++) {
          const cur = id(s === n ? r.pts[k] : [ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
          if (cur !== prev) {
            this.edges[prev].push(cur);
            if (!(directed && r.oneway)) this.edges[cur].push(prev);
          }
          prev = cur;
        }
      }
    }
  }

  private gkey(x: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  nearest(x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (let r = 0; r <= 4 && best < 0; r++) {
      const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++)
          for (const i of this.grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            const d = (this.pts[i][0] - x) ** 2 + (this.pts[i][1] - z) ** 2;
            if (d < bd) (bd = d), (best = i);
          }
    }
    return best;
  }

  /** A* shortest path between two graph nodes; returns the list of points (empty if unreachable). */
  route(from: number, to: number): Pt[] {
    if (from < 0 || to < 0) return [];
    const h = (i: number) => Math.hypot(this.pts[i][0] - this.pts[to][0], this.pts[i][1] - this.pts[to][1]);
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, number>();
    const open: [number, number][] = [[h(from), from]];
    const closed = new Set<number>();
    while (open.length) {
      // Small binary-heap-free queue: pop the lowest f (fine for a few thousand nodes).
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0];
      if (cur === to) break;
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const nb of this.edges[cur]) {
        const ng = g.get(cur)! + Math.hypot(this.pts[nb][0] - this.pts[cur][0], this.pts[nb][1] - this.pts[cur][1]);
        if (ng < (g.get(nb) ?? Infinity)) {
          g.set(nb, ng);
          came.set(nb, cur);
          open.push([ng + h(nb), nb]);
        }
      }
      if (closed.size > 6000) return [];
    }
    if (!came.has(to) && from !== to) return [];
    const path: Pt[] = [];
    for (let c: number | undefined = to; c !== undefined; c = came.get(c)) path.push(this.pts[c]);
    return path.reverse();
  }

  /** A random node between minD and maxD metres from (x, z). */
  randomNodeNear(x: number, z: number, minD: number, maxD: number): number {
    for (let tries = 0; tries < 200; tries++) {
      const i = Math.floor(Math.random() * this.pts.length);
      const d = Math.hypot(this.pts[i][0] - x, this.pts[i][1] - z);
      if (d >= minD && d <= maxD && this.edges[i].length) return i;
    }
    return this.nearest(x, z);
  }
}
