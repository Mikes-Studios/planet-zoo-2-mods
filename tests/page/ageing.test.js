import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elderlyWarningText, nearingElderly } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinageing.js';
import { Sex, animal, zoo } from './zoo.js';

// animals.fdb: hippos turn elderly at 40 and are infertile from then on
test('a hippo within a year of 40 is warned about once', () => {
    const model = zoo([animal('Nearly', Sex.Female, 'H1', { age: 39.4 }), animal('Prime', Sex.Female, 'H1', { age: 20 }), animal('Old', Sex.Male, 'H1', { age: 41 })]);
    const warned = new Set();
    const due = nearingElderly(model, warned);
    assert.deepEqual(due.map(w => w.animal.name), ['Nearly']);
    assert.ok(due[0].infertile);
    assert.match(elderlyWarningText(due[0]), /about 7 months/);
    warned.add(due[0].animal.guid);
    assert.equal(nearingElderly(model, warned).length, 0);
});

test('no elderly warnings in a wildlife reserve', () => {
    const model = zoo([animal('Nearly', Sex.Female, 'H1', { age: 39.4 })]);
    model.reserve = true;
    assert.equal(nearingElderly(model, new Set()).length, 0);
});
