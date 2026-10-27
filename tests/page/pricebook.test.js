import { beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['game.js'] });
const stored = new Map();
const storage = { getItem: k => stored.get(k) ?? null, setItem: mock.fn((k, v) => stored.set(k, v)), removeItem: k => stored.delete(k) };
globalThis.window = { localStorage: storage };
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });

const { screen } = await import('./stubs/mods/pz2qol/game.js');
const book = await import('/js/mods/pz2qol/pricebook.js');

const HOUR = 3600 * 1000;
const row = (name, price, extra = {}) => ({ species: 'Lion', name, gender: 1, maturity: 2, auctionPrice: price, auctionIsConservationCredits: true,
    ratings: 'bronze', auctionTimerSeconds: 3600, ...extra });

beforeEach(() => {
    book.clearPriceBook();
    mock.timers.tick(10 * 1000);
    storage.setItem.mock.resetCalls();
    screen.market = [];
    screen.history = [];
});

test('expired and adopted market rows are no asks', () => {
    screen.market = [row('Live', 1000), row('Expired', 900, { auctionTimerSeconds: 0 }), row('Adopted', 800, { isAdopted: true })];
    book.recordVisibleListings();
    assert.deepEqual(book.getPriceBook().map(l => l.price), [1000]);
});

test('an unchanged screen builds no listings', () => {
    screen.market = [row('A', 1000), row('B', 1100)];
    assert.equal(book.recordVisibleListings(), 2);
    const reads = screen.animalReads;
    assert.equal(book.recordVisibleListings(), 0);
    assert.equal(screen.animalReads, reads);
});

test('a listing\'s timer ticking is no change on screen', () => {
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    const reads = screen.animalReads;
    screen.market = [row('A', 1000, { auctionTimerSeconds: 1500 })];
    assert.equal(book.recordVisibleListings(), 0);
    assert.equal(screen.animalReads, reads);
});

test('one listener that throws does not keep the others from hearing of a change', () => {
    const heard = [];
    const offThrowing = book.onPriceBookChanged(() => {
        throw new Error('listener bug');
    });
    const offHeard = book.onPriceBookChanged(entries => heard.push(entries.length));
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    offThrowing();
    offHeard();
    assert.deepEqual(heard, [1]);
});

test('changes close together are saved once, a moment later', () => {
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    screen.market = [row('B', 1100)];
    book.recordVisibleListings();
    assert.equal(storage.setItem.mock.callCount(), 0);
    mock.timers.tick(2000);
    assert.equal(storage.setItem.mock.callCount(), 1);
    assert.equal(JSON.parse(storage.setItem.mock.calls[0].arguments[1]).length, 2);
});

test('an old trade in the history stops counting for prices however often the history is opened', () => {
    const sale = row('OldSale', 500, { auctionTimerSeconds: undefined });
    for (let visit = 0; visit < 3; visit++) {
        screen.market = [];
        screen.history = [sale];
        book.recordVisibleListings();
        screen.history = [];
        screen.market = [row(`Live${visit}`, 2000 + visit)];
        book.recordVisibleListings();
        mock.timers.tick(6 * HOUR);
    }
    screen.market = [];
    screen.history = [sale];
    book.recordVisibleListings();
    assert.deepEqual(book.getPriceBook().filter(l => l.source == 'history'), []);
});

test('a listing grows too old to count even when no market screen is seen again', () => {
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    assert.equal(book.countForSpecies('Lion'), 1);
    mock.timers.tick(12 * HOUR + 1000);
    assert.deepEqual(book.getPriceBook(), []);
    assert.equal(book.countForSpecies('Lion'), 0);
});

test('the views hear when a listing grows too old, with nothing read in between', () => {
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    const heard = [];
    const off = book.onPriceBookChanged(entries => heard.push(entries.length));
    mock.timers.tick(12 * HOUR + 1000);
    off();
    assert.deepEqual(heard, [0]);
});

test('a listener that reads the book while hearing of an aged listing is told once', () => {
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    let heard = 0;
    const off = book.onPriceBookChanged(() => {
        heard++;
        book.getPriceBook();
    });
    mock.timers.tick(12 * HOUR + 1000);
    book.getPriceBook();
    off();
    assert.equal(heard, 1);
});

test('an age timer that fires before the oldest listing is too old is set again for it', () => {
    screen.market = [row('A', 1000)];
    book.recordVisibleListings();
    const heard = [];
    const off = book.onPriceBookChanged(entries => heard.push(entries.length));
    mock.timers.tick(12 * HOUR - 5000);
    const clockNow = Date.now;
    Date.now = () => clockNow() - 10000;
    mock.timers.tick(7000);
    Date.now = clockNow;
    mock.timers.tick(1);
    assert.deepEqual(heard, [], 'an early timer that ages nothing out tells no view');
    mock.timers.tick(12 * HOUR);
    off();
    assert.deepEqual(heard, [0]);
});
