import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadMap, nearestRoad } from './game/mapData';
import { buildMapPhysics, addHedgePhysics, addRampPhysics, addLoopPhysics, addTrackPhysics } from './game/mapPhysics';
import { buildLoops, buildTrack } from './art/loopMeshes';
import { buildCatalogue, type BuildItem } from './game/builder';
import { openBuilder } from './ui/builder';
import { buildRamps, rampHulls } from './art/rampMeshes';
import { buildEdgeWall } from './art/edgeWall';
import { Car } from './game/car';
import { Input } from './game/input';
import { placeScenery } from './game/scenery';
import { WaterMap } from './game/water';
import { buildDyke } from './game/railway';
import { placePlaygrounds } from './game/playgrounds';
import { buildPlaygrounds } from './art/playgroundMeshes';
import { RoadGraph } from './game/roadGraph';
import { Police, STAR_LEVELS } from './game/police';
import { sound } from './audio/sound';
import { tileStatic } from './art/tiles';
import { applyStreetLooks } from './game/streetLooks';
import { People } from './game/people';
import { makePersonVisual, makeCrashFx, loadPeopleModels } from './art/peopleMeshes';
import { Traffic } from './game/traffic';
import { buildMissions, MissionRunner, MISSION_SIZE, REACH_RADIUS } from './game/missions';
import { CARS, POLICE, carById, upgradedStats, armourFactor } from './game/cars';
import { GRADES, loadProgress, saveProgress, upgradesFor } from './game/progress';
import { buildMapMeshes, bridgeSegments } from './art/mapMeshes';
import { buildTrees, buildLamps, buildGreenery } from './art/sceneryMeshes';
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
const pointsEl = $('points');
const recordEl = $('record');
const stuntEl = $('stunt');
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

/** Startup timing (shown in the console as "startup"). */
const marks: [string, number][] = [];
let markT = performance.now();
const mark = (name: string) => {
  const now = performance.now();
  marks.push([name, Math.round(now - markT)]);
  markT = now;
};

