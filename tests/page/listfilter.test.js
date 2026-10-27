import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['kinhooks.js'] });

const sent = [];
globalThis.engine = { trigger: (...args) => sent.push(args), on() {} };
const { setTestRow } = await import('/js/common/core/DataStore.js');
const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
const { addStorageFilter, installListFilter, refreshList, setStorageFilters } = await import('/js/mods/pz2qol/listfilter.js');
const { STORAGE_LIST, STORAGE_LIST_KEY } = await import('/js/mods/pz2qol/game.js');

installListFilter();
const storage = new DataStoreCollection(STORAGE_LIST);
const rows = ['a1', 'a2', 'a3'].map(key => STORAGE_LIST.concat([key]));
storage._source = rows;
rows.forEach((ctx, i) => setTestRow(ctx, { id: `id${i + 1}`, species: '[Animal_Zebra_Grevys]', multiSelected: false }));

test('a ticked storage row that a data change hides is unticked', () => {
    let advised = new Set(['id1', 'id2']);
    addStorageFilter('sellAdvice', a => advised.has(a.id));
    setStorageFilters({ sellAdvice: 'all' });
    setTestRow(rows[1], { multiSelected: true });
    assert.equal(storage.source.length, 2);
    sent.length = 0;
    advised = new Set(['id1']);
    refreshList(STORAGE_LIST_KEY);
    assert.deepEqual(storage.source, [rows[0]]);
    // once per read of the list until the game takes the untick: the same answer each time
    assert.ok(sent.length > 0);
    assert.deepEqual(new Set(sent.map(args => args.join())), new Set(['AnimalStorage_ItemCheckboxToggled,id2,false']));
});

test('rows the filter shows, or that are not ticked, are left alone', () => {
    setStorageFilters({ sellAdvice: false, species: 'Zebra_Grevys' });
    setTestRow(rows[0], { multiSelected: true });
    sent.length = 0;
    assert.equal(storage.source.length, 3);
    assert.deepEqual(sent, []);
});
