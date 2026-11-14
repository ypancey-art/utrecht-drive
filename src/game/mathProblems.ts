// Math problems per grade (Dutch school system). Every problem has one numeric answer;
// the game shows it as multiple choice so it works on touch screens.
import type { Grade } from './progress';
import type { Lang } from '../i18n';

export interface Problem { type: string; q: string; answer: number; hint: string; unit?: string }
type Gen = (lang: Lang) => Problem;

const ri = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const num = (n: number, lang: Lang) => n.toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { maximumFractionDigits: 2 });
const euro = (n: number, lang: Lang) => '€ ' + n.toLocaleString(lang === 'nl' ? 'nl-NL' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const L = (lang: Lang, nl: string, en: string) => (lang === 'nl' ? nl : en);

// --- Generators -------------------------------------------------------------
const addSub = (max: number): Gen => (lang) => {
  if (Math.random() < 0.5) {
    const a = ri(1, max - 1), b = ri(1, max - a);
    return { type: `add${max}`, q: `${a} + ${b} = ?`, answer: a + b, hint: L(lang, `Tel ${b} op bij ${a}. Tip: eerst naar het volgende tiental.`, `Count on ${b} from ${a}. Tip: jump to the next ten first.`) };
  }
  const a = ri(2, max), b = ri(1, a - 1);
  return { type: `sub${max}`, q: `${a} − ${b} = ?`, answer: a - b, hint: L(lang, `Tel terug vanaf ${a}, ${b} stappen.`, `Count back ${b} steps from ${a}.`) };
};

const tables = (set: number[]): Gen => (lang) => {
  const a = pick(set), b = ri(1, 10);
  return Math.random() < 0.8
    ? { type: 'times', q: `${b} × ${a} = ?`, answer: a * b, hint: L(lang, `Tel ${b} keer ${a}: ${a}, ${a * 2}, ${a * 3}…`, `Count ${a} ${b} times: ${a}, ${a * 2}, ${a * 3}…`) }
    : { type: 'div', q: `${a * b} : ${a} = ?`, answer: b, hint: L(lang, `Hoe vaak past ${a} in ${a * b}? Denk aan de tafel van ${a}.`, `How many times does ${a} fit in ${a * b}? Think of the ${a} times table.`) };
};

const bigTimes: Gen = (lang) => {
  if (Math.random() < 0.5) {
    const a = ri(12, 99), b = ri(2, 9);
    return { type: 'bigtimes', q: `${a} × ${b} = ?`, answer: a * b, hint: L(lang, `Splits: ${Math.floor(a / 10) * 10} × ${b} + ${a % 10} × ${b}.`, `Split it: ${Math.floor(a / 10) * 10} × ${b} + ${a % 10} × ${b}.`) };
  }
  const b = ri(2, 9), ans = ri(11, 40);
  return { type: 'bigdiv', q: `${ans * b} : ${b} = ?`, answer: ans, hint: L(lang, `Hoeveel keer ${b} is ${ans * b}? Probeer eerst ${b} × 10.`, `How many times ${b} makes ${ans * b}? Try ${b} × 10 first.`) };
};

const fractionOf: Gen = (lang) => {
  const [n, d] = pick([[1, 2], [1, 4], [3, 4], [1, 3], [2, 3], [1, 5], [2, 5], [1, 10]]);
  const total = d * ri(2, 12);
  return { type: 'fracof', q: L(lang, `${n}/${d} van ${total} = ?`, `${n}/${d} of ${total} = ?`), answer: (total / d) * n, hint: L(lang, `Deel ${total} eerst door ${d}, keer dan ${n}.`, `First divide ${total} by ${d}, then times ${n}.`) };
};

const money: Gen = (lang) => {
  const a = ri(2, 40) / 4, b = ri(2, 40) / 4; // quarters: € 0,25 steps
  const item = pick(L(lang, 'een ijsje|een broodje|een stripboek|een bal', 'an ice cream|a sandwich|a comic|a ball').split('|'));
  const item2 = pick(L(lang, 'limonade|een appel|stickers', 'lemonade|an apple|stickers').split('|'));
  return { type: 'money', q: L(lang, `Je koopt ${item} voor ${euro(a, lang)} en ${item2} voor ${euro(b, lang)}. Hoeveel euro samen?`, `You buy ${item} for ${euro(a, lang)} and ${item2} for ${euro(b, lang)}. How many euros in total?`), answer: a + b, unit: '€', hint: L(lang, 'Tel eerst de hele euro’s, dan de centen.', 'Add the whole euros first, then the cents.') };
};

const decimals: Gen = (lang) => {
  const a = ri(11, 99) / 10, b = ri(11, 99) / 10;
  if (Math.random() < 0.5) return { type: 'decadd', q: `${num(a, lang)} + ${num(b, lang)} = ?`, answer: +(a + b).toFixed(1), hint: L(lang, 'Zet de komma’s onder elkaar.', 'Line up the decimal points.') };
  const f = pick([10, 100]);
  return { type: 'decmul', q: `${num(a, lang)} × ${f} = ?`, answer: +(a * f).toFixed(1), hint: L(lang, `Keer ${f}: de komma schuift ${f === 10 ? 1 : 2} plek(ken) naar rechts.`, `Times ${f}: the decimal point moves ${f === 10 ? 1 : 2} place(s) right.`) };
};

const percentBasic: Gen = (lang) => {
  const p = pick([10, 25, 50, 20]), n = pick([20, 40, 60, 80, 100, 120, 200, 400]);
  return { type: 'pct', q: L(lang, `${p}% van ${n} = ?`, `${p}% of ${n} = ?`), answer: (n * p) / 100, hint: L(lang, `${p}% is ${p}/100. 10% van ${n} is ${n / 10}.`, `${p}% is ${p}/100. 10% of ${n} is ${n / 10}.`) };
};

const units: Gen = (lang) => {
  const [from, to, f] = pick<[string, string, number]>([['m', 'cm', 100], ['km', 'm', 1000], ['kg', 'g', 1000], ['l', 'ml', 1000], ['cm', 'mm', 10]]);
  const v = pick([1.5, 2, 2.5, 3, 0.5, 4, 0.25, 7]);
  return { type: 'units', q: `${num(v, lang)} ${from} = ? ${to}`, answer: v * f, unit: to, hint: L(lang, `1 ${from} = ${f} ${to}.`, `1 ${from} = ${f} ${to}.`) };
};

const percentAny: Gen = (lang) => {
  const p = ri(1, 19) * 5, n = pick([40, 60, 80, 120, 160, 200, 240, 300, 400, 500]);
  const price = Math.random() < 0.5;
  return price
    ? { type: 'discount', q: L(lang, `Een fiets kost ${euro(n, lang)}. Je krijgt ${p}% korting. Wat betaal je?`, `A bike costs ${euro(n, lang)}. You get ${p}% off. What do you pay?`), answer: n - (n * p) / 100, unit: '€', hint: L(lang, `Reken eerst ${p}% van ${n} uit en haal dat eraf.`, `Work out ${p}% of ${n} first, then subtract it.`) }
    : { type: 'pct', q: L(lang, `${p}% van ${n} = ?`, `${p}% of ${n} = ?`), answer: (n * p) / 100, hint: L(lang, `1% van ${n} is ${n / 100}. Keer ${p}.`, `1% of ${n} is ${n / 100}. Times ${p}.`) };
};

const ratio: Gen = (lang) => {
  const a = ri(1, 5), b = ri(2, 6), k = ri(2, 8);
  return { type: 'ratio', q: L(lang, `Ranja : water = ${a} : ${b}. Je gebruikt ${a * k} dl ranja. Hoeveel dl water?`, `Squash : water = ${a} : ${b}. You use ${a * k} dl squash. How many dl water?`), answer: b * k, hint: L(lang, `${a * k} is ${k} keer ${a}. Doe het water ook ${k} keer.`, `${a * k} is ${k} times ${a}. Do the water ${k} times too.`) };
};

const wordMixed: Gen = (lang) => {
  const speed = pick([30, 40, 50, 60]), min = pick([15, 30, 45]);
  return { type: 'speed', q: L(lang, `Een bus rijdt ${speed} km per uur. Hoeveel km in ${min} minuten?`, `A bus drives ${speed} km per hour. How many km in ${min} minutes?`), answer: (speed * min) / 60, unit: 'km', hint: L(lang, `${min} minuten is ${min}/60 uur.`, `${min} minutes is ${min}/60 of an hour.`) };
};

const negatives: Gen = (lang) => {
  const a = ri(-15, 10), b = ri(-12, 12);
  const op = pick(['+', '−']);
  const bs = b < 0 ? `(${b})` : `${b}`;
  return { type: 'neg', q: `${a} ${op} ${bs} = ?`, answer: op === '+' ? a + b : a - b, hint: L(lang, 'Gebruik een getallenlijn. Min een negatief getal is plus.', 'Use a number line. Minus a negative is plus.') };
};

const orderOps: Gen = (lang) => {
  const a = ri(2, 12), b = ri(2, 9), c = ri(2, 9);
  return pick([
    { type: 'ops', q: `${a} + ${b} × ${c} = ?`, answer: a + b * c, hint: L(lang, 'Eerst keer, dan plus.', 'Multiply first, then add.') },
    { type: 'ops', q: `(${a} + ${b}) × ${c} = ?`, answer: (a + b) * c, hint: L(lang, 'Eerst wat tussen haakjes staat.', 'Brackets first.') },
    { type: 'ops', q: `${a * c} : ${c} − ${b} = ?`, answer: a - b, hint: L(lang, 'Eerst delen, dan min.', 'Divide first, then subtract.') },
  ]);
};

const simpleEq: Gen = (lang) => {
  const x = ri(2, 12), a = ri(2, 9), b = ri(1, 20);
  return Math.random() < 0.5
    ? { type: 'eq1', q: `x + ${b} = ${x + b}.  x = ?`, answer: x, hint: L(lang, `Haal aan beide kanten ${b} weg.`, `Subtract ${b} on both sides.`) }
    : { type: 'eq1', q: `${a}x = ${a * x}.  x = ?`, answer: x, hint: L(lang, `Deel beide kanten door ${a}.`, `Divide both sides by ${a}.`) };
};

const areaPerim: Gen = (lang) => {
  const w = ri(3, 15), h = ri(2, 12);
  return Math.random() < 0.5
    ? { type: 'area', q: L(lang, `Een rechthoek is ${w} m bij ${h} m. Oppervlakte in m²?`, `A rectangle is ${w} m by ${h} m. Area in m²?`), answer: w * h, unit: 'm²', hint: L(lang, 'Oppervlakte = lengte × breedte.', 'Area = length × width.') }
    : { type: 'perim', q: L(lang, `Een rechthoek is ${w} m bij ${h} m. Omtrek in m?`, `A rectangle is ${w} m by ${h} m. Perimeter in m?`), answer: 2 * (w + h), unit: 'm', hint: L(lang, 'Omtrek = alle zijden bij elkaar: 2 × (l + b).', 'Perimeter = all sides added: 2 × (l + w).') };
};

const linearEq: Gen = (lang) => {
  const x = ri(-6, 10), a = ri(2, 7), b = ri(-10, 15), c = ri(1, a - 1 || 1);
  const rhs = a * x + b;
  const bStr = b < 0 ? `− ${-b}` : `+ ${b}`;
  if (Math.random() < 0.5 || c >= a) return { type: 'eq2', q: `${a}x ${bStr} = ${rhs}.  x = ?`, answer: x, hint: L(lang, `Eerst ${b < 0 ? 'plus ' + -b : 'min ' + b} aan beide kanten, dan delen door ${a}.`, `First ${b < 0 ? 'add ' + -b : 'subtract ' + b} on both sides, then divide by ${a}.`) };
  const d = rhs - c * x; // a x + b = c x + d
  const dStr = d < 0 ? `− ${-d}` : `+ ${d}`;
  return { type: 'eq2', q: `${a}x ${bStr} = ${c}x ${dStr}.  x = ?`, answer: x, hint: L(lang, `Breng de x’en naar links: ${a - c}x = ${d - b}.`, `Move the x terms left: ${a - c}x = ${d - b}.`) };
};

const powers: Gen = (lang) => {
  if (Math.random() < 0.5) {
    const b = pick([2, 3, 4, 5, 10]), e = b === 2 ? ri(3, 7) : b === 10 ? ri(2, 5) : ri(2, 4);
    return { type: 'pow', q: `${b}^${e} = ?`, answer: b ** e, hint: L(lang, `${b} keer zichzelf, ${e} keer: ${Array(e).fill(b).join(' × ')}.`, `${b} times itself ${e} times: ${Array(e).fill(b).join(' × ')}.`) };
  }
  const r = ri(2, 15);
  return { type: 'root', q: `√${r * r} = ?`, answer: r, hint: L(lang, `Welk getal keer zichzelf is ${r * r}?`, `Which number times itself is ${r * r}?`) };
};

const pythagoras: Gen = (lang) => {
  const [a, b, c] = pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20], [7, 24, 25]]);
  return Math.random() < 0.6
    ? { type: 'pyth', q: L(lang, `Rechthoekige driehoek: rechthoekszijden ${a} en ${b}. Schuine zijde = ?`, `Right triangle: legs ${a} and ${b}. Hypotenuse = ?`), answer: c, hint: L(lang, `a² + b² = c²: ${a * a} + ${b * b} = ${c * c}. Neem de wortel.`, `a² + b² = c²: ${a * a} + ${b * b} = ${c * c}. Take the root.`) }
    : { type: 'pyth', q: L(lang, `Rechthoekige driehoek: schuine zijde ${c}, één zijde ${a}. Andere zijde = ?`, `Right triangle: hypotenuse ${c}, one leg ${a}. Other leg = ?`), answer: b, hint: L(lang, `b² = c² − a² = ${c * c} − ${a * a} = ${b * b}.`, `b² = c² − a² = ${c * c} − ${a * a} = ${b * b}.`) };
};

