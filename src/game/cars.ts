import type { CarStats } from './car';

/** Size of a car, measured from its 3D model when it loads (metres). Forward is +x. */
export interface CarDims { length: number; width: number; height: number; wheelR: number; wheelbase: number; track: number }

export interface CarSpec {
  id: string;
  name: string; // shown in the game
  model: string; // file in public/models/cars (Kenney Car Kit, CC0)
  price: number; // coins (0 = starter)
  colors: number[]; // paint choices; the first is the model's own colour
  stats: CarStats; // base stats, upgrades add to these
  armour: number; // crash damage multiplier (lower = tougher)
  dims?: CarDims; // filled in by the art layer after loading
}

export const CARS: CarSpec[] = [
  {
    id: 'sedan', name: 'Sedan', model: 'sedan', price: 0,
    colors: [0, 0x2f6f8f, 0xd9dcde, 0x1d1f22, 0xb0302e, 0x3d5a3e],
    stats: { mass: 1500, engineForce: 3300, brakeForce: 90, maxSpeed: 22, maxSteer: 0.55, grip: 3 },
    armour: 1,
  },
  {
    id: 'hatch', name: 'Hot Hatch', model: 'hatchback-sports', price: 120,
    colors: [0, 0x7fc4c0, 0xf2efe6, 0xd8413a, 0xf2c14e],
    stats: { mass: 1250, engineForce: 3100, brakeForce: 85, maxSpeed: 23, maxSteer: 0.65, grip: 3.5 },
    armour: 1.1,
  },
  {
    id: 'suv', name: 'SUV', model: 'suv', price: 220,
    colors: [0, 0xf2f2f2, 0x1b1c1f, 0x3b5f9c, 0x8a1c22],
    stats: { mass: 2000, engineForce: 4600, brakeForce: 100, maxSpeed: 23, maxSteer: 0.52, grip: 3.1 },
    armour: 0.75,
  },
  {
    id: 'van', name: 'Van', model: 'van', price: 280,
    colors: [0, 0xf3b221, 0x3aa38f, 0xd94a2b, 0x4b8fc9],
    stats: { mass: 2500, engineForce: 4400, brakeForce: 110, maxSpeed: 20, maxSteer: 0.5, grip: 2.9 },
    armour: 0.55,
  },
  {
    id: 'sport', name: 'Sport Sedan', model: 'sedan-sports', price: 420,
    colors: [0, 0x9fb8c9, 0x1b1c1f, 0x2e7d4f, 0xd23a2f],
    stats: { mass: 1700, engineForce: 5600, brakeForce: 120, maxSpeed: 28, maxSteer: 0.52, grip: 3.6 },
    armour: 1.25,
  },
  {
    id: 'future', name: 'Future Racer', model: 'race-future', price: 650,
    colors: [0, 0xf2f2f2, 0x35d07f, 0xff7a1a, 0x7a4dff],
    stats: { mass: 1400, engineForce: 6000, brakeForce: 130, maxSpeed: 32, maxSteer: 0.5, grip: 3.9 },
    armour: 1.45,
  },
];

/** The police car (not for sale). */
export const POLICE: CarSpec = {
  id: 'police', name: 'Politie', model: 'police', price: 0, colors: [0],
  stats: { mass: 1800, engineForce: 4600, brakeForce: 110, maxSpeed: 21, maxSteer: 0.55, grip: 3.3 },
  armour: 1,
};

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
