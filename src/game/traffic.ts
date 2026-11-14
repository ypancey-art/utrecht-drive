// Other road users: cars that drive real routes on the right-hand side and brake for
// whatever is in front of them. They appear around the player and disappear far away.
import { Car, type DriveInput } from './car';
import type { CarSpec } from './cars';
import type { RoadGraph } from './roadGraph';
import type { Pt } from './mapData';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface TrafficVisual {
  sync: (car: Car) => void;
  dispose: () => void;
}

interface Unit { car: Car; visual: TrafficVisual; path: Pt[]; stuck: number; age: number }

const CRUISE = 12; // m/s, about 43 km/h
const LANE = 1.6; // keep this far right of the road centre line

export class Traffic {
  units: Unit[] = [];
  private spawnTimer = 0;
  private world: RAPIER.World;
  private graph: RoadGraph;
  private specs: CarSpec[];
  private makeVisual: (spec: CarSpec, color: number) => TrafficVisual;
  max: number;

  constructor(world: RAPIER.World, graph: RoadGraph, specs: CarSpec[], makeVisual: (spec: CarSpec, color: number) => TrafficVisual, max = 14) {
    this.world = world;
    this.graph = graph;
    this.specs = specs;
    this.makeVisual = makeVisual;
    this.max = max;
  }

  isTrafficCollider(handle: number) {
    return this.units.some((u) => u.car.collider.handle === handle);
  }

  /** Spawning, despawning and visuals; once per frame. */
  update(dt: number, player: Car, others: Car[]) {
    const p = player.body.translation();
    this.spawnTimer -= dt;
    if (this.units.length < this.max && this.spawnTimer <= 0) {
      this.spawnTimer = 0.4;
      this.spawn(p.x, p.z, [player, ...others]);
    }
    for (const u of [...this.units]) {
      u.age += dt;
      const c = u.car.body.translation();
      const far = Math.hypot(c.x - p.x, c.z - p.z) > 380;
      if (far || u.stuck > 10 || u.car.flipped || c.y < -1) this.remove(u);
      else u.visual.sync(u.car);
    }
  }

  /** Drives every car one physics step. */
  step(dt: number, player: Car, others: Car[]) {
    const everyone = [player, ...others, ...this.units.map((u) => u.car)];
    for (const u of this.units) this.drive(u, dt, everyone);
  }

  clear() {
    for (const u of [...this.units]) this.remove(u);
  }

  private remove(u: Unit) {
    u.car.dispose();
    u.visual.dispose();
    this.units.splice(this.units.indexOf(u), 1);
  }

  private spawn(px: number, pz: number, avoid: Car[]) {
    const g = this.graph;
    const from = g.randomNodeNear(px, pz, 70, 260);
    if (from < 0 || !g.edges[from].length) return;
    const [sx, sz] = g.pts[from];
    const all = [...avoid, ...this.units.map((u) => u.car)];
    if (all.some((c) => Math.hypot(c.body.translation().x - sx, c.body.translation().z - sz) < 20)) return;
    const path = this.newRoute(from);
    if (path.length < 3) return;
    const spec = this.specs[Math.floor(Math.random() * this.specs.length)];
    const color = spec.colors[Math.floor(Math.random() * spec.colors.length)];
    const car = new Car(this.world, { ...spec.stats, maxSpeed: CRUISE + 2, engineForce: spec.stats.engineForce * 0.7 }, spec.dims);
    const [nx, nz] = path[1];
    const len = Math.hypot(nx - sx, nz - sz) || 1;
    const dx = (nx - sx) / len, dz = (nz - sz) / len;
    car.place(sx - dz * LANE, sz + dx * LANE, dx, dz);
    this.units.push({ car, visual: this.makeVisual(spec, color), path, stuck: 0, age: 0 });
  }

  private newRoute(from: number): Pt[] {
    const g = this.graph;
    const [x, z] = g.pts[from];
    const to = g.randomNodeNear(x, z, 200, 600);
    return g.route(from, to);
  }

  private drive(u: Unit, dt: number, everyone: Car[]) {
    const car = u.car;
    if (car.sinking) {
      car.updateSinking(dt);
      return;
    }
    const c = car.body.translation();
    const r = car.body.rotation();
    const fx = 1 - 2 * (r.y * r.y + r.z * r.z), fz = 2 * (r.x * r.z - r.w * r.y);

    // Drop waypoints we have reached; plan a new trip at the end.
    while (u.path.length > 1 && Math.hypot(u.path[0][0] - c.x, u.path[0][1] - c.z) < 9) u.path.shift();
    if (u.path.length <= 1) {
      const g = this.graph;
      u.path = this.newRoute(g.nearest(c.x, c.z));
      if (u.path.length < 2) {
        u.stuck += dt;
        car.update({ throttle: 0, steer: 0, handbrake: true }, dt);
        return;
      }
    }
    // Aim at the next waypoint, shifted into the right-hand lane.
    const [ax, az] = u.path[0];
    const [bx, bz] = u.path[1] ?? u.path[0];
    const sl = Math.hypot(bx - ax, bz - az) || 1;
    const tx = ax - ((bz - az) / sl) * LANE - c.x, tz = az + ((bx - ax) / sl) * LANE - c.z;
    const angle = Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz);

    // Slow down for bends and for anything in front.
    let target = Math.abs(angle) > 0.5 ? 6 : CRUISE;
    for (const o of everyone) {
      if (o === car) continue;
      const p = o.body.translation();
      const ox = p.x - c.x, oz = p.z - c.z;
      const ahead = ox * fx + oz * fz, side = Math.abs(ox * -fz + oz * fx);
      if (ahead > 0 && ahead < 16 && side < 2.6) target = Math.min(target, ahead < 7 ? 0 : (ahead - 7) * 1.2);
    }
    const speed = car.speed;
    u.stuck = Math.abs(speed) < 0.5 && target > 1 ? u.stuck + dt : 0;
    const input: DriveInput = {
      throttle: speed < target - 1 ? 0.7 : speed > target + 1.5 ? -0.6 : 0,
      steer: Math.max(-1, Math.min(1, angle * 1.8)),
      handbrake: target === 0 && speed < 1,
    };
    car.update(input, dt);
  }
}
