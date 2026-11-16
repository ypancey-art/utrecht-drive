// The world must be drivable: streets through the railway, over bridges, and the ramps must work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameWorld } from './world';
import { Car } from '../src/game/car';
import { loopEntry } from '../src/game/loops';
import { CARS } from '../src/game/cars';
import { WaterMap } from '../src/game/water';

test('no static obstacle blocks a street (railway dyke, bridges, railings, hedges)', async () => {
  const { RAPIER, map, world } = await gameWorld();
  const blocked: string[] = [];
  for (const r of map.roads) {
    if (!r.drivable || r.tunnel) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      if ([ax, az, bx, bz].some((v) => Math.abs(v) > 740)) continue; // the map edge wall
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const hit = world.castRay(new RAPIER.Ray({ x: ax, y: 0.6, z: az }, { x: ux, y: 0, z: uz }), len, true);
      if (hit) {
        blocked.push(`${r.name || r.kind} at ${(ax + ux * hit.timeOfImpact).toFixed(0)},${(az + uz * hit.timeOfImpact).toFixed(0)}`);
      }
    }
  }
  assert.deepEqual(blocked, []);
});

test('the water lookup agrees with a brute-force check', async () => {
  const { map } = await gameWorld();
  const water = new WaterMap(map);
  const pip = (x: number, z: number, pts: [number, number][]) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      if (pts[i][1] > z !== pts[j][1] > z && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
    return c;
  };
  const brute = (x: number, z: number) =>
    map.water.some((w) => pip(x, z, w.pts)) ||
    map.waterways.some((w) => w.pts.slice(1).some((b, i) => {
      const a = w.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l));
      return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < w.width / 2;
    }));
  let wet = 0;
  for (let i = 0; i < 20000; i++) {
    const x = (Math.random() - 0.5) * 1500, z = (Math.random() - 0.5) * 1500;
    const b = brute(x, z);
    if (b) wet++;
    assert.equal(water.contains(x, z), b, `disagree at ${x.toFixed(1)},${z.toFixed(1)}`);
  }
  assert.ok(wet > 100, 'expected some water in the sample');
});

for (const id of ['compact', 'sport']) {
  test(`every ramp works with the ${id}: water jumps land dry, roof ramps reach the roof`, async () => {
    const { map, world, water, scenery } = await gameWorld();
    const spec = CARS.find((c) => c.id === id)!;
    assert.ok((map.ramps ?? []).length >= 8, 'ramps missing from the map data');
    for (const r of map.ramps!) {
      if (r.kind === 'kick' && id !== 'compact') continue; // fast cars may fly over a kicker's roof
      const ux = Math.cos(r.yaw), uz = Math.sin(r.yaw);
      const car = new Car(world, spec.stats, spec.dims);
      // Start where place-ramps.ts guarantees a free run-up for this kind of ramp.
      const run = r.len / 2 + (r.kind === 'water' ? 38 : r.kind === 'kick' ? 36 : r.kind === 'rail' ? 36 : 26);
      car.place(r.x - ux * run, r.z - uz * run, ux, uz, r.y ?? 0);
      let sank = false, maxY = 0, landed = false;
      for (let i = 0; i < 60 * 9; i++) {
        const p = car.body.translation(), q = car.body.rotation();
        const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
        // On the narrow railway dyke: also keep to the line of the ramp.
        const side = r.kind === 'rail' ? (p.x - r.x) * -uz + (p.z - r.z) * ux : 0;
        const ang = Math.atan2(fx * uz - fz * ux, fx * ux + fz * uz) - side * 0.15;
        car.update({ throttle: 1, steer: Math.max(-1, Math.min(1, ang * 3)), handbrake: false }, world.timestep);
        world.step();
        maxY = Math.max(maxY, p.y);
        if (r.kind === 'kick' && car.grounded && !car.flipped && p.y > r.roofH! + 0.3) {
          landed = true;
          break;
        }
        if (p.y < 1.2 && water.contains(p.x, p.z) && scenery.grid.edgeDistance(p.x, p.z) > 0.3) {
          sank = true;
          break;
        }
        if ((p.x - r.x) * ux + (p.z - r.z) * uz > r.len / 2 + (r.kind === 'roof' ? 12 : r.kind === 'kick' ? 60 : r.kind === 'rail' ? 90 : 30) && (r.kind !== 'rail' || car.grounded)) break;
      }
      const where = `${r.kind} ramp at ${r.x},${r.z}`;
      assert.ok(!sank, `${where}: the car sank`);
      assert.ok(!car.flipped, `${where}: the car flipped`);
      if (r.kind === 'kick') assert.ok(landed, `${where}: did not land on the roof`);
      else if (r.kind === 'roof') assert.ok(car.body.translation().y > r.h, `${where}: did not get onto the roof (y ${car.body.translation().y.toFixed(1)})`);
      else if (r.kind === 'rail') assert.ok(maxY > r.y! + 2.5 && car.body.translation().y > r.y! - 0.5, `${where}: no jump, or fell off the railway (y ${car.body.translation().y.toFixed(1)})`);
      else assert.ok(maxY > 2.5, `${where}: no real jump`);
      car.dispose();
    }
  });
}

