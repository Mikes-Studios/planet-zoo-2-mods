import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['kinhooks.js'] });
const { setTestRow } = await import('/js/common/core/DataStore.js');
const { readAnimal, STORAGE_LIST } = await import('/js/mods/pz2qol/game.js');

test('a row is read whole, its genes included', () => {
    const row = STORAGE_LIST.concat(['animal_1']);
    setTestRow(row, { id: 'id1', species: '[Animal_Okapi]', gender: 1, maturity: 2, isPregnant: true, auctionPrice: 900, auctionIsConservationCredits: 1, name: 'Ada', ratings: 'gold' });
    setTestRow(row.concat(['genetics', 'fertility']), { value: 0.8 });
    const a = readAnimal(row);
    assert.equal(a.id, 'id1');
    assert.equal(a.species, '[Animal_Okapi]');
    assert.equal(a.isPregnant, true);
    assert.equal(a.isAlpha, false);
    assert.equal(a.price, 900);
    assert.equal(a.isCC, true);
    assert.equal(a.medal, 'gold');
    assert.equal(a.key, 'animal_1');
    assert.equal(a.genes.fertility, 0.8);
    assert.equal(a.genes.size, undefined);
});

test('a row whose data is gone reads as empty, not as an error', () => {
    const a = readAnimal(STORAGE_LIST.concat(['animal_gone']));
    assert.equal(a.id, undefined);
    assert.equal(a.isShoal, false);
});
