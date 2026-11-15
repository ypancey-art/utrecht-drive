import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProblem, choices } from '../src/game/mathProblems';
import { GRADES } from '../src/game/progress';

test('every grade makes valid problems with 4 distinct choices that include the answer', () => {
  for (const grade of GRADES)
    for (const lang of ['nl', 'en'] as const)
      for (let i = 0; i < 600; i++) {
        const p = makeProblem(grade, lang);
        assert.ok(Number.isFinite(p.answer), `${grade}: answer not a number in "${p.q}"`);
        assert.ok(p.q.length > 0 && p.hint.length > 0, `${grade}: empty question or hint`);
        const c = choices(p);
        assert.equal(c.length, 4, `${grade}: ${c.length} choices for "${p.q}"`);
        assert.equal(new Set(c).size, 4, `${grade}: duplicate choices ${c} for "${p.q}"`);
        assert.ok(c.includes(p.answer), `${grade}: answer missing from choices for "${p.q}"`);
      }
});

test('a new problem "of the same kind" really is the same kind', () => {
  for (const grade of GRADES)
    for (let i = 0; i < 100; i++) {
      const p = makeProblem(grade, 'nl');
      assert.equal(makeProblem(grade, 'nl', p.type).type, p.type);
    }
});
