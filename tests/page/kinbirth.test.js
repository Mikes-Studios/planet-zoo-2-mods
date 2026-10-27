import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERDUE_FACTOR, overdueMothers } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinbirthcore.js';
import { speciesRules } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/speciesrules.js';

const SPECIES = 'Giraffe_Reticulated';
const gestation = speciesRules(SPECIES).gestationYears;
const mother = (age, extra = {}) => Object.assign({ id: 'm', name: 'Tiffany Haddish', species: SPECIES, preg: true, lt: 'habitat', age }, extra);
const zoo = (...animals) => ({ animals: new Map(animals.map(a => [a.id, a])) });

test('a pregnancy past twice its length is overdue; one on time is not', () => {
    assert.ok(gestation > 0, 'the game gives giraffes a pregnancy length');
    const started = new Map();
    assert.deepEqual(overdueMothers(zoo(mother(10)), started), [], 'first seen: it starts now');
    assert.deepEqual(overdueMothers(zoo(mother(10 + gestation * 1.5)), started), [], 'late, not stalled');
    assert.deepEqual(overdueMothers(zoo(mother(10 + gestation * OVERDUE_FACTOR + 0.01)), started).map(a => a.id), ['m']);
});

test('a birth ends the count, and the next pregnancy starts its own', () => {
    const started = new Map();
    overdueMothers(zoo(mother(10)), started);
    overdueMothers(zoo(mother(12, { preg: false })), started);
    assert.equal(started.has('m'), false);
    assert.deepEqual(overdueMothers(zoo(mother(12 + gestation * OVERDUE_FACTOR - 0.1)), started), [], 'counted from this pregnancy');
});

test('only a mother in her habitat counts: not an exhibit animal, one at the trade centre or one being moved', () => {
    const started = new Map([['m', 0]]);
    for (const extra of [{ exhibit: true }, { lt: 'trade' }, { moving: true }]) {
        assert.deepEqual(overdueMothers(zoo(mother(20, extra)), new Map(started)), []);
    }
});
