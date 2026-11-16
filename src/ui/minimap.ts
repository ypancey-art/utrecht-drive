// Small round map in the corner: streets, water and parks around the car, turned so the car
// always points up. Ramps, loops and Hot Wheels tracks are orange; ones out of view sit on the rim.
import type { MapData, Ramp, Loop, Track } from '../game/mapData';
import { MAP_HALF_SIZE } from '../game/mapData';

const SIZE = 170; // CSS pixels
const RANGE = 170; // metres from the centre to the rim
const K = 1; // background pixels per metre
const ORANGE = '#ff8a1c';

interface Mark { x: number; z: number; yaw: number; kind: 'ramp' | 'loop' | 'track' }

export class Minimap {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private marks: Mark[] = [];
  private tracks: [number, number][][] = [];
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(map: MapData) {
    this.el = document.createElement('canvas');
    this.el.id = 'minimap';
    this.el.width = this.el.height = Math.round(SIZE * this.dpr);
    this.ctx = this.el.getContext('2d')!;
    this.bg = drawBackground(map);
  }

  addRamps(ramps: Ramp[]) {
    for (const r of ramps) this.marks.push({ x: r.x, z: r.z, yaw: r.yaw, kind: 'ramp' });
  }
  addLoops(loops: Loop[]) {
    for (const l of loops) this.marks.push({ x: l.x, z: l.z, yaw: l.yaw, kind: 'loop' });
  }
  addTracks(tracks: Track[]) {
    for (const t of tracks) {
      const line: [number, number][] = [];
      for (const p of t.parts) {
        if (p.kind === 'path') for (const q of p.pts) line.push([q[0], q[2]]);
        else line.push([p.loop.x, p.loop.z]);
      }
      if (line.length) {
        this.tracks.push(line);
        this.marks.push({ x: line[0][0], z: line[0][1], yaw: 0, kind: 'track' });
      }
    }
  }

