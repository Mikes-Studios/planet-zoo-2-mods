import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankHabitats, runPlacement } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/storagesendcore.js';
import { fakeGame } from './storagerun.js';

const unplaced = id => ({ id, name: `A${id}`, species: 'Okapi', lt: 'other', assigned: '', moving: false, habitats: [{ id: '9', ok: true, name: 'H' }] });

test('Stop during a move ends the placement run after one more look, without polling the game', async () => {
    const game = fakeGame({ facts: unplaced, stopOnMove: true });
    const final = await runPlacement(['1', '2', '3'], game.deps);
    assert.equal(final.stopped, true);
    assert.deepEqual(game.moves, ['1>9']);
    assert.ok(game.factsAfterStop <= 1, `asked the game ${game.factsAfterStop} times after Stop`);
    assert.deepEqual(final.log.map(e => e.reason), ['stopped before the game confirmed it']);
});

test('a placement surveys the habitats once per animal and polls with the short status', async () => {
    let statusCalls = 0;
    const game = fakeGame({ facts: unplaced });
    game.deps.status = async id => {
        statusCalls++;
        return Object.assign(unplaced(id), { moving: game.moves.length > 0 });
    };
    const final = await runPlacement(['1'], game.deps);
    assert.deepEqual(final.log.map(e => e.ok), [true]);
    assert.equal(game.factsCalls, 1, 'one full survey');
    assert.equal(statusCalls, 1, 'the confirmation came from the status read');
});

test('habitats rank its own, a parent\'s, the biggest group of its species, then the least crowded other', () => {
    const facts = {
        assigned: 'own',
        parentHabs: ['mum'],
        habitats: [
            { id: 'empty', ok: true, total: 0 },
            { id: 'busy', ok: true, total: 6 },
            { id: 'few', ok: true, same: 1, total: 2 },
            { id: 'many', ok: true, same: 4, total: 4 },
            { id: 'manyCrowded', ok: true, same: 9, total: 9, crowded: true },
            { id: 'mum', ok: true, same: 1, total: 3 },
            { id: 'own', ok: true, total: 5 },
            { id: 'closed', ok: false, same: 9 },
            { id: 'unreachable', ok: true, same: 9, reach: false },
        ],
    };
    const ranked = rankHabitats(facts);
    assert.deepEqual(ranked.map(hab => hab.id), ['own', 'mum', 'many', 'few', 'manyCrowded', 'empty', 'busy']);
    assert.deepEqual(ranked.slice(0, 3).map(hab => hab.why), ['its own habitat', 'with a parent', 'with its species']);
});
