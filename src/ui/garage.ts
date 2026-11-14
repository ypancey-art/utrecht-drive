import * as THREE from 'three';
import { t } from '../i18n';
import { CARS, UPGRADE_KINDS, UPGRADE_COST, UPGRADE_PROBLEMS, PAINT_COST, upgradedStats, armourFactor, type CarSpec } from '../game/cars';
import { upgradesFor, type Progress } from '../game/progress';
import { buildCarModel } from '../art/carModels';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { groundOffset } from '../game/car';
import { h, button, modal, mathGate, toast } from './ui';

const NEW_CAR_PROBLEMS = 6;

/** Rotating 3D preview of a car. */
const still = new URLSearchParams(location.search).has('still'); // testing: fixed angle

function preview(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(4, 7, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2e343e, roughness: 0.35, metalness: 0.1 }));
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(5.2, 2.0, 5.6);
  camera.lookAt(0, 0.7, 0);
  const stand = new THREE.Group();
  scene.add(stand);
  let raf = 0;
  const loop = (time: number) => {
    stand.rotation.y = still ? 0.6 : time / 2500;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, hgt, false);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return {
    show(spec: CarSpec, paint: number) {
      stand.clear();
      const m = buildCarModel(spec, paint);
      // Place the wheels where the physics would put them (standing still).
      const d = spec.dims!, wx = d.wheelbase / 2, wz = d.track;
      [[wx, -wz], [wx, wz], [-wx, -wz], [-wx, wz]].forEach(([x, z], i) => m.wheels[i]?.position.set(x, d.wheelR, z));
      m.body.position.y = groundOffset(d.wheelR);
      stand.add(m.body, ...m.wheels);
    },
    dispose() {
      cancelAnimationFrame(raf);
      renderer.dispose();
    },
  };
}

function bar(label: string, value: number) {
  const fill = h('span', { class: 'fill', style: `width:${Math.round(Math.min(1, value) * 100)}%` });
  return h('div', { class: 'stat' }, h('span', {}, label), h('span', { class: 'track' }, fill));
}

/** The garage: buy cars, choose one, upgrade and paint it. */
export function openGarage(p: Progress, grade: Progress['grade'], onChange: () => void): Promise<void> {
  return new Promise((resolve) => {
    let viewing = p.carId;
    const canvas = h('canvas', { class: 'preview' }) as HTMLCanvasElement;
    const tabs = h('div', { class: 'tabs' });
    const info = h('div', { class: 'garage-info' });
    const coins = h('div', { class: 'coins-big' });
    const close = modal(h('div', { class: 'garage-head' }, h('h2', {}, t('garage')), coins), tabs, canvas, info,
      h('div', { class: 'row' }, button(t('close'), () => {
        view.dispose();
        close();
        resolve();
      }, 'primary')));
    const view = preview(canvas);
    const save = () => {
      onChange();
      render();
    };

    async function gate(n: number, cost: number): Promise<boolean> {
      if (p.coins < cost) {
        toast(t('notEnough'));
        return false;
      }
      if (!grade || !(await mathGate(n, grade))) return false;
      p.coins -= cost;
      return true;
    }

    function render() {
      const spec = CARS.find((c) => c.id === viewing)!;
      const owned = p.owned.includes(spec.id);
      const u = upgradesFor(p, spec.id);
      coins.textContent = `🪙 ${p.coins}`;
      tabs.replaceChildren(...CARS.map((c) => button(c.name, () => {
        viewing = c.id;
        render();
      }, c.id === viewing ? 'primary' : '')));
      view.show(spec, spec.colors[u.paint] ?? 0);

      const st = upgradedStats(spec, u);
      const stats = h('div', { class: 'stats' },
        bar(t('statSpeed'), st.maxSpeed / 35),
        bar(t('statHandling'), (st.grip * st.maxSteer) / 2.6),
        bar(t('statTough'), 0.4 / armourFactor(spec, u)),
      );
      const rows: HTMLElement[] = [stats];
      if (!owned) {
        rows.push(h('p', { class: 'muted' }, t('newCar', { n: NEW_CAR_PROBLEMS })));
        rows.push(h('div', { class: 'row' }, button(t('buy', { n: `🪙 ${spec.price}` }), async () => {
          if (await gate(NEW_CAR_PROBLEMS, spec.price)) {
            p.owned.push(spec.id);
            p.carId = spec.id;
            save();
          }
        }, 'primary')));
      } else {
        rows.push(h('div', { class: 'row' }, p.carId === spec.id
          ? h('span', { class: 'badge' }, `✓ ${t('chosen')}`)
          : button(t('choose'), () => {
            p.carId = spec.id;
            save();
          }, 'primary')));
        for (const kind of UPGRADE_KINDS) {
          const lvl = u[kind];
          const dots = h('span', { class: 'lvl' }, '●'.repeat(lvl) + '○'.repeat(3 - lvl));
          const action = lvl >= 3
            ? h('span', { class: 'badge' }, t('max'))
            : button(t('upgrade', { n: `🪙 ${UPGRADE_COST[lvl]} · ✏️ ${UPGRADE_PROBLEMS[lvl]}` }), async () => {
              if (await gate(UPGRADE_PROBLEMS[lvl], UPGRADE_COST[lvl])) {
                u[kind] = lvl + 1;
                save();
              }
            });
          rows.push(h('div', { class: 'upgrade' }, h('span', {}, t(kind)), dots, action));
        }
        const swatches = h('div', { class: 'swatches' }, ...spec.colors.map((c, i) => {
          const b = button('', async () => {
            if (i === u.paint) return;
            if (await gate(3, PAINT_COST)) {
              u.paint = i;
              save();
            }
          }, i === u.paint ? 'swatch on' : 'swatch');
          b.style.background = c ? `#${c.toString(16).padStart(6, '0')}` : 'conic-gradient(#e44, #fd4, #4c8, #48f, #e44)';
          b.title = `🪙 ${PAINT_COST}`;
          return b;
        }));
        rows.push(h('div', { class: 'upgrade' }, h('span', {}, `${t('paint')} (🪙 ${PAINT_COST})`), swatches));
      }
      info.replaceChildren(...rows);
    }
    render();
  });
}