async function start() {
  const [, map] = await Promise.all([RAPIER.init(), loadMap(), loadCarAssets([...CARS, POLICE]), loadPeopleModels()]);
  mark('load files');
  const progress = loadProgress();
  const save = () => {
    saveProgress(progress);
    coinsEl.textContent = `🪙 ${progress.coins}`;
    pointsEl.textContent = `⚡ ${progress.points}`;
    recordEl.textContent = `🏁 ${progress.topSpeed}`;
  };
  save();

  // --- Rendering ---
  const canvas = $<HTMLCanvasElement>('game');
  const isTouch = document.body.classList.contains('touch-device') || navigator.maxTouchPoints > 0;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch });
  // Retina screens: 1.5x is sharp enough and draws ~45% fewer pixels than 2x.
  let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(palette.sky, 180, 700);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 760); // nothing beyond the fog is drawn
  // Soft studio reflections for the cars' paint and glass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xdfefff, 0x9a9f80, 2.4));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.castShadow = true;
  // Weaker machines (phones, 2-4 core laptops) get a smaller shadow map.
  const weak = isTouch || (navigator.hardwareConcurrency ?? 8) <= 4;
  sun.shadow.mapSize.set(weak ? 1024 : 2048, weak ? 1024 : 2048);
  // Shadows are redrawn every other frame (30 times a second is plenty for them).
  renderer.shadowMap.autoUpdate = false;
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
  scene.add(sun, sun.target);
  const SUN_DIR = new THREE.Vector3(0.45, 0.75, 0.35).normalize();

  // Sky dome with the sun in the same direction as the shadow light.
  const sky = new Sky();
  sky.scale.setScalar(700); // follows the camera (see the frame loop), so it stays inside the far plane
  sky.renderOrder = -100; // draw first: the flat ground layers paint over it
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(SUN_DIR);
  scene.add(sky);

  const dyke = buildDyke(map); // first: opens the road tunnels under the railway
  mark('dyke');
  applyStreetLooks(map);
  mark('street looks');
  const scenery = placeScenery(map);
  mark('scenery');
  const water = new WaterMap(map);
  const play = placePlaygrounds(map);
  // Everything that never moves, split into 200 m tiles so only what is in view gets drawn.
  const statics = new THREE.Group();
  // Ramps and loops with a `build` id only appear once built in the city builder.
  const freeRamps = (map.ramps ?? []).filter((r) => !r.build), freeLoops = (map.loops ?? []).filter((l) => !l.build);
  statics.add(buildPlaygrounds(play.items, play.areas));
  const decks = bridgeSegments(map, water, scenery.grid); // once: used for the meshes and the physics
  statics.add(buildMapMeshes(map, scenery.grid, water, dyke, decks));
  mark('map meshes');
  statics.add(buildTrees(scenery.trees), buildLamps(scenery.lamps));
  statics.add(buildGreenery(map.hedges ?? [], map.shrubs ?? []), buildRamps(freeRamps), buildLoops(freeLoops));
  mark('trees + greenery');
  tileStatic(statics);
  mark('tiles');
  scene.add(statics);

  // --- Physics & world logic ---
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const events = new RAPIER.EventQueue(true);
  water.setBridges(decks);
  mark('bridges');
  buildMapPhysics(world, map, scenery.trees, decks, dyke, play);
  addHedgePhysics(world, map.hedges ?? []);
  addRampPhysics(world, freeRamps.flatMap(rampHulls));
  const loopColliders = addLoopPhysics(world, freeLoops);
  // Things built in the city builder: added to the scene and the physics (also later, when built).
  scene.add(buildEdgeWall());
  const postOk = (x: number, z: number) => scenery.grid.edgeDistance(x, z) > 1.2;
  const addBuilt = (id: string) => {
    const ramps = (map.ramps ?? []).filter((r) => r.build === id), loops = (map.loops ?? []).filter((l) => l.build === id);
    const tracks = (map.tracks ?? []).filter((t) => t.id === id);
    if (ramps.length) {
      scene.add(buildRamps(ramps));
      addRampPhysics(world, ramps.flatMap(rampHulls));
    }
    if (loops.length) {
      scene.add(buildLoops(loops));
      for (const h of addLoopPhysics(world, loops)) loopColliders.add(h);
    }
    for (const t of tracks) {
      scene.add(buildTrack(t, map.buildings, postOk));
      for (const h of addTrackPhysics(world, [t], postOk)) loopColliders.add(h);
    }
  };
  for (const id of progress.built) addBuilt(id);
  const catalogue = buildCatalogue(map);
  mark('physics');
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
  // More police cars joining is shown by the stars and heard by the sirens: no pop-up.
  police.inWater = (x, z) => water.contains(x, z) && scenery.grid.edgeDistance(x, z) > 0.3;

  // --- Traffic ---
  const lastHit = new Map<number, number>(); // traffic collider -> time of the last accident
  const traffic = new Traffic(world, new RoadGraph(map, true), CARS.filter((c) => !c.premium), (spec, color) => {
    const m = buildCarModel(spec, color);
    scene.add(m.body, ...m.wheels);
    return { sync: (c) => syncModel(m, c), dispose: () => scene.remove(m.body, ...m.wheels) };
  }, isTouch ? 8 : 14);

  // --- Pedestrians and cyclists ---
  const people = new People(
    new RoadGraph(map, false, (r) => !r.tunnel && ['footway', 'pedestrian', 'path'].includes(r.kind)),
    new RoadGraph(map, false, (r) => !r.tunnel && ['cycleway', 'residential', 'living_street'].includes(r.kind), (r) => (r.kind === 'cycleway' ? 1 : 5)),
    (kind) => makePersonVisual(scene, kind),
    isTouch ? 18 : 40,
  );
  const crashFx = makeCrashFx(scene);
  let shake = 0; // camera shake after hitting someone
  people.onHit = (strength, x, z) => {
    police.addCrash(30 * armourFactor(carById(progress.carId), upgradesFor(progress, progress.carId)));
    sound.crash(0.5 + strength * 0.5);
    crashFx.burst(x, z, strength);
    shake = Math.max(shake, 0.15 + strength * 0.35);
  };

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
      if (guide) {
        const b = beam('target', REACH_RADIUS);
        b.position.set(guide.where[0], 0, guide.where[1]);
        markers.add(b);
      }
    }
  };
  // Something just built (or chosen in the builder): the arrow shows the way there.
  let guide: BuildItem | null = null;
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
        { label: t('earnCoins'), value: 'earn' },
        { label: t('build'), value: 'build' },
        { label: t('startChase'), value: 'chase' },
      ]);
      if (choice === 'garage') {
        await openGarage(progress, progress.grade, () => {
          save();
          buildPlayer();
        });
      } else if (choice === 'build') {
        const go = await openBuilder(progress, catalogue, (it) => addBuilt(it.id));
        save();
        if (go) {
          guide = go;
          refreshMarkers();
        }
      } else if (choice === 'earn' && progress.grade) {
        // Practise for coins: as many sums as you like. Harder grades pay a bit more, and every
        // 5 right in a row gives a bonus.
        const per = 4 + GRADES.indexOf(progress.grade);
        let earned = 0;
        await mathGate(0, progress.grade, t('earnCoins'), (streak) => {
          if (streak > 0) {
            const bonus = streak % 5 === 0 ? 5 * per : 0;
            earned += per + bonus;
            progress.coins += per + bonus;
            coinsEl.textContent = `🪙 ${progress.coins}`;
            save();
            if (bonus) sound.coin();
            return t('earnStatus', { n: earned, p: per }) + (bonus ? ` · ${t('streakBonus', { n: bonus })}` : '');
          }
          return t('earnStatus', { n: earned, p: per });
        });
        if (earned) toast(`🪙 +${earned}`, 1.5);
      } else if (choice === 'chase') {
        police.startChase();
        toast(t('policeComing'), 2.5);
      } else if (choice === 'grade') {
        progress.grade = await startScreen(progress.grade);
        save();
      }
    });
  $('menu-btn').addEventListener('click', openMenu);
  const musicBtn = $('music-btn'), sfxBtn = $('sfx-btn');
  const soundIcons = () => {
    musicBtn.style.opacity = sound.musicOn ? '1' : '0.45';
    sfxBtn.textContent = sound.sfxOn ? '🔊' : '🔇';
  };
  musicBtn.addEventListener('click', () => (sound.toggleMusic(), soundIcons()));
  sfxBtn.addEventListener('click', () => (sound.toggleSfx(), soundIcons()));
  soundIcons();

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
  let camPull = 1; // fraction of the camera distance left after walls and bridges pull it in
  const fwd = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  let acc = 0;
  let last = performance.now();
  let flippedTime = 0;
  const stunts = { air: 0, inverted: false, fast: 0, recordDirty: false, lastSave: 0 };
  let stuntTimer = 0;
  const stunt = (key: Parameters<typeof t>[0], pts: number) => {
    progress.points += pts;
    save();
    sound.coin();
    stuntEl.textContent = t(key, { p: pts });
    stuntEl.classList.add('show');
    pointsEl.classList.add('bump');
    clearTimeout(stuntTimer);
    stuntTimer = window.setTimeout(() => {
      stuntEl.classList.remove('show');
      pointsEl.classList.remove('bump');
    }, 1400);
  };
  let streetTimer = 0;
  let firstFrame = true;
  let crashLoud = 0, lastCrashSound = 0;
  let frameAvg = 16, lastResize = 0, frameNo = 0;
  const STOP: Parameters<Car['update']>[0] = { throttle: 0, steer: 0, handbrake: true };

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const paused = isOpen();
    let throttleNow = 0;

    if (!paused) {
      acc += dt;
      const controls = input.read();
      throttleNow = controls.throttle;
      // At most 3 physics steps per frame: on a slow frame, drop time instead of piling up work.
      acc = Math.min(acc, world.timestep * 3);
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
        if (loopColliders.has(h1) || loopColliders.has(h2)) return; // riding a loop is not a crash
        // Landing after a jump pushes straight up: that is not a crash.
        const fd = e.maxForceDirection();
        const vertical = Math.abs(fd.y) > 0.75;
        let points = vertical ? 0 : Math.min(30, e.totalForceMagnitude() / (car.stats.mass * 30)) * armour;
        // Hitting another road user is an accident: it counts much more (once per car per 2 s).
        const other = h1 === car.collider.handle ? h2 : h1;
        if (traffic.isTrafficCollider(other) && performance.now() - (lastHit.get(other) ?? -1e9) > 2000) {
          lastHit.set(other, performance.now());
          points = Math.max(points, 0) + 22 * armour;
        }
        if (points > 2) police.addCrash(points);
        if (points > 1.5) crashLoud = Math.max(crashLoud, points / 25);
      });
      if (crashLoud > 0 && now - lastCrashSound > 250) {
        sound.crash(crashLoud);
        lastCrashSound = now;
      }
      crashLoud = 0;
      if (police.stars > 0 && starsBefore === 0) toast(t('policeComing'), 2);

      // Water: the car sinks, then comes back on the nearest road.
      const cp = car.body.translation();
      if (!car.sinking) {
        if (cp.y < 1.2 && water.contains(cp.x, cp.z) && scenery.grid.edgeDistance(cp.x, cp.z) > 0.3) {
          car.startSinking();
          sound.splash();
          toast(t('splash'), 2);
        }
      } else if (car.sinking > 3) {
        car.stopSinking();
        spawn();
      }

      // Upside down with no wheel on anything (not while riding through a loop).
      flippedTime = car.flipped && !car.grounded ? flippedTime + dt : 0;
      if (flippedTime > 2) {
        spawn();
        flippedTime = 0;
        stunts.inverted = false;
      }

      // Stunts earn ⚡ points: time in the air, loops (upside down on the wheels and back),
      // landing high up, and keeping up a high speed.
      if (!car.sinking) {
        const q = car.body.rotation();
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        if (!car.grounded) stunts.air += dt;
        else {
          if (stunts.air > 0.8 && upY > 0.7) {
            const pts = Math.min(30, Math.round(stunts.air * 5));
            stunt(cp.y > 2.5 ? 'stuntRoof' : 'stuntAir', cp.y > 2.5 ? pts + 5 : pts);
          }
          stunts.air = 0;
          if (upY < -0.5) stunts.inverted = true;
          else if (upY > 0.9 && stunts.inverted) {
            stunts.inverted = false;
            stunt('stuntLoop', 25);
          }
        }
        if (Math.abs(car.speed) > 25) {
          stunts.fast += dt;
          if (stunts.fast >= 4) {
            stunts.fast = 0;
            stunt('stuntSpeed', 3);
          }
        } else stunts.fast = Math.max(0, stunts.fast - dt);
        const kmh = Math.round(Math.abs(car.speed) * 3.6);
        if (kmh > progress.topSpeed) {
          progress.topSpeed = kmh;
          recordEl.textContent = `🏁 ${kmh}`;
          stunts.recordDirty = true;
        }
        if (stunts.recordDirty && now - stunts.lastSave > 2000) {
          stunts.recordDirty = false;
          stunts.lastSave = now;
          save();
        }
      }

      traffic.update(dt, car, police.units.map((u) => u.car));
      {
        const q = car.body.rotation();
        const hx = 1 - 2 * (q.y * q.y + q.z * q.z), hz = 2 * (q.x * q.z - q.w * q.y);
        people.update(dt, cp.x, cp.z, car.sinking ? 0 : car.speed, Math.atan2(hz, hx));
      }

      // Police: chase, escape or caught.
      const pr = police.update(dt, car);
      if (pr === 'escaped') {
        const reward = 10 * police.stars;
        progress.coins += reward;
        save();
        sound.coin();
        police.clear(true);
        toast(t('escaped', { n: reward }), 2);
      } else if (pr === 'caught') {
        car.update(STOP, world.timestep);
        caught();
      }

      // Missions.
      const before = runner.active;
      const res = runner.update(dt, cp.x, cp.z);
      if (res === 'checkpoint') {
        sound.coin();
        refreshMarkers();
      } else if (res === 'complete' && before) {
        const reward = MISSION_SIZE[before.def.size].reward;
        progress.coins += reward;
        sound.coin();
        if (!progress.missionsDone.includes(before.def.id)) progress.missionsDone.push(before.def.id);
        save();
        toast(t('complete', { n: reward }), 2.5);
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

    // Sound: engine follows speed and throttle; the siren gets louder as police come closer.
    sound.updateEngine(car.speed / car.stats.maxSpeed, throttleNow, !paused && !car.sinking);
    {
      const pp = car.body.translation();
      let nearest = Infinity;
      for (const u of police.units) {
        const c = u.car.body.translation();
        nearest = Math.min(nearest, Math.hypot(c.x - pp.x, c.z - pp.z));
      }
      sound.updateSiren(paused ? Infinity : nearest);
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
    // Keep the camera out of bridges, tunnels and walls: below any ceiling over the car, and in
    // front of anything solid between the car and the camera (only static things count).
    {
      const head = { x: p.x, y: p.y + 1.2, z: p.z };
      const solid = (c: RAPIER.Collider) => c.shape.type !== RAPIER.ShapeType.Cylinder; // not trees, lamp posts, track posts
      const cast = (d: { x: number; y: number; z: number }, max: number) =>
        world.castRay(new RAPIER.Ray(head, d), max, true, RAPIER.QueryFilterFlags.ONLY_FIXED, undefined, undefined, undefined, solid);
      const up = cast({ x: 0, y: 1, z: 0 }, 6);
      if (up) camera.position.y = Math.min(camera.position.y, head.y + Math.max(0.3, up.timeOfImpact - 0.5));
      const dx = camera.position.x - head.x, dy = camera.position.y - head.y, dz = camera.position.z - head.z;
      const len = Math.hypot(dx, dy, dz);
      if (len > 0.5) {
        const hit = cast({ x: dx / len, y: dy / len, z: dz / len }, len);
        // Pull in at once when something is in the way; move back out smoothly.
        const want = hit ? Math.max(1.5, hit.timeOfImpact - 0.4) / len : 1;
        camPull = want < camPull ? want : Math.min(want, camPull + dt * 0.8);
        camera.position.set(head.x + dx * camPull, head.y + dy * camPull, head.z + dz * camPull);
      }
    }
    if (shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      camera.position.z += (Math.random() - 0.5) * shake;
      shake *= Math.exp(-dt * 5);
    }
    lookAt.set(p.x, p.y + 1, p.z).addScaledVector(fwd, 3);
    camera.lookAt(lookAt);
    crashFx.update(dt, camera);
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

    if (guide && !runner.active && Math.hypot(guide.where[0] - p.x, guide.where[1] - p.z) < 20) {
      guide = null; // arrived
      refreshMarkers();
    }
    const tg = runner.target ?? guide?.where ?? null;
    missionEl.classList.toggle('hidden', !runner.active);
    arrowEl.classList.toggle('hidden', !tg);
    if (tg) {
      if (runner.active) {
        missionTitleEl.textContent = runner.active.def.title[getLang()];
        missionTimerEl.textContent = fmtTime(runner.timeLeft);
        missionTimerEl.classList.toggle('low', runner.timeLeft < 15);
      }
      // Arrow relative to the camera's view direction.
      const cf = camera.getWorldDirection(tmp);
      const len = Math.hypot(cf.x, cf.z) || 1;
      const fx = cf.x / len, fz = cf.z / len;
      const vx = tg[0] - p.x, vz = tg[1] - p.z;
      const ang = Math.atan2(vx * -fz + vz * fx, vx * fx + vz * fz);
      needleEl.style.transform = `rotate(${ang}rad)`;
      arrowDistEl.textContent = `${Math.round(Math.hypot(vx, vz))} m`;
    }

    sky.position.copy(camera.position);
    frameNo++;
    if (frameNo % 2 === 0 || firstFrame) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    // Dynamic resolution: if frames are slow for a while, draw fewer pixels (and more again when fast).
    frameAvg = frameAvg * 0.95 + dt * 1000 * 0.05;
    if (now - lastResize > 2000) {
      const target = frameAvg > 30 ? Math.max(0.75, pixelRatio - 0.25) : frameAvg < 18 ? Math.min(Math.min(window.devicePixelRatio, 1.5), pixelRatio + 0.25) : pixelRatio;
      if (target !== pixelRatio) {
        pixelRatio = target;
        renderer.setPixelRatio(pixelRatio);
        lastResize = now;
      }
    }
    if (firstFrame) {
      mark('first frame');
      console.info('startup', marks.map(([n, t]) => `${n} ${t}ms`).join(' · '));
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
  if (qs.has('people')) {
    // ?people: a few people in front of the car (to check how they look).
    const c = car.body.translation();
    const q = car.body.rotation();
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
    for (let i = 0; i < 6; i++) people.placeAt(i % 2 ? 'cyclist' : 'walker', c.x + fx * (8 + i * 2) - fz * (i - 2.5) * 1.6, c.z + fz * (8 + i * 2) + fx * (i - 2.5) * 1.6, i * 1.1);
  }
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
  (window as unknown as { game: unknown }).game = { renderer, people, car: () => car, world, map, scene, camera, police, runner, progress, traffic, addBuilt };
}

start().catch((err) => {
  loadingEl.textContent = String(err);
  console.error(err);
});
