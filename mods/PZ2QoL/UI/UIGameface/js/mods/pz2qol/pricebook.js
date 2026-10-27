// Price book: remembers the CC listings you have seen on the Animal Market
// and your own trade history, so the storage lister can compare prices.
//
// Purely passive: it reads the DataStore lists the game already filled for
// the screen you are looking at. It never requests data itself.
import { LISTING_MAX_AGE_MS, listingKey, medalOf, mergeListings, pricedListings } from '/js/mods/pz2qol/pricing.js';
import { geneScore } from '/js/mods/pz2qol/scores.js';
import { childrenOf, get, HISTORY_LIST, isExpired, isLiveAsk, MARKET_LIST, readAnimal } from '/js/mods/pz2qol/game.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

// v2: keyed by listingKey(). v1 keyed by row id (a screen slot) and is dropped.
const STORAGE_KEY = 'PZ2QoL.priceBook.v2';
const OLD_STORAGE_KEYS = ['PZ2QoL.priceBook.v1'];
const MAX_ENTRIES = 3000;
// the whole book is written at once: changes close together share one write
const SAVE_DELAY_MS = 2000;
// past the oldest listing's age, so a timer that fires a little early still finds it too old
const AGE_CHECK_SLACK_MS = 1000;
let book = [];
// the entries that count for prices (pricedListings), until the oldest of them grows too old
let priced = [];
let pricedUntil = Infinity;
let ageTimer = null;
let saveTimer = null;
const listeners = new Set();

function refreshPriced(now) {
    priced = pricedListings(book, now);
    pricedUntil = priced.reduce((soonest, l) => Math.min(soonest, l.seenAt + LISTING_MAX_AGE_MS), Infinity);
    clearTimeout(ageTimer);
    ageTimer = pricedUntil === Infinity ? null : setTimeout(() => ageOut(Date.now()), pricedUntil - now + AGE_CHECK_SLACK_MS);
}

// the views hear of it after the read, never inside a render
function ageOut(now) {
    const pricedBefore = priced.length;
    refreshPriced(now);
    // time only ages listings out, so the same count is the same set: an early timer just sets itself again
    if (priced.length === pricedBefore) return;
    setTimeout(() => callAll(listeners, priced), 0);
}

function setBook(next) {
    book = next;
    refreshPriced(Date.now());
}

// listings age out between market screens too
function currentPriced() {
    const now = Date.now();
    if (now > pricedUntil) ageOut(now);
    return priced;
}

function load() {
    try {
        if (window.localStorage) OLD_STORAGE_KEYS.forEach(k => window.localStorage.removeItem(k));
        const raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) setBook(mergeListings(parsed, [], Date.now()));
        }
    }
    catch (e) {
        // storage unavailable: keep the book in memory for this session
    }
}

function save() {
    saveTimer = null;
    try {
        if (window.localStorage) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(book));
    }
    catch (e) {
        // ignore; in-memory book still works
    }
}

function saveSoon() {
    if (saveTimer == null) saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

function toListing(ctx, source) {
    const a = readAnimal(ctx);
    return {
        id: listingKey(a),
        species: a.species,
        gender: a.gender,
        maturity: a.maturity,
        isShoal: a.isShoal,
        isExhibit: a.isExhibit,
        score: geneScore(a),
        // not part of the id: one animal always shows the same medal, and
        // keeping the v2 key lets older entries pick it up when seen again
        medal: medalOf(a),
        // the colour morph label as the row shows it; not in the id either
        colormorph: typeof a.colormorph === 'string' && a.colormorph.trim() ? a.colormorph.trim() : undefined,
        price: a.price,
        isCC: a.isCC,
        source,
    };
}

// read straight from the rows, so an unchanged screen builds no listings; the timer ticks, so it counts only as expired or not
const SIGNATURE_FIELDS = ['species', 'name', 'gender', 'maturity', 'auctionPrice', 'auctionIsConservationCredits', 'ratings', 'colormorphLabel', 'isAdopted'];

function rowSignature(ctx) {
    return SIGNATURE_FIELDS.map(f => get(ctx, f)).join(',') + (isExpired(ctx) ? ',x' : '');
}

let lastSignature = '';
let morphSeen = false;
// debug trace, once: what a colour morph label looks like in game (unproven)
function traceMorph(valid) {
    if (morphSeen) return;
    const l = valid.find(x => x.colormorph);
    if (!l) return;
    morphSeen = true;
    breadcrumb(/^\[.*\]$/.test(l.colormorph) ? 'price_morph_token' : 'price_morph_text');
}

export function recordVisibleListings() {
    const market = childrenOf(MARKET_LIST);
    const history = childrenOf(HISTORY_LIST);
    const signature = market.map(rowSignature).join('|') + '#' + history.map(rowSignature).join('|');
    if (signature == lastSignature) {
        return 0;
    }
    lastSignature = signature;
    const observed = [];
    for (const ctx of market) {
        if (isLiveAsk(ctx)) observed.push(toListing(ctx, 'market'));
    }
    for (const ctx of history) observed.push(toListing(ctx, 'history'));
    const valid = observed.filter(l => l.id != undefined && l.price > 0 && l.species);
    traceMorph(valid);
    const next = mergeListings(book, valid, Date.now());
    if (next.length > MAX_ENTRIES) {
        next.sort((x, y) => y.seenAt - x.seenAt);
        next.length = MAX_ENTRIES;
    }
    setBook(next);
    saveSoon();
    // the debug log: what was recorded (only when the visible listings changed)
    try {
        const per = {};
        for (const l of valid) {
            const k = `${l.species}:${l.source}${l.isCC ? '' : ':nocc'}`;
            per[k] = (per[k] || 0) + 1;
        }
        dlog('pricing', 'book_recorded', { observed: observed.length, valid: valid.length, book: book.length, per });
    }
    catch (e) {
        // never stops recording
    }
    callAll(listeners, priced);
    return valid.length;
}

export function getPriceBook() {
    return currentPriced();
}

export function countForSpecies(species) {
    return currentPriced().filter(l => l.species == species && l.isCC).length;
}

export function onPriceBookChanged(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// Adds listings from elsewhere (e.g. an import or a test fixture).
export function mergeIntoPriceBook(listings) {
    setBook(mergeListings(book, listings, Date.now()));
    saveSoon();
    callAll(listeners, priced);
}

export function clearPriceBook() {
    setBook([]);
    lastSignature = '';
    saveSoon();
    callAll(listeners, priced);
}

export function installPriceBook() {
    load();
    // Reads only what is already on screen; cheap when nothing changed.
    setInterval(() => {
        try {
            recordVisibleListings();
        }
        catch (e) {
            reportError('ui', 'Price recording failed', e, { silent: true });
        }
    }, 1500);
}
