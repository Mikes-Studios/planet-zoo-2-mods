import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardChanges, planAutoRun, withGuardsLifted } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { emptyLedger, guardedGuids, noteGuard, normalizeLedger } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautoledger.js';
import { Sex, TRADE, animal, juvenile, zoo } from './zoo.js';

const ids = list => list.map(a => a.id).sort();

test('a female beside a grown relative goes on contraception, and so does one who grows up within half a year beside him', () => {
    const model = zoo([
        animal('Dad', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H1'),
        animal('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
        animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
        juvenile('Soon', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 6.75 }),
        juvenile('Later', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 4 }),
    ]);
    const { on, off } = guardChanges(model);
    assert.deepEqual(ids(on), ['Mum', 'Sister', 'Soon'], 'Mum beside her grown son too; Later is years off');
    assert.deepEqual(off, []);
});

test('a young brother within half a year of growing up puts his grown sister on contraception', () => {
    const model = zoo([
        animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 9 }),
        juvenile('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 6.6 }),
        animal('Mate', Sex.Male, 'H1'),
    ]);
    assert.deepEqual(ids(guardChanges(model).on), ['Sister']);
    const far = zoo([animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 9 }), juvenile('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 3 })]);
    assert.deepEqual(guardChanges(far).on, [], 'years from growing up: the plan parts them in time');
});

test('only the contraception Auto mode set comes off, and only once she is apart from her relative', () => {
    const apart = zoo([
        animal('Sister', Sex.Female, 'H2', { par: ['Mum', 'Dad'], age: 8, contra: true }),
        animal('Mine', Sex.Female, 'H2', { contra: true }),
        animal('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
    ]);
    const guarded = new Set(['g_Sister']);
    assert.deepEqual(ids(guardChanges(apart, guarded).off), ['Sister'], "the player's own stays on");
    const together = zoo([
        animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8, contra: true }),
        animal('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
    ]);
    assert.deepEqual(guardChanges(together, guarded), { on: [], off: [] }, 'still beside him: it stays on');
    const atTrade = zoo([animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8, contra: true, lt: 'trade' })]);
    assert.deepEqual(guardChanges(atTrade, guarded).off, [], 'off only once she is in a habitat without him');
});

test('a guarded female is planned as the breeder she is: the pair is still parted', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H2'), animal('Cow', Sex.Female, 'H2'),
        animal('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
        animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8, contra: true }),
    ]);
    const lifted = withGuardsLifted(model, new Set(['g_Sister']));
    assert.equal(lifted.animals.get('Sister').contra, false);
    assert.equal(model.animals.get('Sister').contra, true, 'the scan is left as it is');
    assert.equal(withGuardsLifted(model, new Set()), model);
    const run = planAutoRun({ model: lifted, species: model.animals.get('Sister').species, settings: {} });
    const moved = run.moves.map(m => String(m.id));
    assert.ok(moved.includes('Sister') || moved.includes('Brother'), `one of the pair moves (${moved.join(',')})`);
});

test('the ledger remembers the guarded females across a save', () => {
    const l = emptyLedger();
    noteGuard(l, 'g_A', true);
    noteGuard(l, 'g_B', true);
    noteGuard(l, 'g_B', false);
    const back = normalizeLedger(JSON.parse(JSON.stringify(l)));
    assert.deepEqual([...guardedGuids(back)], ['g_A']);
});

