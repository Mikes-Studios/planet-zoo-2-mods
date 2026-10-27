// node --test tests/kinsettings.test.mjs
// The Kin settings table (kinsettings.js): one entry per setting, from which
// kin.js takes the defaults and the Kin planner draws its Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_KIN_SETTINGS, KIN_SETTINGS, isChoice } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinsettings.js';
import { DEFAULT_CLOSE_KINSHIP } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';

test('every Kin setting has one entry and one default', () => {
    const keys = KIN_SETTINGS.map(s => s.key);
    assert.equal(new Set(keys).size, keys.length, 'no key twice');
    assert.deepEqual(Object.keys(DEFAULT_KIN_SETTINGS), keys);
    assert.equal(DEFAULT_KIN_SETTINGS.closeKinship, DEFAULT_CLOSE_KINSHIP);
    assert.equal(DEFAULT_KIN_SETTINGS.releaseBoxed, true);
});

test('what the mod does by itself that it did not do before starts off', () => {
    for (const key of ['autoOnAssign', 'autoEarlySale', 'autoHouseWaiting', 'autoContraception', 'uniqueNames', 'overdueBox']) assert.equal(DEFAULT_KIN_SETTINGS[key], false, key);
});

test('a setting shown in Settings has words, a valid default and a known dependency', () => {
    for (const s of KIN_SETTINGS.filter(x => x.section)) {
        if (s.choices) assert.ok(s.choices.some(c => isChoice(s.default, c.value)), `${s.key}: the default is one of its choices`);
        else assert.ok(typeof s.default === 'boolean' && s.label && s.tip, `${s.key}: a switch with a label and a tip`);
        if (s.needs) assert.equal(typeof DEFAULT_KIN_SETTINGS[s.needs], 'boolean', `${s.key}: needs a switch`);
    }
});

test('the Settings sections, by what each setting affects', () => {
    const sections = [...new Set(KIN_SETTINGS.filter(s => s.section).map(s => s.section))];
    assert.deepEqual(sections, ['Auto mode', 'Names', 'Transport boxes', 'Trade centre', 'Alerts', 'Show', 'Close kin from']);
});

test('isChoice matches the close-kin fraction however it was kept', () => {
    assert.ok(isChoice(0.0625, 1 / 16));
    assert.ok(isChoice('0.0625', 1 / 16));
    assert.ok(!isChoice(1 / 8, 1 / 16));
    assert.ok(isChoice('action', 'action'));
});
