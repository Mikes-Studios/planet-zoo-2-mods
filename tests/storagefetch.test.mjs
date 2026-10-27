import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALL_SPECIES, arrivalSkip, cleanName, fetchName, isAllSpecies, ERROR_PAUSE_MS, excludeList, fetchBlockReason, fetchNote, leftLines, parseExclude, pickedText, pickRows, runTradeArrivals,
    sameKeys, tradeConfirmed, tradeSummary, tradeSummaryText, skipText,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/storagefetchcore.js';
import { parseCounts, tradeBlockReason } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/tradejumpcore.js';

const row = (id, extra = {}) => Object.assign({ id: String(id), key: 'k' + id, name: 'Animal ' + id, species: '[Animal_Okapi]', sex: 1, maturity: 2, isShoal: false, isMoving: false }, extra);

test('names and the exclude list', () => {
    assert.equal(cleanName("  Zawadi O'Neil  "), 'zawadi oneil');
    assert.equal(cleanName(null), '');
    const ex = excludeList([
        { species: 'Okapi', guid: '123', name: 'Zuri', sex: 1 },
        { species: 'Okapi', guid: 'bad guid!', name: 'Bo', sex: 0 },
        { species: 'Lion', guid: '9', name: 'Kesi', sex: 0 },
    ], 'Okapi');
    // a name carries its species: Bring all spans species, and names repeat across them
    assert.equal(ex, 'g:123,n:1:okapi:zuri,n:0:okapi:bo');
    const p = parseExclude(ex + ',junk,g:,n:x');
    assert.deepEqual([...p.guids], ['123']);
    assert.deepEqual([...p.names], ['1:okapi:zuri', '0:okapi:bo']);
});

test('pickRows: species, skips, adults first, cap by room', () => {
    const rows = [
        row(1, { name: 'Cleo', maturity: 0 }),            // young
        row(2, { name: 'Asha' }),                         // fertile adult
        row(3, { name: 'Bo', maturity: 5 }),              // old
        row(4, { name: 'Dot', isShoal: true }),
        row(5, { name: 'Eve', isMoving: true }),
        row(6, { name: 'Fay', auctionTimerSeconds: 300 }),
        row(7, { name: 'Zuri', guid: '123' }),            // in the zoo by guid
        row(8, { name: 'Zawadi', sex: 1 }),               // in the zoo by sex, species and name
        row(9, { name: 'Gus', species: '[Animal_Lion]' }),
        row(10, { name: 'Ada' }),
    ];
    const exclude = parseExclude('g:123,n:1:okapi:zawadi');
    const all = pickRows(rows, { species: 'Okapi', room: -1, exclude });
    assert.deepEqual(all.picked.map(r => r.name), ['Ada', 'Asha', 'Bo', 'Cleo']);
    assert.deepEqual([all.shoals.length, all.moving.length, all.listed.length, all.here.length, all.left.length], [1, 1, 1, 2, 0]);
    const two = pickRows(rows, { species: 'okapi', room: 2, exclude });
    assert.deepEqual(two.picked.map(r => r.name), ['Ada', 'Asha']);
    assert.deepEqual(two.left.map(r => r.name), ['Bo', 'Cleo']);
    assert.equal(pickRows(rows, { species: 'Okapi', room: 0, exclude }).picked.length, 0);
    assert.equal(pickRows(rows, { species: 'Okapi', room: null }).picked.length, 6); // no exclude, unknown room
    assert.equal(pickedText(all, -1), '4 animals: 3 adults, 1 young');
    assert.equal(pickedText(two, 2), '2 animals · room for 2');
    const lines = leftLines(two);
    assert.match(lines[0], /No room for 2 .*Bo, Cleo stay in storage/);
    assert.ok(lines.some(l => /2 are already in this zoo/.test(l)));
    assert.ok(lines.some(l => /1 shoal stays/.test(l)));
});

test('sameKeys', () => {
    assert.ok(sameKeys(['a', 'b'], ['b', 'a']));
    assert.ok(!sameKeys(['a'], ['a', 'b']));
    assert.ok(!sameKeys(['a', 'c'], ['a', 'b']));
    assert.ok(sameKeys([], null));
});

