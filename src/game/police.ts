import RAPIER from '@dimforge/rapier3d-compat';
import { Car, type DriveInput } from './car';
import type { CarSpec } from './cars';
import type { RoadGraph } from './roadGraph';
import type { Pt } from './mapData';

/** Visual for a police car; created by the art layer. */
export interface PoliceVisual {
  sync: (car: Car, t: number) => void;
  dispose: () => void;
}

interface Unit {
  car: Car;
  visual: PoliceVisual;
  path: Pt[];
  repath: number;
  stuck: number;
  reversing: number;
}

export const STAR_LEVELS = [40, 70, 90]; // crash meter values for 1, 2, 3 stars
const ESCAPE_TIME = 10; // seconds out of sight to lose the police
const SIGHT_RANGE = 70;
const CATCH_RANGE = 7;

export class Police {
  meter = 0; // crash meter 0..100
  /** People hit since the last chase (slowly forgiven). The chase starts at hitsNeeded (3 to 5). */
  hits = 0;
  hitsNeeded = 3 + Math.floor(Math.random() * 3);
  stars = 0;
  unseen = 0; // seconds the player has been out of sight
  caughtTimer = 0;
  units: Unit[] = [];
  /** Goes up each time you escape: the next chase sends more cars. Cools down slowly. */
  heat = 0;
  /** Seconds the current chase has lasted. */
  chaseTime = 0;
  /** Called when more police join a running chase. */
  onReinforce: () => void = () => {};
  private time = 0;
  /** Set by the game: is this spot water? (Police cars can end up in the canal too.) */
  inWater: (x: number, z: number) => boolean = () => false;

  constructor(
    private world: RAPIER.World,
    private graph: RoadGraph,
    private spec: CarSpec,
    private makeVisual: () => PoliceVisual,
  ) {}

  /** Adds crash damage; may raise the wanted level. */
  addCrash(points: number) {
    this.meter = Math.min(100, this.meter + points);
    const stars = STAR_LEVELS.filter((v) => this.meter >= v).length;
    if (stars > this.stars) {
      if (this.stars === 0) this.chaseTime = 0;
      this.stars = stars;
      this.unseen = 0;
    }
  }

  /** Hitting a pedestrian or cyclist: after 3 to 5 of them the police come. */
  addPersonHit() {
    if (this.stars) {
      this.meter = Math.min(100, this.meter + 15);
      return;
    }
    this.hits += 1;
    if (this.hits >= this.hitsNeeded - 0.01) this.addCrash(STAR_LEVELS[0]);
    else this.meter = (this.hits / this.hitsNeeded) * STAR_LEVELS[0];
  }

  /** Starts a chase right away (menu option). */
  startChase() {
    this.addCrash(Math.max(0, STAR_LEVELS[0] - this.meter));
  }

  /** How many police cars take part: one per star, plus extra after earlier escapes. */
  get wantedCars() {
    return this.stars ? Math.min(6, this.stars + this.heat) : 0;
  }

  isPoliceCollider(handle: number) {
    return this.units.some((u) => u.car.collider.handle === handle);
  }

  /** Called every frame. Returns 'caught', 'escaped' or null. */
  update(dt: number, player: Car): 'caught' | 'escaped' | null {
    this.time += dt;
    if (this.stars === 0) {
      // One hit is forgiven every 45 s.
      this.hits = Math.max(0, this.hits - dt / 45);
      this.meter = (this.hits / this.hitsNeeded) * STAR_LEVELS[0];
      this.heat = Math.max(0, this.heat - dt / 90);
      return null;
    }
    this.meter = Math.max(0, this.meter - dt * 1.2);
    // The longer you stay free, the more police join (every 25 s, up to 3 stars).
    this.chaseTime += dt;
    if (this.stars < 3 && this.chaseTime > 25 * this.stars) {
      this.stars++;
      this.meter = Math.max(this.meter, STAR_LEVELS[this.stars - 1]);
      this.onReinforce();
    }
    // Keep the wanted level while the chase is on.
    this.meter = Math.max(this.meter, STAR_LEVELS[0]);

    const p = player.body.translation();
    // One police car per star, spawned out of sight on the road network.
    while (this.units.length < this.wantedCars) this.spawn(p.x, p.z);

    let seen = false;
    let close = false;
    for (const u of [...this.units]) {
      const c = u.car.body.translation();
      if (!u.car.sinking && c.y < 1.2 && this.inWater(c.x, c.z)) u.car.startSinking();
      if (u.car.sinking > 3) {
        // Sunk: remove it; a new one is sent next frame.
        u.car.dispose();
        u.visual.dispose();
        this.units.splice(this.units.indexOf(u), 1);
        continue;
      }
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < SIGHT_RANGE && this.lineOfSight(c, p)) seen = true;
      if (d < CATCH_RANGE) close = true;
      u.visual.sync(u.car, this.time);
    }

