import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadMap, nearestRoad } from './game/mapData';
import { buildMapPhysics } from './game/mapPhysics';
import { Car } from './game/car';
import { Input } from './game/input';
import { placeScenery } from './game/scenery';
import { WaterMap } from './game/water';
import { buildDyke } from './game/railway';
import { placePlaygrounds } from './game/playgrounds';
import { buildPlaygrounds } from './art/playgroundMeshes';
import { RoadGraph } from './game/roadGraph';
import { Police, STAR_LEVELS } from './game/police';
import { Traffic } from './game/traffic';
import { buildMissions, MissionRunner, MISSION_SIZE, REACH_RADIUS } from './game/missions';
import { CARS, POLICE, carById, upgradedStats, armourFactor } from './game/cars';
import { loadProgress, saveProgress, upgradesFor } from './game/progress';
import { buildMapMeshes, bridgeSegments } from './art/mapMeshes';
import { buildTrees, buildLamps } from './art/sceneryMeshes';
import { buildCarModel, loadCarAssets, type CarModel } from './art/carModels';
import { beam } from './art/markers';
import { palette } from './art/palette';
import { t, getLang, setLang, onLangChange } from './i18n';
import { isOpen, startScreen, mathGate, dialog, toast } from './ui/ui';
import { openGarage } from './ui/garage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loadingEl = $('loading');
const speedEl = $('speed-value');
const streetEl = $('street');
const hintEl = $('hint');
const langBtn = $<HTMLButtonElement>('lang');
const coinsEl = $('coins');
const missionEl = $('mission');
const missionTitleEl = $('mission-title');
const missionTimerEl = $('mission-timer');
const wantedEl = $('wanted');
const starsEl = $('stars');
const meterEl = $('meter-fill');
const arrowEl = $('arrow');
const needleEl = arrowEl.querySelector('.needle') as HTMLElement;
const arrowDistEl = $('arrow-dist');

function applyTexts() {
  loadingEl.textContent = t('loading');
  hintEl.textContent = t('hintKeys');
  langBtn.textContent = t('otherLang');
}
applyTexts();
onLangChange(applyTexts);
document.documentElement.lang = getLang();
langBtn.addEventListener('click', () => setLang(getLang() === 'nl' ? 'en' : 'nl'));

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

/** Moves a car model to match its physics body (body, wheels, steering, spin, fade). */
const _q = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _sq = new THREE.Quaternion(), _v = new THREE.Vector3();
const _e = new THREE.Euler(), Z = new THREE.Vector3(0, 0, -1);
function syncModel(model: CarModel, car: Car) {
  const p = car.body.translation(), r = car.body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  model.body.position.set(p.x, p.y, p.z);
  model.body.quaternion.copy(_q);
  model.wheels.forEach((w, i) => {
    const s = car.wheelState(i);
    const z = s.z + Math.sign(s.z) * model.wheelOutset;
    w.position.copy(_v.set(s.x, s.y, z).applyQuaternion(_q).add(model.body.position));
    _wq.setFromEuler(_e.set(0, s.steering, 0));
    w.quaternion.copy(_q).multiply(_wq).multiply(_sq.setFromAxisAngle(Z, s.rotation));
  });
  model.setOpacity(car.sinking ? Math.max(0, Math.min(1, 1 - (car.sinking - 1.6) / 1.4)) : 1);
}

