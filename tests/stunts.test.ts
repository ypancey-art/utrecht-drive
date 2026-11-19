// Stunt bonuses (src/game/stunts.ts): water/gap/double jumps, loop combos, near misses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { Stunts } from '../src/game/stunts';
import { Car } from '../src/game/car';
import { CARS } from '../src/game/cars';
import { t } from '../src/i18n';
import type { Ramp } from '../src/game/mapData';

const canal = { contains: (x: number) => x > 5 && x < 15 };
const land: Ramp = { x: 40, z: 0, yaw: Math.PI, len: 10, h: 1.6, w: 4, kind: 'land' };

test('jumps over water, onto a landing ramp and one after the other earn extra tricks', () => {
  const s = new Stunts(canal, [land]);
  const names = (l: { name: string }[]) => l.map((k) => k.name);
  assert.deepEqual(names(s.landed({ x: 0, z: 0 }, { x: 20, z: 0 }, 1.2)), [t('trickWater')]);
  assert.deepEqual(names(s.landed({ x: 25, z: 0 }, { x: 38, z: 1 }, 1)), [t('trickGap'), t('trickDouble')]);
  assert.deepEqual(names(s.landed({ x: 50, z: 0 }, { x: 70, z: 0 }, 1)), [t('trickTriple')]);
  // Landing in the water is no water jump.
  assert.ok(!names(new Stunts(canal, []).landed({ x: 0, z: 0 }, { x: 10, z: 0 }, 1)).includes(t('trickWater')));
});

test('loops in a row make a loop combo', () => {
  const s = new Stunts(canal, []);
  assert.equal(s.loop().key, 'stuntLoop');
  const e = s.loop();
  assert.equal(e.key, 'stuntCombo');
  assert.equal(e.list, t('trickLoops', { n: 2 }));
});

/** A flat world with the player driving fast past a parked car `gap` metres to its side. */
async function pass(gap: number) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0));
  const spec = CARS.find((c) => c.id === 'sport')!;
  const car = new Car(world, spec.stats, spec.dims), other = new Car(world, spec.stats, spec.dims);
  car.place(-60, 0, 1, 0);
  other.place(20, car.collider.halfExtents()!.z * 2 + gap, 1, 0);
  car.body.setLinvel({ x: 20, y: 0, z: 0 }, true);
  const s = new Stunts({ contains: () => false }, []);
  const keys: string[] = [];
  for (let i = 0; i < 60 * 6; i++) {
    car.update({ throttle: 1, steer: 0, handbrake: false }, world.timestep);
    other.update({ throttle: 0, steer: 0, handbrake: true }, world.timestep);
    world.step();
    for (const e of s.update(world.timestep, car, [other], world)) keys.push(e.key);
  }
  return keys;
}

test('passing a car very close at speed is a near miss, passing far away is not', async () => {
  assert.deepEqual(await pass(0.5), ['stuntNearMiss']);
  assert.deepEqual(await pass(3), []);
  assert.deepEqual(await pass(-0.3), [], 'scraping along the car is no near miss');
});
