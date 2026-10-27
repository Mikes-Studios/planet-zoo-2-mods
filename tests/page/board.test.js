import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY, noOtherHabitat, placeName, suggestPlan } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { visibleCounts, worstOf } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinplannercore.js';
import { KEEP_REASONS, cullPlan } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincull.js';
import { HIPPO, HIPPO_INFO, Sex, TRADE, animal, zoo } from './zoo.js';

const moves = plan => plan.map(m => `${m.id}>${m.to}`);

function family({ pregnantDaughter = false } = {}) {
    const daughter = animal('F2', Sex.Female, 'H1', { par: ['M1', 'F1'], age: 9 });
    if (pregnantDaughter) daughter.preg = true;
    return zoo([animal('M1', Sex.Male, 'H1'), animal('F1', Sex.Female, 'H1'), daughter], { habitats: ['H1', 'H2'] });
}
const OPEN = { bySpecies: { [HIPPO]: { H1: { ok: true }, H2: { ok: true } } }, habitats: [{ id: 'H1', name: 'H1' }, { id: 'H2', name: 'H2' }] };

test('Suggest fixes moves the daughter, not the father who is the habitat\'s only breeding male', () => {
    assert.deepEqual(moves(suggestPlan(family(), HIPPO, OPEN)), ['F2>H2']);
});

// five unrelated founder pairs in one habitat, each with a grown son and daughter;
// an assigned habitat beside it holds one unrelated female
test('Suggest fixes parts relatives in a crowded group: each move costs one breeder there, not every pair it could make', () => {
    const herd = [];
    for (let i = 0; i < 5; i++) {
        herd.push(animal(`Sire${i}`, Sex.Male, 'H1'), animal(`Dam${i}`, Sex.Female, 'H1'));
        herd.push(animal(`Son${i}`, Sex.Male, 'H1', { par: [`Sire${i}`, `Dam${i}`], age: 9 }), animal(`Daughter${i}`, Sex.Female, 'H1', { par: [`Sire${i}`, `Dam${i}`], age: 9 }));
    }
    herd.push(animal('Lone', Sex.Female, 'H2'));
    const plan = suggestPlan(zoo(herd, { habitats: ['H1', 'H2'] }), HIPPO, OPEN, { assignments: { H2: [HIPPO] } });
    assert.ok(plan.length >= 1, 'a related pair is parted');
    assert.ok(plan.every(m => m.to === 'H2'), moves(plan).join(' '));
});

test('Suggest fixes never takes a habitat\'s last breeding pair away to fix a risk', () => {
    assert.deepEqual(suggestPlan(family({ pregnantDaughter: true }), HIPPO, OPEN), []);
});

test('a place has one name everywhere: the model\'s, the destination check\'s, the scan\'s list', () => {
    const model = zoo([animal('M1', Sex.Male, 'H1')]);
    model.snapshot.habs = [{ id: 'H3', name: 'Empty Plain' }];
    const dest = { habitats: [{ id: 'H2', name: 'New Plain' }], tradeCentre: { id: 'T', name: 'Trading Post' } };
    assert.deepEqual(['H1', 'H2', 'H3', 'H4', TRADE, AWAY, ''].map(to => placeName(model, to, dest)),
        ['H1', 'New Plain', 'Empty Plain', 'Habitat H4', 'Trading Post', 'Elsewhere', '']);
    assert.equal(placeName(model, TRADE, null), 'Trade centre');
});

test('"no other habitat suits it" only when no ok habitat other than the species\' own is left', () => {
    const ok = { ok: true }, no = { ok: false };
    assert.equal(noOtherHabitat({ H1: ok }, new Set(['H1'])), true);
    assert.equal(noOtherHabitat({ H1: ok, H2: no }, new Set(['H1'])), true);
    assert.equal(noOtherHabitat({}, new Set()), true);
    assert.equal(noOtherHabitat({ H2: ok }, new Set()), false);
    assert.equal(noOtherHabitat({ H1: no, H2: ok }, new Set(['H1'])), false);
    assert.equal(noOtherHabitat({ H1: ok }, new Set(['H1', 'H3'])), false);
});

test('with Covered pairs off, only-covered counts have no worst severity (no empty kin line)', () => {
    const counts = { risk: 0, kin: 0, future: 0, held: 0, covered: 2 };
    assert.equal(worstOf(visibleCounts(counts, false)), null);
    assert.equal(worstOf(visibleCounts(counts, true)), 'covered');
    assert.equal(worstOf(visibleCounts({ held: 1, covered: 1 }, false)), 'held');
});

test('Thin out says why an animal stays by a code, with its words beside it', () => {
    const preg = animal('Mum', Sex.Female, 'H1');
    preg.preg = true;
    const model = zoo([animal('M1', Sex.Male, 'H1'), preg, animal('F2', Sex.Female, 'H1'), animal('F3', Sex.Female, 'H1')]);
    const r = cullPlan(model, HIPPO, HIPPO_INFO, { options: { keepIds: new Set(['F3']) } });
    const keep = new Map(r.habitats[0].keep.map(k => [k.id, k]));
    assert.equal(keep.get('Mum').whyCode, 'pregnant');
    assert.equal(keep.get('F3').whyCode, 'mine');
    for (const k of keep.values()) assert.equal(k.why, k.whyCode ? KEEP_REASONS[k.whyCode] : '');
});

test('Suggest fixes never sends an animal to an assigned habitat the game\'s check did not list', () => {
    const model = zoo([
        animal('M0', Sex.Male, 'H9'),
        animal('F0', Sex.Female, 'H9'),
        animal('M1', Sex.Male, 'H1', { age: 20 }),
        animal('F1', Sex.Female, 'H1', { par: ['M1', 'F0'] }),
        animal('F3', Sex.Female, 'H3'),
    ], { habitats: ['H1', 'H3', 'H9'] });
    const dest = { bySpecies: { [HIPPO]: { H1: { ok: true }, H9: { ok: true } } }, habitats: [{ id: 'H1', name: 'H1' }, { id: 'H9', name: 'H9' }] };
    const plan = suggestPlan(model, HIPPO, dest, { assignments: { H1: [HIPPO], H3: [HIPPO] } });
    assert.ok(!plan.some(m => m.to === 'H3'), moves(plan).join(', '));
});
