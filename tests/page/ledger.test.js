import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { AGES_MAX, cleanFor, cleanHabitatIds, emptyLedger, fitBudget, ledgerView, logAction, normalizeLedger, refusedMoves, savedSize, settleAction } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautoledger.js';
import { HIPPO, HIPPO_FACTS, Sex, TRADE, animal } from './zoo.js';

// Leo in habitat 1; habs: [id, name, the game's habitat id]
function park(habs) {
    return buildKinModel({
        animals: [animal('Leo', Sex.Male, '1')],
        habitats: habs.map(([id, name]) => ({ id, name, kind: 'habitat' })),
        habs: habs.map(([id, name, hid]) => ({ id, name, hid })),
        speciesFacts: { [HIPPO]: HIPPO_FACTS },
    });
}

function refuseThrice(model, to) {
    const l = emptyLedger();
    for (let i = 0; i < 3; i++) {
        const e = logAction(l, model, { id: 'Leo', to, reason: 'test' }, { run: 1, clock: 1, realNow: 1000, species: HIPPO });
        settleAction(l, e, { id: 'Leo', to }, false, { clock: 1, realNow: 1000, why: 'refused' });
    }
    return l;
}

test('a refused move is blocked for that habitat only, whatever the habitats are called', () => {
    for (const [label, habs] of [
        ['two habitats share a name', [['1', 'Home', '11'], ['2', 'Savannah', '22'], ['3', 'Savannah', '33']]],
        ['a name with ">" in it', [['1', 'Home', '11'], ['2', 'A>B', '22']]],
        ['a habitat without a name', [['1', 'Home', '11'], ['2', '', '22']]],
    ]) {
        const model = park(habs);
        const l = refuseThrice(model, '2');
        assert.deepEqual([...ledgerView(l, model, 1, 2000).blocked], ['Leo>2'], label);
        assert.deepEqual(refusedMoves(l, model, HIPPO), [{ id: 'Leo', to: '2' }], label);
    }
});

test('the save budget drops the oldest histories and refusals first and never a "sent away" record', () => {
    const l = emptyLedger();
    for (let i = 0; i < 150; i++) {
        // the newest histories come first in key order
        l.hist[`g${i}`] = [['Savannah Habitat', '101', 10 - i * 0.01]];
        l.fails[`f${i}>101`] = [1, 1000, 10 - i * 0.01];
        l.leave[`s${i}`] = 1;
    }
    fitBudget(l, savedSize(l) - 4000);
    const kept = Object.keys(l.hist);
    assert.ok(kept.length < 150, 'nothing trimmed');
    assert.deepEqual(kept, Array.from({ length: kept.length }, (_, i) => `g${i}`), 'not the oldest histories went');
    assert.equal(Object.keys(l.leave).length, 150);
});

test('a breeder sent away for no place stays usable; a spare sent away is held to leave', () => {
    const model = park([['1', 'Home', '11']]);
    const send = leave => {
        const l = emptyLedger();
        const x = { id: 'Leo', to: TRADE, reason: leave ? 'its young would score well below' : 'no place in a breeding group', leave };
        settleAction(l, logAction(l, model, x, { run: 1, clock: 1, realNow: 1000, species: HIPPO }), x, true, { clock: 1, realNow: 1000 });
        return [...ledgerView(l, model, 1, 2000).leaving];
    };
    assert.deepEqual(send(false), []);
    assert.deepEqual(send(true), ['Leo']);
});

test("switching Auto mode on for a species forgets its animals' moves, hand moves and leaving marks, not hands off", async () => {
    const { emptyLedger, forgetSpecies } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautoledger.js');
    const { zoo: build, animal: one, Sex: S } = await import('./zoo.js');
    const model = build([one('Lion', S.Male, 'H1'), one('Other', S.Female, 'H1', { species: 'Giraffe' })]);
    const l = emptyLedger();
    for (const g of ['g_Lion', 'g_Other']) {
        l.hist[g] = [['H2', '', 1]];
        l.manual[g] = 9;
        l.leave[g] = 1;
        l.pins[g] = 1;
    }
    forgetSpecies(l, model, model.animals.get('Lion').species);
    assert.deepEqual([l.hist.g_Lion, l.manual.g_Lion, l.leave.g_Lion, l.pins.g_Lion], [undefined, undefined, undefined, 1]);
    assert.deepEqual([l.hist.g_Other, l.manual.g_Other, l.leave.g_Other], [[['H2', '', 1]], 9, 1]);
});

test('the remembered trade-centre ages keep the newest few and survive a save', () => {
    const l = emptyLedger();
    for (let i = 0; i < AGES_MAX + 10; i++) l.ages[`0|a${i}|1.2.3.4`] = [30, i];
    fitBudget(l);
    assert.equal(Object.keys(l.ages).length, AGES_MAX);
    assert.ok(!('0|a0|1.2.3.4' in l.ages), 'the oldest go first');
    assert.deepEqual(normalizeLedger(JSON.parse(JSON.stringify(l))).ages, l.ages);
});

test('a Clean up is kept as the whole zoo or as its habitats by name and id, and found again on the next load', () => {
    assert.deepEqual(normalizeLedger(Object.assign(emptyLedger(), { clean: true })).clean, { zoo: true });
    assert.equal(normalizeLedger(Object.assign(emptyLedger(), { clean: { habs: [] } })).clean, false);
    const before = park([['1', 'Savanna', 'h7'], ['2', 'Pond', 'h8']]);
    const clean = cleanFor(before, ['1']);
    assert.deepEqual(clean, { habs: [['Savanna', 'h7']] });
    assert.deepEqual(cleanFor(before, 'zoo'), { zoo: true });
    assert.equal(cleanFor(before, []), false);
    const l = normalizeLedger(Object.assign(emptyLedger(), { clean }));
    const after = park([['30', 'Pond', 'h8'], ['31', 'Savanna', 'h7']]);
    assert.deepEqual(Array.from(cleanHabitatIds(l, after)), ['31'], 'the same habitat under its new id');
    assert.deepEqual(Array.from(cleanHabitatIds(l, park([['30', 'Pond', 'h8']]))), [], 'a habitat gone since is left out');
});
