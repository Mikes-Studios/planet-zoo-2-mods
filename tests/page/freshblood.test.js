import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshBloodNeeds } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinbloodline.js';
import { bestFreshBlood } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { normalizeStored } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { HIPPO, Sex, animal, juvenile, strands, zoo } from './zoo.js';

// one bull's herd: his daughter has no unrelated male; his son has the unrelated cow
function herd(extra = []) {
    const list = [
        animal('Bull', Sex.Male, 'H1'),
        animal('Cow1', Sex.Female, 'H1'),
        animal('Cow2', Sex.Female, 'H1'),
        juvenile('Daughter', Sex.Female, 'H1', { par: ['Bull', 'Cow1'] }),
        juvenile('Son', Sex.Male, 'H1', { par: ['Bull', 'Cow2'] }),
        ...extra,
    ];
    for (const a of list) a.genes = strands(5);
    return list;
}

const shape = needs => needs.map(n => `${n.sex}:${n.calves.map(c => c.id).join(',')}`);

test('a calf related to every animal of the other sex asks for fresh blood', () => {
    assert.deepEqual(shape(freshBloodNeeds(zoo(herd()), HIPPO)), [`${Sex.Male}:Daughter`]);
});

test('an unrelated bull anywhere in the zoo is enough', () => {
    assert.deepEqual(freshBloodNeeds(zoo(herd([animal('Other', Sex.Male, 'H2')])), HIPPO), []);
});

test('a bull the plan would not breed (weak calves) is no partner', () => {
    const model = zoo(herd([animal('Poor', Sex.Male, 'H2')]));
    model.animals.get('Poor').genes = strands(0);
    assert.deepEqual(shape(freshBloodNeeds(model, HIPPO)), [`${Sex.Male}:Daughter`]);
});

test('grown animals are not asked for: only calves still growing up', () => {
    const model = zoo(herd());
    for (const id of ['Daughter', 'Son']) model.animals.delete(id);
    model.animals.set('Grown', Object.assign(animal('Grown', Sex.Female, 'H1', { par: ['Bull', 'Cow1'] }), { genes: strands(5) }));
    assert.deepEqual(freshBloodNeeds(model, HIPPO), []);
});

function stored(list) {
    return normalizeStored({
        species: HIPPO,
        animals: list.map(x => ({ guid: `g_${x.name}`, name: x.name, sex: x.sex, maturity: 2, forSale: !!x.forSale, par: (x.par || []).map(p => `g_${p}`), genes: x.genes })),
    });
}

test('the stored pick: unrelated, not listed, not weak, best calves with the calves waiting', () => {
    const model = zoo(herd());
    const need = freshBloodNeeds(model, HIPPO)[0];
    const pick = bestFreshBlood(model, HIPPO, stored([
        { name: 'Brother', sex: Sex.Male, genes: strands(6), par: ['Bull'] },
        { name: 'Listed', sex: Sex.Male, genes: strands(6), forSale: true },
        { name: 'Poor', sex: Sex.Male, genes: strands(0) },
        { name: 'Fair', sex: Sex.Male, genes: strands(4) },
        { name: 'Good', sex: Sex.Male, genes: strands(6) },
        { name: 'Cow', sex: Sex.Female, genes: strands(6) },
    ]), need);
    assert.equal(pick.name, 'Good');
});

test('no stored animal fits: the pick is null, so the notice points to the market', () => {
    const model = zoo(herd());
    const need = freshBloodNeeds(model, HIPPO)[0];
    assert.equal(bestFreshBlood(model, HIPPO, stored([{ name: 'Brother', sex: Sex.Male, genes: strands(6), par: ['Bull'] }]), need), null);
});
