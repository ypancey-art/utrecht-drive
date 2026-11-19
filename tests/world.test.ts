// The world must be drivable: streets through the railway, over bridges, and the ramps must work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameWorld, driveRamp, driveLoop, driveTrack } from './world';
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
  test(`every ramp works with the ${id}: water jumps land dry, roof ramps reach the roof, jumps land upright`, async () => {
    const w = await gameWorld();
    assert.ok((w.map.ramps ?? []).length >= 8, 'ramps missing from the map data');
    for (const r of w.map.ramps!) {
      if (r.kind === 'kick' && id !== 'compact') continue; // fast cars may fly over a kicker's roof
      const err = driveRamp(w, r, id);
      assert.equal(err, '', `${r.kind} ramp at ${r.x},${r.z}: ${err}`);
    }
  });
}

for (const id of ['compact', 'sport']) {
  test(`every loop takes the ${id} all the way round`, async () => {
    const w = await gameWorld();
    assert.ok((w.map.loops ?? []).length >= 3, 'loops missing from the map data');
    for (const l of w.map.loops!) {
      const err = driveLoop(w, l, id);
      assert.equal(err, '', `loop at ${l.x},${l.z}: ${err}`);
    }
  });
}


// Every track with two cars; they must stay on the track all the way and over every loop. The compact
// goes full throttle; the sport (46 m/s) lifts off and brakes before sharp bends, like a player would
// (at full throttle it is too fast for the tighter bends of the newer tracks).
for (const id of ['compact', 'sport']) {
  test(`every Hot Wheels track can be driven from start to end with the ${id}`, async () => {
    const w = await gameWorld();
    assert.ok((w.map.tracks ?? []).length >= 2, 'tracks missing from the map data');
    for (const t of w.map.tracks!) {
      const err = driveTrack(w, t, id, { strict: true, ease: id !== 'compact' });
      assert.equal(err, '', `${t.id} (${t.name}): ${err}`);
    }
  });
}
