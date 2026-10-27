import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOSAVE_CHOICES, AUTOSAVE_MIN_MINUTES, autosaveSummary, fmtDuration, parseAutosaveState } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/autosavecore.js';

const base = { minutes: 5, minMinutes: 2, available: true, inPark: true, armed: true, pending: false, elapsed: 60, retryIn: 0, sinceSave: 60, lastKind: 'mod', lastError: '' };

test('choices never go below the 2-minute minimum', () => {
    assert.equal(AUTOSAVE_MIN_MINUTES, 2);
    for (const m of AUTOSAVE_CHOICES) assert.ok(m === 0 || m >= AUTOSAVE_MIN_MINUTES);
});

test('durations', () => {
    assert.equal(fmtDuration(12), '12 s');
    assert.equal(fmtDuration(125), '2 min');
    assert.equal(fmtDuration(3600), '1 h');
    assert.equal(fmtDuration(3900), '1 h 5 min');
    assert.equal(fmtDuration(-5), '0 s');
});

test('countdown in the park, ticking locally between updates', () => {
    const s = autosaveSummary(base, 30);
    assert.equal(s.tone, 'on');
    assert.equal(s.short, '5m');
    assert.equal(s.left, 210);
    assert.match(s.detail, /Next save in 3 min/);
    assert.match(s.last, /Last save 1 min ago by the mod/);
});

test('away from the park the clock waits', () => {
    const s = autosaveSummary(Object.assign({}, base, { inPark: false, armed: false }), 500);
    assert.equal(s.left, 240);
    assert.match(s.detail, /waits while you are away/);
});

test('due, saving, failed, off and unavailable', () => {
    assert.equal(autosaveSummary(Object.assign({}, base, { elapsed: 400 })).tone, 'due');
    assert.match(autosaveSummary(Object.assign({}, base, { elapsed: 400, armed: false })).detail, /waiting for the game/);
    assert.equal(autosaveSummary(Object.assign({}, base, { pending: true })).title, 'Saving…');
    // the next try as Lua plans it (nextTry): only a real retry is promised
    const failed = autosaveSummary(Object.assign({}, base, { lastError: 'The game refused the autosave request.', retryIn: 40, nextTry: 'retry' }));
    assert.equal(failed.tone, 'bad');
    assert.match(failed.detail, /The mod tries again in 40 s/);
    const noRetry = autosaveSummary(Object.assign({}, base, { lastError: 'The game refused the autosave request.', retryIn: 40 }));
    assert.match(noRetry.detail, /Press Save now to try again/);
    assert.equal(autosaveSummary(Object.assign({}, base, { minutes: 0 })).short, 'Off');
    assert.equal(autosaveSummary(Object.assign({}, base, { available: false })).short, 'Game');
    assert.equal(autosaveSummary(Object.assign({}, base, { sinceSave: -1 })).last, 'No save yet this session');
});

test('state parsing', () => {
    assert.deepEqual(parseAutosaveState('{"minutes":5}'), { minutes: 5 });
    assert.equal(parseAutosaveState('nope'), null);
});
