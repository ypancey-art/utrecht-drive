// All player-facing text lives here. Add a language by adding a dictionary.
const dictionaries = {
  nl: {
    loading: 'Overvecht laden…',
    hintKeys: 'Pijltjes / WASD = rijden · Spatie = handrem · R = auto rechtzetten',
    otherLang: 'EN',
  },
  en: {
    loading: 'Loading Overvecht…',
    hintKeys: 'Arrows / WASD = drive · Space = handbrake · R = reset car',
    otherLang: 'NL',
  },
} as const;

export type Lang = keyof typeof dictionaries;
export type TextKey = keyof (typeof dictionaries)['nl'];

let current: Lang = 'nl';
try {
  const saved = localStorage.getItem('lang');
  if (saved === 'nl' || saved === 'en') current = saved;
} catch {
  /* storage unavailable */
}

const listeners: Array<() => void> = [];

export const t = (key: TextKey): string => dictionaries[current][key];
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
