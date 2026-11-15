// Pedestrians and cyclists on the real footpaths and cycle paths. They walk or ride routes
// around the player and disappear far away. A car that hits one sends them flying, cartoon
// style: they tumble through the air, bounce, lie dizzy for a moment and get back up (it is a
// kids' game), but it counts as an accident. A cyclist's bike flies off on its own.
import type { RoadGraph } from './roadGraph';
import type { Pt } from './mapData';

export type PersonKind = 'walker' | 'cyclist';

/** A person (and their bike) flying through the air after being hit. */
export interface Flight {
  y: number; // height above the ground
  spin: number; // tumble angle (radians)
  bike?: { x: number; y: number; z: number; spin: number; heading: number; rest: boolean };
}

export interface PersonVisual {
  /** x, z, heading (radians, 0 = +x), walk phase, fallen 0..1, flying (when in the air or crashed) */
  sync: (x: number, z: number, heading: number, phase: number, fallen: number, flight?: Flight | null) => void;
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
  /** Crash state: position/speed in the air, tumbling, and the bike's own flight. */
  crash: null | {
    vx: number; vy: number; vz: number; y: number; spin: number; spinV: number; landed: boolean;
    bike?: { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; spinV: number; heading: number; rest?: boolean };
  };
  visual: PersonVisual;
}

const G = 14; // a bit more than real gravity: snappier, cartoonier arcs

const WALK = 1.35, RIDE = 4.6; // m/s
const HIT_RANGE = 1.6;

export class People {
  list: Person[] = [];
  private spawnTimer = 0;
  private walkGraph: RoadGraph;
  private bikeGraph: RoadGraph;
  private makeVisual: (kind: PersonKind) => PersonVisual;
  max: number;
  /** Called when the player hits someone (strength 0..1, where it happened). */
  onHit: (strength: number, x: number, z: number) => void = () => {};

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
        if (p.crash) this.fly(p, dt);
      } else {
        this.walk(p, dt);
        // Hit by the player's car?
        if (Math.abs(carSpeed) > 2.5 && Math.hypot(p.x - px, p.z - pz) < HIT_RANGE) this.hit(p, Math.abs(carSpeed), carHeading);
      }
      if (p.down <= 0) p.crash = null;
      const c = p.crash;
      // Lying down after landing; standing up again in the last half second.
      const fallen = c ? (c.landed ? Math.min(1, p.down * 2) : 0) : 0;
      p.visual.sync(p.x, p.z, c ? p.fallDir : p.heading, p.phase, fallen,
        c ? { y: c.y, spin: c.landed ? 0 : c.spin, bike: c.bike && { x: c.bike.x, y: c.bike.y, z: c.bike.z, spin: c.bike.spin, heading: c.bike.heading, rest: !!c.bike.rest } } : null);
    }
  }

  private hit(p: Person, speed: number, carHeading: number) {
    const s = Math.min(speed, 30);
    const side = (Math.random() - 0.5) * 0.6;
    const dir = carHeading + side;
    const h = s * 0.75, vy = Math.min(11, 2 + s * 0.45);
    p.fallDir = dir;
    p.crash = {
      vx: Math.cos(dir) * h, vz: Math.sin(dir) * h, vy, y: 0, spin: 0, spinV: 5 + s * 0.6, landed: false,
    };
    if (p.kind === 'cyclist') {
      const bd = carHeading - side * 1.5;
      p.crash.bike = {
        x: p.x, y: 0, z: p.z, vx: Math.cos(bd) * h * 0.8, vz: Math.sin(bd) * h * 0.8, vy: vy * 0.7,
        spin: 0, spinV: (Math.random() < 0.5 ? -1 : 1) * (4 + s * 0.4), heading: p.heading,
      };
    }
    p.down = 3.2;
    this.onHit(Math.min(1, s / 15), p.x, p.z);
  }

  /** Flying, bouncing and sliding after a hit. Lying time only starts counting once landed. */
  private fly(p: Person, dt: number) {
    const c = p.crash!;
    if (!c.landed) {
      p.down = Math.max(p.down, 2.6);
      c.vy -= G * dt;
      c.y += c.vy * dt;
      c.spin += c.spinV * dt;
      if (c.y <= 0) {
        c.y = 0;
        if (c.vy < -4) {
          c.vy = -c.vy * 0.35; // bounce
          c.vx *= 0.5;
          c.vz *= 0.5;
          c.spinV *= 0.5;
        } else {
          c.landed = true;
          c.vy = 0;
        }
      }
    } else {
      // Sliding to a stop on the ground.
      const k = Math.max(0, 1 - dt * 6);
      c.vx *= k;
      c.vz *= k;
    }
    p.x += c.vx * dt;
    p.z += c.vz * dt;
    p.lx = p.x;
    p.lz = p.z;
    const b = c.bike;
    if (b) {
      if (!b.rest) b.vy -= G * dt;
      b.y += b.vy * dt;
      b.spin += b.spinV * dt;
      if (b.y <= 0 && !b.rest) {
        b.y = 0;
        if (b.vy < -3) {
          b.vy = -b.vy * 0.3;
          b.spinV *= 0.4;
          b.vx *= 0.5;
          b.vz *= 0.5;
        } else {
          // Comes to rest, lying on its side, sliding a little.
          b.vy = 0;
          b.vx *= Math.max(0, 1 - dt * 5);
          b.vz *= Math.max(0, 1 - dt * 5);
          b.rest = true;
        }
      }
      b.x += b.vx * dt;
      b.z += b.vz * dt;
    }
  }

  /** Testing aid: put someone at a spot, standing still. */
  placeAt(kind: PersonKind, x: number, z: number, heading: number) {
    this.list.push({ kind, x, z, heading, path: [], from: [x, z], lx: x, lz: z, speed: 0, phase: 1, side: 0, down: 0, fallDir: 0, crash: null, visual: this.makeVisual(kind) });
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
      down: 0, fallDir: 0, crash: null, visual: this.makeVisual(kind),
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
