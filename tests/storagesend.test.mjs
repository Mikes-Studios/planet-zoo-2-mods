import test from 'node:test';
import assert from 'node:assert/strict';
import {
    blockedReason, ERROR_PAUSE_MS, moveConfirmed, parseIdList, pickHabitat, rankHabitats, runPlacement, sendButtonLabel, skipReason, summarize, summaryText, TIER,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/storagesendcore.js';

const hab = (id, extra = {}) => Object.assign({ id: String(id), name: `H${id}`, ok: true, reach: true, total: 5, same: 0, crowded: false }, extra);
const facts = (extra = {}) => Object.assign({ id: '7', name: 'Kesi', species: 'Lion', alive: true, lt: 'other', moving: false, assigned: '', busy: false, mode: 'offline', parentHabs: [], habitats: [] }, extra);

test('ids and labels', () => {
    assert.deepEqual(parseIdList('12, 13,abc,12,,14'), ['12', '13', '14']);
    assert.deepEqual(parseIdList(null), []);
    assert.equal(sendButtonLabel(70), 'Find a habitat (70)');
    assert.equal(sendButtonLabel(1), 'Find a habitat');
});

test('the button: needs a selection and the game allowing Send to Zoo (in Franchise the click is the go-ahead)', () => {
    assert.match(blockedReason({ count: 0 }), /Select/);
    assert.match(blockedReason({ count: 3, sendAllowed: false }), /can't send/);
    assert.match(blockedReason({ count: 3, moving: true }), /already sending/);
    assert.equal(blockedReason({ count: 3, franchise: true }), '');
    assert.equal(blockedReason({ count: 3 }), '');
});

test('ranking: own habitat, then a parent, then its species (biggest group), then the least crowded other', () => {
    const f = facts({
        assigned: '',
        parentHabs: ['30'],
        habitats: [
            hab(10, { total: 2 }),
            hab(11, { total: 9 }),
            hab(20, { same: 2, total: 6 }),
            hab(21, { same: 5, total: 8 }),
            hab(30, { same: 1, total: 4 }),
            hab(40, { ok: false, reason: 'wrong type' }),
            hab(41, { reach: false, same: 9 }),
        ],
    });
    const r = rankHabitats(f);
    assert.deepEqual(r.map(x => x.id), ['30', '21', '20', '10', '11']);
    assert.equal(r[0].tier, TIER.parent);
    assert.equal(r[1].tier, TIER.species);
    assert.equal(r[3].tier, TIER.any);
    // its own (assigned) habitat beats everything
    assert.equal(rankHabitats(Object.assign({}, f, { assigned: '11' }))[0].id, '11');
    // a crowded habitat comes after an uncrowded one of the same tier
    const c = rankHabitats(facts({ habitats: [hab(1, { same: 3, crowded: true }), hab(2, { same: 1 })] }));
    assert.deepEqual(c.map(x => x.id), ['2', '1']);
});

test('fails open to any habitat the game allows; skip reasons otherwise', () => {
    assert.equal(pickHabitat(facts({ habitats: [hab(5)] })).hab.id, '5');
    assert.equal(skipReason(null), 'the game did not answer');
    assert.equal(skipReason(facts({ gone: true })), 'no longer in the zoo');
    assert.equal(skipReason(facts({ error: 'nopark' })), 'no park is running');
    assert.equal(skipReason(facts({ moving: true, habitats: [hab(1)] })), 'already on its way somewhere');
    assert.equal(skipReason(facts({ lt: 'habitat', assigned: '3', habitats: [hab(1)] })), 'already in a habitat');
    assert.equal(skipReason(facts({ habitats: [] })), 'this zoo has no finished habitat');
    assert.equal(skipReason(facts({ habitats: [hab(1, { ok: false })] })), 'no habitat accepts Lion');
    // the game's name when the page added one (speciesnames.js)
    assert.equal(skipReason(facts({ speciesName: 'Löwe', habitats: [hab(1, { ok: false })] })), 'no habitat accepts Löwe');
    assert.equal(skipReason(facts({ habitats: [hab(1, { reach: false })] })), 'no keeper can reach a suitable habitat');
});

test('confirmation: a transport job or already there', () => {
    assert.equal(moveConfirmed(facts({ moving: true }), '1'), true);
    assert.equal(moveConfirmed(facts({ lt: 'habitat', assigned: '1' }), '1'), true);
    assert.equal(moveConfirmed(facts({ lt: 'habitat', assigned: '2' }), '1'), false);
    assert.equal(moveConfirmed(null, '1'), false);
});

test('summary groups skips by reason and sends by habitat', () => {
    const s = summarize([
        { ok: true, habitat: 'Savannah' }, { ok: true, habitat: 'Savannah' }, { ok: true, habitat: 'Forest' },
        { ok: false, reason: 'no habitat accepts Lion' }, { ok: false, reason: 'no habitat accepts Lion' }, { ok: false, reason: 'refused: busy' },
    ], 8);
    assert.equal(s.sent, 3);
    assert.equal(s.skipped, 3);
    assert.deepEqual(s.habitats, [{ name: 'Savannah', n: 2 }, { name: 'Forest', n: 1 }]);
    assert.deepEqual(s.reasons[0], { text: 'no habitat accepts Lion', n: 2 });
    assert.equal(summaryText(s), 'Sent 3 of 8 to a habitat · skipped 3 · 2 not tried (stopped)');
});

// A fake game: animals with facts; a move gives the animal a transport job
// unless the id is refused; a clock that only moves when the run sleeps.
function fakeGame({ animals, refuse = [], neverConfirm = [], busyFor = {} }) {
    let clock = 0;
    const events = [];
    const state = new Map(animals.map(a => [a.id, Object.assign(facts(), a)]));
    return {
        events,
        state,
        deps: {
            now: () => clock,
            sleep: async ms => {
                events.push(['sleep', ms]);
                clock += ms;
            },
            paceMs: () => 1500,
            facts: async id => {
                events.push(['facts', id]);
                const f = state.get(id);
                if (!f) return { id, gone: true };
                const busy = busyFor[id] && clock < busyFor[id];
                return JSON.parse(JSON.stringify(Object.assign({}, f, { busy: !!busy })));
            },
            move: async (id, habId) => {
                events.push(['move', id, habId]);
                if (refuse.includes(id)) return { ok: false, detail: 'The game refused the move.' };
                if (!neverConfirm.includes(id)) state.get(id).moving = true;
                return { ok: true, detail: '' };
            },
        },
    };
}

test('run: one move at a time, each confirmed, a pause after each, failures skipped and the run carries on', async () => {
    const zoo = [hab(1, { same: 2 }), hab(2)];
    const g = fakeGame({
        animals: [
            { id: '1', habitats: zoo },
            { id: '2', habitats: zoo },
            { id: '3', habitats: [hab(1, { ok: false })] }, // no habitat accepts it
            { id: '4', habitats: zoo },
            { id: '5', habitats: zoo },
        ],
        refuse: ['2'],
        neverConfirm: ['4'],
    });
    const updates = [];
    const final = await runPlacement(['1', '2', '3', '4', '5', '6'], Object.assign({}, g.deps, { onUpdate: s => updates.push(s) }));
    assert.equal(final.finished, true);
    assert.equal(final.running, false);
    const sent = final.log.filter(e => e.ok).map(e => e.id);
    const skipped = final.log.filter(e => !e.ok).map(e => [e.id, e.reason]);
    assert.deepEqual(sent, ['1', '5']);
    assert.deepEqual(skipped.map(s => s[0]), ['2', '3', '4', '6']);
    assert.match(skipped[0][1], /^refused/);
    assert.equal(skipped[1][1], 'no habitat accepts Lion');
    assert.equal(skipped[2][1], 'not confirmed by the game in time');
    assert.equal(skipped[3][1], 'no longer in the zoo');
    // exactly one move per animal tried, in order, to the best habitat
    const moves = g.events.filter(e => e[0] === 'move');
    assert.deepEqual(moves, [['move', '1', '1'], ['move', '2', '1'], ['move', '4', '1'], ['move', '5', '1']]);
    // a pause follows every move before the next one
    for (let i = 0; i < g.events.length; i++) {
        if (g.events[i][0] !== 'move') continue;
        const nextMove = g.events.findIndex((e, j) => j > i && e[0] === 'move');
        if (nextMove < 0) continue;
        assert.ok(g.events.slice(i, nextMove).some(e => e[0] === 'sleep' && e[1] >= 1500), 'pause between moves');
    }
    assert.ok(updates.length > 6);
});

test('run online: a longer pause after a refusal, waits while the game is busy', async () => {
    const zoo = [hab(1)];
    const g = fakeGame({ animals: [{ id: '1', habitats: zoo }, { id: '2', habitats: zoo }], refuse: ['1'], busyFor: { 2: ERROR_PAUSE_MS + 2000 } });
    const final = await runPlacement(['1', '2'], Object.assign({}, g.deps, { online: true }));
    const iMove1 = g.events.findIndex(e => e[0] === 'move' && e[1] === '1');
    assert.deepEqual(g.events[iMove1 + 1], ['sleep', ERROR_PAUSE_MS]);
    // animal 2's move only after the game is no longer busy
    const iMove2 = g.events.findIndex(e => e[0] === 'move' && e[1] === '2');
    assert.ok(iMove2 > 0);
    const busySleeps = g.events.slice(iMove1 + 2, iMove2).filter(e => e[0] === 'sleep').length;
    assert.ok(busySleeps >= 1, 'waited for the busy flag');
    assert.deepEqual(final.log.map(e => e.ok), [false, true]);
});

test('Stop ends the run before the next animal', async () => {
    const zoo = [hab(1)];
    const g = fakeGame({ animals: ['1', '2', '3'].map(id => ({ id, habitats: zoo })) });
    let stop = false;
    const final = await runPlacement(['1', '2', '3'], Object.assign({}, g.deps, {
        isStopped: () => stop,
        onUpdate: s => { if (s.log.length === 1) stop = true; },
    }));
    assert.equal(final.stopped, true);
    assert.equal(g.events.filter(e => e[0] === 'move').length, 1);
    assert.equal(final.log.length, 1);
});
