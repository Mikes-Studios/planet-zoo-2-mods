import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { comparables, mergeListings, pricedListings, recommendPrice } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/pricing.js';
import { encodeJob } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

const animal = { id: 1, species: 'Hippopotamus_Common', gender: 1, maturity: 2 };

test('the offset applies to the recommendation as capped by the game: -50% of 14,000 capped at 10,000 is 5,000', () => {
    const r = recommendPrice(animal, [], { defaultPrice: 14000, min: 100, max: 10000 }, { offset: -0.5 });
    assert.equal(r.basePrice, 10000);
    assert.equal(r.price, 5000);
});

test("the reason says when a game limit held the price, before the offset or after it", () => {
    const capped = recommendPrice(animal, [], { defaultPrice: 14000, min: 100, max: 10000 });
    assert.equal(capped.price, 10000);
    assert.match(capped.reason, /capped at the game's maximum 10,000 CC/);
    const raised = recommendPrice(animal, [], { defaultPrice: 400, min: 100, max: 10000 }, { offset: -0.9 });
    assert.equal(raised.price, 100);
    assert.match(raised.reason, /raised to the game's minimum 100 CC/);
    // capped before the offset, then under the cap: the price says nothing of the cap
    assert.doesNotMatch(recommendPrice(animal, [], { defaultPrice: 14000, min: 100, max: 10000 }, { offset: -0.5 }).reason, /capped/);
});

test('the offset under the cap works as before', () => {
    const r = recommendPrice(animal, [], { defaultPrice: 4000, min: 100, max: 10000 }, { offset: -0.25 });
    assert.equal(r.price, 3000);
});

test('the page shows what tests/price_table.txt says, the table the engine lists by too (tests/lister_price.lua)', () => {
    const rows = readFileSync(new URL('./price_table.txt', import.meta.url), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
    assert.ok(rows.length > 200);
    for (const line of rows) {
        const [defaultPrice, pct, min, max, base, price] = line.split(' ').map(Number);
        const advice = recommendPrice(animal, [], { defaultPrice, min, max }, { offset: pct / 100 });
        assert.deepEqual([advice.basePrice, advice.price], [base, price], line);
    }
});

test('a listing job carries each price before the offset, and the offset once', () => {
    const rows = [
        { guid: '123', key: 'animal_1', advice: { basePrice: 14000, price: 7000 } },
        { guid: '456', key: 'animal_2', advice: { basePrice: null, price: null } },
    ];
    const { text } = encodeJob(rows, { paceMs: 3000, offset: -0.5 });
    assert.deepEqual(text.split('\n'), ['v1 3000 list offset=-50', '123 animal_1 14000 max', '456 animal_2 - max']);
});

const lion = (i, price, medal, extra = {}) => ({ id: `L${i}`, species: 'lion', gender: 0, maturity: 2, isShoal: false, isCC: true, price, score: 60, medal, source: 'market', seenAt: 0, ...extra });
const silverLion = { id: 'A', species: 'lion', gender: 0, maturity: 2, isShoal: false, medal: 'silver', genes: { size: 0.6, longevity: 0.6, fertility: 0.6, immunity: 0.6 } };
const unratedLions = Array.from({ length: 20 }, (_, i) => lion(i, 1000 + i * 10, undefined));

test('one rated listing among many unrated ones does not shut the unrated ones out', () => {
    const listings = unratedLions.concat([lion(99, 5000, 'silver')]);
    const comp = comparables(silverLion, listings);
    assert.equal(comp.list.length, 21);
    assert.equal(comp.medalMode, 'unrated');
    const advice = recommendPrice(silverLion, listings, { defaultPrice: 1200 });
    assert.ok(advice.price < 2000, `priced from the 21 listings, got ${advice.price}`);
    assert.equal(advice.confidence, 'medium');
    assert.match(advice.reason, /Only 1 Silver among 21 listings .*20 without a medal/);
});

test('a rated listing of another medal is scaled to the animal\'s medal among the unrated ones', () => {
    const listings = unratedLions.concat([lion(98, 3000, 'bronze')]);
    const bronze = comparables(silverLion, listings).list.find(l => l.id == 'L98');
    assert.equal(bronze.rawPrice, 3000);
    assert.ok(bronze.price > 3000, 'a Bronze price scaled up to Silver');
    assert.match(recommendPrice(silverLion, listings).reason, /No Silver among 21 listings/);
});

test('three rated listings still price by medal alone', () => {
    const rated = [lion(97, 4000, 'silver'), lion(98, 4100, 'silver'), lion(99, 4200, 'silver')];
    const comp = comparables(silverLion, unratedLions.concat(rated));
    assert.equal(comp.medalMode, 'same');
    assert.equal(comp.list.length, 3);
});

test('a single listing of the animal\'s own medal reads without an empty "with"', () => {
    const advice = recommendPrice(silverLion, [lion(1, 4000, 'silver')]);
    assert.doesNotMatch(advice.reason, /with :/);
    assert.match(advice.reason, /^Only 1 Silver listed among animals: median 4,000 CC/);
});

const HOUR = 3600 * 1000;

test('a trade in the history ages from its first sighting, however often the history is opened', () => {
    const sale = lion(1, 900, 'bronze', { id: 'sale', source: 'history' });
    let book = mergeListings([], [sale], 0);
    for (let hours = 5; hours <= 30; hours += 5) book = mergeListings(book, [sale], hours * HOUR);
    assert.equal(book.length, 1);
    assert.equal(book[0].seenAt, 0);
    assert.deepEqual(pricedListings(book, 30 * HOUR), [], 'older than 12 h: no longer priced');
    assert.equal(pricedListings(book, 11 * HOUR).length, 1);
});

test('a market listing counts from its last sighting and is dropped after 12 h unseen', () => {
    const ask = lion(1, 900, 'bronze', { id: 'ask' });
    let book = mergeListings([], [ask], 0);
    book = mergeListings(book, [ask], 10 * HOUR);
    assert.equal(book[0].seenAt, 10 * HOUR);
    assert.deepEqual(mergeListings(book, [], 23 * HOUR), []);
});

test('the player\'s own trade seen on the market and then in the history counts once, as the trade', () => {
    const ask = lion(1, 3000, 'bronze', { id: 'same' });
    let book = mergeListings([], [ask, lion(2, 1000, 'bronze', { id: 'other' })], 0);
    book = mergeListings(book, [Object.assign({}, ask, { source: 'history' })], HOUR);
    assert.equal(book.length, 2);
    assert.equal(book.find(l => l.id == 'same').source, 'history');
    book = mergeListings(book, [ask], 2 * HOUR);
    assert.equal(book.find(l => l.id == 'same').source, 'history', 'the market row never replaces the trade');
    assert.equal(mergeListings(book.concat([ask]), [], 2 * HOUR).length, 2, 'a stored book with both rows keeps the trade only');
});

test('the price fit over many listings still follows the gene score', () => {
    const many = Array.from({ length: 200 }, (_, i) => lion(i, 1000 + (i % 100) * 20, undefined, { score: i % 100 }));
    const animal = { id: 'A', species: 'lion', gender: 0, maturity: 2, isShoal: false, genes: { size: 0.8, longevity: 0.8, fertility: 0.8, immunity: 0.8 } };
    const advice = recommendPrice(animal, many);
    assert.equal(advice.method, 'fit');
    assert.equal(advice.marketPrice, Math.round((1000 + advice.score * 20) * 0.97));
});
