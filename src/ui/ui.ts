// HTML screens drawn over the 3D view. They pause driving while open.
import { sound } from '../audio/sound';
import { t, getLang, setLang, gradeName, type Lang } from '../i18n';
import { GRADES, type Grade } from '../game/progress';
import { makeProblem, choices, formatAnswer } from '../game/mathProblems';

type Child = Node | string | null | false | undefined;
export function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}
export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls }, label) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

const root = document.getElementById('screens')!;
let openCount = 0;
/** True while any screen is open (the car should not drive). */
export const isOpen = () => openCount > 0;

/** Shows a modal card and returns a function that closes it. */
export function modal(...content: Child[]): () => void {
  openCount++;
  const card = h('div', { class: 'card' }, ...content);
  const back = h('div', { class: 'backdrop' }, card);
  root.append(back);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openCount--;
    back.remove();
  };
}

/** A message with buttons; resolves with the chosen button's value. */
export function dialog<T>(title: string, body: string, buttons: { label: string; value: T; primary?: boolean; disabled?: boolean }[]): Promise<T> {
  return new Promise((resolve) => {
    const row = h('div', { class: 'row' });
    const close = modal(h('h2', {}, title), body ? h('p', {}, body) : null, row);
    for (const b of buttons) {
      const el = button(b.label, () => {
        close();
        resolve(b.value);
      }, b.primary ? 'primary' : '');
      el.disabled = !!b.disabled;
      row.append(el);
    }
  });
}

/** First screen: language and grade. */
export function startScreen(current: Grade | null): Promise<Grade> {
  return new Promise((resolve) => {
    let close = () => {};
    const render = () => {
      close();
      const langs = h('div', { class: 'row' },
        ...(['nl', 'en'] as Lang[]).map((l) => button(l === 'nl' ? 'Nederlands' : 'English', () => {
          setLang(l);
          render();
        }, getLang() === l ? 'primary' : '')),
      );
      const grades = h('div', { class: 'grid' },
        ...GRADES.map((g) => button(gradeName(g), () => {
          close();
          resolve(g);
        }, g === current ? 'primary' : '')),
      );
      close = modal(h('h1', {}, t('title')), h('p', { class: 'muted' }, t('language')), langs, h('p', { class: 'muted' }, t('chooseGrade')), grades);
    };
    render();
  });
}

/**
 * The math gate: solve `count` problems to continue. A wrong answer gives a new problem
 * of the same kind; after 2 wrong in a row the hint is shown. Resolves false if cancelled.
 */
export function mathGate(count: number, grade: Grade, title = t('solveN', { n: count })): Promise<boolean> {
  return new Promise((resolve) => {
    let solved = 0, wrongStreak = 0;
    let problem = makeProblem(grade, getLang());
    const progress = h('div', { class: 'dots' });
    const question = h('div', { class: 'question' });
    const answers = h('div', { class: 'answers' });
    const feedback = h('div', { class: 'feedback' });
    const hint = h('div', { class: 'hint' });
    let locked = false;
    const close = modal(h('h2', {}, title), progress, question, answers, feedback, hint,
      h('div', { class: 'row' }, button(t('cancel'), () => finish(false))));

    const onKey = (e: KeyboardEvent) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) (answers.children[n - 1] as HTMLButtonElement | undefined)?.click();
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    function finish(ok: boolean) {
      window.removeEventListener('keydown', onKey);
      close();
      resolve(ok);
    }

    function render() {
      progress.replaceChildren(...Array.from({ length: count }, (_, i) => h('span', { class: i < solved ? 'dot on' : 'dot' })));
      question.textContent = problem.q;
      hint.textContent = wrongStreak >= 2 ? `${t('hint')}: ${problem.hint}` : '';
      answers.replaceChildren(...choices(problem).map((v) => button(formatAnswer(v, problem, getLang()), () => answer(v))));
    }
    function answer(v: number) {
      if (locked) return;
      locked = true;
      const right = Math.abs(v - problem.answer) < 1e-6;
      feedback.textContent = right ? t('correct') : t('wrong');
      if (right) sound.correct();
      else sound.wrong();
      feedback.className = right ? 'feedback good' : 'feedback bad';
      setTimeout(() => {
        locked = false;
        feedback.textContent = '';
        if (right) {
          solved++;
          wrongStreak = 0;
          if (solved >= count) return finish(true);
          problem = makeProblem(grade, getLang());
        } else {
          wrongStreak++;
          problem = makeProblem(grade, getLang(), problem.type);
        }
        render();
      }, right ? 500 : 900);
    }
    render();
  });
}

/** Short message in the middle of the screen. */
let toastTimer = 0;
export function toast(text: string, seconds = 2.5) {
  const el = document.getElementById('toast')!;
  el.textContent = text;
  clearTimeout(toastTimer);
  if (seconds > 0) toastTimer = window.setTimeout(() => (el.textContent = ''), seconds * 1000);
}
