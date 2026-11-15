// Façade looks chosen by looking at Google Street View, one street at a time (by hand, no
// images are copied or stored). Each rule gives the buildings along a street, built in a
// range of years, a façade style from buildingMeshes.ts and optionally a wall colour.
import type { MapData } from './mapData';

interface Rule {
  street: string;
  years: [number, number];
  minH?: number;
  maxH?: number;
  look: string;
  wall?: number;
  radius?: number; // metres from the street centre line (default 45)
}

export const STREET_LOOKS: Rule[] = [
  // Anna van Burendreef (Street View, Oct 2022 / Mar 2026)
  { street: 'Anna van Burendreef', years: [1955, 1970], look: 'row62' }, // red-brown brick, white bands, yellow panels
  { street: 'Anna van Burendreef', years: [1975, 1990], look: 'timber' }, // dark grey boards
  { street: 'Anna van Burendreef', years: [1991, 2004], maxH: 12, look: 'row02' }, // orange-brown brick, grey panels
  { street: 'Anna van Burendreef', years: [2003, 2012], minH: 12, look: 'woodSlat' }, // wooden slats + concrete floor edges
  { street: 'Anna van Burendreef', years: [2003, 2012], maxH: 12, look: 'modern', wall: 0xa58468 },
];

const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};

/** Sets `look` (and `lookWall`) on the buildings that a rule matches. */
export function applyStreetLooks(map: MapData) {
  for (const rule of STREET_LOOKS) {
    const segs = map.roads.filter((r) => r.name === rule.street).flatMap((r) => r.pts.slice(1).map((b, i) => [r.pts[i][0], r.pts[i][1], b[0], b[1]]));
    if (!segs.length) continue;
    const R = rule.radius ?? 45;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [ax, az, bx, bz] of segs) (x0 = Math.min(x0, ax, bx)), (x1 = Math.max(x1, ax, bx)), (z0 = Math.min(z0, az, bz)), (z1 = Math.max(z1, az, bz));
    for (const b of map.buildings) {
      if (b.church || !b.year || b.year < rule.years[0] || b.year > rule.years[1]) continue;
      if (rule.minH !== undefined && b.h < rule.minH) continue;
      if (rule.maxH !== undefined && b.h >= rule.maxH) continue;
      const [px, pz] = b.pts[0];
      if (px < x0 - R - 60 || px > x1 + R + 60 || pz < z0 - R - 60 || pz > z1 + R + 60) continue;
      const near = b.pts.some(([x, z]) => segs.some((s) => segDist(x, z, s[0], s[1], s[2], s[3]) < R));
      if (!near) continue;
      b.look = rule.look;
      if (rule.wall !== undefined) b.lookWall = rule.wall;
    }
  }
}
