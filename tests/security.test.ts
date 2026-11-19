import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean } from '../src/game/progress';
import { validNick } from '../src/game/nicknames';

test('damaged or hand-edited saves are repaired, never trusted', () => {
  for (const raw of [null, 'x', 42, [], { upgrades: null }, { owned: 'x' }, { coins: 'abc', points: -5, topSpeed: Infinity }, { grade: 'zzz', carId: 'hyper' }, { upgrades: { compact: { engine: 99, paint: -1 }, evil: {} } }]) {
    const p = clean(raw);
    assert.ok(p.owned.includes('compact'));
    assert.ok(p.owned.includes(p.carId), 'the current car is always owned');
    for (const n of [p.coins, p.points, p.topSpeed]) assert.ok(Number.isFinite(n) && n >= 0);
    assert.ok(p.grade === null || typeof p.grade === 'string');
    for (const [id, u] of Object.entries(p.upgrades)) {
      assert.notEqual(id, 'evil');
      for (const v of [u.engine, u.tires, u.armour]) assert.ok(v >= 0 && v <= 3);
    }
  }
  const good = clean({ grade: 'g5', coins: 120, carId: 'sport', owned: ['compact', 'sport'], upgrades: { sport: { engine: 2, tires: 1, armour: 0, paint: 3 } }, missionsDone: ['m1'], points: 50, topSpeed: 140, built: ['railLoop'] });
  assert.equal(good.carId, 'sport');
  assert.equal(good.coins, 120);
  assert.equal(good.upgrades.sport.engine, 2);
  assert.deepEqual(good.built, ['railLoop']);
});

test('only nicknames from the word lists are accepted (no free text)', () => {
  assert.ok(validNick([0, 0]));
  for (const bad of ['Bad words', [0], [0, 1, 2], [-1, 0], [0, 999], [0.5, 1], ['0', '1'], null, { 0: 0, 1: 0 }]) assert.equal(validNick(bad), false);
});