for (const id of ['compact', 'sport']) {
  test(`every loop takes the ${id} all the way round`, async () => {
    const { map, world } = await gameWorld();
    const spec = CARS.find((c) => c.id === id)!;
    assert.ok((map.loops ?? []).length >= 3, 'loops missing from the map data');
    for (const l of map.loops!) {
      const e = loopEntry(l);
      const car = new Car(world, spec.stats, spec.dims);
      car.place(e.x - e.dirX * 45, e.z - e.dirZ * 45, e.dirX, e.dirZ);
      let maxY = 0, out = false;
      for (let i = 0; i < 60 * 14; i++) {
        car.update({ throttle: 1, steer: 0, handbrake: false }, world.timestep);
        world.step();
        const p = car.body.translation();
        maxY = Math.max(maxY, p.y);
        const along = (p.x - l.x) * e.dirX + (p.z - l.z) * e.dirZ;
        if (maxY > l.r * 2 - 1 && along > 14 && p.y < 1.5) {
          out = true;
          break;
        }
      }
      const where = `loop at ${l.x},${l.z}`;
      assert.ok(maxY > l.r * 2 - 1, `${where}: did not reach the top (max ${maxY.toFixed(1)} m)`);
      assert.ok(out && !car.flipped, `${where}: did not come out on its wheels`);
      car.dispose();
    }
  });
}

test('every Hot Wheels track can be driven from start to end with the compact', async () => {
  const { map, world } = await gameWorld();
  const spec = CARS.find((c) => c.id === 'compact')!;
  assert.ok((map.tracks ?? []).length >= 2, 'tracks missing from the map data');
  for (const t of map.tracks!) {
    const paths = t.parts.filter((p) => p.kind === 'path').map((p) => (p as { pts: [number, number, number][] }).pts);
    const loop = (t.parts.find((p) => p.kind === 'loop') as { loop: { x: number; z: number; y?: number; r: number } }).loop;
    const all = paths.flat();
    const [sx, , sz] = all[0], [nx, , nz] = all[2], l = Math.hypot(nx - sx, nz - sz);
    const car = new Car(world, spec.stats, spec.dims);
    // Tracks on the railway start and end on the dyke (y = the track bed).
    const base = t.free ? all[0][1] : 0;
    car.place(sx - ((nx - sx) / l) * 10, sz - ((nz - sz) / l) * 10, (nx - sx) / l, (nz - sz) / l, base);
    const end = all[all.length - 1];
    let top = 0, reached = false;
    for (let i = 0; i < 60 * 40 && !reached; i++) {
      const p = car.body.translation(), q = car.body.rotation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      let best = 0, bd = Infinity;
      for (let k = 0; k < all.length; k++) {
        const d = (all[k][0] - p.x) ** 2 + (all[k][2] - p.z) ** 2 + (all[k][1] - p.y) ** 2;
        if (d < bd) (bd = d), (best = k);
      }
      const tg = all[Math.min(all.length - 1, best + 3)];
      const fx = 1 - 2 * (q.y * q.y + q.z * q.z), fz = 2 * (q.x * q.z - q.w * q.y);
      const ang = Math.atan2(fx * (tg[2] - p.z) - fz * (tg[0] - p.x), fx * (tg[0] - p.x) + fz * (tg[2] - p.z));
      const inLoop = Math.hypot(p.x - loop.x, p.z - loop.z) < 20 && p.y > (loop.y ?? 0) - 1;
      car.update({ throttle: 1, steer: inLoop || upY < 0.7 ? 0 : Math.max(-1, Math.min(1, ang * 2)), handbrake: false }, world.timestep);
      world.step();
      if (inLoop) top = Math.max(top, p.y);
      if (Math.hypot(p.x - end[0], p.z - end[2]) < 8 && p.y < base + 2.5) reached = true;
    }
    assert.ok(top > (loop.y ?? 0) + loop.r * 2 - 1.5, `${t.id}: did not get over the top of its loop (${top.toFixed(1)} m)`);
    assert.ok(reached && !car.flipped, `${t.id} (${t.name}): did not reach the end`);
    car.dispose();
  }
});
