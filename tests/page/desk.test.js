import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRONTIER_TEXT, blockOf, carryTicks, deskRows, listerBlockOf, partialJobText, resultText, rowBlock, shownResult, tickable, tickedRows, verdictOf } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';
import { Maturity, cautionOf, isSellable } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';

const adult = (fields = {}) => Object.assign({ id: 1, key: 'animal_1', species: 'Lion', name: 'Leo', gender: 0, maturity: Maturity.Adult, genes: {} }, fields);
const FRONTIER = '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]';
const guids = new Map([['animal_1', '91']]);

test('a Frontier-zoo row loses its storage-list Quick trade label once the game\'s verdict lands', () => {
    const [row] = deskRows([adult({ source: FRONTIER })], guids, null, new Set());
    assert.equal(row.pre, true);
    assert.equal(row.block, 'quick');
    Object.assign(row, rowBlock(row.a, { guid: row.guid, verdict: verdictOf({ trade: true, quickTrade: true, quickRelease: false, rehome: false }) }));
    assert.equal(row.pre, false);
    assert.equal(row.block, null);
    assert.equal(row.cat, 'market');
});

test('the game\'s own refusal outranks the guess from where an animal came from', () => {
    const [row] = deskRows([adult({ source: FRONTIER })], guids, null, new Set(), new Map([['91', 'Infected']]));
    assert.equal(row.pre, false);
    assert.equal(row.block, 'untradeable');
    assert.equal(row.blockDetail, 'Infected');
});

test('one rule says what can go on the market: shoals, juveniles, the elderly, pregnant and listed animals cannot', () => {
    assert.equal(blockOf(adult()), null);
    assert.equal(blockOf(adult({ isShoal: true })), 'shoal');
    assert.equal(blockOf(adult({ maturity: Maturity.Infant })), 'juvenile');
    assert.equal(blockOf(adult({ maturity: Maturity.ElderlyInfertile })), 'elderly');
    assert.equal(blockOf(adult({ maturity: Maturity.Elderly })), 'elderly', 'a fertile elderly one too: the server refuses it');
    // a Reticulated giraffe turns elderly at 32: the server refused one at 31.2 whose row still said adult
    const giraffe = age => adult({ species: '[Animal_Giraffe_Reticulated]', maturity: Maturity.Adult, age });
    assert.equal(blockOf(giraffe(31.2)), 'nearlyElderly');
    assert.equal(blockOf(giraffe(30.1)), 'nearlyElderly', 'a sale refused 1.9 years short');
    assert.equal(blockOf(giraffe(29.3)), 'nearlyElderly', 'a release refused 2.7 years short');
    assert.equal(blockOf(giraffe(28.9)), null, 'a release taken 3.1 years short');
    assert.equal(blockOf(adult({ species: '[Animal_Giraffe_Reticulated]', maturity: Maturity.Adult })), null, 'no age: nothing to go by');
    assert.equal(blockOf(adult({ isPregnant: true })), 'pregnant');
    assert.equal(blockOf(adult({ auctionTimerSeconds: 600 })), 'listed');
});

test('the storage Sellable chip and the Market lister agree on every animal', () => {
    const cases = [{}, { isShoal: true }, { isMoving: true }, { isPregnant: true }, { auctionTimerSeconds: 600 }, { source: FRONTIER }]
        .concat(Object.values(Maturity).map(maturity => ({ maturity })));
    for (const fields of cases) {
        const a = adult(fields);
        assert.equal(isSellable(a), listerBlockOf(a) === null, JSON.stringify(fields));
    }
});

test('the lister never offers to sell an animal from a Frontier zoo, and says what to do instead', () => {
    const a = adult({ source: FRONTIER });
    assert.equal(blockOf(a), null, 'the desk still checks it per animal');
    assert.equal(listerBlockOf(a), 'quick');
    assert.match(FRONTIER_TEXT, /Frontier zoo.*no CC.*Quick trade it for cash/);
    assert.equal(listerBlockOf(adult({ source: FRONTIER, isPregnant: true })), 'pregnant', "the row's own block first");
});

test('an infertile adult can be listed, with a caution that the game may refuse it', () => {
    const infertile = adult({ maturity: Maturity.AdultInfertile });
    assert.equal(blockOf(infertile), null);
    assert.equal(cautionOf(infertile), 'infertile');
});

const lions = [0, 1, 2].map(i => adult({ id: 100 + i, key: `animal_${i}`, name: `Lion ${i}`, gender: i % 2, genes: { size: 0.5, longevity: 0.5, fertility: 0.5, immunity: 0.5 } }));
const noPrice = () => ({ price: 0, confidence: 'none', reason: '' });

test('ticks made before the game gave the GUIDs stay ticked once the GUIDs arrive', () => {
    const before = deskRows(lions, new Map(), noPrice, undefined);
    const chosen = new Set(before.filter(r => tickable(r)).map(r => r.id));
    const ids = new Map(lions.map(a => [a.key, String(9000 + a.id)]));
    const after = deskRows(lions, ids, noPrice, new Set());
    const carried = carryTicks(before, after, chosen);
    assert.deepEqual([...carried].sort(), after.map(r => r.id).sort());
});

test('a tick never moves to another animal that now has the same row key', () => {
    const before = deskRows(lions, new Map(lions.map(a => [a.key, String(9000 + a.id)])), noPrice, new Set());
    const chosen = new Set([before[0].id]);
    const after = deskRows(lions, new Map(lions.map(a => [a.key, String(8000 + a.id)])), noPrice, new Set());
    assert.deepEqual([...carryTicks(before, after, chosen)], []);
});

test('List takes only the ticked rows the filters show: a reprice out of the price range drops the tick', () => {
    const rows = [{ id: 'g1', species: 'Lion', a: adult(), advice: { price: 6000 } }, { id: 'g2', species: 'Lion', a: adult({ name: 'Two' }), advice: { price: 4000 } }];
    const chosen = new Set(['g1', 'g2']);
    assert.deepEqual(tickedRows(rows, chosen, { species: 'Lion', priceMax: 5000 }).map(r => r.id), ['g2']);
    assert.deepEqual(tickedRows(rows, chosen, { species: 'Tiger' }), []);
});

test('an animal a stopped run never reached reads as not started; a stopped check leaves it as it was', () => {
    const pending = { guid: '91', status: 'pending' };
    assert.equal(shownResult({ mode: 'list', phase: 'running' }, pending), pending);
    assert.equal(shownResult({ mode: 'list', phase: 'stopped' }, pending).status, 'notstarted');
    assert.equal(shownResult({ mode: 'quicktrade', phase: 'done' }, pending).status, 'notstarted');
    assert.equal(shownResult({ mode: 'check', phase: 'stopped' }, pending), undefined);
});
test('a job short of animals the game did not answer for says to try again, apart from those without an id', () => {
    assert.equal(partialJobText({ inJob: 50, asked: 300, noid: 0, unanswered: 250 }), 'Listing 50 of 300: 250 without an answer from the game in time (try again)');
    assert.equal(partialJobText({ inJob: 3, asked: 39, noid: 36 }), "Listing 3 of 39: 36 couldn't be identified by the game");
});
test('a result shows its detail only when the detail says more than its words', () => {
    assert.equal(resultText({ status: 'skipped', kind: 'listed', detail: 'Already on the market.' }), 'already on the market');
    assert.equal(resultText({ status: 'skipped', kind: 'untradeable', detail: 'Cannot trade\n[AnimalList_Problem_SeriouslyInjured]' }), "the game won't trade it: injured");
});