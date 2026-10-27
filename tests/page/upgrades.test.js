import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageUpgrades } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { normalizeStored } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { HIPPO, Sex, animal, strands, zoo } from './zoo.js';

function stored(list) {
    return normalizeStored({
        species: HIPPO,
        animals: list.map(x => ({ guid: `g_${x.name}`, name: x.name, sex: x.sex, maturity: x.maturity ?? 2, forSale: !!x.forSale, par: (x.par || []).map(p => `g_${p}`), genes: x.genes })),
    });
}

function park() {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'),
        animal('Weak', Sex.Female, 'H1'),
        animal('Good', Sex.Female, 'H1'),
    ]);
    model.animals.get('Weak').genes = strands(1);
    model.animals.get('Good').genes = strands(5);
    model.animals.get('Bull').genes = strands(4);
    return model;
}

const assignments = new Map([['H1', new Set([HIPPO])]]);

test('a stored adult well above the weakest of its sex, unrelated to the other sex there, is offered', () => {
    const up = storageUpgrades(park(), HIPPO, stored([{ name: 'Zola', sex: Sex.Female, genes: strands(6) }]), { assignments });
    assert.equal(up.length, 1);
    assert.equal(up[0].name, 'Zola');
    assert.equal(up[0].hab, 'H1');
    assert.equal(up[0].replaces, 'Weak');
});

test('related, barely better or young stored animals are not offered', () => {
    const up = storageUpgrades(park(), HIPPO, stored([
        { name: 'Daughter', sex: Sex.Female, genes: strands(6), par: ['Bull'] },
        { name: 'Close', sex: Sex.Female, genes: strands(1) },
        { name: 'Calf', sex: Sex.Female, genes: strands(6), maturity: 0 },
    ]), { assignments });
    assert.deepEqual(up, []);
});

test('a listed stored adult worth having is offered, marked for Bring from storage to cancel its listing', () => {
    const up = storageUpgrades(park(), HIPPO, stored([{ name: 'Listed', sex: Sex.Female, genes: strands(6), forSale: true }]), { assignments });
    assert.deepEqual(up.map(u => [u.name, u.listed]), [['Listed', true]]);
});

test('each stored animal and each replaced animal is used once, the biggest gain first', () => {
    const up = storageUpgrades(park(), HIPPO, stored([
        { name: 'Best', sex: Sex.Female, genes: strands(6) },
        { name: 'Second', sex: Sex.Female, genes: strands(5) },
    ]), { assignments });
    assert.deepEqual(up.map(u => `${u.name}>${u.replaces}`), ['Best>Weak']);
});

test('a missing partner is filled from storage with the best unrelated one, never the weak ones', async () => {
    const { bestForNeeds } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const model = zoo([animal('Bull', Sex.Male, 'H1')]);
    const s = stored([
        { name: 'Weak', sex: Sex.Female, genes: strands(1) },
        { name: 'Best', sex: Sex.Female, genes: strands(6) },
        { name: 'Daughter', sex: Sex.Female, genes: strands(6), par: ['Bull'] },
        { name: 'Male', sex: Sex.Male, genes: strands(5) },
        { name: 'Brother', sex: Sex.Male, genes: strands(6), par: ['Mum2'] },
        { name: 'Sister', sex: Sex.Female, genes: strands(6), par: ['Mum2'] },
    ]);
    const picks = bestForNeeds(model, HIPPO, s, [{ hab: 'H1', sex: Sex.Female }, { hab: 'H2', sex: 'pair' }]).map(p => p.map(x => x.guid));
    assert.deepEqual(picks[0], ['g_Best']);
    assert.equal(picks[1].length, 2);
    assert.ok(!(picks[1].includes('g_Brother') && picks[1].includes('g_Sister')), 'a related pair is never chosen');
    assert.ok(!picks[1].includes('g_Best'), 'one stored animal fills one need');
});

test("a missing partner is the stored one with the best calves with the habitat's male, not the best genes of her own", async () => {
    const { bestForNeeds } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const model = zoo([animal('Bull', Sex.Male, 'H1')]);
    const same = 'A'.repeat(12);
    model.animals.get('Bull').genes = { F: same, I: same, S: same, L: same };
    const s = stored([
        { name: 'Showy', sex: Sex.Female, genes: { F: 'AAAAAAaaaaaa', I: 'AAAAAAaaaaaa', S: same, L: same } },
        { name: 'Match', sex: Sex.Female, genes: { F: 'AAAAAAaaaaaa', I: 'a'.repeat(12), S: same, L: same } },
    ]);
    const [pick] = bestForNeeds(model, HIPPO, s, [{ hab: 'H1', sex: Sex.Female }]);
    assert.equal(pick[0].guid, 'g_Match');
    assert.equal(pick[0].young, 88);
});

