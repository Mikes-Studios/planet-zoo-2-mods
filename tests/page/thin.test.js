import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cullPlan } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincull.js';
import { assessGrowUp } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinlife.js';
import { HIPPO, HIPPO_FACTS, Sex, animal, juvenile, zoo } from './zoo.js';

// hippos in groups of at most 4: a bull and seven cows are three over
const SMALL = { social: { min: 1, max: 4 } };
const INFO = { species: HIPPO, mating: 'polygyny', social: SMALL.social, fertilityAges: { maturity: 7, infertility: 40 } };
const FACTS = { [HIPPO]: Object.assign({}, HIPPO_FACTS, SMALL) };
// fertile, no gene rule applies
const FINE = { F: 'AAAAAABBBBBB', I: 'AAAAAABBBBBB', S: 'AAAAAAAAAAAA', L: 'AAAAAAAAAAAA' };

function herd(cows) {
    const list = [animal('Bull', Sex.Male, 'H1'), ...Array.from({ length: cows }, (_, i) => animal(`Cow${i + 1}`, Sex.Female, 'H1'))];
    for (const a of list) a.genes = FINE;
    return list;
}

test('Thin out: a habitat over its room is thinned', () => {
    assert.equal(cullPlan(zoo(herd(7), { facts: FACTS }), HIPPO, INFO).moves.length, 5);
});

test('Thin out: with overcrowding off no habitat is over its room', () => {
    const model = zoo(herd(7), { facts: FACTS });
    model.rules = { socialGroups: true, overcrowding: false };
    assert.deepEqual(cullPlan(model, HIPPO, INFO).moves, []);
});

test('Thin out: without the species info no habitat is thinned for room', () => {
    const r = cullPlan(zoo(herd(11)), HIPPO, {});
    assert.deepEqual(r.moves, []);
    assert.deepEqual(r.habitats.map(h => [h.room, h.target]), [[false, 12]]);
});

test('Thin out: a juvenile stays in its habitat, whatever its genes or the player\'s picks', () => {
    const barren = { F: 'aaaaaaaaaaaa', I: 'AAAAAABBBBBB', S: 'AAAAAAAAAAAA', L: 'AAAAAAAAAAAA' };
    const calf = juvenile('Calf', Sex.Female, 'H1');
    const cow = animal('Barren', Sex.Female, 'H1');
    calf.genes = barren;
    cow.genes = barren;
    const r = cullPlan(zoo([...herd(2), cow, calf], { facts: FACTS }), HIPPO, INFO, { options: { genes: 'best', cullIds: new Set(['Calf']) } });
    const sent = r.moves.map(m => m.id);
    assert.ok(sent.includes('Barren'), 'the adult with the same genes goes');
    assert.ok(!sent.includes('Calf'));
});

test('growing up: with overcrowding off a full group is no reason for a notice', () => {
    const model = zoo([...herd(3), juvenile('Calf', Sex.Female, 'H1')], { facts: FACTS });
    const calf = model.animals.get('Calf');
    assert.ok(assessGrowUp(model, calf).reasons.some(r => r.code === 'group'), 'the group of five is not over the game\'s four');
    model.rules = { socialGroups: true, overcrowding: false };
    assert.deepEqual(assessGrowUp(model, calf).reasons.map(r => r.code), []);
});
