import type { CarStats } from './car';

/** Shape parameters for the low-poly model (metres). Forward is +x. */
export interface CarShape {
  length: number;
  width: number;
  height: number; // roof height
  belt: number; // height of the window line
  clearance: number;
  noseTop: number; // height of the front edge of the bonnet
  tailTop: number; // height of the rear edge
  hood: number; // length of bonnet from the front to the windscreen base
  roofFront: number; // distance from front to the top of the windscreen
  roofRear: number; // distance from rear to the top of the rear window
  deck: number; // length of the boot lid from the rear (0 = vertical tail)
  wheelR: number;
  wheelbase: number;
  lights: 'bar' | 'quad' | 'round' | 'slim' | 'buzz';
  roofColor?: number; // two-tone roof / upper body
}

export interface CarSpec {
  id: string;
  name: string; // shown in the game
  price: number; // coins (0 = starter)
  colors: number[]; // paint choices; the first is the default
  shape: CarShape;
  stats: CarStats; // base stats, upgrades add to these
  armour: number; // crash damage multiplier (lower = tougher)
}

export const CARS: CarSpec[] = [
  {
    id: 'ev4', name: 'Kia EV4', price: 0,
    colors: [0x2f6f8f, 0xd9dcde, 0x1d1f22, 0xb0302e, 0x9aa2a8, 0x3d5a3e],
    shape: {
      length: 4.73, width: 1.86, height: 1.48, belt: 0.95, clearance: 0.16, noseTop: 0.72, tailTop: 0.98,
      hood: 1.15, roofFront: 2.0, roofRear: 1.25, deck: 0.35, wheelR: 0.36, wheelbase: 2.82, lights: 'bar',
    },
    stats: { mass: 1700, engineForce: 3600, brakeForce: 90, maxSpeed: 23, maxSteer: 0.55, grip: 3 },
    armour: 1,
  },
  {
    id: '500e', name: 'Fiat 500e', price: 120,
    colors: [0x7fc4c0, 0xf2efe6, 0xd8413a, 0x1e1f22, 0xf2c14e],
    shape: {
      length: 3.63, width: 1.68, height: 1.53, belt: 0.98, clearance: 0.15, noseTop: 0.82, tailTop: 0.98,
      hood: 0.85, roofFront: 1.45, roofRear: 0.45, deck: 0.05, wheelR: 0.33, wheelbase: 2.32, lights: 'round',
      roofColor: 0x1e1f22,
    },
    stats: { mass: 1300, engineForce: 2900, brakeForce: 80, maxSpeed: 21, maxSteer: 0.65, grip: 3.4 },
    armour: 1.1,
  },
  {
    id: 'modely', name: 'Tesla Model Y', price: 250,
    colors: [0xf2f2f2, 0x1b1c1f, 0x3b5f9c, 0x8a1c22, 0x8c9096],
    shape: {
      length: 4.75, width: 1.92, height: 1.62, belt: 1.03, clearance: 0.18, noseTop: 0.8, tailTop: 1.05,
      hood: 1.05, roofFront: 2.05, roofRear: 0.95, deck: 0.3, wheelR: 0.38, wheelbase: 2.89, lights: 'slim',
    },
    stats: { mass: 1950, engineForce: 4600, brakeForce: 100, maxSpeed: 25, maxSteer: 0.52, grip: 3.1 },
    armour: 0.85,
  },
  {
    id: 'buzz', name: 'VW ID. Buzz', price: 300,
    colors: [0xf3b221, 0x3aa38f, 0xd94a2b, 0x4b8fc9, 0x8a8f94],
    shape: {
      length: 4.71, width: 1.99, height: 1.94, belt: 1.08, clearance: 0.18, noseTop: 0.95, tailTop: 1.75,
      hood: 0.35, roofFront: 0.75, roofRear: 0.2, deck: 0, wheelR: 0.38, wheelbase: 2.99, lights: 'buzz',
      roofColor: 0xf2f2ee,
    },
    stats: { mass: 2400, engineForce: 4300, brakeForce: 110, maxSpeed: 20, maxSteer: 0.5, grip: 2.9 },
    armour: 0.6,
  },
  {
    id: 'taycan', name: 'Porsche Taycan', price: 500,
    colors: [0x9fb8c9, 0x1b1c1f, 0xc9c9c4, 0x2e7d4f, 0xd23a2f],
    shape: {
      length: 4.96, width: 1.97, height: 1.38, belt: 0.86, clearance: 0.13, noseTop: 0.62, tailTop: 0.92,
      hood: 1.35, roofFront: 2.25, roofRear: 1.4, deck: 0.45, wheelR: 0.36, wheelbase: 2.9, lights: 'quad',
    },
    stats: { mass: 2100, engineForce: 6200, brakeForce: 120, maxSpeed: 30, maxSteer: 0.5, grip: 3.6 },
    armour: 1.35,
  },
];

export const carById = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];

export type UpgradeKind = 'engine' | 'tires' | 'armour';
export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'tires', 'armour'];
export const UPGRADE_COST = [40, 80, 150]; // coins for level 1, 2, 3
export const UPGRADE_PROBLEMS = [3, 4, 5]; // math problems for level 1, 2, 3
export const PAINT_COST = 15;

export interface CarUpgrades { engine: number; tires: number; armour: number; paint: number }

/** Stats after upgrades: engine +15% power/+8% top speed per level, tires +10% grip/steer per level. */
export function upgradedStats(spec: CarSpec, u: CarUpgrades): CarStats {
  const s = spec.stats;
  return {
    ...s,
    engineForce: s.engineForce * (1 + 0.15 * u.engine),
    maxSpeed: s.maxSpeed * (1 + 0.08 * u.engine),
    grip: s.grip * (1 + 0.1 * u.tires),
    maxSteer: s.maxSteer * (1 + 0.05 * u.tires),
  };
}
export const armourFactor = (spec: CarSpec, u: CarUpgrades) => spec.armour * [1, 0.75, 0.55, 0.4][u.armour];
