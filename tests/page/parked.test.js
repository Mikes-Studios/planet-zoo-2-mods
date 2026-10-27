import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeParked, planAutoRun } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { HIPPO, HIPPO_INFO, Sex, TRADE, animal, strands, zoo } from './zoo.js';

// a strong young male Auto mode parked at the trade centre a year ago, a weak bull with the cows
function herd() {
    const model = zoo([
        animal('Weak', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1'),
        animal('Strong', Sex.Male, TRADE, { age: 8 }),
    ]);
    model.animals.get('Weak').genes = strands(1);
    model.animals.get('Strong').genes = strands(5);
    for (const id of ['Cow', 'Cow2']) model.animals.get(id).genes = strands(5);
    return model;
}

const view = () => ({ pinned: new Set(), manual: new Set(), cooled: new Set(['Strong']), leaving: new Set(), movedAt: new Map([['Strong', 3]]) });

function plan(model, v) {
    return planAutoRun({ model, species: HIPPO, info: HIPPO_INFO, settings: { on: true, thin: false, trade: true }, view: v });
}

test('a breeder Auto mode parked stays parked while the herd is as it left it', () => {
    const model = herd();
    const v = view();
    const { cooled, freed } = freeParked(model, HIPPO, v, 2.5);
    assert.deepEqual(freed, []);
    assert.deepEqual([...cooled], ['Strong']);
    assert.ok(!plan(model, Object.assign(v, { cooled })).moves.some(m => m.id === 'Strong'));
});

test('once the herd changes, a parked breeder is weighed again and takes the place of a weaker sire, no move back', () => {
    const model = herd();
    const v = Object.assign(view(), { recentFrom: new Map([['Strong', new Set(['H1'])]]) });
    const { cooled, freed, recentFrom } = freeParked(model, HIPPO, v, 3.2);
    assert.deepEqual(freed, ['Strong']);
    const moves = plan(model, Object.assign(v, { cooled, recentFrom })).moves;
    const back = moves.find(m => m.id === 'Strong' && m.to === 'H1');
    assert.ok(back, JSON.stringify(moves));
    assert.equal(back.reversal, false, 'freed by a herd change: no back and forth');
});

test('one sent there to leave, or one never moved by Auto mode, is not freed', () => {
    const model = herd();
    const leaving = Object.assign(view(), { leaving: new Set(['Strong']) });
    assert.deepEqual(freeParked(model, HIPPO, leaving, 9).freed, []);
    const unknown = Object.assign(view(), { movedAt: new Map() });
    assert.deepEqual(freeParked(model, HIPPO, unknown, 9).freed, []);
});
