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
}

const KEY = 'utrecht-drive-progress';
const fresh = (): Progress => ({ grade: null, coins: 0, carId: 'ev4', owned: ['ev4'], upgrades: {}, missionsDone: [] });

/** Saved in this browser only (profiles come later). */
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return fresh();
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
