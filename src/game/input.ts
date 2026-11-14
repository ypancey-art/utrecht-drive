import type { DriveInput } from './car';

type Key = 'gas' | 'brake' | 'left' | 'right' | 'handbrake';

const KEYMAP: Record<string, Key> = {
  ArrowUp: 'gas', KeyW: 'gas',
  ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'handbrake',
};

/** Keyboard + on-screen touch buttons, merged into one DriveInput. */
export class Input {
  private held = new Set<Key>();
  private touchHeld = new Map<number, Key>();
  onReset: () => void = () => {};

  constructor(touchRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (k) {
        this.held.add(k);
        e.preventDefault();
      }
      if (e.code === 'KeyR') this.onReset();
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (k) this.held.delete(k);
    });
    window.addEventListener('blur', () => this.held.clear());

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch-device');
    for (const btn of touchRoot.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
      const key = btn.dataset.key as Key;
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        this.touchHeld.set(e.pointerId, key);
        btn.classList.add('active');
        e.preventDefault();
      });
      const up = (e: PointerEvent) => {
        this.touchHeld.delete(e.pointerId);
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private has(k: Key) {
    if (this.held.has(k)) return true;
    for (const v of this.touchHeld.values()) if (v === k) return true;
    return false;
  }

  read(): DriveInput {
    return {
      throttle: (this.has('gas') ? 1 : 0) - (this.has('brake') ? 1 : 0),
      steer: (this.has('right') ? 1 : 0) - (this.has('left') ? 1 : 0),
      handbrake: this.has('handbrake'),
    };
  }
}
