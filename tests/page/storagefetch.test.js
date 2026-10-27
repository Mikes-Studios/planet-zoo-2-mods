import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_SPECIES, cancelLines, excludeList, fetchRequest, handOverState, matchItems, parseExclude, pickRows, runTradeArrivals, START_ERRORS } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/storagefetchcore.js';
import { fakeGame } from './storagerun.js';

const row = (key, species, name, sex = 1) => ({ id: key, key, species, name, sex, maturity: 2 });

test('"Bring all" keeps a stored animal whose name and sex a park animal of another species shares', () => {
    const park = [{ species: 'Zebra', name: 'Amara', sex: 1, guid: 'p1' }];
    const rows = [row('k1', 'Giraffe', 'Amara'), row('k2', 'Zebra', 'Amara')];
    const pick = pickRows(rows, { species: ALL_SPECIES, room: 10, exclude: parseExclude(excludeList(park, ALL_SPECIES)) });
    assert.deepEqual(pick.picked.map(r => r.key), ['k1']);
    assert.deepEqual(pick.here.map(r => r.key), ['k2'], 'the zebra of that name and sex is the park\'s own');
});

test('the exclude list names each park animal with its sex, species and name', () => {
    const park = [
        { species: '[Animal_Zebra]', name: 'Amara!', sex: 2, guid: 'g-1' },
        { species: 'Okapi', name: 'Bo', sex: 1, guid: 'not a guid' },
        { species: 'Okapi', name: '', sex: 1 },
    ];
    assert.equal(excludeList(park, ALL_SPECIES), 'g:g-1,n:2:zebra:amara,n:1:okapi:bo');
    assert.equal(excludeList(park, 'Okapi'), 'n:1:okapi:bo', 'one species: only its animals');
    assert.deepEqual([...parseExclude(excludeList(park, ALL_SPECIES)).names], ['2:zebra:amara', '1:okapi:bo']);
});

test('a request for named animals is refused when none can be told apart by its genes, never widened', () => {
    const park = [{ species: 'Okapi', name: 'Cid', sex: 1, guid: 'p1' }];
    assert.deepEqual(fetchRequest(park, 'Okapi', [{ sex: 1, name: 'Bob', genes: null }]), { error: 'unnamed' });
    assert.deepEqual(fetchRequest(park, 'Okapi', [{ sex: 1, name: 'Bob', genes: [50, null, 100, 40] }]), { error: 'unnamed' });
    assert.deepEqual(fetchRequest(park, 'Okapi', null), { exclude: 'g:p1,n:1:okapi:cid' }, 'no names asked: every stored one');
});

test('the named animals lead the request, ahead of the park\'s own', () => {
    const park = [{ species: 'Okapi', name: 'Cid', sex: 1, guid: 'p1' }];
    const r = fetchRequest(park, 'Okapi', [{ sex: 2, name: 'Bob', genes: [50, 49.6, 100, 40] }, { sex: 1, name: 'Ann', genes: null }]);
    assert.equal(r.exclude, 'm:2:50.50.100.40:bob,g:p1,n:1:okapi:cid');
});

const arrival = id => ({ id, name: `A${id}`, lt: 'other', moving: false, tc: '5', tcNow: 1, tcMax: 10 });

test('Stop during a trade request ends the run after one more look, without polling the game', async () => {
    const game = fakeGame({ facts: arrival, stopOnMove: true });
    const final = await runTradeArrivals(['1', '2', '3'], game.deps);
    assert.equal(final.stopped, true);
    assert.deepEqual(game.moves, ['1']);
    assert.ok(game.factsAfterStop <= 1, `asked the game ${game.factsAfterStop} times after Stop`);
    assert.deepEqual(final.log.map(e => [e.reason, e.left]), [['stopped before the game confirmed it', true]]);
});

test('an arrival already in the trade centre costs no request; a full centre and a refusal leave it for the Move screen', async () => {
    const where = { 1: { lt: 'trade' }, 2: { tcNow: 10 }, 3: {}, 4: {} };
    const game = fakeGame({
        facts: (id, g) => Object.assign(arrival(id), where[id], id === '4' && g.moves.includes(id) ? { moving: true } : {}),
        move: id => (id === '3' ? { ok: false, detail: 'The game refused to send it to the trade centre.' } : { ok: true }),
    });
    const final = await runTradeArrivals(['1', '2', '3', '4'], game.deps);
    assert.deepEqual(game.moves, ['3', '4'], 'no request for the one already there or the one with no room');
    assert.deepEqual(final.log.map(e => [e.id, e.ok, !!e.already, e.reason || '', !!e.left]), [
        ['1', true, true, '', false],
        ['2', false, false, 'the trade centre is full', true],
        ['3', false, false, 'the game refused to send it to the trade centre', true],
        ['4', true, false, '', false],
    ]);
});

