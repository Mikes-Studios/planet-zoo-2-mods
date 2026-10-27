// The Breeding programme's fine tuning (kinprogtune.js): known keys and
// choices only, defaults left out, applied on top of the options, a stable
// cache key, and the engine reads every tuned option.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMME_TUNING, applyTuning, normalizeTuning, tuningChoice, tuningCount, tuningKey } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogtune.js';
import { PROGRAMME_DEFAULTS } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import { programmeOptionsFor } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';

test('every tuning has one default choice and options the engine knows', () => {
    for (const t of PROGRAMME_TUNING) {
        assert.equal(t.choices.filter(c => c.id === 'default').length, 1, t.key);
        assert.ok(!t.choices.find(c => c.id === 'default').value, `${t.key}: the default changes nothing`);
        for (const c of t.choices) for (const k of Object.keys(c.value || {})) assert.ok(k in PROGRAMME_DEFAULTS, `${t.key}.${c.id}: ${k}`);
        assert.equal(new Set(t.choices.map(c => c.id)).size, t.choices.length, `${t.key}: ids repeat`);
    }
});

test('normalizeTuning keeps known keys and choices, drops defaults and junk', () => {
    // relatives are never paired: there is no tuning that allows it, and a kept choice for it is dropped
    assert.deepEqual(normalizeTuning({ structurePenalty: 'soft', relatedPenalty: 'allow', lineBonus: 'default', bogus: 'x', spareOut: 'nope' }), { structurePenalty: 'soft' });
    assert.deepEqual(normalizeTuning(null), {});
    assert.deepEqual(normalizeTuning(['soft']), {});
});

test('applyTuning puts the choices on top, the rest untouched', () => {
    const base = { moveCost: 0.08, useTradeCentre: true, maxEvaluations: 3000000, timeBudgetMs: 6000 };
    assert.deepEqual(applyTuning(base, null), base);
    const o = applyTuning(base, { moveCost: 'free', search: 'quick', spareOut: 'stay', defaultCapacity: '12' });
    assert.equal(o.moveCost, 0);
    assert.equal(o.maxEvaluations, 600000);
    assert.equal(o.timeBudgetMs, 1500);
    assert.equal(o.spareOut, false);
    assert.equal(o.defaultCapacity, 12);
    assert.equal(o.useTradeCentre, true);
    assert.equal(base.moveCost, 0.08, 'the input is not changed');
});

test('tuningKey is stable and empty for the defaults', () => {
    assert.equal(tuningKey({}), '');
    assert.equal(tuningKey({ lineBonus: 'default' }), '');
    assert.equal(tuningKey({ spareOut: 'stay', lineBonus: 'off' }), tuningKey({ lineBonus: 'off', spareOut: 'stay' }));
    assert.equal(tuningCount({ spareOut: 'stay', lineBonus: 'off', x: 1 }), 2);
    assert.equal(tuningChoice({}, 'structurePenalty').id, 'default');
    assert.equal(tuningChoice({ structurePenalty: 'soft' }, 'structurePenalty').label, 'Soft');
});

test('Auto mode applies the tuning on top of its own search budget', () => {
    const settings = { step: 3, trade: true };
    const plain = programmeOptionsFor(settings, 'auto', null);
    assert.equal(plain.structurePenalty, undefined);
    const tuned = programmeOptionsFor(settings, 'auto', null, { structurePenalty: 'soft', search: 'long' });
    assert.equal(tuned.structurePenalty, 0.3);
    assert.equal(tuned.maxEvaluations, 10000000);
    assert.equal(tuned.moveCost, plain.moveCost);
});
