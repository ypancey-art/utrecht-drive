import type { CarUpgrades } from './cars';

export type Grade = 'g3' | 'g4' | 'g5' | 'g6' | 'g7' | 'g8' | 'vo1' | 'vo3';
export const GRADES: Grade[] = ['g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'vo1', 'vo3'];

export interface Progress {
  grade: Grade | null; // null = not chosen yet (show start screen)
  coins: number;
  carId: string;
  owned: string[];
  upgrades: Record<string, CarUpgrades>;
  missionsDone: string[];
  points: number; // ⚡ stunt points, earned by driving (speed, jumps, loops)
  topSpeed: number; // km/h record
  built: string[]; // things built in the city (ramp groups, loops, tracks)
}

const KEY = 'utrecht-drive-progress';
const KNOWN_CARS = ['compact', 'hatch', 'sedan', 'wagon', 'suv', 'offroad', 'pickup', 'minivan', 'coupe', 'sport', 'gt', 'rally', 'truck', 'limo', 'hyper'];
const fresh = (): Progress => ({ grade: null, coins: 0, carId: 'compact', owned: ['compact'], upgrades: {}, missionsDone: [], points: 0, topSpeed: 0, built: [] });

/** Saved in this browser only (profiles come later). */
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return clean(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return fresh();
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const level = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3 ? (v as number) : 0);

/** Old or damaged saves (or hand-edited ones) are repaired field by field, never trusted as-is. */
export function clean(raw: unknown): Progress {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Older saves used car ids that no longer exist.
  const owned = strings(p.owned).filter((id) => KNOWN_CARS.includes(id));
  if (!owned.includes('compact')) owned.unshift('compact');
  const carId = typeof p.carId === 'string' && owned.includes(p.carId) ? p.carId : 'compact';
  const upgrades: Record<string, CarUpgrades> = {};
  if (p.upgrades && typeof p.upgrades === 'object') {
    for (const [id, u] of Object.entries(p.upgrades as Record<string, Partial<CarUpgrades>>)) {
      if (!KNOWN_CARS.includes(id) || !u || typeof u !== 'object') continue;
      upgrades[id] = { engine: level(u.engine), tires: level(u.tires), armour: level(u.armour), paint: Number.isInteger(u.paint) && u.paint! >= 0 && u.paint! < 20 ? u.paint! : 0 };
    }
  }
  return {
    grade: GRADES.includes(p.grade as Grade) ? (p.grade as Grade) : null,
    coins: num(p.coins),
    carId,
    owned: [...new Set(owned)],
    upgrades,
    missionsDone: strings(p.missionsDone),
    points: num(p.points),
    topSpeed: num(p.topSpeed),
    built: strings(p.built),
  };
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export const upgradesFor = (p: Progress, carId: string): CarUpgrades =>
  (p.upgrades[carId] ??= { engine: 0, tires: 0, armour: 0, paint: 0 });