test('Auto mode keeps a good female breeding when young relatives grow up soon in every habitat: the guard covers it', () => {
    const model = zoo([
        animal('Leader', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'),
        animal('Niece', Sex.Female, 'H1', { par: ['OldSire', 'Dam'], age: 8 }),
        animal('HalfSis', Sex.Female, 'H1', { par: ['OldSire', 'Dam2'], age: 9 }),
        juvenile('Nephew', Sex.Male, 'H1', { par: ['Leader', 'HalfSis'], age: 6.6 }),
        animal('Bull', Sex.Male, 'H2'), animal('Cow2', Sex.Female, 'H2'),
        juvenile('HalfBro', Sex.Male, 'H2', { par: ['OldSire', 'Cow2'], age: 6.6 }),
    ]);
    const run = planAutoRun({ model, species: model.animals.get('Niece').species, settings: {} });
    const niece = run.moves.find(m => String(m.id) === 'Niece');
    assert.ok(!niece || niece.to !== TRADE, `the niece stays a breeder (${niece && niece.to})`);
    assert.deepEqual(ids(guardChanges(model).on), ['Cow2', 'HalfSis', 'Niece'], 'the mothers of the young males, and the half-aunt of one');
});

test('the long run: a sire no kin of the young females growing up is kept over one who is their brother', async () => {
    const { planProgramme } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js');
    const { HIPPO, HIPPO_INFO } = await import('./zoo.js');
    const daughters = ['D1', 'D2', 'D3', 'D4'].map(n => juvenile(n, Sex.Female, 'H1', { par: ['Dad', 'Mum'], age: 5 }));
    const model = zoo([
        animal('Dad', Sex.Male, 'H1', { age: 12 }), animal('Mum', Sex.Female, 'H1'), ...daughters,
        animal('Brother', Sex.Male, 'H2', { par: ['Dad', 'Mum0'], age: 8 }), animal('Cow', Sex.Female, 'H2'),
        animal('Stranger', Sex.Male, TRADE, { age: 8 }),
    ], { habitats: ['H1', 'H2'] });
    const placed = w => {
        const r = planProgramme(model, HIPPO, HIPPO_INFO, null, { options: { futureMateWeight: w, moveCost: 0, outsiderCost: 0 } });
        const after = new Map([...model.animals.values()].map(a => [a.id, a.hab || TRADE]));
        for (const m of r.moves) after.set(String(m.id), String(m.to));
        return ['Dad', 'Brother', 'Stranger'].filter(id => after.get(id) !== TRADE).sort();
    };
    assert.ok(placed(0.25).includes('Stranger'), `kept: ${placed(0.25)} (without the long run: ${placed(0)})`);
});

test('a good male left at the trade centre is kept for the young who will need him, a weaker one is sold even so', async () => {
    const { planProgramme } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js');
    const { HIPPO, HIPPO_INFO, strands } = await import('./zoo.js');
    const withGenes = (a, level) => Object.assign(a, { genes: strands(level) });
    const daughters = ['D1', 'D2'].map(n => withGenes(juvenile(n, Sex.Female, 'H1', { par: ['Dad', 'Mum'], age: 5 }), 4));
    const model = zoo([
        withGenes(animal('Dad', Sex.Male, 'H1'), 4), withGenes(animal('Mum', Sex.Female, 'H1'), 4), ...daughters,
        withGenes(animal('Stranger', Sex.Male, TRADE, { age: 8 }), 5),
        withGenes(animal('Weakling', Sex.Male, TRADE, { age: 8 }), 3),
    ], { habitats: ['H1'] });
    const r = planProgramme(model, HIPPO, HIPPO_INFO, null, { options: { pinIds: new Set(['Dad', 'Mum']) } });
    const keep = new Map(r.keep.map(x => [x.id, x.reason]));
    const sell = new Map(r.sellable.map(x => [x.id, x.reason]));
    assert.equal(keep.get('Stranger'), 'young', `kept for the daughters (keep ${[...keep]}, sell ${[...sell]})`);
    assert.ok(!keep.has('Weakling'), 'a weaker one is never kept for later');
    assert.ok(sell.has('Weakling'), `sold (${[...sell]})`);
});

test('a sire left as the last option is held to the best sire of the last park years', async () => {
    const { STANDARD_YEARS, sireStandard } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const sire = (id, avg) => ({ a: { id }, avg });
    const first = sireStandard(null, [sire('Ekavir', 75), sire('Hamadi', 70)], 10);
    assert.deepEqual(first.std, [75, 10]);
    assert.deepEqual(first.below, [], 'within the margin');
    const alone = sireStandard(first.std, [sire('Hamadi', 60)], 11);
    assert.deepEqual(alone.below.map(s => s.a.id), ['Hamadi'], 'the best sire gone, his standard stays');
    assert.deepEqual(alone.std, [75, 10]);
    assert.ok(alone.floor > 60 && alone.floor < 75, 'a replacement must give young over the floor');
    const later = sireStandard(alone.std, [sire('Hamadi', 60)], 10 + STANDARD_YEARS + 1);
    assert.deepEqual([later.std, later.below], [[60, 10 + STANDARD_YEARS + 1], []], 'an old standard lapses');
});
