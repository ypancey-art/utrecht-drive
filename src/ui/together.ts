// "Play together" screen: start a room (get a code) or join one (type the code).
// Players get a made-up nickname (an adjective and an animal); kids don't type their real name.
import { h, button, modal } from './ui';
import { t, getLang } from '../i18n';
import { cleanCode } from '../net/room';

const NAMES = {
  nl: {
    a: ['Snelle', 'Gekke', 'Stoere', 'Vrolijke', 'Slimme', 'Dappere', 'Turbo', 'Super', 'Wilde', 'Coole', 'Grappige', 'Blije'],
    b: ['Vos', 'Uil', 'Panda', 'Tijger', 'Haai', 'Egel', 'Leeuw', 'Draak', 'Pinguïn', 'Koala', 'Wolf', 'Otter', 'Raket', 'Eekhoorn'],
  },
  en: {
    a: ['Fast', 'Crazy', 'Brave', 'Happy', 'Clever', 'Bold', 'Turbo', 'Super', 'Wild', 'Cool', 'Funny', 'Jolly'],
    b: ['Fox', 'Owl', 'Panda', 'Tiger', 'Shark', 'Hedgehog', 'Lion', 'Dragon', 'Penguin', 'Koala', 'Wolf', 'Otter', 'Rocket', 'Squirrel'],
  },
};
export function randomNickname() {
  const n = NAMES[getLang()];
  const pick = (l: string[]) => l[Math.floor(Math.random() * l.length)];
  return `${pick(n.a)} ${pick(n.b)}`;
}

export type TogetherChoice = { kind: 'host'; name: string } | { kind: 'join'; name: string; code: string } | null;

/** Asks to start or join a room. Resolves with the choice, or null on cancel. */
export function togetherScreen(name: string): Promise<TogetherChoice> {
  return new Promise((resolve) => {
    const nameEl = h('strong', { class: 'nick' }, name);
    const reroll = button('🎲', () => {
      name = randomNickname();
      nameEl.textContent = name;
    });
    reroll.title = t('newName');
    const code = h('input', { class: 'code-input', maxlength: '4', placeholder: 'ABCD', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
    const joinBtn = button(t('joinRoom'), () => {
      const c = cleanCode(code.value);
      if (c.length !== 4) return code.focus();
      done({ kind: 'join', name, code: c });
    }, 'primary');
    joinBtn.disabled = true;
    code.addEventListener('input', () => {
      code.value = cleanCode(code.value);
      joinBtn.disabled = code.value.length !== 4;
    });
    code.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing letters must not drive the car or open the menu
      if (e.key === 'Enter' && !joinBtn.disabled) joinBtn.click();
    });
    const close = modal(
      h('h2', {}, t('together')),
      h('p', {}, t('togetherInfo')),
      h('div', { class: 'row nick-row' }, h('span', {}, t('yourName')), nameEl, reroll),
      h('h3', {}, t('hostRoom')),
      h('p', { class: 'muted' }, t('hostInfo')),
      h('div', { class: 'row' }, button(t('hostRoom'), () => done({ kind: 'host', name }), 'primary')),
      h('h3', {}, t('joinRoom')),
      h('div', { class: 'row' }, code, joinBtn),
      h('div', { class: 'row' }, button(t('close'), () => done(null))),
    );
    function done(c: TogetherChoice) {
      close();
      resolve(c);
    }
  });
}
