import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';
import { Sex, animal, zoo } from './zoo.js';

loadPages();
const { makeupFixed, makeupShort, programmeHabitats, programmeKey, setRatioChoice } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/progprefs.js');
const { groupRule } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js');

const NYALA = { species: 'Antelope_Nyala', mating: 'polygyny' };
const AARDVARK = { species: 'Aardvark', mating: 'polygyny' };

test('the make-up reads the same on the board and in the window, leader species included', () => {
    assert.equal(makeupShort(groupRule(NYALA, 'auto')), 'leader ♂');
    assert.equal(makeupShort(groupRule({ species: 'Beaver_Eurasian', mating: 'monogamy' }, 'auto')), 'leader pair');
    assert.equal(makeupShort(groupRule(AARDVARK, '1:3')), '1♂ : 3♀');
});

test('a leader species has no make-up to choose, and the choice stays out of its plan key', () => {
    assert.ok(makeupFixed(groupRule(NYALA, '1:3')));
    assert.ok(!makeupFixed(groupRule(AARDVARK, '1:3')));
    const nyala = { species: 'Antelope_Nyala', step: 3, useTrade: true, info: NYALA };
    const aardvark = { species: 'Aardvark', step: 3, useTrade: true, info: AARDVARK };
    const before = [programmeKey(nyala), programmeKey(aardvark)];
    setRatioChoice('Antelope_Nyala', '1:3');
    setRatioChoice('Aardvark', '1:3');
    assert.equal(programmeKey(nyala), before[0]);
    assert.notEqual(programmeKey(aardvark), before[1]);
});

test('the game is asked about the species\' habitats, set-aside and suitable ones, never an exhibit', () => {
    const model = zoo([
        animal('Kito', Sex.Male, 'H1'),
        Object.assign(animal('Show', Sex.Female, 'X1'), { exhibit: true }),
    ]);
    const dest = { bySpecies: { [model.animals.get('Kito').species]: { H2: { ok: true }, H3: { ok: false } } } };
    const habs = programmeHabitats(model, model.animals.get('Kito').species, dest, new Map([['H4', new Set([model.animals.get('Kito').species])]]));
    assert.deepEqual(habs.sort(), ['H1', 'H2', 'H4']);
});