  /** px, pz: car position; heading: angle of the car's forward direction (atan2(fz, fx)). */
  draw(px: number, pz: number, heading: number) {
    const g = this.ctx, d = this.dpr, R = (SIZE / 2) * d, s = R / RANGE;
    const sn = Math.sin(heading), cs = Math.cos(heading);
    // World (x, z) to screen: forward is up, right is right.
    const a = -s * sn, c = s * cs, b = -s * cs, dd = -s * sn;
    const e = R - (a * px + c * pz), f = R - (b * px + dd * pz);
    const toScreen = (x: number, z: number): [number, number] => [a * x + c * z + e, b * x + dd * z + f];

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 2 * R, 2 * R);
    g.save();
    g.beginPath();
    g.arc(R, R, R - d, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#3b4652';
    g.fillRect(0, 0, 2 * R, 2 * R);
    g.setTransform(a, b, c, dd, e, f);
    g.drawImage(this.bg, -MAP_HALF_SIZE, -MAP_HALF_SIZE, 2 * MAP_HALF_SIZE, 2 * MAP_HALF_SIZE);
    // Tracks as orange lines.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = ORANGE;
    g.lineWidth = 2.5 * d;
    g.lineJoin = g.lineCap = 'round';
    for (const line of this.tracks) {
      g.beginPath();
      line.forEach(([x, z], i) => {
        const [sx, sy] = toScreen(x, z);
        if (i) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.stroke();
    }
    g.restore();

    // Ramps and loops: icons inside the circle, small dots on the rim for the nearest ones outside it.
    g.setTransform(1, 0, 0, 1, 0, 0);
    const rim: [number, number, number][] = [];
    for (const m of this.marks) {
      const [sx, sy] = toScreen(m.x, m.z);
      const dx = sx - R, dy = sy - R, dist = Math.hypot(dx, dy);
      if (dist < R - 6 * d) this.icon(sx, sy, m, heading);
      else rim.push([dx / dist, dy / dist, dist]);
    }
    rim.sort((p, q) => p[2] - q[2]);
    g.fillStyle = ORANGE;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = d;
    for (const [ux, uy, dist] of rim.slice(0, 6)) {
      const r = (dist < 2 * R ? 3.5 : 2.5) * d;
      g.beginPath();
      g.arc(R + ux * (R - 5 * d), R + uy * (R - 5 * d), r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // The car: a white arrow in the middle, pointing up.
    g.fillStyle = '#fff';
    g.strokeStyle = '#1d2330';
    g.lineWidth = 1.5 * d;
    g.beginPath();
    g.moveTo(R, R - 8 * d);
    g.lineTo(R + 6 * d, R + 7 * d);
    g.lineTo(R, R + 3 * d);
    g.lineTo(R - 6 * d, R + 7 * d);
    g.closePath();
    g.fill();
    g.stroke();
    // Rim.
    g.beginPath();
    g.arc(R, R, R - d, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2 * d;
    g.stroke();
  }

  private icon(sx: number, sy: number, m: Mark, heading: number) {
    const g = this.ctx, d = this.dpr;
    g.save();
    g.translate(sx, sy);
    g.fillStyle = ORANGE;
    g.strokeStyle = '#1d2330';
    g.lineWidth = 1.2 * d;
    if (m.kind === 'ramp') {
      // A wedge pointing the way you jump (towards the lip).
      g.rotate(m.yaw - heading);
      g.beginPath();
      g.moveTo(0, -7 * d);
      g.lineTo(5 * d, 5 * d);
      g.lineTo(-5 * d, 5 * d);
      g.closePath();
      g.fill();
      g.stroke();
    } else if (m.kind === 'loop') {
      g.beginPath();
      g.arc(0, 0, 5.5 * d, 0, Math.PI * 2);
      g.lineWidth = 3 * d;
      g.strokeStyle = ORANGE;
      g.stroke();
      g.lineWidth = 1 * d;
      g.strokeStyle = '#1d2330';
      g.beginPath();
      g.arc(0, 0, 7 * d, 0, Math.PI * 2);
      g.stroke();
    } else {
      // Track start: an orange flag.
      g.beginPath();
      g.arc(0, 0, 6 * d, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(-2 * d, -3.5 * d);
      g.lineTo(3.5 * d, -1.5 * d);
      g.lineTo(-2 * d, 0.5 * d);
      g.closePath();
      g.fill();
      g.fillRect(-2.6 * d, -3.5 * d, 1.2 * d, 7.5 * d);
    }
    g.restore();
  }
}

/** The whole map once, at K pixels per metre: parks, water, rails and streets. */
function drawBackground(map: MapData): HTMLCanvasElement {
  const n = Math.round(2 * MAP_HALF_SIZE * K);
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d')!;
  const X = (x: number) => (x + MAP_HALF_SIZE) * K, Z = (z: number) => (z + MAP_HALF_SIZE) * K;
  const poly = (pts: [number, number][], fill: string) => {
    if (pts.length < 3) return;
    g.fillStyle = fill;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.closePath();
    g.fill();
  };
  const line = (pts: [number, number][], width: number, color: string) => {
    if (pts.length < 2) return;
    g.strokeStyle = color;
    g.lineWidth = width * K;
    g.beginPath();
    pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z))));
    g.stroke();
  };
  g.lineJoin = g.lineCap = 'round';
  g.fillStyle = '#4d5a52';
  g.fillRect(0, 0, n, n);
  for (const a of map.green) poly(a.pts, '#5d7d55');
  for (const a of map.woods) poly(a.pts, '#4f7048');
  for (const b of map.buildings) poly(b.pts, '#6f6a66');
  for (const w of map.water) poly(w.pts, '#3f87c4');
  for (const w of map.waterways) line(w.pts, Math.max(3, w.width), '#3f87c4');
  for (const r of map.rails) line(r.pts, 4, '#8a7f74');
  for (const r of map.roads) if (!r.drivable) line(r.pts, 2, 'rgba(200,190,170,0.45)');
  for (const r of map.roads) if (r.drivable) line(r.pts, Math.max(11, r.width + 4), '#1d2330');
  for (const r of map.roads) if (r.drivable) line(r.pts, Math.max(8, r.width + 1), '#f2efe8');
  return cv;
}