async function start() {
  const [, map] = await Promise.all([RAPIER.init(), loadMap(), loadCarAssets([...CARS, POLICE])]);
  const progress = loadProgress();
  const save = () => {
    saveProgress(progress);
    coinsEl.textContent = `🪙 ${progress.coins}`;
  };
  save();

  // --- Rendering ---
  const canvas = $<HTMLCanvasElement>('game');
  const isTouch = document.body.classList.contains('touch-device') || navigator.maxTouchPoints > 0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(palette.sky, 180, 700);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1500);
  // Soft studio reflections for the cars' paint and glass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x9a9f80, 2.4));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(0.45, 0.75, 0.35).normalize();

  // Sky dome with the sun in the same direction as the shadow light.
  const sky = new Sky();
  sky.scale.setScalar(1400);
  sky.renderOrder = -100; // draw first: the flat ground layers paint over it
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  scene.add(sky);

  const dyke = buildDyke(map); // first: opens the road tunnels under the railway
  const scenery = placeScenery(map);
  const water = new WaterMap(map);
  const play = placePlaygrounds(map);
  scene.add(buildPlaygrounds(play.items, play.areas));
  scene.add(buildMapMeshes(map, scenery.grid, water, dyke), buildTrees(scenery.trees), buildLamps(scenery.lamps));

  // --- Physics & world logic ---
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const events = new RAPIER.EventQueue(true);
  const decks = bridgeSegments(map, water, scenery.grid);
  water.setBridges(decks);
  buildMapPhysics(world, map, scenery.trees, decks, dyke, play);
  const graph = new RoadGraph(map);

  // --- Player car (rebuilt when changing car or upgrades in the garage) ---
  let car!: Car;
  let model!: CarModel;
  const buildPlayer = () => {
    const spec = carById(progress.carId);
    const up = upgradesFor(progress, spec.id);
    let pose: { x: number; z: number; dx: number; dz: number } | null = null;
    if (car) {
      const p = car.body.translation(), r = car.body.rotation();
      pose = { x: p.x, z: p.z, dx: 1 - 2 * (r.y * r.y + r.z * r.z), dz: 2 * (r.x * r.z - r.w * r.y) };
      car.dispose();
      scene.remove(model.body, ...model.wheels);
    }
    car = new Car(world, upgradedStats(spec, up), spec.dims!);
    model = buildCarModel(spec, spec.colors[up.paint] ?? 0);
    scene.add(model.body, ...model.wheels);
    if (pose) car.place(pose.x, pose.z, pose.dx, pose.dz);
  };
  buildPlayer();

  const spawn = (fromStation = false) => {
    const station = map.stations[0]?.p ?? [0, 0];
    const p = car.body.translation();
    const from = fromStation ? station : [p.x, p.z];
    const r = nearestRoad(map, from[0], from[1], (r) => r.drivable && r.kind !== 'service');
    if (car.sinking) car.stopSinking();
    car.place(r.x, r.z, r.dirX, r.dirZ);
  };
  spawn(true);

  // Testing aid: ?at=x,z[,heading in degrees] starts the car at a map position.
  const at = new URLSearchParams(location.search).get('at')?.split(',').map(Number);
  if (at && at.length >= 2 && at.every(Number.isFinite)) {
    const a = ((at[2] ?? 0) * Math.PI) / 180;
    car.place(at[0], at[1], Math.cos(a), Math.sin(a));
  }

  // --- Police ---
  const police = new Police(world, graph, POLICE, () => {
    const m = buildCarModel(POLICE, POLICE.colors[0], { police: true });
    scene.add(m.body, ...m.wheels);
    return {
      sync: (c, time) => {
        syncModel(m, c);
        m.flash?.(time);
      },
      dispose: () => scene.remove(m.body, ...m.wheels),
    };
  });
  police.inWater = (x, z) => water.contains(x, z) && scenery.grid.edgeDistance(x, z) > 0.3;

  // --- Traffic ---
  const lastHit = new Map<number, number>(); // traffic collider -> time of the last accident
  const traffic = new Traffic(world, new RoadGraph(map, true), CARS, (spec, color) => {
    const m = buildCarModel(spec, color);
    scene.add(m.body, ...m.wheels);
    return { sync: (c) => syncModel(m, c), dispose: () => scene.remove(m.body, ...m.wheels) };
  }, isTouch ? 8 : 14);

  // --- Missions ---
  const runner = new MissionRunner(buildMissions(map));
  const markers = new THREE.Group();
  scene.add(markers);
  const refreshMarkers = () => {
    markers.clear();
    if (runner.active) {
      const tg = runner.target!;
      const b = beam('target', REACH_RADIUS);
      b.position.set(tg[0], 0, tg[1]);
      markers.add(b);
    } else {
      for (const m of runner.missions) {
        const b = beam(progress.missionsDone.includes(m.def.id) ? 'done' : 'start', REACH_RADIUS);
        b.position.set(m.start[0], 0, m.start[1]);
        markers.add(b);
      }
    }
  };
  refreshMarkers();

  // --- Flows that open screens (driving pauses while a screen is open) ---
  let busy = false;
  const flow = async (fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } finally {
      busy = false;
    }
  };

  const askMission = (m: (typeof runner.missions)[number]) =>
    flow(async () => {
      const size = MISSION_SIZE[m.def.size];
      const lang = getLang();
      const go = await dialog(t('missionAsk', { name: m.def.title[lang] }),
        `${m.def.desc[lang]}\n\n${t('reward', { n: size.reward })} · ${t('timeLimit', { n: fmtTime(m.timeLimit) })} · ${t('problemsNeeded', { n: size.problems })}`,
        [{ label: t('notNow'), value: false }, { label: t('start'), value: true, primary: true }]);
      if (go && progress.grade && (await mathGate(size.problems, progress.grade))) {
        runner.begin(m);
        toast(m.def.title[lang], 2);
      } else runner.snooze(m);
      refreshMarkers();
    });

  const caught = () =>
    flow(async () => {
      // Caught: always a fine. Not enough coins? Pay what you have and work off the rest with sums.
      const fine = police.stars * 20;
      if (progress.coins >= fine) {
        await dialog(t('caughtTitle'), t('caughtBody', { n: fine }), [{ label: t('payFine', { n: fine }), value: 'pay', primary: true }]);
        progress.coins -= fine;
      } else {
        const have = progress.coins;
        const bail = 2 + police.stars;
        await dialog(t('caughtTitle'), t('caughtBody', { n: fine }) + '\n\n' + t('fineShort', { have, n: bail }), [{ label: t('solveBail', { n: bail }), value: 'bail', primary: true }]);
        progress.coins = 0;
        while (progress.grade && !(await mathGate(bail, progress.grade))) { /* try again */ }
      }
      save();
      police.clear();
      toast(t('free'));
    });

  const openMenu = () =>
    flow(async () => {
      const choice = await dialog(t('menu'), '', [
        { label: t('resume'), value: 'resume', primary: true },
        { label: t('garage'), value: 'garage' },
        { label: t('changeGrade'), value: 'grade' },
      ]);
      if (choice === 'garage') {
        await openGarage(progress, progress.grade, () => {
          save();
          buildPlayer();
        });
      } else if (choice === 'grade') {
        progress.grade = await startScreen(progress.grade);
        save();
      }
    });
  $('menu-btn').addEventListener('click', openMenu);

  const input = new Input($('touch'));
  input.onReset = () => !isOpen() && spawn();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !isOpen()) openMenu();
  });

  // --- Resize ---
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // --- Loop ---
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let acc = 0;
  let last = performance.now();
  let flippedTime = 0;
  let streetTimer = 0;
  let firstFrame = true;
  const STOP: Parameters<Car['update']>[0] = { throttle: 0, steer: 0, handbrake: true };

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const paused = isOpen();

    if (!paused) {
      acc += dt;
      const controls = input.read();
      while (acc >= world.timestep) {
        if (car.sinking) car.updateSinking(world.timestep);
        else car.update(controls, world.timestep);
        police.step(world.timestep, car);
        traffic.step(world.timestep, car, police.units.map((u) => u.car));
        world.step(events);
        acc -= world.timestep;
      }

      // Crashes fill the crash meter (not bumps from police cars).
      const starsBefore = police.stars;
      const armour = armourFactor(carById(progress.carId), upgradesFor(progress, progress.carId));
      events.drainContactForceEvents((e) => {
        const h1 = e.collider1(), h2 = e.collider2();
        if (h1 !== car.collider.handle && h2 !== car.collider.handle) return;
        if (police.isPoliceCollider(h1) || police.isPoliceCollider(h2) || car.sinking) return;
        let points = Math.min(30, e.totalForceMagnitude() / (car.stats.mass * 30)) * armour;
        // Hitting another road user is an accident: it counts much more (once per car per 2 s).
        const other = h1 === car.collider.handle ? h2 : h1;
        if (traffic.isTrafficCollider(other) && performance.now() - (lastHit.get(other) ?? -1e9) > 2000) {
          lastHit.set(other, performance.now());
          points = Math.max(points, 0) + 22 * armour;
        }
        if (points > 2) police.addCrash(points);
      });
      if (police.stars > starsBefore) toast(t(starsBefore ? 'policeMore' : 'policeComing'), 2.5);

      // Water: the car sinks, then comes back on the nearest road.
      const cp = car.body.translation();
      if (!car.sinking) {
        if (cp.y < 2 && water.contains(cp.x, cp.z) && scenery.grid.edgeDistance(cp.x, cp.z) > 0.3) {
          car.startSinking();
          toast(t('splash'), 3);
        }
      } else if (car.sinking > 3) {
        car.stopSinking();
        spawn();
      }

      flippedTime = car.flipped ? flippedTime + dt : 0;
      if (flippedTime > 2) {
        spawn();
        flippedTime = 0;
      }

      traffic.update(dt, car, police.units.map((u) => u.car));

      // Police: chase, escape or caught.
      const pr = police.update(dt, car);
      if (pr === 'escaped') {
        police.clear();
        toast(t('escaped'));
      } else if (pr === 'caught') {
        car.update(STOP, world.timestep);
        caught();
      }

      // Missions.
      const before = runner.active;
      const res = runner.update(dt, cp.x, cp.z);
      if (res === 'checkpoint') {
        toast(t('checkpoint', { i: runner.stop, n: runner.active!.stops.length }), 1.5);
        refreshMarkers();
      } else if (res === 'complete' && before) {
        const reward = MISSION_SIZE[before.def.size].reward;
        progress.coins += reward;
        if (!progress.missionsDone.includes(before.def.id)) progress.missionsDone.push(before.def.id);
        save();
        toast(t('complete', { n: reward }), 3);
        refreshMarkers();
      } else if (res === 'failed') {
        toast(t('failed'));
        refreshMarkers();
      }
      if (!runner.active && !busy && !car.sinking) {
        const m = runner.atStart(cp.x, cp.z);
        if (m) askMission(m);
      }
    }

    // Sync visuals.
    syncModel(model, car);
    const p = car.body.translation();
    const r = car.body.rotation();
    fwd.set(1 - 2 * (r.y * r.y + r.z * r.z), 0, 2 * (r.x * r.z - r.w * r.y)).normalize();
    const desired = tmp.set(p.x, p.y, p.z).addScaledVector(fwd, -9);
    desired.y = p.y + 4;
    if (firstFrame) camPos.copy(desired);
    camPos.lerp(desired, 1 - Math.exp(-dt * 4));
    camera.position.copy(camPos);
    lookAt.set(p.x, p.y + 1, p.z).addScaledVector(fwd, 3);
    camera.lookAt(lookAt);
    sun.position.set(p.x, 0, p.z).addScaledVector(SUN_DIR, 150);
    sun.target.position.set(p.x, 0, p.z);
    sky.position.copy(camera.position);
    markers.children.forEach((b) => (b.children[1].rotation.y += dt));

    // HUD.
    speedEl.textContent = String(Math.round(Math.abs(car.speed) * 3.6));
    streetTimer -= dt;
    if (streetTimer <= 0) {
      streetTimer = 0.5;
      const near = nearestRoad(map, p.x, p.z, (r) => !!r.name);
      streetEl.textContent = near.dist2 < 20 * 20 ? near.road!.name : '';
    }
    wantedEl.classList.toggle('hidden', police.stars === 0 && police.meter < 1);
    starsEl.textContent = police.stars ? '★'.repeat(police.stars) + '☆'.repeat(3 - police.stars) : '☆☆☆';
    meterEl.style.width = `${police.meter}%`;
    meterEl.style.background = police.meter >= STAR_LEVELS[0] ? '#ff3b30' : '#ffb340';

    const tg = runner.target;
    missionEl.classList.toggle('hidden', !runner.active);
    arrowEl.classList.toggle('hidden', !tg);
    if (runner.active && tg) {
      missionTitleEl.textContent = runner.active.def.title[getLang()];
      missionTimerEl.textContent = fmtTime(runner.timeLeft);
      missionTimerEl.classList.toggle('low', runner.timeLeft < 15);
      // Arrow relative to the camera's view direction.
      const cf = camera.getWorldDirection(tmp);
      const len = Math.hypot(cf.x, cf.z) || 1;
      const fx = cf.x / len, fz = cf.z / len;
      const vx = tg[0] - p.x, vz = tg[1] - p.z;
      const ang = Math.atan2(vx * -fz + vz * fx, vx * fx + vz * fz);
      needleEl.style.transform = `rotate(${ang}rad)`;
      arrowDistEl.textContent = `${Math.round(Math.hypot(vx, vz))} m`;
    }

    renderer.render(scene, camera);
    if (firstFrame) {
      loadingEl.classList.add('hidden');
      firstFrame = false;
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // Testing aids: ?grade=g5 skips the start screen, ?wanted=2 starts a chase, ?garage=ev4 opens the garage.
  const qs = new URLSearchParams(location.search);
  const qGrade = qs.get('grade') as typeof progress.grade;
  if (qGrade) progress.grade = qGrade;
  if (qs.get('wanted')) police.addCrash(STAR_LEVELS[Math.min(2, Number(qs.get('wanted')) - 1)]);
  if (qs.get('garage')) {
    progress.owned = [...new Set([...progress.owned, qs.get('garage')!])];
    progress.carId = qs.get('garage')!;
    buildPlayer();
    flow(() => openGarage(progress, progress.grade, () => {
      save();
      buildPlayer();
    }));
  }

  // First visit: choose language and grade.
  if (!progress.grade) {
    flow(async () => {
      progress.grade = await startScreen(null);
      save();
    });
  }

  // Handy for debugging in the browser console.
  (window as unknown as { game: unknown }).game = { car: () => car, world, map, scene, camera, police, runner, progress, traffic };
}

start().catch((err) => {
  loadingEl.textContent = String(err);
  console.error(err);
});
