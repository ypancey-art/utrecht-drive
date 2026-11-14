import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { loadMap, nearestRoad, type MapData } from './game/mapData';
import { buildMapPhysics } from './game/mapPhysics';
import { Car } from './game/car';
import { Input } from './game/input';
import { buildMapMeshes } from './art/mapMeshes';
import { buildTrees, buildLamps } from './art/sceneryMeshes';
import { placeScenery } from './game/scenery';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { buildCarMesh } from './art/carMesh';
import { palette } from './art/palette';
import { t, getLang, setLang, onLangChange } from './i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loadingEl = $('loading');
const speedEl = $('speed-value');
const streetEl = $('street');
const hintEl = $('hint');
const langBtn = $<HTMLButtonElement>('lang');

function applyTexts() {
  loadingEl.textContent = t('loading');
  hintEl.textContent = t('hintKeys');
  langBtn.textContent = t('otherLang');
}
applyTexts();
onLangChange(applyTexts);
document.documentElement.lang = getLang();
langBtn.addEventListener('click', () => setLang(getLang() === 'nl' ? 'en' : 'nl'));

async function start() {
  const [, map] = await Promise.all([RAPIER.init(), loadMap()]);

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

  const scenery = placeScenery(map);
  scene.add(buildMapMeshes(map), buildTrees(scenery.trees), buildLamps(scenery.lamps));

  // --- Physics ---
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  buildMapPhysics(world, map, scenery.trees);

  const car = new Car(world);
  const carMesh = buildCarMesh();
  scene.add(carMesh.body, ...carMesh.wheels);

  const spawn = () => {
    const station = map.stations[0]?.p ?? [0, 0];
    const p = car.body.translation();
    const from = spawned ? [p.x, p.z] : station;
    const r = nearestRoad(map, from[0], from[1], (r) => r.drivable && r.kind !== 'service');
    car.place(r.x, r.z, r.dirX, r.dirZ);
  };
  let spawned = false;
  spawn();
  spawned = true;

  const input = new Input($('touch'));
  input.onReset = spawn;

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
  const quat = new THREE.Quaternion();
  const wheelQuat = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  let acc = 0;
  let last = performance.now();
  let flippedTime = 0;
  let streetTimer = 0;
  let firstFrame = true;

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    acc += dt;
    const controls = input.read();
    while (acc >= world.timestep) {
      car.update(controls, world.timestep);
      world.step();
      acc -= world.timestep;
    }

    // Auto-reset when the car stays flipped.
    flippedTime = car.flipped ? flippedTime + dt : 0;
    if (flippedTime > 2) {
      spawn();
      flippedTime = 0;
    }

    // Sync car meshes with physics.
    const p = car.body.translation();
    const r = car.body.rotation();
    quat.set(r.x, r.y, r.z, r.w);
    carMesh.body.position.set(p.x, p.y, p.z);
    carMesh.body.quaternion.copy(quat);
    carMesh.wheels.forEach((w, i) => {
      const s = car.wheelState(i);
      tmp.set(s.x, s.y, s.z).applyQuaternion(quat).add(carMesh.body.position);
      w.position.copy(tmp);
      wheelQuat.setFromEuler(new THREE.Euler(0, s.steering, 0));
      w.quaternion.copy(quat).multiply(wheelQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), s.rotation));
    });

    // Chase camera.
    fwd.set(1, 0, 0).applyQuaternion(quat);
    fwd.y = 0;
    fwd.normalize();
    const desired = tmp.set(p.x, p.y, p.z).addScaledVector(fwd, -9);
    desired.y = p.y + 4;
    if (firstFrame) camPos.copy(desired);
    camPos.lerp(desired, 1 - Math.exp(-dt * 4));
    camera.position.copy(camPos);
    lookAt.set(p.x, p.y + 1, p.z).addScaledVector(fwd, 3);
    camera.lookAt(lookAt);

    sun.position.set(p.x, 0, p.z).addScaledVector(SUN_DIR, 150);
    sky.position.copy(camera.position);
    sun.target.position.set(p.x, 0, p.z);

    // HUD.
    speedEl.textContent = String(Math.round(Math.abs(car.speed) * 3.6));
    streetTimer -= dt;
    if (streetTimer <= 0) {
      streetTimer = 0.5;
      const near = nearestRoad(map, p.x, p.z, (r) => !!r.name);
      streetEl.textContent = near.dist2 < 20 * 20 ? near.road!.name : '';
    }

    renderer.render(scene, camera);
    if (firstFrame) {
      loadingEl.classList.add('hidden');
      firstFrame = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for debugging in the browser console.
  (window as unknown as { game: unknown }).game = { car, world, map: map as MapData, scene, camera, scenery };
}

start().catch((err) => {
  loadingEl.textContent = String(err);
  console.error(err);
});
