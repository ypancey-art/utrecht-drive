// The railway through Overvecht runs on a dyke (embankment). Every street, cycle path or footpath
// that crosses the railway passes underneath it through an opening with a bridge deck on top
// (OSM tags those as railway bridges or as short road tunnels, like the Tiberdreef tunnel at the
// station). The dyke is a height grid so parallel tracks merge into one wide embankment.
import type { MapData, Pt } from './mapData';

export const RAIL_H = 4.5; // height of the track bed above the street
const TOP = 2.2; // half width of the gravel top per track
const SLOPE = 1.5; // horizontal metres per metre of height (next to streets and paths)
const GENTLE = 3.2; // elsewhere the grass slope is gentle enough to drive up (about 17°)
const FOOT = TOP + RAIL_H * SLOPE;
const WIDE = TOP + RAIL_H * GENTLE;
const DECK = 1.0; // bridge deck thickness
const RES = 1; // grid spacing (m)
const CLOSE = 3; // fill gaps between parallel tracks up to 2*CLOSE cells wide
const REACH = 35; // how far along a crossing road the opening can reach (m)

export interface Dyke {
  pos: Float32Array; // vertices (x, y, z) of the embankment surface
  idx: Uint32Array; // its triangles
  top: Uint8Array; // per vertex: 1 = gravel track bed, 0 = grass slope
  walls: number[]; // abutment walls on both sides of each opening (triangles x, y, z, ...)
  decks: { ax: number; az: number; bx: number; bz: number; width: number }[]; // bridge spans
}

