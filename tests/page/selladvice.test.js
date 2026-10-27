import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['kinhooks.js'] });

const handlers = {};
globalThis.engine = {
    on: (name, fn) => {
        handlers[name] = fn;
    },
    trigger() {},
};
// the page's own 10 s ask would keep the test running
globalThis.setInterval = () => 0;
const { setTestRow } = await import('/js/common/core/DataStore.js');
const { DataStoreCollection } = await import('/js/common/data/DataStoreCollection.js');
const { STORAGE_LIST } = await import('/js/mods/pz2qol/game.js');
const { getStorageFilters, getStoragePredicates, installListFilter, setStorageFilters } = await import('/js/mods/pz2qol/listfilter.js');
const { installSellAdvice } = await import('/js/mods/pz2qol/selladvice.js');

installListFilter();
const storage = new DataStoreCollection(STORAGE_LIST);
let refreshes = 0;
storage._onChange = { dispatch: () => refreshes++ };
const genes = { fertility: 0.5, immunity: 0.5, size: 0.5, longevity: 0.5 };
storage._source = ['a1', 'a2'].map(key => STORAGE_LIST.concat([key]));
// names as the game's Storage rows give them
setTestRow(storage._source[0], { id: 'id1', name: '[STRING_LITERAL:Value=|Ada|]', gender: 1, species: '[Animal_Zebra_Grevys]' });
setTestRow(storage._source[1], { id: 'id2', name: '[STRING_LITERAL:Value=|Bo|]', gender: 1, species: '[Animal_Zebra_Grevys]' });
storage._source.forEach(ctx => ['size', 'longevity', 'fertility', 'immunity'].forEach(id => setTestRow(ctx.concat(['genetics', id]), { value: genes[id] })));
const advice = names => JSON.stringify(names.map(n => ({ s: 'Zebra_Grevys', x: 1, n, p: [50, 50, 50, 50] })));
installSellAdvice();

test('new advice re-filters the list while the chip is on', () => {
    handlers.PZ2QoL_SellAdviceResult('A1', advice(['Ada']));
    setStorageFilters({ sellAdvice: 'all' });
    assert.equal(storage.source.length, 1);
    const before = refreshes;
    handlers.PZ2QoL_SellAdviceResult('A2', advice(['Bo']));
    assert.ok(refreshes > before, 'the list is told to read its rows again');
    assert.equal(storage.source[0], storage._source[1]);
    handlers.PZ2QoL_SellAdviceResult('A3', advice(['Bo']));
    assert.equal(getStorageFilters().sellAdvice, 'all');
});

test('when the advice runs out the chip goes off, not lit over the whole list', () => {
    handlers.PZ2QoL_SellAdviceResult('A4', '[]');
    assert.equal(getStorageFilters().sellAdvice, false);
    assert.equal(getStoragePredicates().sellAdvice, undefined);
});
