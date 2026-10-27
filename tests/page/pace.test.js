import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';
import { setTimeout as wait } from 'node:timers/promises';

loadPages({ stubs: ['kinhooks.js'] });

// the player store as the Lua side keeps it: one text, read and written by both pages
let stored = JSON.stringify({ pace: { lister: 3, moves: 0.5 } });
const handlers = {};
globalThis.engine = {
    on(name, fn) {
        handlers[name] = fn;
    },
    trigger(name, reqId, text) {
        if (name === 'PZ2QoL_PrefsLoad') setTimeout(() => handlers.PZ2QoL_PrefsData(reqId, true, stored), 1);
        if (name === 'PZ2QoL_PrefsSave') {
            stored = text;
            setTimeout(() => handlers.PZ2QoL_PrefsSaved(reqId, true), 1);
        }
    },
};
const { getPace, setPace } = await import('/js/mods/pz2qol/pace.js');

test('a pause set on one page keeps the pause the other page saved', async () => {
    await wait(20);
    assert.equal(getPace('lister'), 3);
    stored = JSON.stringify({ pace: { lister: 5, moves: 0.5 } });
    setPace('moves', 2);
    await wait(600);
    assert.deepEqual(JSON.parse(stored).pace, { lister: 5, moves: 2 });
    assert.equal(getPace('lister'), 5, 'and this page takes it up');
});