const CURRICULUM: Record<Grade, Gen[]> = {
  g3: [addSub(20)],
  g4: [addSub(100), tables([1, 2, 5, 10])],
  g5: [tables([2, 3, 4, 5, 6, 7, 8, 9, 10]), addSub(1000), tables([2, 3, 4, 5])],
  g6: [bigTimes, fractionOf, money],
  g7: [fractionOf, decimals, percentBasic, units],
  g8: [percentAny, ratio, wordMixed, fractionOf],
  vo1: [negatives, orderOps, simpleEq, areaPerim],
  vo3: [linearEq, powers, pythagoras],
};

/** A random problem for this grade; pass `sameAs` to get a new problem of the same kind. */
export function makeProblem(grade: Grade, lang: Lang, sameAs?: string): Problem {
  const gens = CURRICULUM[grade];
  for (let i = 0; i < 30 && sameAs; i++) {
    const p = pick(gens)(lang);
    if (p.type === sameAs) return p;
  }
  return pick(gens)(lang);
}

/** Four answer options (the right one plus believable mistakes), shuffled. */
export function choices(p: Problem): number[] {
  const a = p.answer;
  const step = Number.isInteger(a) ? 1 : Number.isInteger(a * 10) ? 0.1 : 0.01;
  const mag = Math.max(1, Math.abs(a));
  const cands = [a + step, a - step, a + 10 * step, a - 10 * step, a + 2 * step, a * 2, Math.round(a / 2), a + Math.ceil(mag * 0.1), -a]
    .map((v) => +v.toFixed(2))
    .filter((v) => v !== a && (a < 0 || v >= 0));
  const set = new Set<number>([a]);
  while (set.size < 4 && cands.length) set.add(cands.splice(Math.floor(Math.random() * cands.length), 1)[0]);
  for (let k = 3; set.size < 4; k++) set.add(+(a + k * step).toFixed(2));
  return [...set].sort(() => Math.random() - 0.5);
}

export const formatAnswer = (n: number, p: Problem, lang: Lang) => (p.unit === '€' ? euro(n, lang) : num(n, lang) + (p.unit ? ` ${p.unit}` : ''));