test('the board button: block reasons and the note', () => {
    assert.equal(fetchBlockReason({}), '');
    assert.match(fetchBlockReason({ tradeBlock: 'A move plan is running' }), /plan/);
    assert.match(fetchBlockReason({ hasTradeCentre: false }), /Build a trade centre/);
    assert.match(fetchBlockReason({ tcNow: 12, tcMax: 12 }), /full \(12\/12\)/);
    assert.equal(fetchBlockReason({ tcNow: 250, tcMax: 250, mode: 'franchise' }), 'Your storage is full (all zoos, 250/250)');
    assert.equal(fetchBlockReason({ tcNow: 3, tcMax: 12, adults: 0 }), ''); // young may still be there
    assert.equal(fetchNote({ speciesName: 'Okapi', adults: 8, tcNow: 3, tcMax: 12 }), '8 adults in storage (+ any young) · trade centre 3/12');
    assert.equal(fetchNote({ speciesName: 'Okapi', adults: null }), 'Okapi in storage: count unknown here');
    assert.equal(fetchNote({ speciesName: 'Okapi', adults: 8, tcNow: 90, tcMax: 250, mode: 'franchise' }), '8 adults in storage (+ any young) · storage, all zoos 90/250');
    assert.match(fetchNote({ speciesName: 'Okapi', adults: 0 }), /No adult Okapi/);
    assert.match(tradeBlockReason({ sendRunning: true }), /being placed/);
});

test('parseCounts passes the trade centre through', () => {
    const c = parseCounts('{"ok":true,"mode":"franchise","tc":true,"tcNow":3,"tcMax":12,"bySpecies":{"Okapi":{"m":1,"f":2}}}');
    assert.equal(c.tc, true);
    assert.equal(c.tcNow, 3);
    assert.equal(c.tcMax, 12);
    const d = parseCounts('{"ok":true,"bySpecies":{}}');
    assert.equal(d.tcNow, undefined);
    assert.equal(d.tc, undefined);
});

test('arrival checks', () => {
    assert.ok(tradeConfirmed({ lt: 'trade' }));
    assert.ok(tradeConfirmed({ lt: 'other', moving: true }));
    assert.ok(!tradeConfirmed({ lt: 'other' }));
    assert.ok(!tradeConfirmed(null));
    assert.equal(arrivalSkip({ lt: 'other', tc: '5', tcNow: 1, tcMax: 4 }), '');
    assert.equal(arrivalSkip({ lt: 'other', boxed: true, tc: '5' }), ''); // boxed is fine: the Move screen's own sequence
    // a skip is a code, worded in one place (skipText)
    const why = f => skipText(arrivalSkip(f));
    assert.equal(why({ gone: true }), 'no longer in the zoo');
    assert.equal(why({ lt: 'other', tc: '' }), 'this zoo has no trade centre');
    assert.equal(why({ lt: 'other', tc: '5', tcNow: 4, tcMax: 4 }), 'the trade centre is full');
    assert.equal(why({ moving: true }), 'already on its way somewhere');
});

// A fake game: facts per id, moves recorded with the fake clock.
function fakeGame(spec, { online = false } = {}) {
    let t = 0;
    const g = { moves: [], sleeps: [], facts: 0 };
    const st = {};
    for (const id of Object.keys(spec)) st[id] = Object.assign({ id, name: 'A' + id, alive: true, lt: 'other', moving: false, tc: '50', tcNow: 1, tcMax: 10, busy: false }, spec[id]);
    g.deps = {
        online,
        now: () => t,
        sleep: async ms => { g.sleeps.push(ms); t += ms; },
        paceMs: () => 1500,
        facts: async id => {
            g.facts++;
            const s = st[id];
            if (!s) return { id, gone: true };
            if (s.busyFor > 0) {
                s.busyFor -= 1;
                return Object.assign({}, s, { busy: true });
            }
            return Object.assign({}, s);
        },
        move: async id => {
            g.moves.push({ id, t });
            const s = st[id];
            if (s.refuse) return { ok: false, detail: 'The game refused to send it to the trade centre.' };
            if (!s.never) s.lt = 'trade';
            return { ok: true, detail: '' };
        },
    };
    return g;
}

