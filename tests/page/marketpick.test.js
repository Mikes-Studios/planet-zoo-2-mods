import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeenListings, marketPicks } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/marketpickcore.js';

const row = (id, sex, o = {}) => Object.assign({ id, sex, adult: true, gene: 80, breeder: 80, value: 2, calves: null, floor: null, known: false }, o);

test('with breeders of yours known, the best cubs win, and each sex gets its own pick', () => {
    const p = marketPicks([
        row('m1', 'm', { known: true, calves: 80, gene: 95 }), row('m2', 'm', { known: true, calves: 86, gene: 85 }),
        row('f1', 'f', { known: true, calves: 82 }), row('f2', 'f', { known: true, calves: 79 }),
    ]);
    assert.deepEqual([p.m.best, p.m.basis, p.m.score, p.f.best], ['m2', 'calves', 86, 'f1']);
});

test('best value goes to the most genes per price among those meeting the standard', () => {
    const p = marketPicks([
        row('top', 'm', { known: true, calves: 88, floor: 75, value: 1.1 }),
        row('deal', 'm', { known: true, calves: 80, floor: 75, value: 6 }),
        row('cheapJunk', 'm', { known: true, calves: 60, floor: 75, value: 11.5 }),
    ]);
    assert.deepEqual([p.m.best, p.m.value], ['top', 'deal']);
});

test('the higher calves always win; equal ones go to the better breeder score, then the better value', () => {
    let p = marketPicks([row('a', 'f', { known: true, calves: 80, breeder: 49 }), row('b', 'f', { known: true, calves: 79, breeder: 66 })]);
    assert.equal(p.f.best, 'a', 'a point more beats a better breeder score');
    p = marketPicks([row('a', 'f', { known: true, calves: 85, breeder: 80 }), row('b', 'f', { known: true, calves: 85, breeder: 90 })]);
    assert.equal(p.f.best, 'b');
    p = marketPicks([row('a', 'f', { known: true, calves: 85, breeder: 90, value: 1 }), row('b', 'f', { known: true, calves: 85, breeder: 90, value: 5 })]);
    assert.equal(p.f.best, 'b');
});

test('none of yours known: own genes decide, and weak or young ones are left out', () => {
    const p = marketPicks([
        row('a', 'm', { gene: 90, breeder: 91, value: 2.3 }), row('b', 'm', { gene: 90, breeder: 88, value: 1.1 }),
        row('kid', 'm', { gene: 99, adult: false }), row('poor', 'm', { gene: 50, value: 20 }),
    ]);
    assert.deepEqual([p.m.best, p.m.basis, p.m.value], ['a', 'genes', 'a']);
});

test('a 0% fertility listing is never a pick, however good its calves would be', () => {
    const p = marketPicks([row('zero', 'f', { known: true, calves: 85, value: 9, infertile: true }), row('ok', 'f', { known: true, calves: 80, value: 1 })]);
    assert.deepEqual([p.f.best, p.f.value], ['ok', 'ok']);
});

test('no pick while listings are still being read or none meets the standard', () => {
    assert.equal(marketPicks([row('a', 'm', { known: true })]).m, null);
    assert.equal(marketPicks([row('a', 'm', { known: true, calves: 60, floor: 75 })]).m, null);
    assert.equal(marketPicks([]).f, null);
});

test('the standard is judged on the best calves, and a pick says how many it was chosen from', () => {
    const p = marketPicks([
        row('steady', 'm', { known: true, calves: 78, bestCalves: 84, floor: 80 }),
        row('one-off', 'm', { known: true, calves: 70, bestCalves: 79, floor: 80 }),
    ]);
    assert.deepEqual([p.m.best, p.m.of], ['steady', 2]);
});

test('the best of every page paged through wins, and leaving the Market forgets them', () => {
    let time = 0;
    const note = createSeenListings({ now: () => time, forgetMs: 5000 });
    const lion = (id, calves) => row(id, 'f', { species: 'Lion_African', known: true, calves });
    note([lion('page1a', 80), lion('page1b', 85)]);
    const picks = note([lion('page2a', 82)]);
    assert.deepEqual([picks.get('Lion_African').f.best, picks.get('Lion_African').f.of], ['page1b', 3], 'the best is on a page no longer on screen');
    time += 1000;
    assert.equal(note([]), null);
    assert.equal(note([lion('page2a', 82)]).get('Lion_African').f.of, 3, 'a moment off screen keeps them');
    time += 6000;
    note([]);
    assert.equal(note([lion('page2a', 82)]).get('Lion_African').f.of, 1, 'off the Market a while: a new visit');
});

test('the best of your own animals in storage, each sex apart, never a 0% fertility or young one', async () => {
    const { bestOfYours } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/marketpickcore.js');
    const yours = (id, sex, calves, o = {}) => Object.assign({ id, species: 'Lion_African', sex, adult: true, infertile: false, calves }, o);
    const p = bestOfYours([
        yours('old', 'm', 74), yours('young', 'm', 79), yours('kid', 'm', 99, { adult: false }),
        yours('f1', 'f', 81, { infertile: true }), yours('f2', 'f', 76), yours('unknown', 'f', null),
    ]);
    assert.deepEqual([p.m, p.f], [{ id: 'young', score: 79 }, { id: 'f2', score: 76 }]);
});

test('the best of yours is of every row scrolled through, not of those on screen', async () => {
    const { bestOfYours } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/marketpickcore.js');
    const note = createSeenListings({ pick: bestOfYours, now: () => 0 });
    const row = (id, calves) => ({ id, species: 'Lion_African', sex: 'm', adult: true, infertile: false, calves });
    note([row('top', 80), row('b', 74)]);
    const scrolled = note([row('c', 76), row('d', 72)]);
    assert.deepEqual(scrolled.get('Lion_African').m, { id: 'top', score: 80 }, 'the one scrolled past stays the best');
});
