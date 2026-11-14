// Types for public/data/overvecht.json (made by scripts/fetch-osm.mjs).
// Coordinates are metres from the map centre: [x east, z south].
export type Pt = [number, number];
export interface Road { name: string; kind: string; drivable: boolean; width: number; lanes: number; oneway?: boolean; bridge?: boolean; tunnel?: boolean; pts: Pt[] }
export interface Building {
  h: number; // typical roof height above ground (m)
  type: string;
  year?: number; // year built (3D BAG)
  floors?: number;
  eave?: number; // pitched roofs: wall height and ridge height
  ridge?: number;
  color?: string;
  roof?: string;
  roofColor?: number; // measured from the aerial photo
  church?: 'church' | 'mosque';
  lod?: [number, number, number, number, number]; // 3D shape: vertex start, count, index start, wall indices, roof indices
  pts: Pt[];
}
export interface CityTree { p: Pt; genus: string; species: string; year: number }
export interface MapData {
  center: { lat: number; lon: number };
  roads: Road[];
  buildings: Building[];
  water: { pts: Pt[] }[];
  waterways: { width: number; pts: Pt[] }[];
  rails: { pts: Pt[] }[];
  green: { pts: Pt[] }[];
  woods: { pts: Pt[] }[];
  trees: Pt[];
  treeRows: { pts: Pt[] }[];
  cityTrees?: CityTree[];
  stations: { name: string; p: Pt }[];
  lodInfo?: { positions: number; indices: number };
  /** Real 3D building shapes (3D BAG LoD2.2), loaded from buildings3d.bin. */
  lod3d?: { pos: Int16Array; idx: Uint16Array };
}

export const MAP_HALF_SIZE = 750;

export async function loadMap(): Promise<MapData> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/overvecht.json`);
  const map: MapData = await res.json();
  if (map.lodInfo) {
    const buf = await (await fetch(`${import.meta.env.BASE_URL}data/buildings3d.bin`)).arrayBuffer();
    map.lod3d = {
      pos: new Int16Array(buf, 0, map.lodInfo.positions),
      idx: new Uint16Array(buf, map.lodInfo.positions * 2, map.lodInfo.indices),
    };
  }
  return map;
}

/** Nearest point on any matching road. Returns the road, the point and the segment direction. */
export function nearestRoad(map: MapData, x: number, z: number, filter: (r: Road) => boolean = (r) => r.drivable) {
  let best = { dist2: Infinity, road: null as Road | null, x: 0, z: 0, dirX: 1, dirZ: 0 };
  for (const road of map.roads) {
    if (!filter(road)) continue;
    const p = road.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const px = ax + dx * s, pz = az + dz * s;
      const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best.dist2) {
        const len = Math.sqrt(len2);
        best = { dist2: d2, road, x: px, z: pz, dirX: dx / len, dirZ: dz / len };
      }
    }
  }
  return best;
}
