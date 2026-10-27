import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingCount, marketSpecies, rankTargets, scoreTarget } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/marketscancore.js';
import { BREED_TARGETS } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/breedtargets.js';

const target = (id, fields = {}) => Object.assign({ id, lifespan: 40, mature: 5, gestation: 1, interBirth: 2, litter: 1, breedingScore: 0.2, reserves: 1, releaseAnimals: 10 }, fields);
const asks = (...prices) => prices.map(price => ({ price, isCC: true }));
const read = (listings, more = {}) => Object.assign({ ok: true, total: listings.length, pagesRead: 1, pages: 1, listings }, more);

test('a female earns her juveniles a year times the median ask times the buyers left to her', () => {
    const s = scoreTarget(target('Slow', { interBirth: 4, releaseAnimals: 6 }), read(asks(1000, 3000, 2000, 9000)));
    assert.equal(s.perYear, 0.25);
    assert.equal(s.price, 2500);
    assert.equal(s.share, 0.6, '6 wanted against 4 listed');
    assert.equal(s.value, 0.25 * 2500 * 0.6);
    assert.match(s.why, /4 listed, asking about 2,500 CC; 6 wanted across 1 reserve; a juvenile every 4 years per female, sellable after 6/);
});

test('a scarce, slow species outranks a common one that breeds every year when its price makes up for it', () => {
    const scarce = target('Scarce', { interBirth: 8 });
    const common = target('Common', { interBirth: 1 });
    const reads = new Map([
        ['Scarce', read(asks(40000, 50000))],
        ['Common', read(asks(...Array(60).fill(3000)), { total: 60, pagesRead: 3, pages: 10 })],
    ]);
    const [first, second] = rankTargets([common, scarce], reads);
    assert.equal(first.target.id, 'Scarce');
    assert.equal(second.count, 200, 'the unread pages counted at the read pages\' rate');
    assert.equal(second.approx, true);
});

test('a species nobody lists ranks after the priced ones, and an unread one last, saying why', () => {
    const reads = new Map([
        ['Priced', read(asks(100))],
        ['Open', read([])],
        ['Failed', { ok: false, message: 'The market did not answer within 20 s.' }],
    ]);
    const ranked = rankTargets([target('Failed'), target('Open'), target('Priced')], reads);
    assert.deepEqual(ranked.map(s => s.target.id), ['Priced', 'Open', 'Failed']);
    assert.match(ranked[1].why, /^none listed;/);
    assert.equal(ranked[1].value, null);
    assert.match(ranked[2].why, /not scanned: The market did not answer within 20 s\./);
});

test('only Conservation Credit asks set the price', () => {
    const s = scoreTarget(target('Mixed'), read([{ price: 500000, isCC: false }, { price: 2000, isCC: true }]));
    assert.equal(s.price, 2000);
});

test('the count is exact when every page was read', () => {
    assert.deepEqual(listingCount({ total: 25, pagesRead: 2, pages: 2 }), { count: 25, approx: false });
    assert.deepEqual(listingCount({ total: 25, pagesRead: 2, pages: null }), { count: 25, approx: false });
});

test('every breeding target is a long-lived species whose male takes several mates, named as the Market names it', () => {
    assert.ok(BREED_TARGETS.length > 0);
    for (const t of BREED_TARGETS) {
        assert.ok(t.lifespan >= 25 && t.breedingScore <= 0.3 && t.interBirth > 0 && t.releaseAnimals > 0, t.id);
        assert.match(marketSpecies(t), /^\[Animal_[A-Za-z_]+\]$/);
    }
    assert.ok(BREED_TARGETS.some(t => t.id === 'Elephant_Indian'));
    assert.ok(!BREED_TARGETS.some(t => t.id === 'Shoebill'), 'monogamous');
});
