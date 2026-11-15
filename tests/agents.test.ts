// Road users, police and missions, simulated without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameWorld } from './world';
import { RoadGraph } from '../src/game/roadGraph';
import { Traffic } from '../src/game/traffic';
import { People } from '../src/game/people';
import { Police, STAR_LEVELS } from '../src/game/police';
import { buildMissions } from '../src/game/missions';
import { Car } from '../src/game/car';
import { CARS, POLICE } from '../src/game/cars';

test('traffic drives on the streets', async () => {
  const { map, world, scenery } = await gameWorld();
  const player = new Car(world, CARS[0].stats, CARS[0].dims);
  player.place(300, 100, 1, 0);
  const traffic = new Traffic(world, new RoadGraph(map, true), CARS, () => ({ sync() {}, dispose() {} }), 10);
  let off = 0, samples = 0;
  const start = new Map<object, { x: number; z: number }>();
  for (let i = 0; i < 60 * 30; i++) {
    traffic.step(world.timestep, player, []);
    world.step();
    traffic.update(world.timestep, player, []);
    if (i % 60 === 0)
      for (const u of traffic.units) {
        const p = u.car.body.translation();
        if (!start.has(u)) start.set(u, { x: p.x, z: p.z });
        samples++;
        if (scenery.grid.edgeDistance(p.x, p.z) > 1.5) off++;
      }
  }
  assert.ok(traffic.units.length >= 8, `only ${traffic.units.length} cars`);
  assert.ok(off / samples < 0.03, `${off} of ${samples} samples off the road`);
  const moved = traffic.units.filter((u) => {
    const s = start.get(u), p = u.car.body.translation();
    return s && Math.hypot(p.x - s.x, p.z - s.z) > 50;
  });
  assert.ok(moved.length >= traffic.units.length / 2, 'most cars should have driven somewhere');
  traffic.units.forEach((u) => u.car.dispose());
  player.dispose();
});

test('pedestrians and cyclists appear and walk', async () => {
  const { map } = await gameWorld();
  const people = new People(
    new RoadGraph(map, false, (r) => !r.tunnel && ['footway', 'pedestrian', 'path'].includes(r.kind)),
    new RoadGraph(map, false, (r) => !r.tunnel && ['cycleway', 'residential', 'living_street'].includes(r.kind)),
    () => ({ sync() {}, dispose() {} }),
    30,
  );
  let hits = 0;
  people.onHit = () => hits++;
  for (let i = 0; i < 30 * 20; i++) people.update(1 / 30, 0, 0, 0, 0);
  assert.equal(people.list.length, 30);
  assert.ok(people.list.some((p) => p.kind === 'cyclist') && people.list.some((p) => p.kind === 'walker'));
  // Someone right in front of a fast car gets knocked over (and gets up again).
  const p = people.list[0];
  people.update(1 / 30, p.x, p.z, 10, 0);
  assert.equal(hits, 1);
  assert.ok(p.down > 0);
  for (let i = 0; i < 30 * 4; i++) people.update(1 / 30, p.x + 100, p.z, 0, 0);
  assert.equal(p.down <= 0, true, 'should be back on their feet');
});

test('police: chases start, grow, and come back stronger after an escape', async () => {
  const { map, world } = await gameWorld();
  const player = new Car(world, CARS[0].stats, CARS[0].dims);
  player.place(300, 100, 1, 0);
  const police = new Police(world, new RoadGraph(map), POLICE, () => ({ sync() {}, dispose() {} }));
  let reinforced = 0;
  police.onReinforce = () => reinforced++;
  police.startChase();
  assert.equal(police.stars, 1);
  police.update(0.1, player);
  assert.equal(police.units.length, 1, 'one car for one star');
  police.chaseTime = 26;
  police.update(0.1, player);
  assert.equal(police.stars, 2);
  assert.equal(reinforced, 1);
  police.update(0.1, player);
  assert.equal(police.units.length, 2);
  police.clear(true); // escaped
  assert.equal(police.stars, 0);
  assert.equal(police.heat, 1);
  police.startChase();
  police.update(0.1, player);
  assert.equal(police.units.length, 2, 'after an escape the next chase sends an extra car');
  // Crashes: enough damage gives a star on its own.
  police.clear();
  police.heat = 0;
  police.addCrash(STAR_LEVELS[0] - 1);
  assert.equal(police.stars, 0);
  police.addCrash(2);
  assert.equal(police.stars, 1);
  police.clear();
  player.dispose();
});

test('every mission can be driven: all stops are on connected streets', async () => {
  const { map } = await gameWorld();
  const graph = new RoadGraph(map);
  const missions = buildMissions(map);
  assert.equal(missions.length, 8, 'a mission was skipped');
  for (const m of missions) {
    let prev = graph.nearest(m.start[0], m.start[1]);
    for (const s of m.stops) {
      const next = graph.nearest(s[0], s[1]);
      assert.ok(graph.route(prev, next).length > 0, `${m.def.id}: no route to a stop`);
      prev = next;
    }
    assert.ok(m.timeLimit > 20, `${m.def.id}: time limit ${m.timeLimit}`);
  }
});
