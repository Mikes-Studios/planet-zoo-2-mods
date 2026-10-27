import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages();

// The game's player save as the Lua side keeps it, shared by the hub and park pages.
const handlers = {};
let store = JSON.stringify({ kinSettings: { boxedAfterS: 30 } });
globalThis.engine = {
    on(name, fn) {
        handlers[name] = fn;
    },
    trigger(name, ...args) {
        if (name === 'PZ2QoL_PrefsLoad') setTimeout(() => handlers.PZ2QoL_PrefsData(args[0], true, store), 5);
        if (name === 'PZ2QoL_PrefsSave') {
            store = args[1];
            setTimeout(() => handlers.PZ2QoL_PrefsSaved(args[0], true), 1);
        }
    },
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const { getKinSettings, setKinSettings } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kin.js');

const { DEFAULT_KIN_SETTINGS, KIN_SETTINGS, isChoice } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinsettings.js');

test('every Kin setting has one entry: its default and its words in Settings', () => {
    assert.equal(Object.keys(DEFAULT_KIN_SETTINGS).length, KIN_SETTINGS.length);
    assert.equal(DEFAULT_KIN_SETTINGS.closeKinship, 1 / 16);
    for (const s of KIN_SETTINGS.filter(x => x.section)) {
        assert.ok(s.choices ? s.choices.some(c => isChoice(s.default, c.value)) : typeof s.default === 'boolean' && s.label && s.tip, s.key);
        if (s.needs) assert.ok(s.needs in DEFAULT_KIN_SETTINGS, s.key);
    }
});

test('a Kin setting changed on this page keeps the one the other page saved meanwhile', async () => {
    await wait(50);
    assert.equal(getKinSettings().boxedAfterS, 30);
    store = JSON.stringify({ kinSettings: { boxedAfterS: 30, alertKin: true } });
    setKinSettings({ alerts: false });
    await wait(1000);
    assert.deepEqual(JSON.parse(store).kinSettings, { boxedAfterS: 30, alertKin: true, alerts: false });
});
