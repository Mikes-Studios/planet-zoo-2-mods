// Storage filter extension point (scores.js): flags other modules back with
// a predicate, e.g. Kin's `related` ("Kin" chip in Animal Storage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStorageFilters, DEFAULT_STORAGE_FILTERS, storageFiltersActive } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';

const f = over => Object.assign({}, DEFAULT_STORAGE_FILTERS, over);
const herd = [
    { id: 'a', gender: 0, maturity: 2, genes: { size: 0.9, longevity: 0.9, fertility: 0.9, immunity: 0.9 } },
    { id: 'b', gender: 1, maturity: 2, genes: { size: 0.2, longevity: 0.2, fertility: 0.2, immunity: 0.2 } },
    { id: 'c', gender: 1, maturity: 0, genes: { size: 0.5, longevity: 0.5, fertility: 0.5, immunity: 0.5 } },
];
const ids = list => list.map(a => a.id);

test('related is off by default and counts as an active filter', () => {
    assert.equal(DEFAULT_STORAGE_FILTERS.related, false);
    assert.equal(storageFiltersActive(f({})), false);
    assert.equal(storageFiltersActive(f({ related: true })), true);
});

test('a predicate applies only while its flag is on', () => {
    const related = new Set(['a', 'c']);
    const predicates = { related: a => related.has(a.id) };
    assert.deepEqual(ids(applyStorageFilters(herd, f({}), predicates)), ['a', 'b', 'c']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ related: true }), predicates)), ['a', 'c']);
    // combines with the built-in filters and sorts
    assert.deepEqual(ids(applyStorageFilters(herd, f({ related: true, adults: 'all' }), predicates)), ['a']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ related: true, sort: 'gene' }), predicates)), ['a', 'c']);
});

test('a flag without a predicate filters nothing (Kin off or no data yet)', () => {
    assert.deepEqual(ids(applyStorageFilters(herd, f({ related: true }))), ['a', 'b', 'c']);
    assert.deepEqual(ids(applyStorageFilters(herd, f({ related: true }), {})), ['a', 'b', 'c']);
});

// Fertile adults: the game's maturity carries the infertile stages
// (EAnimalMaturity 4/5/6); the market won't take an elderly animal, fertile or not.
import { isElderly, isFertileAdult, Maturity } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';

const ages = [
    { id: 'infant', maturity: Maturity.Infant },
    { id: 'young', maturity: Maturity.YoungAdult },
    { id: 'adult', maturity: Maturity.Adult },
    { id: 'elderly', maturity: Maturity.Elderly },
    { id: 'youngInf', maturity: Maturity.YoungAdultInfertile },
    { id: 'adultInf', maturity: Maturity.AdultInfertile },
    { id: 'elderlyInf', maturity: Maturity.ElderlyInfertile },
    { id: 'unknown' },
].map(a => Object.assign({ gender: 0, genes: {} }, a));

test('maturity values match the game enum', () => {
    assert.deepEqual([Maturity.Infant, Maturity.YoungAdult, Maturity.Adult, Maturity.Elderly, Maturity.YoungAdultInfertile, Maturity.AdultInfertile, Maturity.ElderlyInfertile], [0, 1, 2, 3, 4, 5, 6]);
});

test('the Adults chip is off by default; each stage counts as an active filter', () => {
    assert.equal(DEFAULT_STORAGE_FILTERS.adults, 'off');
    for (const stage of ['all', 'fertile', 'juvenile']) assert.equal(storageFiltersActive(f({ adults: stage })), true, stage);
});

test('the Adults chip: all adults, fertile adults (fertile elderly too), juveniles', () => {
    assert.deepEqual(ids(applyStorageFilters(ages, f({ adults: 'fertile' }))), ['young', 'adult', 'elderly']);
    assert.deepEqual(ids(applyStorageFilters(ages, f({ adults: 'all' }))), ['young', 'adult', 'elderly', 'youngInf', 'adultInf', 'elderlyInf']);
    assert.deepEqual(ids(applyStorageFilters(ages, f({ adults: 'juvenile' }))), ['infant', 'unknown']);
    assert.deepEqual(ids(ages.filter(isFertileAdult)), ['young', 'adult', 'elderly']);
});

test('every elderly animal, fertile or not, is flagged for the lister skip', () => {
    assert.deepEqual(ids(ages.filter(isElderly)), ['elderly', 'elderlyInf']);
});

// Sellable: what the game's own sell flow refuses (juvenile, pregnant,
// elderly), plus storage rows already listed or being moved. An infertile
// adult is not blocked: the game may refuse it (cautionOf), so the lister
// tries it and the If refused option decides.
import { cautionOf, isSellable, sellBlockers } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';

const stock = [
    { id: 'ok', maturity: Maturity.Adult },
    { id: 'okElderly', maturity: Maturity.Elderly },
    { id: 'infant', maturity: Maturity.Infant },
    { id: 'youngInf', maturity: Maturity.YoungAdultInfertile },
    { id: 'adultInf', maturity: Maturity.AdultInfertile },
    { id: 'elderlyInf', maturity: Maturity.ElderlyInfertile },
    { id: 'pregnant', maturity: Maturity.Adult, isPregnant: true },
    { id: 'listed', maturity: Maturity.Adult, auctionTimerSeconds: 3600 },
    { id: 'expired', maturity: Maturity.Adult, auctionTimerSeconds: 0 },
    { id: 'moving', maturity: Maturity.YoungAdult, isMoving: true },
    { id: 'unknown' },
].map(a => Object.assign({ gender: 1, genes: {} }, a));

