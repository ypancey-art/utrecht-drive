// "Play together" screen: start a room (get a code) or join one (type the code).
// Players get a made-up nickname (an adjective and an animal); kids can't type a name or any text
// that others would see.
import { h, button, modal } from './ui';
import { t } from '../i18n';
import { cleanCode, CODE_LEN } from '../net/room';
import { randomNick, nickName, type Nick } from '../game/nicknames';

export type TogetherChoice = { kind: 'host'; nick: Nick } | { kind: 'join'; nick: Nick; code: string } | null;

/** Asks to start or join a room. Resolves with the choice, or null on cancel. */
export function togetherScreen(nick: Nick): Promise<TogetherChoice> {
  return new Promise((resolve) => {
    const nameEl = h('strong', { class: 'nick' }, nickName(nick));
    const reroll = button('🎲', () => {
      nick = randomNick();
      nameEl.textContent = nickName(nick);
    });
    reroll.title = t('newName');
    const code = h('input', { class: 'code-input', maxlength: String(CODE_LEN), placeholder: 'ABC123', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' }) as HTMLInputElement;
    const joinBtn = button(t('joinRoom'), () => {
      const c = cleanCode(code.value);
      if (c.length !== CODE_LEN) return code.focus();
      done({ kind: 'join', nick, code: c });
    }, 'primary');
    joinBtn.disabled = true;
    code.addEventListener('input', () => {
      code.value = cleanCode(code.value);
      joinBtn.disabled = code.value.length !== CODE_LEN;
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
      h('div', { class: 'row' }, button(t('hostRoom'), () => done({ kind: 'host', nick }), 'primary')),
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
