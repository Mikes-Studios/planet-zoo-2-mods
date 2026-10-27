import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldPregnant, planProblems } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { Sex, TRADE, animal, zoo } from './zoo.js';

const pregnant = hab => Object.assign(animal('Mum', Sex.Female, hab), { preg: true });

test('a plan never moves a pregnant female out of her habitat, to another one or to the trade centre', () => {
    const mum = pregnant('H1');
    assert.equal(heldPregnant(mum, { id: 'Mum', to: 'H2' }), true);
    assert.equal(heldPregnant(mum, { id: 'Mum', to: TRADE }), true);
});

test('a pregnant female waiting at the trade centre goes into a habitat: the golden rule', () => {
    const mum = pregnant(TRADE);
    assert.equal(heldPregnant(mum, { id: 'Mum', to: 'H1' }), false);
    const model = zoo([mum, animal('Bull', Sex.Male, 'H1')]);
    assert.deepEqual(planProblems(model, [{ id: 'Mum', to: 'H1' }], null).filter(p => p.preg), []);
});

test('a move the player planned by hand always runs, with a warning', () => {
    const mum = pregnant('H1');
    assert.equal(heldPregnant(mum, { id: 'Mum', to: 'H2', byPlayer: true }), false);
    const problems = planProblems(zoo([mum, animal('Bull', Sex.Male, 'H2')]), [{ id: 'Mum', to: 'H2', byPlayer: true }], null);
    assert.ok(problems.some(p => p.preg && p.warn));
});