test('runTradeArrivals: already there costs nothing; moves one at a time with the pause', async () => {
    const g = fakeGame({ 1: { lt: 'trade' }, 2: {}, 3: { boxed: true }, 4: { refuse: true }, 5: { never: true } });
    const st = await runTradeArrivals(['1', '2', '3', '4', '5', '6'], g.deps);
    assert.deepEqual(g.moves.map(m => m.id), ['2', '3', '4', '5']);
    const sum = tradeSummary(st, ['1', '2', '3', '4', '5', '6']);
    assert.equal(sum.already, 1);
    assert.equal(sum.sent, 2);
    assert.equal(sum.skipped, 3);
    assert.deepEqual(sum.leftIds, ['4', '5']); // refused + unconfirmed; 6 is gone
    assert.ok(sum.reasons.some(r => /refused/.test(r.text)));
    assert.ok(sum.reasons.some(r => /not confirmed/.test(r.text)));
    assert.ok(sum.reasons.some(r => /no longer in the zoo/.test(r.text)));
    // a pause after each real request; none for the one already there
    for (let i = 1; i < g.moves.length; i++) assert.ok(g.moves[i].t - g.moves[i - 1].t >= 1500);
    assert.match(tradeSummaryText(sum), /^3 of 6 in or on the way to the trade centre · skipped 3$/);
});

test('runTradeArrivals: online pauses longer after a refusal; busy waits; full is skipped', async () => {
    const g = fakeGame({ 1: { refuse: true }, 2: { busyFor: 2 }, 3: { tcNow: 10, tcMax: 10 } }, { online: true });
    const st = await runTradeArrivals(['1', '2', '3'], g.deps);
    assert.ok(g.sleeps.includes(ERROR_PAUSE_MS));
    assert.deepEqual(g.moves.map(m => m.id), ['1', '2']);
    const sum = tradeSummary(st, ['1', '2', '3']);
    assert.equal(sum.sent, 1);
    assert.deepEqual(sum.leftIds, ['1', '3']);
});

test('runTradeArrivals: Stop ends before the next animal and the rest stay for the Move screen', async () => {
    const g = fakeGame({ 1: {}, 2: {}, 3: {} });
    let stop = false;
    const deps = Object.assign({}, g.deps, { isStopped: () => stop, move: async id => { stop = true; return g.deps.move(id); } });
    const st = await runTradeArrivals(['1', '2', '3'], deps);
    assert.equal(g.moves.length, 1);
    assert.ok(st.stopped);
    const sum = tradeSummary(st, ['1', '2', '3']);
    assert.equal(sum.untried, 2);
    assert.deepEqual(sum.leftIds, ['2', '3']);
    assert.match(tradeSummaryText(sum), /2 not tried \(stopped\)/);
});

test('Bring all: every species, the whole zoo excluded, room cap', () => {
    assert.equal(isAllSpecies(ALL_SPECIES), true);
    assert.equal(isAllSpecies('Okapi'), false);
    assert.equal(fetchName(ALL_SPECIES, x => 'N:' + x), 'stored animals');
    assert.equal(fetchName('Okapi', x => 'N:' + x), 'N:Okapi');
    const ex = excludeList([
        { species: 'Okapi', guid: '1', name: 'Zuri', sex: 1 },
        { species: 'Lion', guid: '2', name: 'Kesi', sex: 0 },
    ], ALL_SPECIES);
    assert.equal(ex, 'g:1,n:1:okapi:zuri,g:2,n:0:lion:kesi');
    const rows = [
        row(1, { name: 'Asha' }),
        row(2, { name: 'Leo', species: '[Animal_Lion]' }),
        row(3, { name: 'Kesi', species: '[Animal_Lion]', sex: 0 }),   // already in the zoo
        row(4, { name: 'Pip', species: '[Animal_Zebra]', maturity: 0 }), // young: last
        row(5, { name: 'Dot', isShoal: true }),
    ];
    const p = pickRows(rows, { species: ALL_SPECIES, room: -1, exclude: parseExclude(ex) });
    assert.deepEqual(p.picked.map(r => r.name), ['Asha', 'Leo', 'Pip']);
    assert.deepEqual(p.here.map(r => r.name), ['Kesi']);
    assert.equal(p.shoals.length, 1);
    const capped = pickRows(rows, { species: ALL_SPECIES, room: 2, exclude: parseExclude(ex) });
    assert.deepEqual(capped.picked.map(r => r.name), ['Asha', 'Leo']);
    assert.deepEqual(capped.left.map(r => r.name), ['Pip']);
    assert.match(fetchNote({ all: true, tcNow: 90, tcMax: 250, mode: 'franchise' }), /Every species · Storage, all zoos 90\/250/);
    assert.equal(fetchNote({ all: true }), 'Every species in your Animal Storage');
});
