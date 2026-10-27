import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';
import { buildKinModel, Sex } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';

loadPages();
const { relatedBreedingPairs, storageRelatives } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinstorage.js');

// Stored animals as kin.js hands them over: the rows' name, sex and the
// game's maturity (0 infant, 2 adult, 3 elderly, 5 infertile, 6 elderly and infertile).
function storage(rows) {
    return buildKinModel({
        scope: 'storage',
        animals: rows.map(([id, sex, maturity, par = []]) => ({ id, key: id, guid: `g_${id}`, name: id, species: 'Lion', sex, juv: maturity === 0, maturity, par: par.map(p => `g_${p}`), hab: '' })),
    });
}

test('storage: an elderly infertile mother and her son are no inbreeding risk', () => {
    const model = storage([['Mum', Sex.Female, 6], ['Son', Sex.Male, 2, ['Mum']]]);
    assert.deepEqual(relatedBreedingPairs(model, ['Mum', 'Son']), []);
    assert.deepEqual(storageRelatives(model, 'Son').map(r => r.severity), ['covered']);
});

test('storage: a fertile mother and her adult son are a risk, with a calf a later one', () => {
    const model = storage([['Mum', Sex.Female, 3], ['Son', Sex.Male, 2, ['Mum']], ['Cub', Sex.Male, 0, ['Mum']]]);
    assert.deepEqual(relatedBreedingPairs(model, ['Mum', 'Son', 'Cub']).map(p => `${p.a.name}+${p.b.name}:${p.severity}`), ['Son+Mum:risk', 'Cub+Mum:future']);
});
