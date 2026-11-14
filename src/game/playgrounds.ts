// Playground equipment placed inside the OSM playground areas (deterministic).
// Visual models live in src/art/playgroundMeshes.ts; colliders use the same list.
import type { MapData, Pt } from './mapData';

export type Equipment = 'slide' | 'swings' | 'climber' | 'sandbox' | 'seesaw' | 'spring' | 'fountain';
export interface Item { kind: Equipment; x: number; z: number; rot: number; half: [number, number, number] } // half sizes for collision

const SIZE: Record<Equipment, [number, number, number]> = {
  slide: [2.2, 1.6, 0.5], swings: [1.8, 1.25, 1], climber: [1.5, 1.4, 1.5], sandbox: [1.6, 0.2, 1.6],
  seesaw: [1.7, 0.4, 0.25], spring: [0.4, 0.5, 0.25], fountain: [0.9, 0.6, 0.9],
};

function inside(x: number, z: number, pts: Pt[]) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function placePlaygrounds(map: MapData): { items: Item[]; areas: MapData['playgrounds'] } {
  const items: Item[] = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const pg of map.playgrounds) {
    const xs = pg.pts.map((p) => p[0]), zs = pg.pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const area = (maxX - minX) * (maxZ - minZ);
    if (area < 40) continue;
    // Bigger playgrounds (like De Kinderdroom) get more; water playgrounds get fountains.
    const order: Equipment[] = pg.water
      ? ['fountain', 'fountain', 'sandbox', 'climber', 'fountain', 'spring']
      : ['slide', 'swings', 'climber', 'sandbox', 'seesaw', 'spring', 'slide', 'swings', 'climber', 'spring'];
    const n = Math.min(order.length, Math.max(2, Math.round(area / 180)));
    const placed: Item[] = [];
    for (const kind of order.slice(0, n)) {
      const [hx, , hz] = SIZE[kind];
      const r = Math.hypot(hx, hz) + 1.2;
      for (let tries = 0; tries < 40; tries++) {
        const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
        if (!inside(x, z, pg.pts)) continue;
        // Keep the whole item inside and apart from the others.
        if ([[r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dz]) => !inside(x + dx, z + dz, pg.pts))) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < r + Math.hypot(p.half[0], p.half[2]) + 1.2)) continue;
        placed.push({ kind, x, z, rot: rand() * Math.PI, half: SIZE[kind] });
        break;
      }
    }
    items.push(...placed);
  }
  return { items, areas: map.playgrounds };
}
