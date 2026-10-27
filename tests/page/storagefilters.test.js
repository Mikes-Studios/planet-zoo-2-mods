import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStorageFilters, DEFAULT_STORAGE_FILTERS, Maturity, storageFiltersActive, SURPLUS_KEEP_STEPS, surplusChipCount } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';

const female = (id, score, listed = false) => ({
    id, species: 'Zebra', gender: 1, maturity: 2,
    genes: { size: score, longevity: score, fertility: score, immunity: score },
    auctionTimerSeconds: listed ? 3600 : undefined,
});
const zebras = [female('a', 0.9), female('b', 0.8, true), female('c', 0.7), female('d', 0.6)];
const filters = patch => Object.assign({}, DEFAULT_STORAGE_FILTERS, patch);

test('the Surplus chip counts what its first click would show', () => {
    const off = filters({});
    const firstClick = filters({ surplusOnly: true, surplusKeep: SURPLUS_KEEP_STEPS[0] });
    assert.equal(surplusChipCount(zebras, off), applyStorageFilters(zebras, firstClick).length);
    assert.equal(surplusChipCount(zebras, off), 3);
});

test('under Not listed the Surplus chip leaves listed animals out, as its filter does', () => {
    const on = filters({ surplusOnly: true, surplusKeep: 2, hideListed: true });
    assert.equal(surplusChipCount(zebras, on), applyStorageFilters(zebras, on).length);
    assert.equal(surplusChipCount(zebras, on), 1);
});

test('the Adults chip steps through all adults, fertile adults and juveniles', () => {
    const ages = [Maturity.Infant, Maturity.Adult, Maturity.ElderlyInfertile].map((maturity, i) => Object.assign(female('m' + i, 0.5), { maturity }));
    const shown = adults => applyStorageFilters(ages, filters({ adults })).map(a => a.maturity);
    assert.deepEqual(shown('off'), [Maturity.Infant, Maturity.Adult, Maturity.ElderlyInfertile]);
    assert.deepEqual(shown('all'), [Maturity.Adult, Maturity.ElderlyInfertile]);
    assert.deepEqual(shown('fertile'), [Maturity.Adult]);
    assert.deepEqual(shown('juvenile'), [Maturity.Infant]);
    assert.equal(storageFiltersActive(filters({})), false);
    assert.equal(storageFiltersActive(filters({ adults: 'fertile' })), true);
});

test('Sell advice splits the advised animals: all, for the market (a medal), to release (none), to quick sell (a Frontier zoo)', () => {
    const PLAYER = '[AnimalExchange_Source_Description:Value=|Breeder Zoo|]';
    const FRONTIER = '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]';
    const herd = [
        Object.assign(female('gold', 0.9), { medal: 'gold', source: PLAYER }),
        Object.assign(female('plain', 0.5), { medal: 'none', source: PLAYER }),
        Object.assign(female('wild', 0.5), { medal: 'bronze', source: FRONTIER }),
        Object.assign(female('kept', 0.9), { medal: 'silver', source: PLAYER }),
    ];
    const advised = { sellAdvice: a => a.id !== 'kept' };
    const shown = way => applyStorageFilters(herd, filters({ sellAdvice: way }), advised).map(a => a.id);
    assert.deepEqual(shown('all'), ['gold', 'plain', 'wild']);
    assert.deepEqual(shown('market'), ['gold']);
    assert.deepEqual(shown('release'), ['plain']);
    assert.deepEqual(shown('quick'), ['wild'], 'a medal does not make a Frontier-zoo animal sellable');
    assert.deepEqual(shown(false), ['gold', 'plain', 'wild', 'kept']);
});

test('where the game has given its verdict, Sell advice follows it: one adopted for cash is no release', () => {
    const PLAYER = '[AnimalExchange_Source_Description:Value=|Breeder Zoo|]';
    const cash = Object.assign(female('cash', 0.5), { medal: 'none', source: PLAYER });
    const ccBought = Object.assign(female('cc', 0.5), { medal: 'none', source: '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]' });
    const unchecked = Object.assign(female('plain', 0.5), { medal: 'none', source: PLAYER });
    const verdict = { cash: { trade: false, quickTrade: true, quickRelease: false }, cc: { trade: true, quickTrade: true, quickRelease: true } };
    const verdictOf = a => verdict[a.id] || null;
    const shown = way => applyStorageFilters([cash, ccBought, unchecked], filters({ sellAdvice: way }), { sellAdvice: () => true }, verdictOf).map(a => a.id);
    assert.deepEqual(shown('release'), ['cc', 'plain'], 'the game says the cash one can not, the CC-bought one can; the unchecked one by its medal');
    assert.deepEqual(shown('quick'), ['cash'], 'only Quick trade takes the cash one');
    assert.deepEqual(shown('market'), ['cc'], 'the market takes the CC-bought one though it came from a Frontier zoo');
});

test('an animal within three years of elderly is in none of the ways: the server refuses every trade', () => {
    const PLAYER = '[AnimalExchange_Source_Description:Value=|Breeder Zoo|]';
    const old = Object.assign(female('old', 0.5), { species: '[Animal_Giraffe_Reticulated]', age: 29.3, medal: 'none', source: PLAYER });
    const young = Object.assign(female('young', 0.5), { species: '[Animal_Giraffe_Reticulated]', age: 25.4, medal: 'none', source: PLAYER });
    const shown = way => applyStorageFilters([old, young], filters({ sellAdvice: way }), { sellAdvice: () => true }).map(a => a.id);
    assert.deepEqual(shown('release'), ['young']);
    assert.deepEqual(shown('quick'), []);
    assert.deepEqual(shown('market'), []);
});

test('Sellable cycles every stored animal by how it can go, with no Auto run: market, release, quick sell, none', () => {
    const PLAYER = '[AnimalExchange_Source_Description:Value=|Breeder Zoo|]';
    const FRONTIER = '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]';
    const zebra = (id, extra) => Object.assign(female(id, 0.6), { source: PLAYER, medal: 'none' }, extra);
    const herd = [
        zebra('gold', { medal: 'gold' }), zebra('plain'), zebra('wild', { source: FRONTIER }),
        zebra('due', { isPregnant: true }), zebra('listed', { auctionTimerSeconds: 600 }),
    ];
    const shown = way => applyStorageFilters(herd, filters({ sellable: way })).map(a => a.id);
    assert.deepEqual(shown('market'), ['gold']);
    assert.deepEqual(shown('release'), ['plain']);
    assert.deepEqual(shown('quick'), ['wild']);
    assert.deepEqual(shown('no'), ['due', 'listed']);
    assert.deepEqual(shown('any'), herd.map(a => a.id));
});
