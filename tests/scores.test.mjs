// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStorageFilters, breederScore, DEFAULT_STORAGE_FILTERS, Gender, geneScore, Maturity, PICK_MIN_SCORE,
    speciesStats, storageFiltersActive, storageSummary, surplusIds, valueIndex,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';
import { tierOf } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/ui.js';

const animal = (id, over = {}) => Object.assign({
    id, species: 'Lion', gender: Gender.Male, maturity: Maturity.Adult,
    isShoal: false, isExhibit: false, isPregnant: false, isAlpha: false,
    price: 1000, isCC: false,
    genes: { size: 0.5, longevity: 0.5, fertility: 0.5, immunity: 0.5 },
}, over);

const f = over => Object.assign({}, DEFAULT_STORAGE_FILTERS, over);

test('geneScore averages relevant genes', () => {
    assert.equal(geneScore(animal('a', { genes: { size: 1, longevity: 0.5, fertility: 0.5, immunity: 0 } })), 50);
    assert.equal(geneScore(animal('b', { genes: { size: 0.9, longevity: 0.81, fertility: 0.8, immunity: 0.8 } })), 83);
});

test('geneScore: exhibit uses longevity+fertility, shoal is null, missing is null', () => {
    assert.equal(geneScore(animal('a', { isExhibit: true, genes: { size: 0, longevity: 1, fertility: 0.5, immunity: 0 } })), 75);
    assert.equal(geneScore(animal('b', { isShoal: true })), null);
    assert.equal(geneScore(animal('c', { genes: {} })), null);
});

test('breederScore weights fertility most', () => {
    const fertile = animal('a', { genes: { size: 0, longevity: 0.5, fertility: 1, immunity: 0.5 } });
    const sterile = animal('b', { genes: { size: 0, longevity: 1, fertility: 0, immunity: 1 } });
    assert.equal(breederScore(fertile), 70);
    assert.equal(breederScore(sterile), 60);
    assert.equal(breederScore(animal('c', { isShoal: true })), null);
});

test('valueIndex per 1k cash and per 100 CC', () => {
    assert.equal(valueIndex(animal('a', { price: 2000 })), 25);
    assert.equal(valueIndex(animal('b', { price: 200, isCC: true })), 25);
    assert.equal(valueIndex(animal('c', { price: 0 })), null);
    assert.equal(valueIndex(animal('d', { price: undefined })), null);
});

// a Market pick (marketpickcore.js) is only an animal worth having at all
test('a pick needs a decent gene score', () => {
    const cheapPoor = animal('a', { price: 100, genes: { size: .3, longevity: .3, fertility: .3, immunity: .3 } });
    const fairGood = animal('b', { price: 5000, genes: { size: .7, longevity: .7, fertility: .7, immunity: .7 } });
    assert.ok(geneScore(cheapPoor) < PICK_MIN_SCORE);
    assert.ok(geneScore(fairGood) >= PICK_MIN_SCORE);
});

test('score tier thresholds (the badge colour, ui.js tierOf)', () => {
    assert.equal(tierOf(null), 'tier_none');
    assert.equal(tierOf(80), 'tier_great');
    assert.equal(tierOf(60), 'tier_good');
    assert.equal(tierOf(40), 'tier_fair');
    assert.equal(tierOf(39), 'tier_poor');
});

const herd = [
    animal('m1', { genes: { size: .9, longevity: .9, fertility: .9, immunity: .9 } }),
    animal('m2', { genes: { size: .5, longevity: .5, fertility: .5, immunity: .5 } }),
    animal('m3', { genes: { size: .2, longevity: .2, fertility: .2, immunity: .2 } }),
    animal('f1', { gender: Gender.Female, isPregnant: true }),
    animal('f2', { gender: Gender.Female, maturity: Maturity.Infant }),
    animal('z1', { species: 'Zebra', gender: Gender.Male }),
    animal('z2', { species: 'Zebra', gender: Gender.Male, maturity: Maturity.Elderly, isAlpha: true }),
];

test('speciesStats counts breeding pairs (infants and elderly excluded)', () => {
    const s = speciesStats(herd);
    assert.equal(s.get('Lion').pairs, 1);
    assert.equal(s.get('Zebra').pairs, 0);
});

test('surplusIds keeps the best N per species and sex', () => {
    assert.deepEqual([...surplusIds(herd, 1)].sort(), ['f2', 'm2', 'm3', 'z2']);
    assert.deepEqual([...surplusIds(herd, 2)].sort(), ['m3']);
    assert.equal(surplusIds(herd, 3).size, 0);
});

test('applyStorageFilters', () => {
    const ids = list => list.map(a => a.id);
    assert.deepEqual(ids(applyStorageFilters(herd, f({}))), ids(herd));
    assert.deepEqual(ids(applyStorageFilters(herd, f({ pregnant: true }))), ['f1']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ alpha: true }))), ['z2']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ adults: 'juvenile' }))), ['f2']);
    assert.ok(!ids(applyStorageFilters(herd, f({ adults: 'all' }))).includes('f2'));
    assert.deepEqual(ids(applyStorageFilters(herd, f({ pairsOnly: true }))), ['m1', 'm2', 'm3', 'f1', 'f2']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ minScore: 80 }))), ['m1']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ surplusOnly: true, surplusKeep: 2 }))), ['m3']);
    const sorted = ids(applyStorageFilters(herd, f({ sort: 'gene' })));
    assert.equal(sorted[0], 'm1');
    assert.equal(sorted[sorted.length - 1], 'm3');
});

test('storageFiltersActive and summary', () => {
    assert.equal(storageFiltersActive(f({})), false);
    assert.equal(storageFiltersActive(f({ sort: 'gene' })), true);
    const s = storageSummary(herd);
    assert.equal(s.count, 7);
    assert.equal(s.males, 5);
    assert.equal(s.females, 2);
    assert.equal(s.pregnant, 1);
    assert.equal(s.species, 2);
    assert.equal(s.pairs, 1);
});

test('hideListed hides animals on the market (timer > 0) and keeps them out of pairs', () => {
    const genes = { size: 0.8, longevity: 0.8, fertility: 0.8, immunity: 0.8 };
    const list = [
        animal(1, { ...genes, auctionTimerSeconds: 3600 }),                       // listed
        animal(2, { ...genes, auctionTimerSeconds: -1 }),                         // game's "not listed"
        animal(3, { ...genes, auctionTimerSeconds: 0, gender: Gender.Female }),   // expired listing counts as not listed
        animal(4, { ...genes }),                                                  // field missing
        animal(5, { ...genes, auctionTimerSeconds: 120, gender: Gender.Female }), // listed female
    ];
    const f = { ...DEFAULT_STORAGE_FILTERS, hideListed: true };
    assert.equal(storageFiltersActive(f), true);
    assert.deepEqual(applyStorageFilters(list, f).map(a => a.id), [2, 3, 4]);
    assert.deepEqual(applyStorageFilters(list, DEFAULT_STORAGE_FILTERS).map(a => a.id), [1, 2, 3, 4, 5]);
    // with only the listed female gone, the remaining female (3) still makes a pair
    assert.deepEqual(applyStorageFilters(list, { ...f, pairsOnly: true }).map(a => a.id), [2, 3, 4]);
    const noFemale = list.filter(a => a.id != 3);
    assert.deepEqual(applyStorageFilters(noFemale, { ...f, pairsOnly: true }).map(a => a.id), []);
});
