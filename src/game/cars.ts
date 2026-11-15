import type { CarStats } from './car';

/** Size of a car, measured from its 3D model when it loads (metres). Forward is +x. */
export interface CarDims { length: number; width: number; height: number; wheelR: number; wheelbase: number; track: number }

export interface CarSpec {
  id: string;
  name: string; // shown in the game
  model: string; // body in public/models/cars/car-pack.glb: "<node>|<length m>|<flip front/back 0/1>"
  price: number; // coins (0 = starter)
  problems?: number; // sums to solve when buying (default 6)
  premium?: boolean; // shown with a ★ in the garage
  colors: number[]; // paint choices; the first is the model's own colour
  stats: CarStats; // base stats, upgrades add to these
  armour: number; // crash damage multiplier (lower = tougher)
  dims?: CarDims; // filled in by the art layer after loading
}

// Models: "Generic passenger car pack" by Comrade1280 (CC BY 4.0). Model = "<node>|<length m>|<flip>".
export const CARS: CarSpec[] = [
  {
    id: 'compact', name: 'Compact', model: 'Compact Body|3.9|0', price: 0,
    colors: [0, 0x2f6f8f, 0xd9dcde, 0x1d1f22, 0xb0302e, 0x7fc4c0],
    stats: { mass: 1250, engineForce: 4100, brakeForce: 98, maxSpeed: 30, maxSteer: 0.62, grip: 3.3 },
    armour: 1.05,
  },
  {
    id: 'hatch', name: 'Hatchback', model: 'Hatchback Body|4.2|0', price: 100,
    colors: [0, 0xf2efe6, 0xd8413a, 0x1e1f22, 0xf2c14e],
    stats: { mass: 1350, engineForce: 4600, brakeForce: 103, maxSpeed: 33, maxSteer: 0.62, grip: 3.4 },
    armour: 1,
  },
  {
    id: 'sedan', name: 'Sedan', model: 'Sedan Body|4.8|0', price: 180,
    colors: [0, 0x2b3a4a, 0xd9dcde, 0x8a1c22, 0x9aa2a8],
    stats: { mass: 1600, engineForce: 5600, brakeForce: 115, maxSpeed: 36, maxSteer: 0.55, grip: 3.2 },
    armour: 0.95,
  },
  {
    id: 'wagon', name: 'Stationwagon', model: 'Wagon Body|4.8|1', price: 220,
    colors: [0, 0x3d5a3e, 0xd9dcde, 0x1b1c1f, 0x3b5f9c],
    stats: { mass: 1700, engineForce: 5600, brakeForce: 115, maxSpeed: 35, maxSteer: 0.54, grip: 3.2 },
    armour: 0.85,
  },
  {
    id: 'suv', name: 'SUV', model: 'SUV Body|4.7|1', price: 260,
    colors: [0, 0xf2f2f2, 0x1b1c1f, 0x3b5f9c, 0x8a1c22],
    stats: { mass: 2000, engineForce: 6600, brakeForce: 121, maxSpeed: 35, maxSteer: 0.52, grip: 3.1 },
    armour: 0.7,
  },
  {
    id: 'offroad', name: 'Offroad', model: 'Offroad Body|4.6|1', price: 340,
    colors: [0, 0x5b6b3a, 0xc8a46a, 0x1b1c1f, 0xe0662b],
    stats: { mass: 2100, engineForce: 7400, brakeForce: 125, maxSpeed: 36, maxSteer: 0.52, grip: 3.5 },
    armour: 0.55,
  },
  {
    id: 'pickup', name: 'Pickup', model: 'Pickup Body|5.2|0', price: 380,
    colors: [0, 0xb3261e, 0xf2f2f2, 0x24425f, 0x1b1c1f],
    stats: { mass: 2300, engineForce: 8000, brakeForce: 130, maxSpeed: 38, maxSteer: 0.48, grip: 3.3 },
    armour: 0.5,
  },
  {
    id: 'minivan', name: 'Minivan', model: 'minivan body|4.9|0', price: 300,
    colors: [0, 0xf3b221, 0x3aa38f, 0xd94a2b, 0x4b8fc9],
    stats: { mass: 2200, engineForce: 6300, brakeForce: 126, maxSpeed: 30, maxSteer: 0.5, grip: 3 },
    armour: 0.6,
  },
  {
    id: 'coupe', name: 'Coupé', model: 'Coupe Body|4.6|0', price: 420,
    colors: [0, 0x9fb8c9, 0x1b1c1f, 0x2e7d4f, 0xd23a2f],
    stats: { mass: 1550, engineForce: 7600, brakeForce: 138, maxSpeed: 41, maxSteer: 0.53, grip: 3.6 },
    armour: 1.2,
  },
  {
    id: 'sport', name: 'Sportwagen', model: 'Sport body|4.5|1', price: 600,
    colors: [0, 0xf2f2f2, 0x35d07f, 0xff7a1a, 0x7a4dff],
    stats: { mass: 1450, engineForce: 8700, brakeForce: 150, maxSpeed: 46, maxSteer: 0.5, grip: 3.9 },
    armour: 1.45,
  },
  // Premium editions: same bodies, stronger engines and special paint. They cost more coins and more sums.
  {
    id: 'gt', name: 'Gran Turismo', model: 'Coupe Body|4.8|0', price: 900, problems: 8, premium: true,
    colors: [0xd4af37, 0xc3c9cf, 0x111214, 0x1d3f8f, 0x6d1020],
    stats: { mass: 1600, engineForce: 10400, brakeForce: 155, maxSpeed: 50, maxSteer: 0.52, grip: 3.9 },
    armour: 1.1,
  },
  {
    id: 'rally', name: 'Rally 4x4', model: 'Offroad Body|4.7|1', price: 1100, problems: 9, premium: true,
    colors: [0xf2f2f2, 0xff7a1a, 0x0b5ed7, 0x111214, 0xd4af37],
    stats: { mass: 2000, engineForce: 10800, brakeForce: 150, maxSpeed: 47, maxSteer: 0.56, grip: 4.2 },
    armour: 0.4,
  },
  {
    id: 'truck', name: 'Monster Pickup', model: 'Pickup Body|5.6|0', price: 1300, problems: 10, premium: true,
    colors: [0x111214, 0x35d07f, 0xd8413a, 0x7a4dff, 0xd4af37],
    stats: { mass: 2600, engineForce: 12000, brakeForce: 150, maxSpeed: 46, maxSteer: 0.5, grip: 3.9 },
    armour: 0.3,
  },
  {
    id: 'limo', name: 'Limousine', model: 'Sedan Body|5.6|0', price: 1500, problems: 10, premium: true,
    colors: [0x0d0e10, 0xf4f4f2, 0xd4af37, 0x3b0d1c, 0x9aa2a8],
    stats: { mass: 2300, engineForce: 10500, brakeForce: 150, maxSpeed: 46, maxSteer: 0.48, grip: 3.6 },
    armour: 0.7,
  },
  {
    id: 'hyper', name: 'Hypercar', model: 'Sport body|4.6|1', price: 2000, problems: 12, premium: true,
    colors: [0xd4af37, 0xc3c9cf, 0x111214, 0x00b3a4, 0xff2d55],
    stats: { mass: 1400, engineForce: 13000, brakeForce: 170, maxSpeed: 56, maxSteer: 0.5, grip: 4.4 },
    armour: 1.3,
  },
];

/** The police car (not for sale). */
export const POLICE: CarSpec = {
  id: 'police', name: 'Politie', model: 'Wagon Body|4.8|1', price: 0, colors: [0xf4f4f2],
  stats: { mass: 1800, engineForce: 8200, brakeForce: 130, maxSpeed: 40, maxSteer: 0.55, grip: 3.3 },
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
