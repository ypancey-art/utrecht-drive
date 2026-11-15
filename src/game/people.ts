// Pedestrians and cyclists on the real footpaths and cycle paths. They walk or ride routes
// around the player and disappear far away. A car that hits one knocks them over: they get
// back up after a moment (it is a kids' game), but it counts as an accident.
import type { RoadGraph } from './roadGraph';
import type { Pt } from './mapData';

export type PersonKind = 'walker' | 'cyclist';

export interface PersonVisual {
  /** x, z, heading (radians, 0 = +x), walk phase, fallen 0..1 */
  sync: (x: number, z: number, heading: number, phase: number, fallen: number) => void;
  dispose: () => void;
}

interface Person {
  kind: PersonKind;
  x: number;
  z: number;
  heading: number;
  speed: number;
  path: Pt[];
  /** Start of the current path segment (the person moves along from -> path[0]). */
  from: Pt;
  /** Position along the path line, without the keep-right offset. */
  lx: number;
  lz: number;
  phase: number;
  side: number; // keep-right offset
  down: number; // seconds left lying down after being hit
  fallDir: number;
  visual: PersonVisual;
}

const WALK = 1.35, RIDE = 4.6; // m/s
const HIT_RANGE = 1.6;

export class People {
  list: Person[] = [];
  private spawnTimer = 0;
  private walkGraph: RoadGraph;
  private bikeGraph: RoadGraph;
  private makeVisual: (kind: PersonKind) => PersonVisual;
  max: number;
  /** Called when the player hits someone (strength 0..1). */
  onHit: (strength: number) => void = () => {};

  constructor(walkGraph: RoadGraph, bikeGraph: RoadGraph, makeVisual: (kind: PersonKind) => PersonVisual, max = 40) {
    this.walkGraph = walkGraph;
    this.bikeGraph = bikeGraph;
    this.makeVisual = makeVisual;
    this.max = max;
  }

  update(dt: number, px: number, pz: number, carSpeed: number, carHeading: number) {
    this.spawnTimer -= dt;
    if (this.list.length < this.max && this.spawnTimer <= 0) {
      this.spawnTimer = 0.15;
      this.spawn(px, pz, Math.random() < 0.35 ? 'cyclist' : 'walker');
    }
    for (const p of [...this.list]) {
      if (Math.hypot(p.x - px, p.z - pz) > 190) {
        this.remove(p);
        continue;
      }
      if (p.down > 0) {
        p.down -= dt;
      } else {
        this.walk(p, dt);
        // Hit by the player's car?
        if (Math.abs(carSpeed) > 2.5 && Math.hypot(p.x - px, p.z - pz) < HIT_RANGE) {
          p.down = 3;
          p.fallDir = carHeading;
          this.onHit(Math.min(1, Math.abs(carSpeed) / 15));
        }
      }
      const fallen = p.down > 0 ? Math.min(1, (3 - p.down) * 6, p.down * 2) : 0;
      if (p.down > 0 && p.down > 2.6) {
        // Pushed away a little while falling.
        p.x += Math.cos(p.fallDir) * dt * 4;
        p.z += Math.sin(p.fallDir) * dt * 4;
      }
      p.visual.sync(p.x, p.z, p.down > 0 ? p.fallDir : p.heading, p.phase, fallen);
    }
  }

  /** Testing aid: put someone at a spot, standing still. */
  placeAt(kind: PersonKind, x: number, z: number, heading: number) {
    this.list.push({ kind, x, z, heading, path: [], from: [x, z], lx: x, lz: z, speed: 0, phase: 1, side: 0, down: 0, fallDir: 0, visual: this.makeVisual(kind) });
  }

  clear() {
    for (const p of [...this.list]) this.remove(p);
  }

  private remove(p: Person) {
    p.visual.dispose();
    this.list.splice(this.list.indexOf(p), 1);
  }

  private spawn(px: number, pz: number, kind: PersonKind) {
    const g = kind === 'cyclist' ? this.bikeGraph : this.walkGraph;
    if (!g.pts.length) return;
    const bike = kind === 'cyclist';
    const n = g.randomNodeNear(px, pz, 15, 140, bike);
    if (n < 0) return;
    const goal = g.randomNodeNear(g.pts[n][0], g.pts[n][1], 80, 300, bike);
    const path = g.route(n, goal);
    if (path.length < 2) return;
    const [x, z] = path[0];
    const heading = Math.atan2(path[1][1] - z, path[1][0] - x);
    this.list.push({
      kind, x, z, heading, path: path.slice(1), from: path[0], lx: x, lz: z,
      speed: (kind === 'cyclist' ? RIDE : WALK) * (0.8 + Math.random() * 0.4),
      phase: Math.random() * 10, side: kind === 'cyclist' ? 0.7 : 0.4 + Math.random() * 0.5,
      down: 0, fallDir: 0, visual: this.makeVisual(kind),
    });
  }

  private walk(p: Person, dt: number) {
    if (!p.path.length) {
      // Arrived: pick a new destination from here.
      const g = p.kind === 'cyclist' ? this.bikeGraph : this.walkGraph;
      const n = g.nearest(p.lx, p.lz);
      if (n < 0) return;
      const path = g.route(n, g.randomNodeNear(p.lx, p.lz, 80, 300, p.kind === 'cyclist'));
      if (path.length < 2) return;
      p.from = [p.lx, p.lz];
      p.path = path.slice(1);
    }
    // Move along the path line itself (no steering, so nobody can orbit a waypoint).
    let step = p.speed * dt;
    while (step > 0 && p.path.length) {
      const [tx, tz] = p.path[0];
      const d = Math.hypot(tx - p.lx, tz - p.lz);
      if (d <= step) {
        step -= d;
        p.lx = tx;
        p.lz = tz;
        p.from = p.path.shift()!;
      } else {
        p.lx += ((tx - p.lx) / d) * step;
        p.lz += ((tz - p.lz) / d) * step;
        step = 0;
      }
    }
    // Keep right of the line, and ease the shown position/heading so corners look smooth.
    const to = p.path[0] ?? [p.lx + Math.cos(p.heading), p.lz + Math.sin(p.heading)];
    const sx = to[0] - p.from[0], sz = to[1] - p.from[1], sl = Math.hypot(sx, sz) || 1;
    const wx = p.lx - (sz / sl) * p.side, wz = p.lz + (sx / sl) * p.side;
    const k = Math.min(1, dt * 5);
    const mx = (wx - p.x) * k, mz = (wz - p.z) * k;
    p.x += mx;
    p.z += mz;
    const want = Math.atan2(sz, sx);
    let diff = want - p.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    p.heading += diff * Math.min(1, dt * 6);
    p.phase += p.speed * dt * (p.kind === 'cyclist' ? 1.2 : 2.6);
  }
}
