import type { MapData, Pt } from './mapData';
import { nearestRoad } from './mapData';
import type { Lang } from '../i18n';

type Place = string; // a street name, or 'station'
type Size = 'small' | 'medium' | 'race';

interface MissionDef {
  id: string;
  size: Size;
  title: Record<Lang, string>;
  desc: Record<Lang, string>;
  start: Place;
  stops: Place[]; // targets in order (races: checkpoints)
}

export const MISSION_SIZE: Record<Size, { problems: number; reward: number }> = {
  small: { problems: 3, reward: 30 },
  medium: { problems: 4, reward: 50 },
  race: { problems: 5, reward: 80 },
};

// Missions tied to real places in Overvecht and around.
const DEFS: MissionDef[] = [
  {
    id: 'station-dash', size: 'small', start: 'Moldaudreef', stops: ['station'],
    title: { nl: 'Stationsrace', en: 'Station Dash' },
    desc: { nl: 'Je trein naar Amsterdam vertrekt zo! Rij naar station Utrecht Overvecht voordat hij weg is.', en: 'Your train to Amsterdam leaves soon! Get to Utrecht Overvecht station before it goes.' },
  },
  {
    id: 'pizza', size: 'small', start: 'Zamenhofdreef', stops: ['Moezeldreef'],
    title: { nl: 'Pizzabezorging', en: 'Pizza Delivery' },
    desc: { nl: 'Breng een warme pizza van het winkelcentrum naar de Moezeldreef.', en: 'Bring a hot pizza from the shopping centre to Moezeldreef.' },
  },
  {
    id: 'parcel', size: 'medium', start: 'Jacoba van Beierendreef', stops: ['Tiberdreef'],
    title: { nl: 'Pakketje', en: 'Parcel Run' },
    desc: { nl: 'Een pakketje moet vandaag nog naar de Tiberdreef.', en: 'A parcel has to reach Tiberdreef today.' },
  },
  {
    id: 'groceries', size: 'medium', start: 'Marnedreef', stops: ['Kardinaal de Jongweg'],
    title: { nl: 'Boodschappen voor oma', en: 'Groceries for Grandma' },
    desc: { nl: 'Oma woont aan de Kardinaal de Jongweg. Breng haar boodschappen van de Marnedreef voordat het ijs smelt.', en: 'Grandma lives on Kardinaal de Jongweg. Bring her shopping from Marnedreef before the ice cream melts.' },
  },
  {
    id: 'school', size: 'medium', start: 'Linnaeuslaan', stops: ['Brailledreef'],
    title: { nl: 'Te laat voor school', en: 'Late for School' },
    desc: { nl: 'Je vriend heeft de bel bijna gemist. Breng hem snel naar school!', en: 'Your friend nearly missed the bell. Get them to school fast!' },
  },
  {
    id: 'night-train', size: 'medium', start: 'Salvador Allendeplein', stops: ['station'],
    title: { nl: 'Laatste trein', en: 'Last Train' },
    desc: { nl: 'De laatste trein vertrekt bijna. Haal hem!', en: 'The last train is about to leave. Catch it!' },
  },
  {
    id: 'dreven-race', size: 'race', start: 'Donaudreef', stops: ['Moezeldreef', 'Tiberdreef', 'Jacoba van Beierendreef', 'Donaudreef'],
    title: { nl: 'Dreven-race', en: 'Dreven Race' },
    desc: { nl: 'Race langs alle checkpoints over de dreven van Overvecht en terug.', en: 'Race through every checkpoint along the Overvecht dreven and back.' },
  },
  {
    id: 'rivers-race', size: 'race', start: 'Neckardreef', stops: ['Taagdreef', 'Wolgadreef', 'Rhônedreef', 'Neckardreef'],
    title: { nl: 'Rivierenrondje', en: 'Rivers Loop' },
    desc: { nl: 'Alle straten hier heten naar rivieren. Rij het rondje zo snel als je kan!', en: 'All these streets are named after rivers. Drive the loop as fast as you can!' },
  },
];