test('the market dims listings well below your best breeder of the sex wanted', async () => {
    const { marketDimFor } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const model = park();
    assert.equal(marketDimFor(model, HIPPO, Sex.Female), 83 - 15, 'best female Good scores 83');
    assert.equal(marketDimFor(model, HIPPO, Sex.Male), 67 - 15, 'best male Bull scores 67');
    assert.equal(marketDimFor(model, HIPPO, 'pair'), 67 - 15, 'a pair: the lower of the two');
    assert.equal(marketDimFor(zoo([animal('Bull', Sex.Male, 'H1')]), HIPPO, Sex.Female), null, 'no female to compare with');
});

test('a stored male is offered when his calves would clearly beat the current male\'s, and the others say why not', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow1', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1')]);
    model.animals.get('Bull').genes = strands(1);
    model.animals.get('Cow1').genes = strands(6);
    model.animals.get('Cow2').genes = strands(6);
    const skipped = [];
    const up = storageUpgrades(model, HIPPO, stored([
        { name: 'Stud', sex: Sex.Male, genes: strands(6) },
        { name: 'Son', sex: Sex.Male, genes: strands(6), par: ['Cow1'] },
        { name: 'Same', sex: Sex.Male, genes: strands(1) },
    ]), { assignments, onSkip: (s, why) => skipped.push(`${s.name}: ${why}`) });
    assert.deepEqual(up.map(u => `${u.name}>${u.replaces}`), ['Stud>Bull']);
    assert.ok(up[0].young > up[0].replacesYoung);
    assert.ok(skipped.some(t => t.startsWith('Son: related')), skipped.join(' | '));
    assert.ok(skipped.some(t => t.startsWith('Same:')), skipped.join(' | '));
});

test('a stored adult that is the park\'s own animal (same name, sex and genes) is left out', async () => {
    const { withoutParkAnimals } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const model = park();
    const s = stored([
        { name: 'Good', sex: Sex.Female, genes: strands(5) },
        { name: 'Good', sex: Sex.Female, genes: strands(2) },
    ]);
    const left = withoutParkAnimals(model, HIPPO, s);
    assert.deepEqual(left.animals.map(a => a.genes.S), [strands(2).S], 'the park\'s Good is not stored; the other Good is');
});

test('a male need\'s Market gets the habitat\'s females and the weakest male\'s calves as the floor', async () => {
    const { marketMatesFor } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const model = zoo([animal('Cow1', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1'), animal('Cow3', Sex.Female, 'H2'),
        animal('Bull', Sex.Male, 'H2'), animal('Runt', Sex.Male, 'H2')]);
    model.animals.get('Cow1').genes = strands(6);
    model.animals.get('Cow2').genes = strands(3);
    model.animals.get('Cow3').genes = strands(6);
    model.animals.get('Bull').genes = strands(6);
    model.animals.get('Runt').genes = strands(1);
    const m = marketMatesFor(model, HIPPO, { hab: 'H1', sex: Sex.Male });
    assert.equal(m.mates.length, 2, 'Cow1 and Cow2, not Cow3 in H2');
    const { bestOffspringScore } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js');
    assert.equal(m.floor, bestOffspringScore(strands(1), [strands(6), strands(3), strands(6)]), 'Runt\'s best calves');
    assert.equal(marketMatesFor(model, HIPPO, { hab: 'H3', sex: Sex.Male }), null, 'no mate there');
    assert.equal(marketMatesFor(model, HIPPO, { hab: 'H1', sex: 'pair' }), null);
});

// the programme asked which stored adults it would bring in (storageTrial, storageAdditions)
async function additions(model, s, info = {}) {
    const { storageAdditions, storageTrial } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const { planProgramme } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js');
    const trial = storageTrial(model, HIPPO, s);
    if (!trial) return [];
    return storageAdditions(trial, planProgramme(trial.model, HIPPO, info, null, { assignments, options: { pinIds: trial.pinIds } }));
}

test('stored females of the standard join the male of a harem as extra females, best young first', async () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    model.animals.get('Bull').genes = strands(5);
    model.animals.get('Cow').genes = strands(5);
    const add = await additions(model, stored([
        { name: 'Good', sex: Sex.Female, genes: strands(5) },
        { name: 'Best', sex: Sex.Female, genes: strands(6) },
    ]));
    assert.deepEqual(add.map(a => `${a.name}>${a.hab}`), ['Best>H1', 'Good>H1']);
    assert.ok(add.every(a => a.young > 0));
});

