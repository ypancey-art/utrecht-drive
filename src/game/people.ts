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
    this.list.push({ kind, x, z, heading, path: [], speed: 0, phase: 1, side: 0, down: 0, fallDir: 0, visual: this.makeVisual(kind) });
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
    const n = g.randomNodeNear(px, pz, 15, 140);
    if (n < 0) return;
    const goal = g.randomNodeNear(g.pts[n][0], g.pts[n][1], 60, 250);
    const path = g.route(n, goal);
    if (path.length < 2) return;
    const [x, z] = path[0];
    this.list.push({
      kind, x, z, heading: 0, path: path.slice(1),
      speed: (kind === 'cyclist' ? RIDE : WALK) * (0.8 + Math.random() * 0.4),
      phase: Math.random() * 10, side: kind === 'cyclist' ? 0.7 : 0.4 + Math.random() * 0.5,
      down: 0, fallDir: 0, visual: this.makeVisual(kind),
    });
  }

  private walk(p: Person, dt: number) {
    if (!p.path.length) {
      // Arrived: pick a new destination from here.
      const g = p.kind === 'cyclist' ? this.bikeGraph : this.walkGraph;
      const n = g.nearest(p.x, p.z);
      p.path = g.route(n, g.randomNodeNear(p.x, p.z, 60, 250)).slice(1);
      if (!p.path.length) return;
    }
    const [tx, tz] = p.path[0];
    // Aim a little to the right of the path line (keep right).
    const dx0 = tx - p.x, dz0 = tz - p.z, d0 = Math.hypot(dx0, dz0) || 1;
    const ax = tx - (dz0 / d0) * p.side, az = tz + (dx0 / d0) * p.side;
    const dx = ax - p.x, dz = az - p.z, d = Math.hypot(dx, dz);
    if (d < 0.8) {
      p.path.shift();
      return;
    }
    const want = Math.atan2(dz, dx);
    let diff = want - p.heading;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    p.heading += Math.max(-dt * 4, Math.min(dt * 4, diff));
    const step = p.speed * dt * (Math.abs(diff) > 1.2 ? 0.4 : 1);
    p.x += Math.cos(p.heading) * step;
    p.z += Math.sin(p.heading) * step;
    p.phase += step * (p.kind === 'cyclist' ? 1.2 : 2.6);
  }
}
