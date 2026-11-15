// The "build in the city" screen: a list of things to build with coins, stunt points and sums.
import { t, getLang } from '../i18n';
import type { BuildItem } from '../game/builder';
import type { Progress } from '../game/progress';
import { h, button, modal, mathGate, toast } from './ui';

const ICON: Record<BuildItem['kind'], string> = { ramps: '🟨', loop: '➰', track: '🏁' };

/**
 * Shows the list. Resolves with the item the player wants to drive to (just built, or chosen
 * with "drive there"), or null when closed. `onBuild` adds the item to the world.
 */
export function openBuilder(p: Progress, items: BuildItem[], onBuild: (item: BuildItem) => void): Promise<BuildItem | null> {
  return new Promise((resolve) => {
    let close = () => {};
    const done = (item: BuildItem | null) => {
      close();
      resolve(item);
    };
    const render = () => {
      close();
      const lang = getLang();
      const rows = items.map((it) => {
        const built = p.built.includes(it.id);
        const cost = `🪙 ${it.coins} · ⚡ ${it.points} · ✏️ ${it.sums}`;
        const action = built
          ? button(t('goThere'), () => done(it))
          : button(t('buildBtn'), async () => {
            if (p.coins < it.coins || p.points < it.points) {
              toast(p.coins < it.coins ? t('notEnough') : t('notEnoughPoints'));
              return;
            }
            close();
            if (p.grade && (await mathGate(it.sums, p.grade))) {
              p.coins -= it.coins;
              p.points -= it.points;
              p.built.push(it.id);
              onBuild(it);
              toast(t('builtNow'), 2);
              resolve(it);
            } else render();
          }, p.coins >= it.coins && p.points >= it.points ? 'primary' : '');
        return h('div', { class: 'build-row' },
          h('span', { class: 'build-icon' }, ICON[it.kind]),
          h('div', { class: 'build-text' }, h('div', { class: 'build-name' }, it.name[lang]), h('div', { class: 'muted' }, built ? `✓ ${t('builtLabel')}` : cost)),
          action);
      });
      close = modal(
        h('div', { class: 'garage-head' }, h('h2', {}, t('buildTitle')), h('div', { class: 'coins-big' }, `🪙 ${p.coins} · ⚡ ${p.points}`)),
        h('p', { class: 'muted' }, t('buildIntro')),
        h('div', { class: 'build-list' }, ...rows),
        h('div', { class: 'row' }, button(t('close'), () => done(null), 'primary')),
      );
    };
    render();
  });
}
