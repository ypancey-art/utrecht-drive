// The railway through Overvecht runs on a dyke (embankment). Streets pass under it where
// OSM marks the railway as a bridge. This builds the shapes once, for visuals and physics.
import type { MapData, Pt } from './mapData';

export const RAIL_H = 4.5; // height of the track bed above the street
const TOP = 2.2; // half width of the gravel top per track
const FOOT = TOP + RAIL_H * 1.5; // half width at the bottom (slope 1 : 1.5)
const DECK = 1.0; // bridge deck thickness

export interface Dyke {
  slopes: number[]; // triangles (x, y, z, ...) of the grassy sides
  tops: number[]; // triangles of the gravel top
  walls: number[]; // abutment faces where the dyke meets a bridge
  decks: { ax: number; az: number; bx: number; bz: number; width: number }[]; // bridge spans
}

export function buildDyke(map: MapData): Dyke {
  const slopes: number[] = [], tops: number[] = [], walls: number[] = [];
  const decks: Dyke['decks'] = [];
  const key = (p: Pt) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const bridgeEnds = new Set<string>();
  for (const r of map.rails) if (r.bridge) for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) bridgeEnds.add(key(p));

  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);

  for (const r of map.rails) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      if (r.bridge) {
        decks.push({ ax, az, bx, bz, width: TOP * 2 + 0.6 });
        continue;
      }
      // Extend a little past the ends so neighbouring pieces meet at bends.
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const ext0 = bridgeEnds.has(key(r.pts[i])) ? 0 : 0.6, ext1 = bridgeEnds.has(key(r.pts[i + 1])) ? 0 : 0.6;
      const sx = ax - ux * ext0, sz = az - uz * ext0, ex = bx + ux * ext1, ez = bz + uz * ext1;
      const at = (x: number, z: number, off: number, y: number) => [x + nx * off, y, z + nz * off];
      quad(tops, at(sx, sz, -TOP, RAIL_H), at(ex, ez, -TOP, RAIL_H), at(ex, ez, TOP, RAIL_H), at(sx, sz, TOP, RAIL_H));
      quad(slopes, at(sx, sz, -FOOT, 0), at(ex, ez, -FOOT, 0), at(ex, ez, -TOP, RAIL_H), at(sx, sz, -TOP, RAIL_H));
      quad(slopes, at(sx, sz, TOP, RAIL_H), at(ex, ez, TOP, RAIL_H), at(ex, ez, FOOT, 0), at(sx, sz, FOOT, 0));
      // Abutment wall where the dyke ends at a bridge.
      for (const [px, pz, isEnd] of [[ax, az, bridgeEnds.has(key(r.pts[i]))], [bx, bz, bridgeEnds.has(key(r.pts[i + 1]))]] as const) {
        if (!isEnd) continue;
        quad(walls, at(px, pz, -FOOT, 0), at(px, pz, FOOT, 0), at(px, pz, TOP, RAIL_H), at(px, pz, -TOP, RAIL_H));
      }
    }
  }
  return { slopes, tops, walls, decks };
}

export const RAIL_DECK = DECK;
