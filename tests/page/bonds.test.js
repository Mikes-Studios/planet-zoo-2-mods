import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { HIPPO, HIPPO_FACTS, Sex, animal } from './zoo.js';

// Bull is bonded to Mate (monogamy); his daughter lives with them. bond: what the bond pass said about her.
function family(bond) {
    const bull = animal('Bull', Sex.Male, 'H1');
    bull.bond = Object.assign({ mate: 'Mate', here: true }, bond);
    return buildKinModel({
        animals: [bull, animal('Mate', Sex.Female, 'H1'), animal('Daughter', Sex.Female, 'H1', { par: ['Bull', 'Mum'] })],
        habitats: [{ id: 'H1', name: 'H1', kind: 'habitat' }],
        speciesFacts: { [HIPPO]: HIPPO_FACTS },
        bondsOk: true,
    });
}
const severity = model => model.pairs.find(p => p.b.id === 'Daughter').severity;

test('bonds: a pair the game locks apart is held, one it does not is a risk', () => {
    assert.equal(severity(family({ lock: ['Daughter'] })), 'held');
    assert.equal(severity(family({ lock: [] })), 'risk');
});

test('bonds: a check that failed is unknown, held while the bond is whole', () => {
    assert.equal(severity(family({ lock: [], unk: ['Daughter'] })), 'held');
});