test('sellBlockers names each reason', () => {
    const by = Object.fromEntries(stock.map(a => [a.id, sellBlockers(a)]));
    assert.deepEqual(by.ok, []);
    assert.deepEqual(by.okElderly, ['elderly']);
    assert.deepEqual(by.infant, ['juvenile']);
    assert.deepEqual(by.youngInf, []);
    assert.deepEqual(by.adultInf, []);
    assert.deepEqual(by.elderlyInf, ['elderly']);
    assert.deepEqual(stock.filter(a => cautionOf(a) === 'infertile').map(a => a.id), ['youngInf', 'adultInf']);
    assert.deepEqual(by.pregnant, ['pregnant']);
    assert.deepEqual(by.listed, ['listed']);
    assert.deepEqual(by.expired, []);
    assert.deepEqual(by.moving, ['moving']);
    assert.deepEqual(by.unknown, []);
    assert.deepEqual(sellBlockers({ maturity: Maturity.Infant, isPregnant: true, auctionTimerSeconds: 5 }), ['listed', 'pregnant', 'juvenile']);
});

// Without the game's own verdict (the Market desk's Check storage), a medal
// means the market, none means release, and a Frontier zoo's animal only
// Quick trade takes.
const FRONTIER = '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]';
const leaving = stock.concat([
    { id: 'medal', gender: 1, genes: {}, maturity: Maturity.Adult, medal: 'gold' },
    { id: 'frontier', gender: 1, genes: {}, maturity: Maturity.Adult, source: FRONTIER },
]);

test('sellable filter: off by default; each way out and no split the list', () => {
    assert.equal(DEFAULT_STORAGE_FILTERS.sellable, 'any');
    for (const way of ['market', 'release', 'quick', 'no']) assert.equal(storageFiltersActive(f({ sellable: way })), true, way);
    assert.equal(storageFiltersActive(f({ sellable: 'any' })), false);
    const by = way => ids(applyStorageFilters(leaving, f({ sellable: way })));
    assert.deepEqual(by('market'), ['medal']);
    assert.deepEqual(by('release'), ['ok', 'youngInf', 'adultInf', 'expired', 'unknown']);
    assert.deepEqual(by('quick'), ['frontier']);
    assert.deepEqual(by('no'), ['okElderly', 'infant', 'elderlyInf', 'pregnant', 'listed', 'moving']);
    assert.equal(by('market').length + by('release').length + by('quick').length + by('no').length, leaving.length);
    // the game's verdict decides where there is one
    const verdict = a => (a.id === 'ok' ? { trade: true } : null);
    assert.deepEqual(ids(applyStorageFilters(leaving, f({ sellable: 'market' }), {}, verdict)), ['ok', 'medal']);
    // combines with other filters
    assert.deepEqual(ids(applyStorageFilters(leaving, f({ sellable: 'no', adults: 'juvenile' }))), ['infant']);
    // a pregnant animal goes no way, even a fertile adult one
    assert.deepEqual(ids(applyStorageFilters(leaving, f({ sellable: 'release', pregnant: true }))), []);
    assert.deepEqual(ids(applyStorageFilters(leaving, f({ sellable: 'no', pregnant: true }))), ['pregnant']);
    assert.equal(isSellable({ maturity: Maturity.YoungAdult, isPregnant: true }), false);
});

test('species: one species only (the trade shortcuts), off by default', () => {
    assert.equal(DEFAULT_STORAGE_FILTERS.species, '');
    assert.equal(storageFiltersActive(f({})), false);
    assert.equal(storageFiltersActive(f({ species: 'Lion' })), true);
    const zoo = [
        { id: 'l1', species: '[Animal_Lion]', gender: 0, maturity: 2, genes: { size: 0.3, longevity: 0.3, fertility: 0.3, immunity: 0.3 } },
        { id: 't1', species: '[Animal_Tiger]', gender: 0, maturity: 2, genes: { size: 0.9, longevity: 0.9, fertility: 0.9, immunity: 0.9 } },
        { id: 'l2', species: '[Animal_Lion]', gender: 1, maturity: 0, genes: { size: 0.8, longevity: 0.8, fertility: 0.8, immunity: 0.8 } },
        { id: 'a1', species: '[Animal_Leopard_African]', gender: 1, maturity: 2, genes: {} },
    ];
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: 'Lion' }))), ['l1', 'l2']);
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: 'lion' }))), ['l1', 'l2'], 'case-insensitive');
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: '[Animal_Lion]' }))), ['l1', 'l2']);
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: 'Leopard_African' }))), ['a1']);
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: 'Lion', adults: 'all' }))), ['l1'], 'with Adults');
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: 'Lion', sort: 'gene' }))), ['l2', 'l1'], 'with a sort');
    assert.deepEqual(ids(applyStorageFilters(zoo, f({ species: 'Zebra' }))), []);
});