    this.unseen = seen ? 0 : this.unseen + dt;
    this.caughtTimer = close && Math.abs(player.speed) < 3 ? this.caughtTimer + dt : Math.max(0, this.caughtTimer - dt);
    if (this.caughtTimer > 1.2) return 'caught';
    if (this.unseen > ESCAPE_TIME) return 'escaped';
    return null;
  }

  /** Drives every police car one physics step towards the player. */
  step(dt: number, player: Car) {
    const p = player.body.translation();
    for (const u of this.units) {
      const c = u.car.body.translation();
      this.drive(u, dt, p, Math.hypot(c.x - p.x, c.z - p.z));
    }
  }

  /** Removes all police and resets the wanted level. escaped: the next chase gets more cars. */
  clear(escaped = false) {
    if (escaped) this.heat = Math.min(3, Math.floor(this.heat) + 1);
    for (const u of this.units) {
      u.car.dispose();
      u.visual.dispose();
    }
    this.units = [];
    this.stars = 0;
    this.meter = 0;
    this.hits = 0;
    this.hitsNeeded = 3 + Math.floor(Math.random() * 3);
    this.unseen = 0;
    this.caughtTimer = 0;
  }

  private spawn(x: number, z: number) {
    const n = this.graph.randomNodeNear(x, z, 90, 180);
    const [sx, sz] = this.graph.pts[n];
    const nb = this.graph.edges[n][0] ?? n;
    const dir = [this.graph.pts[nb][0] - sx, this.graph.pts[nb][1] - sz];
    const len = Math.hypot(dir[0], dir[1]) || 1;
    const car = new Car(this.world, this.spec.stats, this.spec.dims);
    car.place(sx, sz, dir[0] / len, dir[1] / len);
    this.units.push({ car, visual: this.makeVisual(), path: [], repath: 0, stuck: 0, reversing: 0 });
  }

  private lineOfSight(a: RAPIER.Vector, b: RAPIER.Vector) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return true;
    const ray = new RAPIER.Ray({ x: a.x, y: 1.5, z: a.z }, { x: dx / d, y: 0, z: dz / d });
    // Only static scenery blocks the view (buildings, trees).
    const hit = this.world.castRay(ray, d - 3, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return !hit || hit.timeOfImpact >= d - 3;
  }

  /** Follows the road route to the player; drives straight at them when close and visible. */
  private drive(u: Unit, dt: number, p: RAPIER.Vector, dist: number) {
    const c = u.car.body.translation();
    if (u.car.sinking) {
      u.car.updateSinking(dt);
      return;
    }
    u.repath -= dt;
    if (u.repath <= 0) {
      u.repath = 1;
      u.path = this.graph.route(this.graph.nearest(c.x, c.z), this.graph.nearest(p.x, p.z));
    }
    // Next waypoint at least 10 m ahead.
    let target: Pt = [p.x, p.z];
    if (!(dist < 25 && this.lineOfSight(c, p))) {
      while (u.path.length > 1 && Math.hypot(u.path[0][0] - c.x, u.path[0][1] - c.z) < 10) u.path.shift();
      if (u.path.length) target = u.path[0];
    }
    const r = u.car.body.rotation();
    // Car forward (+x) in world space.
    const fx = 1 - 2 * (r.y * r.y + r.z * r.z), fz = 2 * (r.x * r.z - r.w * r.y);
    const tx = target[0] - c.x, tz = target[1] - c.z;
    const angle = Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz); // + = target to the right
    const speed = u.car.speed;

    u.stuck = Math.abs(speed) < 1 ? u.stuck + dt : 0;
    if (u.stuck > 2) {
      u.reversing = 1.5;
      u.stuck = 0;
    }
    let input: DriveInput;
    if (u.reversing > 0) {
      u.reversing -= dt;
      input = { throttle: -1, steer: -Math.sign(angle), handbrake: false };
    } else {
      const sharp = Math.abs(angle) > 0.7;
      input = { throttle: sharp && speed > 8 ? -0.3 : sharp ? 0.5 : 1, steer: Math.max(-1, Math.min(1, angle * 2)), handbrake: false };
    }
    u.car.update(input, dt);
  }
}
