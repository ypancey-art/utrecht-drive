// Extra stunt bonuses (on top of air time, flips and spins in main.ts landJump):
//  - on two wheels (one side in the air, rolled 25-60°) or a wheelie, for at least a second;
//  - near miss: passing a traffic car very close at speed without touching it;
//  - water jump (flew over water and landed dry), gap jump (landed on a landing ramp);
//  - double / triple jump: jumps landed one after the other within a few seconds;
//  - loop combos: several loops in a row.
// main.ts calls update() every frame, landed() when a jump lands and loop() after a loop.
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Car } from './car';
import type { Ramp } from './mapData';
import { t, type TextKey } from '../i18n';

export interface StuntEvent { key: TextKey; pts: number; list?: string; big?: boolean }
export interface Trick { name: string; pts: number }
interface Pass { close: boolean; touched: boolean }

const COMBO_GAP = 4; // s between landing and the next take-off that still counts as a combo
const LOOP_GAP = 12; // s between loops for a loop combo
const DEG = Math.PI / 180;

export class Stunts {
  private clock = 0;
  private lastLanding = -1e9;
  private chain = 0;
  private lastLoop = -1e9;
  private loopChain = 0;
  private hold = { kind: '' as '' | 'two' | 'wheelie', time: 0, lost: 0 };
  private passes = new Map<Car, Pass>();
  private lastNear = -1e9;
  private water: { contains(x: number, z: number): boolean };
  private landRamps: Ramp[];

  constructor(water: { contains(x: number, z: number): boolean }, ramps: Ramp[]) {
    this.water = water;
    this.landRamps = ramps.filter((r) => r.kind === 'land');
  }

  /** Every frame (on the ground or in the air): two wheels / wheelie and near misses. */
  update(dt: number, car: Car, traffic: Car[], world: RAPIER.World): StuntEvent[] {
    this.clock += dt;
    const out: StuntEvent[] = [];
    const q = car.body.rotation();
    const fy = 2 * (q.x * q.y + q.w * q.z); // up-component of the car's forward axis (nose up > 0)
    const ry = 2 * (q.y * q.z - q.w * q.x); // up-component of its right axis (roll)
    const c = [0, 1, 2, 3].map((i) => car.vehicle.wheelIsInContact(i)); // FL, FR, RL, RR
    const oneSide = (c[0] && c[2] && !c[1] && !c[3]) || (c[1] && c[3] && !c[0] && !c[2]);
    const roll = Math.asin(Math.min(1, Math.abs(ry)));
    const moving = Math.abs(car.speed) > 2;
    const now = moving && oneSide && roll > 25 * DEG && roll < 60 * DEG ? 'two'
      : moving && c[2] && c[3] && !c[0] && !c[1] && fy > Math.sin(8 * DEG) && fy < Math.sin(50 * DEG) ? 'wheelie' : '';
    const h = this.hold;
    if (now && now === h.kind) (h.time += dt), (h.lost = 0);
    else if (now) Object.assign(h, { kind: now, time: dt, lost: 0 });
    else if (h.kind && (h.lost += dt) > 0.25) {
      // Contact flickers for a moment; the stunt ends after a quarter second without it.
      if (h.time >= 1) {
        const pts = Math.min(40, 10 + Math.floor(h.time - 1) * 5);
        out.push({ key: h.kind === 'two' ? 'stuntTwoWheels' : 'stuntWheelie', pts, big: h.time >= 2 });
      }
      Object.assign(h, { kind: '', time: 0, lost: 0 });
    }

    // Near misses: a traffic car passes within a metre at speed, and no touching.
    const p = car.body.translation(), v = car.body.linvel();
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y), fl = Math.hypot(fx, fz) || 1;
    const half = car.collider.halfExtents()!;
    for (const o of traffic) {
      const op = o.body.translation();
      const dx = op.x - p.x, dz = op.z - p.z;
      let pass = this.passes.get(o);
      if (Math.hypot(dx, dz) > 25) {
        if (pass) this.passes.delete(o);
        continue;
      }
      if (!pass) this.passes.set(o, (pass = { close: false, touched: false }));
      const along = (dx * fx + dz * fz) / fl, side = (dz * fx - dx * fz) / fl;
      const oh = o.collider.halfExtents()!;
      const gap = Math.abs(side) - half.z - oh.z;
      const alongside = Math.abs(along) < half.x + oh.x;
      const ov = o.body.linvel();
      const rel = Math.hypot(v.x - ov.x, v.z - ov.z);
      if (alongside && gap < 1 && Math.abs(car.speed) > 11 && rel > 6 && Math.abs(op.y - p.y) < 1.5) pass.close = true;
      world.contactPair(car.collider, o.collider, (m) => {
        for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.05) pass!.touched = true;
      });
      if (Math.abs(along) > half.x + oh.x + 1.5) {
        if (pass.close && !pass.touched && this.clock - this.lastNear > 1) {
          this.lastNear = this.clock;
          out.push({ key: 'stuntNearMiss', pts: 8 });
        }
        pass.close = pass.touched = false;
      }
    }
    return out;
  }

  /** A jump landed (from take-off point to landing point after `air` s): extra tricks for the combo. */
  landed(from: { x: number; z: number }, to: { x: number; z: number }, air: number): Trick[] {
    const tricks: Trick[] = [];
    // Over water: some wet ground under the flight, dry at both ends.
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    let wet = 0;
    for (let d = 1; d < dist; d++) if (this.water.contains(from.x + ((to.x - from.x) * d) / dist, from.z + ((to.z - from.z) * d) / dist)) wet++;
    if (wet >= 3 && !this.water.contains(from.x, from.z) && !this.water.contains(to.x, to.z)) tricks.push({ name: t('trickWater'), pts: 15 });
    // On a landing ramp (the far half of a ramp pair).
    for (const r of this.landRamps) {
      const c = Math.cos(r.yaw), s = Math.sin(r.yaw), dx = to.x - r.x, dz = to.z - r.z;
      if (Math.abs(dx * c + dz * s) < r.len / 2 + 3 && Math.abs(dz * c - dx * s) < r.w / 2 + 1.5) {
        tricks.push({ name: t('trickGap'), pts: 15 });
        break;
      }
    }
    // Jumps one after the other: double, triple, and more.
    this.chain = this.clock - air - this.lastLanding < COMBO_GAP ? this.chain + 1 : 1;
    this.lastLanding = this.clock;
    if (this.chain === 2) tricks.push({ name: t('trickDouble'), pts: 15 });
    else if (this.chain === 3) tricks.push({ name: t('trickTriple'), pts: 30 });
    else if (this.chain > 3) tricks.push({ name: t('trickChain', { n: this.chain }), pts: 10 * this.chain });
    return tricks;
  }

  /** A loop was completed; a few in a row make a loop combo. */
  loop(): StuntEvent {
    this.loopChain = this.clock - this.lastLoop < LOOP_GAP ? this.loopChain + 1 : 1;
    this.lastLoop = this.clock;
    if (this.loopChain < 2) return { key: 'stuntLoop', pts: 25 };
    return { key: 'stuntCombo', pts: 25 + 15 * (this.loopChain - 1), list: t('trickLoops', { n: this.loopChain }), big: true };
  }
}