export interface Mission {
  def: MissionDef;
  start: Pt;
  stops: Pt[];
  timeLimit: number; // seconds
}

/** Middle of the longest drivable way with this name (or the station). */
function placePoint(map: MapData, place: Place): Pt | null {
  if (place === 'station') {
    const s = map.stations[0]?.p;
    if (!s) return null;
    const r = nearestRoad(map, s[0], s[1], (r) => r.drivable && r.kind !== 'service');
    return [r.x, r.z];
  }
  let best: Pt | null = null, bestLen = 0;
  const inside = (p: Pt) => Math.abs(p[0]) < 680 && Math.abs(p[1]) < 680;
  for (const road of map.roads) {
    if (!road.drivable || road.name !== place) continue;
    const r = { pts: road.pts.filter(inside) }; // only the part inside the playable area
    if (r.pts.length < 2) continue;
    let len = 0;
    for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
    if (len > bestLen) {
      bestLen = len;
      // Walk half the length along the way.
      let half = len / 2;
      for (let i = 1; i < r.pts.length; i++) {
        const seg = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
        if (half <= seg) {
          const f = half / (seg || 1);
          best = [r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * f, r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * f];
          break;
        }
        half -= seg;
      }
    }
  }
  return best;
}

export function buildMissions(map: MapData): Mission[] {
  const out: Mission[] = [];
  for (const def of DEFS) {
    const start = placePoint(map, def.start);
    const stops = def.stops.map((p) => placePoint(map, p));
    if (!start || stops.some((s) => !s)) {
      console.warn('Mission skipped (place not on map):', def.id);
      continue;
    }
    let dist = 0, prev = start;
    for (const s of stops as Pt[]) {
      dist += Math.hypot(s[0] - prev[0], s[1] - prev[1]);
      prev = s;
    }
    // Generous: roads wind, so allow 1.8x the straight distance at ~40 km/h, plus 15 s per stop.
    const timeLimit = Math.ceil(((dist * 1.8) / 11 + 15 * stops.length) / 5) * 5;
    out.push({ def, start, stops: stops as Pt[], timeLimit });
  }
  return out;
}

export const REACH_RADIUS = 12;

/** Runs the active mission: which stop is next, time left, success/failure. */
export class MissionRunner {
  active: Mission | null = null;
  stop = 0;
  timeLeft = 0;
  private promptCooldown = new Map<string, number>();

  missions: Mission[];
  constructor(missions: Mission[]) {
    this.missions = missions;
  }

  /** The mission whose start marker the car is standing in (when none is active). */
  atStart(x: number, z: number): Mission | null {
    if (this.active) return null;
    for (const m of this.missions) {
      if ((this.promptCooldown.get(m.def.id) ?? 0) > 0) continue;
      if (Math.hypot(m.start[0] - x, m.start[1] - z) < REACH_RADIUS) return m;
    }
    return null;
  }

  /** Don't ask again for this mission until the car has driven away for a while. */
  snooze(m: Mission) {
    this.promptCooldown.set(m.def.id, 8);
  }

  begin(m: Mission) {
    this.active = m;
    this.stop = 0;
    this.timeLeft = m.timeLimit;
  }

  cancel() {
    if (this.active) this.snooze(this.active);
    this.active = null;
  }

  get target(): Pt | null {
    return this.active ? this.active.stops[this.stop] : null;
  }

  update(dt: number, x: number, z: number): 'checkpoint' | 'complete' | 'failed' | null {
    for (const [id, t] of this.promptCooldown) this.promptCooldown.set(id, t - dt);
    const m = this.active;
    if (!m) return null;
    this.timeLeft -= dt;
    const t = m.stops[this.stop];
    if (Math.hypot(t[0] - x, t[1] - z) < REACH_RADIUS) {
      this.stop++;
      if (this.stop >= m.stops.length) {
        this.snooze(m);
        this.active = null;
        return 'complete';
      }
      return 'checkpoint';
    }
    if (this.timeLeft <= 0) {
      this.snooze(m);
      this.active = null;
      return 'failed';
    }
    return null;
  }
}