type Seg = [number, number, number, number];
const segDist = (x: number, z: number, [ax, az, bx, bz]: Seg) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
const segClosest = (x: number, z: number, [ax, az, bx, bz]: Seg): Pt => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return [ax + dx * t, az + dz * t];
};
const cross = (a: Seg, b: Seg) => {
  const rx = a[2] - a[0], rz = a[3] - a[1], sx = b[2] - b[0], sz = b[3] - b[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((b[0] - a[0]) * sz - (b[1] - a[1]) * sx) / den, u = ((b[0] - a[0]) * rz - (b[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
};

/** Roads tagged as a tunnel where they pass under the railway are opened up (driven at street level). */
function openUnderpasses(map: MapData, railSegs: Seg[]) {
  for (const r of map.roads) {
    if (!r.tunnel) continue;
    const crosses = r.pts.slice(1).some((b, i) => railSegs.some((s) => cross([r.pts[i][0], r.pts[i][1], b[0], b[1]], s) >= 0));
    if (crosses) r.tunnel = false;
  }
}

export function buildDyke(map: MapData): Dyke {
  const railSegs: Seg[] = [];
  const raised: Seg[] = []; // segments that sit on the dyke (not on an OSM bridge)
  const decks: Dyke['decks'] = [];
  for (const r of map.rails)
    for (let i = 0; i < r.pts.length - 1; i++) {
      const s: Seg = [r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]];
      if (Math.hypot(s[2] - s[0], s[3] - s[1]) < 0.01) continue;
      railSegs.push(s);
      if (r.bridge) decks.push({ ax: s[0], az: s[1], bx: s[2], bz: s[3], width: TOP * 2 + 0.6 });
      else raised.push(s);
    }
  openUnderpasses(map, railSegs);

  // Openings: the part of every crossing road near the crossing, with its half width.
  const openings: { seg: Seg; hw: number }[] = [];
  for (const r of map.roads) {
    if (r.bridge || r.tunnel) continue;
    const pts = r.pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const at = (s: number): Pt => {
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    };
    const hits: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const rs: Seg = [pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]];
      for (const s of railSegs) {
        const t = cross(rs, s);
        if (t >= 0) hits.push(cum[i] + t * (cum[i + 1] - cum[i]));
      }
    }
    if (!hits.length) continue;
    if (r.kind === 'service' && cum[cum.length - 1] < 80) continue; // little maintenance loops between the tracks
    const hw = r.width / 2 + (r.drivable ? 1.5 : 2.2); // paths: room for a car too
    // Merge the stretches around each crossing and cut them into short pieces.
    const spans = hits.map((s) => [Math.max(0, s - REACH), Math.min(cum[cum.length - 1], s + REACH)]).sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push([...sp]);
    }
    for (const [s0, s1] of merged) {
      // Follow the polyline exactly: break at its own vertices.
      const cuts = [s0, ...cum.filter((c) => c > s0 && c < s1), s1];
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = at(cuts[k]), b = at(cuts[k + 1]);
        openings.push({ seg: [a[0], a[1], b[0], b[1]], hw });
      }
    }
  }
  // OSM often splits a path into several ways at a crossing: also open every road piece that
  // runs into the dyke at an angle (roads running alongside the dyke stay outside it).
  const CELL = 20, railCells = new Map<string, number[]>();
  raised.forEach((s, i) => {
    for (let cx = Math.floor((Math.min(s[0], s[2]) - FOOT) / CELL); cx <= Math.floor((Math.max(s[0], s[2]) + FOOT) / CELL); cx++)
      for (let cz = Math.floor((Math.min(s[1], s[3]) - FOOT) / CELL); cz <= Math.floor((Math.max(s[1], s[3]) + FOOT) / CELL); cz++)
        (railCells.get(`${cx},${cz}`) ?? railCells.set(`${cx},${cz}`, []).get(`${cx},${cz}`)!).push(i);
  });
  const across = (x: number, z: number, ux: number, uz: number) => {
    for (const i of railCells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const s = raised[i];
      if (segDist(x, z, s) > FOOT - 0.5) continue;
      const l = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (Math.abs((ux * (s[2] - s[0]) + uz * (s[3] - s[1])) / l) < 0.87) return true;
    }
    return false;
  };
  for (const r of map.roads) {
    if (r.bridge || r.tunnel || r.kind === 'steps') continue;
    const total = r.pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0);
    if (r.kind === 'service' && total < 80) continue;
    const hw = r.width / 2 + (r.drivable ? 1.5 : 2.2);
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      let start = -1;
      for (let d = 0; d <= len + 1; d += 1) {
        const inside = d <= len && across(ax + ux * d, az + uz * d, ux, uz);
        if (inside && start < 0) start = d;
        if ((!inside || d > len) && start >= 0) {
          const d0 = Math.max(0, start - 3), d1 = Math.min(len, d + 2);
          openings.push({ seg: [ax + ux * d0, az + uz * d0, ax + ux * d1, az + uz * d1], hw });
          start = -1;
        }
      }
    }
  }

  // ---- height grid
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of raised) {
    minX = Math.min(minX, s[0], s[2]); maxX = Math.max(maxX, s[0], s[2]);
    minZ = Math.min(minZ, s[1], s[3]); maxZ = Math.max(maxZ, s[1], s[3]);
  }
  if (!raised.length) return { pos: new Float32Array(), idx: new Uint32Array(), top: new Uint8Array(), walls: [], decks };
  const pad = WIDE + CLOSE * RES + 2;
  const x0 = Math.floor(minX - pad), z0 = Math.floor(minZ - pad);
  const nx = Math.ceil((maxX + pad - x0) / RES) + 1, nz = Math.ceil((maxZ + pad - z0) / RES) + 1;
  const H = new Float32Array(nx * nz);
  const X = (i: number) => x0 + i * RES, Z = (j: number) => z0 + j * RES;
  const profile = (d: number, slope: number) => (d <= TOP ? RAIL_H : Math.max(0, RAIL_H - (d - TOP) / slope));
  // Steep dyke everywhere (as before), plus a gentle grass slope that is only allowed to rise
  // as far as it stays clear of streets and paths running alongside (it drops at the steep
  // slope towards them), so cars can drive up onto the tracks without anything covering a road.
  const G = new Float32Array(nx * nz);
  for (const s of raised) {
    const i0 = Math.max(0, Math.floor((Math.min(s[0], s[2]) - WIDE - x0) / RES)), i1 = Math.min(nx - 1, Math.ceil((Math.max(s[0], s[2]) + WIDE - x0) / RES));
    const j0 = Math.max(0, Math.floor((Math.min(s[1], s[3]) - WIDE - z0) / RES)), j1 = Math.min(nz - 1, Math.ceil((Math.max(s[1], s[3]) + WIDE - z0) / RES));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = segDist(X(i), Z(j), s), k = j * nx + i;
        const h = profile(d, SLOPE), g = profile(d, GENTLE);
        if (h > H[k]) H[k] = h;
        if (g > G[k]) G[k] = g;
      }
  }
  // Morphological closing (max filter, then min filter) fills the dip between parallel tracks.
  // Separable max / min filters, written as plain loops (this runs on every start).
  const filter = (src: Float32Array, isMax: boolean) => {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let j = 0; j < nz; j++) {
      const row = j * nx;
      for (let i = 0; i < nx; i++) {
        let v = src[row + i];
        const k1 = Math.min(nx - 1, i + CLOSE);
        for (let k = Math.max(0, i - CLOSE); k <= k1; k++) {
          const w = src[row + k];
          if (isMax ? w > v : w < v) v = w;
        }
        tmp[row + i] = v;
      }
    }
    for (let j = 0; j < nz; j++) {
      const k0 = Math.max(0, j - CLOSE), k1 = Math.min(nz - 1, j + CLOSE);
      for (let i = 0; i < nx; i++) {
        let v = tmp[j * nx + i];
        for (let k = k0; k <= k1; k++) {
          const w = tmp[k * nx + i];
          if (isMax ? w > v : w < v) v = w;
        }
        out[j * nx + i] = v;
      }
    }
    return out;
  };
  const closed = filter(filter(H, true), false);
  for (let k = 0; k < H.length; k++) H[k] = Math.max(H[k], closed[k]);
  {
    const REACH_G = RAIL_H * SLOPE; // beyond this a road no longer limits the slope
    const RC = 16, roadCells = new Map<number, number[]>();
    const sides: number[] = []; // ax, az, bx, bz, half width
    const lines: [Pt[], number, boolean][] = [
      ...map.roads.filter((r) => !r.bridge && !r.tunnel).map((r): [Pt[], number, boolean] => [r.pts, r.width / 2 + 1, false]),
      ...map.waterways.map((w): [Pt[], number, boolean] => [w.pts, w.width / 2 + 1, false]),
      ...map.water.map((w): [Pt[], number, boolean] => [[...w.pts, w.pts[0]], 1, true]),
      ...map.buildings.map((b): [Pt[], number, boolean] => [[...b.pts, b.pts[0]], 1, true]),
    ];
    // Areas (water, buildings): points inside one get no gentle slope at all.
    const areas = lines.filter((l) => l[2]).map(([pts]) => {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [x, z] of pts) (a = Math.min(a, x)), (b = Math.min(b, z)), (c = Math.max(c, x)), (d = Math.max(d, z));
      return { pts, box: [a, b, c, d] };
    }).filter(({ box }) => box[2] > x0 && box[0] < x0 + nx * RES && box[3] > z0 && box[1] < z0 + nz * RES);
    // Mark grid points inside an area (only where the gentle slope would add height).
    const inside = new Uint8Array(nx * nz);
    for (const { pts, box } of areas) {
      const i0 = Math.max(0, Math.floor((box[0] - x0) / RES)), i1 = Math.min(nx - 1, Math.ceil((box[2] - x0) / RES));
      const j0 = Math.max(0, Math.floor((box[1] - z0) / RES)), j1 = Math.min(nz - 1, Math.ceil((box[3] - z0) / RES));
      for (let jj = j0; jj <= j1; jj++) {
        const z = Z(jj);
        // Crossings of this row with the polygon, then fill between pairs.
        const xs: number[] = [];
        for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
          const [xa, za] = pts[a], [xb, zb] = pts[b];
          if (za > z !== zb > z) xs.push(((xb - xa) * (z - za)) / (zb - za) + xa);
        }
        xs.sort((p, q) => p - q);
        for (let q = 0; q + 1 < xs.length; q += 2)
          for (let ii = Math.max(i0, Math.ceil((xs[q] - x0) / RES)); ii <= Math.min(i1, Math.floor((xs[q + 1] - x0) / RES)); ii++) inside[jj * nx + ii] = 1;
      }
    }
    for (const [pts, hw] of lines) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = sides.length;
        if (Math.max(ax, bx) < x0 - 20 || Math.min(ax, bx) > x0 + nx * RES + 20 || Math.max(az, bz) < z0 - 20 || Math.min(az, bz) > z0 + nz * RES + 20) continue;
        sides.push(ax, az, bx, bz, hw);
        const pad = hw + REACH_G;
        for (let cx = Math.floor((Math.min(ax, bx) - pad) / RC); cx <= Math.floor((Math.max(ax, bx) + pad) / RC); cx++)
          for (let cz = Math.floor((Math.min(az, bz) - pad) / RC); cz <= Math.floor((Math.max(az, bz) + pad) / RC); cz++)
            (roadCells.get(cx * 4096 + cz) ?? roadCells.set(cx * 4096 + cz, []).get(cx * 4096 + cz)!).push(n);
      }
    }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (G[k] <= H[k]) continue;
        const x = X(i), z = Z(j);
        let d = REACH_G;
        for (const n of roadCells.get(Math.floor(x / RC) * 4096 + Math.floor(z / RC)) ?? []) {
          const ax = sides[n], az = sides[n + 1], dx = sides[n + 2] - ax, dz = sides[n + 3] - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          const e = Math.hypot(x - ax - dx * t, z - az - dz * t) - sides[n + 4];
          if (e < d) d = e;
        }
        if (inside[k]) continue;
        // Roads crossing the dyke get an opening anyway: only roads alongside should limit it.
        H[k] = Math.max(H[k], Math.min(G[k], Math.max(0, d) / SLOPE));
      }
  }

  // ---- openings: grid points inside one are cut; those next to the edge are moved onto it.
  const cut = new Uint8Array(nx * nz);
  const near = new Map<number, number[]>();
  openings.forEach(({ seg, hw }, oi) => {
    const i0 = Math.max(0, Math.floor((Math.min(seg[0], seg[2]) - hw - x0) / RES) - 1), i1 = Math.min(nx - 1, Math.ceil((Math.max(seg[0], seg[2]) + hw - x0) / RES) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(seg[1], seg[3]) - hw - z0) / RES) - 1), j1 = Math.min(nz - 1, Math.ceil((Math.max(seg[1], seg[3]) + hw - z0) / RES) + 1);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (H[k] <= 0) continue;
        if (segDist(X(i), Z(j), seg) < hw) {
          cut[k] = 1;
          (near.get(k) ?? near.set(k, []).get(k)!).push(oi);
        }
      }
  });
  const posX = new Float32Array(nx * nz), posZ = new Float32Array(nx * nz);
  const state = new Uint8Array(nx * nz); // 0 normal, 1 edge (moved onto the opening edge), 2 inside (dropped)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      posX[k] = X(i);
      posZ[k] = Z(j);
      if (!cut[k]) continue;
      let edge = false;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < nx && b < nz && !cut[b * nx + a] && H[b * nx + a] > 0) edge = true;
        }
      state[k] = edge ? 1 : 2;
      if (!edge) continue;
      // Push the point out of every opening it is in (onto the nearest edge).
      for (let pass = 0; pass < 2; pass++)
        for (const oi of near.get(k) ?? []) {
          const { seg, hw } = openings[oi];
          const [cx, cz] = segClosest(posX[k], posZ[k], seg);
          const dx = posX[k] - cx, dz = posZ[k] - cz, d = Math.hypot(dx, dz);
          if (d >= hw) continue;
          if (d < 1e-3) continue;
          posX[k] = cx + (dx / d) * hw;
          posZ[k] = cz + (dz / d) * hw;
        }
    }

  // ---- mesh: only cells that have height and are not inside an opening
  const vid = new Int32Array(nx * nz).fill(-1);
  const pos: number[] = [], top: number[] = [], idx: number[] = [];
  const v = (k: number) => {
    if (vid[k] < 0) {
      vid[k] = pos.length / 3;
      pos.push(posX[k], H[k], posZ[k]);
      top.push(H[k] >= RAIL_H - 0.05 ? 1 : 0);
    }
    return vid[k];
  };
  const edges = new Map<string, number>(); // boundary edges between two moved points -> walls
  const tri = (a: number, b: number, c: number) => {
    if (state[a] === 2 || state[b] === 2 || state[c] === 2) return;
    if (H[a] <= 0 && H[b] <= 0 && H[c] <= 0) return;
    if (state[a] === 1 && state[b] === 1 && state[c] === 1) return; // sliver along the edge
    idx.push(v(a), v(b), v(c));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (state[p] !== 1 || state[q] !== 1) continue;
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  };
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // Winding gives upward normals (x east, z south).
      tri(a, c, b);
      tri(b, c, d);
    }

  // Abutment walls: from the street up to the dyke along the edges of every opening.
  const walls: number[] = [];
  for (const [key, n] of edges) {
    if (n !== 1) continue;
    const [p, q] = key.split(',').map(Number);
    if (H[p] < 0.1 && H[q] < 0.1) continue;
    const a = [posX[p], 0, posZ[p]], b = [posX[q], 0, posZ[q]];
    walls.push(...a, ...b, posX[q], H[q], posZ[q], ...a, posX[q], H[q], posZ[q], posX[p], H[p], posZ[p]);
  }

  // Decks: every stretch of track over an opening.
  for (const s of raised) {
    const len = Math.hypot(s[2] - s[0], s[3] - s[1]);
    const sx0 = Math.min(s[0], s[2]), sx1 = Math.max(s[0], s[2]), sz0 = Math.min(s[1], s[3]), sz1 = Math.max(s[1], s[3]);
    const nearOpenings = openings.filter(({ seg, hw }) =>
      Math.max(seg[0], seg[2]) + hw + 1 >= sx0 && Math.min(seg[0], seg[2]) - hw - 1 <= sx1 && Math.max(seg[1], seg[3]) + hw + 1 >= sz0 && Math.min(seg[1], seg[3]) - hw - 1 <= sz1);
    if (!nearOpenings.length) continue;
    let start = -1;
    const STEP = 0.5;
    for (let d = 0; d <= len + STEP; d += STEP) {
      const t = Math.min(d, len) / len;
      const x = s[0] + (s[2] - s[0]) * t, z = s[1] + (s[3] - s[1]) * t;
      const over = d <= len && nearOpenings.some(({ seg, hw }) => segDist(x, z, seg) < hw + 0.5);
      if (over && start < 0) start = d;
      if ((!over || d > len) && start >= 0) {
        const e = Math.min(len, d);
        const t0 = Math.max(0, start - 1) / len, t1 = Math.min(len, e + 1) / len;
        decks.push({ ax: s[0] + (s[2] - s[0]) * t0, az: s[1] + (s[3] - s[1]) * t0, bx: s[0] + (s[2] - s[0]) * t1, bz: s[1] + (s[3] - s[1]) * t1, width: TOP * 2 + 0.6 });
        start = -1;
      }
    }
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx), top: Uint8Array.from(top), walls, decks };
}

export const RAIL_DECK = DECK;
