import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['kinhooks.js'] });

const handlers = {};
const sent = [];
globalThis.engine = {
    on: (name, fn) => {
        handlers[name] = fn;
    },
    trigger: (...args) => sent.push(args),
};
const store = await import('/js/mods/pz2qol/userstore.js');
const lastLoad = () => sent.filter(args => args[0] === 'PZ2QoL_StoreLoad').at(-1)[1];
const answer = (ok, text) => handlers.PZ2QoL_StoreData(lastLoad(), ok, 1, 1, text);
const saves = () => sent.filter(args => args[0] === 'PZ2QoL_StoreSave');
const loads = () => sent.filter(args => args[0] === 'PZ2QoL_StoreLoad').length;
const SAVE_WAIT_MS = 450;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function countSavedAndInFlight() {
    store._resetUserStoreForTests();
    sent.length = 0;
    store.loadUserData();
    answer(true, '{}');
    store.updateUserData('count', old => (old || 0) + 1);
    await wait(SAVE_WAIT_MS);
    return saves().at(-1)[1];
}

test('every load of the store tells the listeners once', () => {
    store._resetUserStoreForTests();
    const heard = [];
    const off = store.onUserData(status => heard.push(status));
    store.loadUserData();
    answer(true, '{}');
    handlers.PZ2QoL_StoreReset();
    answer(true, '{}');
    handlers.PZ2QoL_StoreReset();
    answer(false, 'nopark');
    handlers.PZ2QoL_StoreReset();
    answer(false, 'nopark');
    off();
    assert.deepEqual(heard, ['file', 'file', 'memory', 'memory']);
});

