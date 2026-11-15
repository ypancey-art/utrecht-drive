// The city builder: things kids can add to the map with coins (from sums) and stunt points
// (from driving): extra jump ramps, loops and long Hot Wheels tracks.
import type { MapData, Pt } from './mapData';
import { loopEntry } from './loops';

export interface BuildItem {
  id: string;
  kind: 'ramps' | 'loop' | 'track';
  name: { nl: string; en: string };
  coins: number;
  points: number;
  sums: number;
  where: Pt; // where to drive to try it
}

const QUARTER: Record<string, { nl: string; en: string }> = {
  rampsNW: { nl: 'noordwest', en: 'north-west' },
  rampsNE: { nl: 'noordoost', en: 'north-east' },
  rampsSW: { nl: 'zuidwest', en: 'south-west' },
  rampsSE: { nl: 'zuidoost', en: 'south-east' },
};

function nearestStreet(map: MapData, x: number, z: number) {
  let best = '', bd = Infinity;
  for (const r of map.roads) {
    if (!r.name) continue;
    for (const [px, pz] of r.pts) {
      const d = Math.hypot(px - x, pz - z);
      if (d < bd) (bd = d), (best = r.name);
    }
  }
  return best;
}

export function buildCatalogue(map: MapData): BuildItem[] {
  const items: BuildItem[] = [];
  // Ramp groups (one per quarter of the map).
  const groups = new Map<string, NonNullable<MapData['ramps']>>();
  for (const r of map.ramps ?? []) if (r.build) (groups.get(r.build) ?? groups.set(r.build, []).get(r.build)!).push(r);
  for (const [id, ramps] of [...groups].sort()) {
    const q = QUARTER[id] ?? { nl: id, en: id };
    const r = ramps[0];
    items.push({
      id, kind: 'ramps', coins: 60, points: 40, sums: 4,
      name: { nl: `${ramps.length} schansen in het ${q.nl}`, en: `${ramps.length} jump ramps in the ${q.en}` },
      where: [r.x - Math.cos(r.yaw) * (r.len / 2 + 25), r.z - Math.sin(r.yaw) * (r.len / 2 + 25)],
    });
  }
  // Loops.
  for (const l of map.loops ?? []) {
    if (!l.build) continue;
    const e = loopEntry(l);
    const street = nearestStreet(map, l.x, l.z);
    items.push({
      id: l.build, kind: 'loop', coins: 120, points: 80, sums: 5,
      name: { nl: `Looping bij de ${street}`, en: `Loop near ${street}` },
      where: [e.x - e.dirX * 30, e.z - e.dirZ * 30],
    });
  }
  // Long tracks: each one a bit more expensive.
  (map.tracks ?? []).forEach((t, i) => {
    const first = t.parts[0];
    const p = first.kind === 'path' ? first.pts[0] : [0, 0, 0];
    items.push({
      id: t.id, kind: 'track', coins: 250 + i * 60, points: 150 + i * 50, sums: 8 + i,
      name: { nl: `Hot Wheels-baan ${t.name}`, en: `Hot Wheels track ${t.name}` },
      where: [p[0], p[2]],
    });
  });
  return items;
}
