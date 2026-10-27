import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLifeState, lifeEvents } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinlife.js';

// One animal's scan, in the shape lifeEvents reads.
function scan(a) {
    const kid = Object.assign({ id: '1', guid: 'g1', name: 'Kid', species: 'S', sex: 1, hab: 'H1' }, a);
    return { animals: new Map([['1', kid]]), groups: new Map([['H1', new Map([['S', [kid]]])]]), speciesFacts: {}, byAnimal: new Map() };
}

test('growing up and becoming able to breed are told apart', () => {
    const state = createLifeState();
    const young = scan({ juv: true, age: 3.5, adultIn: 0.3, fert: { state: 'juvenile', yearsToMature: 0.5 } });
    const grown = scan({ juv: false, age: 3.8, infertile: true, fert: { state: 'young', yearsToMature: 0.2 } });
    const fertile = scan({ juv: false, age: 4.1, fert: { state: 'fertile' } });
    const kinds = (prev, next, now) => lifeEvents(prev, next, { state, now }).map(e => e.kind).sort();
    assert.deepEqual(kinds(null, young, 1), ['soon']);
    assert.deepEqual(kinds(young, grown, 2), ['adult', 'soon'], 'grown up, and able to breed soon');
    assert.deepEqual(kinds(grown, fertile, 3), ['adult'], 'able to breed now');
});
