import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autosaveSummary } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/autosavecore.js';

const failed = { available: true, minutes: 5, inPark: true, armed: true, lastError: 'The game refused the autosave request.', sinceSave: -1 };
const detail = (state, age) => autosaveSummary(Object.assign({}, failed, state), age).detail;

test('a failed autosave says when the mod tries next, counted down from the card clock', () => {
    assert.equal(detail({ retryIn: 60, nextTry: 'retry' }, 15), 'The game refused the autosave request. The mod tries again in 45 s.');
    assert.equal(detail({ retryIn: 180, nextTry: 'interval' }, 0), 'The game refused the autosave request. The mod tries again at its next autosave, in 3 min; Save now tries at once.');
    assert.equal(detail({ retryIn: null, nextTry: 'manual' }, 0), 'The game refused the autosave request. Press Save now to try again.');
    assert.equal(detail({ retryIn: null, nextTry: 'waiting' }, 0), 'The game refused the autosave request. A save is due; waiting for the game to get its autosave ready.');
});