test('only the click\'s own hand-over counts down; an old one waits for a click, then goes', () => {
    const at = 1000000;
    assert.equal(handOverState({ fresh: true, at }, at + 2000), 'fresh');
    assert.equal(handOverState({ fresh: true, at }, at + 60000), 'later', 'Storage did not show in time: a later visit');
    assert.equal(handOverState({ fresh: false, at }, at), 'later');
    assert.equal(handOverState({ fresh: false, at }, at + 600001), 'expired', 'as old as Lua keeps it');
    assert.equal(handOverState(null, at), 'expired');
});

const genes = (f, i, s, l) => ({ fertility: f, immunity: i, size: s, longevity: l });

test('a named fetch ticks the row with that sex, name and gene grades, wherever it sits in the list', () => {
    const items = matchItems([{ sex: 1, name: 'Zola', genes: [83, 67, 50, 42] }]);
    const zola = (key, g) => ({ id: key, key, name: 'Zola', species: 'Hippo', sex: 1, maturity: 2, genes: g });
    const right = zola('k1', genes(0.83, 0.67, 0.5, 0.42));
    const wrong = zola('k2', genes(0.33, 0.5, 0.25, 0.25));
    const other = Object.assign({}, right, { id: 'k3', key: 'k3', name: 'Other' });
    for (const rows of [[right, wrong, other], [wrong, other, right]]) {
        assert.deepEqual(pickRows(rows, { species: 'Hippo', room: 10, exclude: parseExclude(items) }).picked.map(r => r.key), ['k1']);
    }
    assert.equal(pickRows([right, wrong, other], { species: 'Hippo', room: 10, exclude: parseExclude('') }).picked.length, 3, 'no names: every one');
});

test('a named fetch takes its row even when a park animal has the same name and sex', () => {
    const rows = [{ id: '1', key: 'k1', name: 'Zola', species: 'Hippo', sex: 1, maturity: 2, genes: genes(0.83, 0.67, 0.5, 0.42) }];
    const csv = ['n:1:hippo:zola', matchItems([{ sex: 1, name: 'Zola', genes: [83, 67, 50, 42] }])].join(',');
    assert.deepEqual(pickRows(rows, { species: 'Hippo', room: 10, exclude: parseExclude(csv) }).picked.map(r => r.key), ['k1']);
});

test('every refusal Lua sends for a Bring click has a sentence on the card', () => {
    const lua = readFileSync(new URL('../../mods/PZ2QoL/Main/pz2qol.storagefetch.lua', import.meta.url), 'utf8');
    const details = [...lua.matchAll(/answer\(false, "(\w+)"/g)].map(match => match[1]);
    assert.ok(details.includes('nozoo'));
    for (const detail of details) assert.ok(START_ERRORS[detail], `no message for "${detail}"`);
});

test('a named animal on the market is set aside for its listing to be cancelled; an unnamed listed one is left alone', () => {
    const g = genes(0.83, 0.67, 0.5, 0.42);
    const listed = Object.assign(row('k1', 'Okapi', 'Bokang'), { genes: g, auctionTimerSeconds: 3600 });
    const other = Object.assign(row('k2', 'Okapi', 'Zuri'), { genes: g, auctionTimerSeconds: 3600 });
    const named = pickRows([listed, other], { species: 'Okapi', room: 5, exclude: parseExclude(matchItems([{ sex: 1, name: 'Bokang', genes: [83, 67, 50, 42] }])) });
    assert.deepEqual(named.cancel.map(r => r.key), ['k1']);
    assert.deepEqual(named.picked, []);
    const all = pickRows([listed, other], { species: 'Okapi', room: 5, exclude: parseExclude('') });
    assert.deepEqual([all.cancel, all.listed.map(r => r.key)], [[], ['k1', 'k2']]);
});

test('the card names the listings taken off the market and the ones the game kept', () => {
    const a = { name: 'Bokang' }, b = { name: 'Zuri' };
    assert.deepEqual(cancelLines([a], []), ['Took Bokang off the market.']);
    assert.deepEqual(cancelLines([a, b], [b]), ['Took Bokang off the market.', 'Zuri stays on the market: the game did not cancel the listing. Cancel it in Storage and bring it again.']);
});