test('a weak, related or young stored female is never brought in', async () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    model.animals.get('Bull').genes = strands(5);
    model.animals.get('Cow').genes = strands(5);
    const add = await additions(model, stored([
        { name: 'Weak', sex: Sex.Female, genes: strands(1) },
        { name: 'Daughter', sex: Sex.Female, genes: strands(6), par: ['Bull'] },
        { name: 'Calf', sex: Sex.Female, genes: strands(6), maturity: 0 },
    ]));
    assert.deepEqual(add, []);
});

test('a listed stored female of the standard is brought in too, marked listed', async () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    model.animals.get('Bull').genes = strands(5);
    model.animals.get('Cow').genes = strands(5);
    const add = await additions(model, stored([{ name: 'Listed', sex: Sex.Female, genes: strands(6), forSale: true }]));
    assert.deepEqual(add.map(a => [a.name, a.listed]), [['Listed', true]]);
});

test('no park animal moves to make room for a stored one', async () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    const { storageTrial } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const trial = storageTrial(model, HIPPO, stored([{ name: 'Rival', sex: Sex.Male, genes: strands(6) }]));
    assert.deepEqual(trial.pinIds.sort(), ['Bull', 'Cow']);
    assert.deepEqual((await additions(model, stored([{ name: 'Rival', sex: Sex.Male, genes: strands(6) }]))).map(a => a.name), []);
});

test("the Market judges a listing against your placed breeders of the other sex, else any of yours, with Auto mode's standard", async () => {
    const { marketMatesOfSpecies } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const { bestOffspringScore } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js');
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    model.animals.get('Bull').genes = strands(5);
    model.animals.get('Cow').genes = strands(4);
    const m = marketMatesOfSpecies(model, HIPPO, stored([{ name: 'Kept', sex: Sex.Female, genes: strands(6) }]));
    assert.equal(m.m.mates.length, 1, 'a male listing: the cow in the habitat, the one he would breed with');
    assert.equal(m.f.mates.length, 1, 'a female listing: the bull');
    const first = marketMatesOfSpecies(zoo([animal('Bull', Sex.Male, 'H1')]), HIPPO, stored([{ name: 'Kept', sex: Sex.Female, genes: strands(6) }]));
    assert.equal(first.m.mates.length, 1, 'no female placed yet: the stored one guides the next buy');
    assert.equal(m.m.floor, bestOffspringScore(strands(5), [strands(4)]) - 10);
    assert.equal(marketMatesOfSpecies(zoo([]), HIPPO, null), null, 'nothing of the species: nothing to judge by');
});

test('your animals outside a habitat get the score a Market listing of their sex would, for the Storage window', async () => {
    const { marketMatesOfSpecies } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const { calfScores } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js');
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1')]);
    const m = marketMatesOfSpecies(model, HIPPO, stored([{ name: 'Spare', sex: Sex.Male, genes: strands(6) }]));
    assert.equal(m.unplaced.length, 1, 'the placed ones are not on the Storage window');
    const spare = m.unplaced[0];
    const expect = calfScores(strands(6), [model.animals.get('Cow').genes, model.animals.get('Cow2').genes], true);
    assert.deepEqual([spare.n, spare.c, spare.b], ['Spare', expect.score, expect.best], 'a male: his average over your placed females');
});

test("one storage list: the programme's places first, each need from what they leave, an animal never twice", async () => {
    const { mergeStorageSuggestions } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const cow = (name, hab, young) => ({ guid: `g_${name}`, name, sex: Sex.Female, hab, young });
    const { items, unfilled } = mergeStorageSuggestions({
        additions: [cow('Jie', 'A14', 66), cow('Zara', 'A12', 63)],
        needs: [
            { hab: 'A13', sex: Sex.Female, bring: [cow('Earlene', null, 56)] },
            { hab: 'A14', sex: Sex.Female, bring: [cow('Evita', null, 58)] },
            { hab: 'A15', sex: Sex.Male, bring: [] },
        ],
        upgrades: [Object.assign(cow('Jie', 'A12', 70), { replacesName: 'Old', replacesYoung: 40 })],
    });
    assert.deepEqual(items.map(x => `${x.role}:${x.name}>${x.hab}`), ['join:Jie>A14', 'join:Zara>A12', 'fill:Earlene>A13']);
    assert.deepEqual(unfilled.map(n => n.hab), ['A15'], 'nothing in storage: the Market');
});