test('changes made while the store could not be used stay out of the next zoo\'s file', async () => {
    store._resetUserStoreForTests();
    store.loadUserData();
    answer(true, JSON.stringify({ kinMute: { zebra: true } }));
    store.updateUserData('kinMute', old => Object.assign({}, old || {}, { bear: true }));
    await new Promise(resolve => setTimeout(resolve, 450));
    handlers.PZ2QoL_StoreSaved(saves().at(-1)[1], false);
    sent.length = 0;
    store.updateUserData('kinMute', old => Object.assign({}, old || {}, { lion: true }));
    handlers.PZ2QoL_StoreReset();
    answer(false, 'nopark');
    handlers.PZ2QoL_StoreReset();
    answer(true, JSON.stringify({ kinMute: { tiger: true } }));
    assert.deepEqual(store.getUserData('kinMute'), { tiger: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(saves(), [], 'nothing of the last zoo is written into this one');
});

test('changes made while the zoo was still being found are kept when its data can be read', async () => {
    store._resetUserStoreForTests();
    sent.length = 0;
    store.loadUserData();
    answer(false, 'wait');
    store.updateUserData('kinMute', old => Object.assign({}, old || {}, { lion: true }));
    handlers.PZ2QoL_StoreReset('data');
    answer(true, JSON.stringify({ kinMute: { zebra: true } }));
    assert.deepEqual(store.getUserData('kinMute'), { zebra: true, lion: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(saves().length, 1);
    assert.deepEqual(JSON.parse(saves()[0][2]).kinMute, { zebra: true, lion: true });
});

test('a data reset sends the save still waiting, then reads the store once it is answered', () => {
    store._resetUserStoreForTests();
    sent.length = 0;
    store.loadUserData();
    answer(true, JSON.stringify({ kinMute: { zebra: true } }));
    store.updateUserData('kinMute', old => Object.assign({}, old || {}, { lion: true }));
    handlers.PZ2QoL_StoreReset('data');
    assert.equal(saves().length, 1, 'the waiting save is sent at the reset');
    assert.deepEqual(JSON.parse(saves()[0][2]).kinMute, { zebra: true, lion: true });
    assert.equal(loads(), 1, 'no read while that save is unanswered');
    handlers.PZ2QoL_StoreSaved(saves()[0][1], true);
    assert.equal(loads(), 2);
    answer(true, JSON.stringify({ kinMute: { zebra: true, lion: true } }));
    assert.deepEqual(store.getUserData('kinMute'), { zebra: true, lion: true });
});

test('a counter saved while a reset waits is counted once', async () => {
    const saveId = await countSavedAndInFlight();
    handlers.PZ2QoL_StoreReset('data');
    store.updateUserData('count', old => (old || 0) + 1);
    // the file already holds the saved count before its save is answered
    answer(true, JSON.stringify({ count: 1 }));
    handlers.PZ2QoL_StoreSaved(saveId, true);
    answer(true, JSON.stringify({ count: 1 }));
    assert.equal(store.getUserData('count'), 2, 'the saved change is not replayed, the one made during the wait is');
});

test('a counter whose save failed while a reset waits is replayed once', async () => {
    const saveId = await countSavedAndInFlight();
    handlers.PZ2QoL_StoreReset('data');
    handlers.PZ2QoL_StoreSaved(saveId, false);
    answer(true, '{}');
    assert.equal(store.getUserData('count'), 1);
});

test('a reset waits for an unanswered save no longer than the answer timeout', async () => {
    await countSavedAndInFlight();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        handlers.PZ2QoL_StoreReset('data');
        mock.timers.tick(5999);
        assert.equal(loads(), 1);
        mock.timers.tick(1);
        assert.equal(loads(), 2);
    }
    finally {
        mock.timers.reset();
    }
    answer(true, '{}');
    assert.equal(store.getUserData('count'), 1, 'an unconfirmed change is replayed');
});

test('a saved change is not replayed into a later read', async () => {
    store._resetUserStoreForTests();
    sent.length = 0;
    store.loadUserData();
    answer(true, '{}');
    store.updateUserData('count', old => (old || 0) + 1);
    await new Promise(resolve => setTimeout(resolve, 450));
    handlers.PZ2QoL_StoreSaved(saves().at(-1)[1], true);
    handlers.PZ2QoL_StoreReset('data');
    answer(true, JSON.stringify({ count: 1 }));
    assert.equal(store.getUserData('count'), 1);
});

test('a change whose save failed is kept for the next read', async () => {
    store._resetUserStoreForTests();
    sent.length = 0;
    store.loadUserData();
    answer(true, '{}');
    store.updateUserData('kinMute', () => ({ lion: true }));
    await new Promise(resolve => setTimeout(resolve, 450));
    handlers.PZ2QoL_StoreSaved(saves().at(-1)[1], false);
    handlers.PZ2QoL_StoreReset('data');
    answer(true, '{}');
    assert.deepEqual(store.getUserData('kinMute'), { lion: true });
});

test('a park reset sends no save and reads the next zoo at once', async () => {
    store._resetUserStoreForTests();
    sent.length = 0;
    store.loadUserData();
    answer(true, '{}');
    store.updateUserData('kinMute', () => ({ lion: true }));
    handlers.PZ2QoL_StoreReset('park');
    assert.equal(loads(), 2);
    await wait(SAVE_WAIT_MS);
    assert.equal(saves().length, 0);
});

test('a park reset does not wait for a save of the zoo it left', async () => {
    const saveId = await countSavedAndInFlight();
    handlers.PZ2QoL_StoreReset('park');
    assert.equal(loads(), 2);
    answer(true, JSON.stringify({ count: 5 }));
    handlers.PZ2QoL_StoreSaved(saveId, true);
    assert.equal(store.getUserData('count'), 5);
});

test('a change still waiting for its save stays out of the next zoo after a park reset', () => {
    store._resetUserStoreForTests();
    store.loadUserData();
    answer(true, '{}');
    store.updateUserData('kinMute', () => ({ lion: true }));
    handlers.PZ2QoL_StoreReset('park');
    answer(true, JSON.stringify({ kinMute: { tiger: true } }));
    assert.deepEqual(store.getUserData('kinMute'), { tiger: true });
});
