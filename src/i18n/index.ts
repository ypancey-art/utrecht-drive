// All player-facing text lives here. Add a language by adding a dictionary with the same keys.
const nl = {
  loading: 'Overvecht laden…',
  hintKeys: 'Pijltjes / WASD = rijden · Spatie = handrem · R = auto rechtzetten · M = menu',
  otherLang: 'EN',
  splash: 'Plons! De auto zinkt…',
  title: 'Utrecht Drive',
  chooseGrade: 'In welke groep zit je?',
  language: 'Taal',
  play: 'Spelen',
  solveN: 'Los {n} sommen op',
  progressN: 'Som {i} van {n}',
  correct: 'Goed zo!',
  wrong: 'Niet goed. Probeer deze!',
  hint: 'Tip',
  cancel: 'Stoppen',
  missionAsk: 'Missie: {name}',
  reward: 'Beloning: {n} munten',
  timeLimit: 'Tijd: {n}',
  problemsNeeded: 'Eerst {n} sommen oplossen',
  start: 'Starten',
  notNow: 'Niet nu',
  complete: 'Missie gelukt! +{n} munten',
  failed: 'Te laat! De missie is mislukt.',
  checkpoint: 'Checkpoint {i}/{n}',
  garage: 'Garage',
  menu: 'Menu',
  resume: 'Verder spelen',
  changeGrade: 'Andere groep kiezen',
  owned: 'In bezit',
  choose: 'Kiezen',
  chosen: 'Gekozen',
  buy: 'Kopen · {n}',
  notEnough: 'Niet genoeg munten',
  engine: 'Motor',
  tires: 'Banden',
  armour: 'Pantser',
  paint: 'Kleur',
  upgrade: 'Upgrade · {n}',
  max: 'Max',
  statSpeed: 'Snelheid',
  statHandling: 'Wendbaar',
  statTough: 'Sterk',
  wanted: 'Gezocht!',
  escaped: 'Ontsnapt! De politie is je kwijt. +{n} munten. Volgende keer komen er meer…',
  startChase: '🚨 Politieachtervolging',
  earnCoins: '🧮 Sommen voor munten',
  build: '🏗️ Bouwen in de stad',
  buildTitle: 'Bouwen in de stad',
  buildIntro: 'Munten verdien je met sommen, ⚡ stuntpunten met rijden: hard rijden, springen, loopings. Bouw er schansen, loopings en Hot Wheels-banen mee!',
  buildBtn: 'Bouwen',
  builtLabel: 'gebouwd',
  goThere: '🧭 Rij erheen',
  builtNow: '🏗️ Gebouwd! Volg de pijl.',
  notEnoughPoints: 'Nog niet genoeg ⚡ stuntpunten: rijd hard, spring en maak loopings!',
  stuntAir: 'Sprong! +{p} ⚡',
  stuntLoop: 'Looping! +{p} ⚡',
  stuntSpeed: 'Snel! +{p} ⚡',
  stuntRoof: 'Op het dak! +{p} ⚡',
  record: '🏁 Record: {n} km/h',
  earnStatus: 'Verdiend: 🪙 {n} · {p} per goede som, bonus bij 5 op rij',
  streakBonus: '5 op rij! +{n}',
  caughtTitle: 'Aangehouden!',
  policeComing: '🚨 De politie komt eraan!',
  policeMore: '🚨 Nog meer politie!',
  hitPerson: 'Au! Pas op voor fietsers en voetgangers!',
  caughtBody: 'De politie heeft je te pakken. Je moet een boete van {n} munten betalen.',
  fineShort: 'Je hebt maar {have} munten. Die betaal je, en de rest los je af met {n} sommen.',
  payFine: 'Boete betalen · {n} munten',
  solveBail: '{n} borgsom-sommen',
  free: 'Je bent vrij. Rij voorzichtig!',
  newCar: 'Nieuwe auto: {n} sommen',
  close: 'Sluiten',
  missions: 'Missies',
  done: 'gedaan',
};
type Dict = Record<keyof typeof nl, string>;
const en: Dict = {
  loading: 'Loading Overvecht…',
  hintKeys: 'Arrows / WASD = drive · Space = handbrake · R = reset car · M = menu',
  otherLang: 'NL',
  splash: 'Splash! The car is sinking…',
  title: 'Utrecht Drive',
  chooseGrade: 'Which grade are you in?',
  language: 'Language',
  play: 'Play',
  solveN: 'Solve {n} problems',
  progressN: 'Problem {i} of {n}',
  correct: 'Correct!',
  wrong: 'Not quite. Try this one!',
  hint: 'Hint',
  cancel: 'Stop',
  missionAsk: 'Mission: {name}',
  reward: 'Reward: {n} coins',
  timeLimit: 'Time: {n}',
  problemsNeeded: 'Solve {n} problems first',
  start: 'Start',
  notNow: 'Not now',
  complete: 'Mission complete! +{n} coins',
  failed: 'Too late! The mission failed.',
  checkpoint: 'Checkpoint {i}/{n}',
  garage: 'Garage',
  menu: 'Menu',
  resume: 'Resume',
  changeGrade: 'Change grade',
  owned: 'Owned',
  choose: 'Choose',
  chosen: 'Chosen',
  buy: 'Buy · {n}',
  notEnough: 'Not enough coins',
  engine: 'Engine',
  tires: 'Tires',
  armour: 'Armour',
  paint: 'Paint',
  upgrade: 'Upgrade · {n}',
  max: 'Max',
  statSpeed: 'Speed',
  statHandling: 'Handling',
  statTough: 'Toughness',
  wanted: 'Wanted!',
  escaped: 'Escaped! The police lost you. +{n} coins. Next time more will come…',
  startChase: '🚨 Police chase',
  earnCoins: '🧮 Sums for coins',
  build: '🏗️ Build in the city',
  buildTitle: 'Build in the city',
  buildIntro: 'You earn coins with sums and ⚡ stunt points by driving: going fast, jumping, loops. Use them to build ramps, loops and Hot Wheels tracks!',
  buildBtn: 'Build',
  builtLabel: 'built',
  goThere: '🧭 Drive there',
  builtNow: '🏗️ Built! Follow the arrow.',
  notEnoughPoints: 'Not enough ⚡ stunt points yet: drive fast, jump and do loops!',
  stuntAir: 'Jump! +{p} ⚡',
  stuntLoop: 'Loop! +{p} ⚡',
  stuntSpeed: 'Fast! +{p} ⚡',
  stuntRoof: 'On the roof! +{p} ⚡',
  record: '🏁 Record: {n} km/h',
  earnStatus: 'Earned: 🪙 {n} · {p} per right answer, bonus for 5 in a row',
  streakBonus: '5 in a row! +{n}',
  caughtTitle: 'Caught!',
  policeComing: '🚨 The police are coming!',
  policeMore: '🚨 More police!',
  hitPerson: 'Ouch! Watch out for cyclists and pedestrians!',
  caughtBody: 'The police caught you. You have to pay a fine of {n} coins.',
  fineShort: 'You only have {have} coins. You pay those, and work off the rest with {n} problems.',
  payFine: 'Pay fine · {n} coins',
  solveBail: '{n} bail problems',
  free: 'You are free. Drive carefully!',
  newCar: 'New car: {n} problems',
  close: 'Close',
  missions: 'Missions',
  done: 'done',
};
const dictionaries = { nl, en };
const GRADE_NAMES = {
  nl: { g3: 'Groep 3', g4: 'Groep 4', g5: 'Groep 5', g6: 'Groep 6', g7: 'Groep 7', g8: 'Groep 8', vo1: 'VO klas 1–2', vo3: 'VO klas 3' },
  en: { g3: 'Groep 3 (age 6)', g4: 'Groep 4 (7)', g5: 'Groep 5 (8)', g6: 'Groep 6 (9)', g7: 'Groep 7 (10)', g8: 'Groep 8 (11)', vo1: 'Secondary 1–2', vo3: 'Secondary 3' },
};

export type Lang = keyof typeof dictionaries;
export type TextKey = keyof typeof nl;

let current: Lang = 'nl';
try {
  const saved = localStorage.getItem('lang');
  if (saved === 'nl' || saved === 'en') current = saved;
} catch {
  /* storage unavailable */
}

const listeners: Array<() => void> = [];

/** Text in the current language; {name} placeholders are filled from params. */
export const t = (key: TextKey, params: Record<string, string | number> = {}): string =>
  dictionaries[current][key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''));
export const gradeName = (g: keyof (typeof GRADE_NAMES)['nl']) => GRADE_NAMES[current][g];
export const getLang = (): Lang => current;
export const onLangChange = (fn: () => void) => listeners.push(fn);
export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem('lang', lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}
