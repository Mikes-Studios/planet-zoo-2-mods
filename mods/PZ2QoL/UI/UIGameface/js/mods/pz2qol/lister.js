// Market lister: price advice for animals in storage and a one-click
// "Sell at recommended price".
//
// Listing goes through the mod's Lua listing engine (pz2qol.lister.lua,
// listerlua.js): it works on animal GUIDs inside Animal Storage and calls the
// game's own listing function, so the storage list rebuilding under it cannot
// make it list the wrong animal. When the engine cannot be used, nothing is
// listed and the player is told why.
//
// Safety rules (do not relax without thinking about the player's account):
//  - Franchise only; only ever started by a click
//  - one listing at a time, each confirmed by the game before the next
//  - a failed animal is skipped; only Stop ends a run
import { translate } from '/js/common/core/Localisation.js';
import { GameMode } from '/js/project/data/GameTypes.js';
import { currentGamemodeIs } from '/js/project/data/SimulationDataModel.js';
import { medalLabel, medalOf, morphOf, morphText, normalMorphLabel, offsetLabel, recommendPrice, speciesMarketSummary } from '/js/mods/pz2qol/pricing.js';
import { Gender, geneScore, normSpecies, relevantGenes } from '/js/mods/pz2qol/scores.js';
import { GAME_COVERS, stepAside } from '/js/mods/pz2qol/stepaside.js';
import { clear, fmtInt, GENES, h, icon, isGamePopupOpen, setClass, setText, tierOf, visibleBox } from '/js/mods/pz2qol/ui.js';
import {
    childrenOf, get, isLiveAsk, MARKET_LIST, readAnimal, SPECIES_LIST, STORAGE_ACTIONS, STORAGE_DATA, STORAGE_LIST, TRADE_LISTING,
} from '/js/mods/pz2qol/game.js';
import { countForSpecies, getPriceBook, onPriceBookChanged, recordVisibleListings } from '/js/mods/pz2qol/pricebook.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog, logPriceDecision } from '/js/mods/pz2qol/debuglog.js';
import { getPaceMs, onPace, paceSlider } from '/js/mods/pz2qol/pace.js';
import { getPref, onPrefs, setPref } from '/js/mods/pz2qol/prefs.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';
import {
    BLOCK_WORDS, FRONTIER_TEXT, blockOf, deskRows, encodeJob, listerBlockOf, reasonText, partialJobText, PREGNANT_TEXT, resultText, rowFingerprint, SHOAL_TEXT, STEP_WORDS, summaryText, tally, UNANSWERED_TEXT,
} from '/js/mods/pz2qol/listercore.js';
import {
    capsAgeMs, engineCaps, engineRunning, engineUsable, engineWhyNot, getEngineState, lastCaps, onEngineState, resolveGuids, setEnginePace, startEngineRun, stopEngineRun,
} from '/js/mods/pz2qol/listerlua.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';

// A capabilities answer younger than this (place() keeps one fresh while
// Animal Storage is open) is used as it is when it says the engine works.
const CAPS_REUSE_MS = 15000;
// Global adjustment to every recommended price, in 5% steps.
export const OFFSET_STEP = 0.05;
export const OFFSET_LIMIT = 0.5;

// ------------------------------------------------------------- settings
// Kept in the player's settings (prefs.js, every zoo; Gameface's
// localStorage is lost when the game closes).
const ENABLED_PREF = 'listerEnabled';
const OFFSET_PREF = 'priceOffset';

// Price offset: one setting, applied wherever a recommended price is used
// (the panel, the multi-select totals and every listing the lister sends).
export function clampOffset(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    const stepped = Math.round(n / OFFSET_STEP) * OFFSET_STEP;
    return Math.round(Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, stepped)) * 100) / 100;
}

// On by default (the developer's decision, 2026-10-16: Franchise is the
// point of this mod); listing still only starts with a click on Sell.
const enabledPref = () => getPref(ENABLED_PREF) !== false;
const offsetPref = () => clampOffset(getPref(OFFSET_PREF));

let enabled = enabledPref();
let priceOffset = offsetPref();
const settingListeners = new Set();

// the kept settings arrive (or change on the other page)
onPrefs((status, key) => {
    if (key !== undefined && key !== ENABLED_PREF && key !== OFFSET_PREF) return;
    const nextEnabled = enabledPref();
    const nextOffset = offsetPref();
    if (nextEnabled === enabled && nextOffset === priceOffset) return;
    enabled = nextEnabled;
    priceOffset = nextOffset;
    document.body.classList.toggle('PZ2QoL_listerOn', enabled);
    callAll(settingListeners, enabled);
});

export function isListerEnabled() {
    return enabled;
}

export function setListerEnabled(on) {
    enabled = !!on;
    setPref(ENABLED_PREF, enabled ? undefined : false);
    document.body.classList.toggle('PZ2QoL_listerOn', enabled);
    callAll(settingListeners, enabled);
}

export function onListerSettingChanged(fn) {
    settingListeners.add(fn);
    return () => settingListeners.delete(fn);
}

export function getPriceOffset() {
    return priceOffset;
}

export function setPriceOffset(v) {
    priceOffset = clampOffset(v);
    setPref(OFFSET_PREF, priceOffset || undefined);
    callAll(settingListeners, enabled);
}

export function isFranchise() {
    if (window.__PZ2QOL_TEST_FRANCHISE !== undefined) return !!window.__PZ2QOL_TEST_FRANCHISE;
    try {
        return currentGamemodeIs(GameMode.Franchise);
    }
    catch (e) {
        return false;
    }
}

// -------------------------------------------------------------- helpers

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function selectedKeys() {
    const v = get(STORAGE_DATA, 'selectedAnimalIDs');
    return Array.isArray(v) ? v.slice() : [];
}

function tradeLimits() {
    return {
        defaultPrice: get(TRADE_LISTING, 'tradePriceDefault'),
        min: get(TRADE_LISTING, 'tradePriceMin'),
        max: get(TRADE_LISTING, 'tradePriceMax'),
        duration: get(TRADE_LISTING, 'tradeDurationDefault'),
        durationMin: get(TRADE_LISTING, 'tradeDurationMin'),
        durationMax: get(TRADE_LISTING, 'tradeDurationMax'),
    };
}

function animalForKey(key) {
    return readAnimal(STORAGE_LIST.concat(key));
}

// Storage list keys ("animal_12") are positions: when an animal sells or the
// list is re-sorted the game rebuilds it and a key can point at another
// animal, so a key is only trusted together with what its row holds.
export function fingerprint(a) {
    return rowFingerprint(a);
}

// What the listing engine checks a row key against (see resolveGuids).
export function identityOf(a) {
    return { key: a.key, fp: fingerprint(a), name: a.name, species: a.species, gender: a.gender };
}

function t(s) {
    if (typeof s !== 'string') return s == undefined ? '' : String(s);
    try {
        return translate(s);
    }
    catch (e) {
        return s;
    }
}

const SEX = { [Gender.Male]: '♂', [Gender.Female]: '♀' };
const CONFIDENCE = {
    high: 'high confidence',
    medium: 'medium confidence',
    low: 'low confidence (few listings)',
    none: "no market data: using the game's own price",
};

// Advice for one storage animal, using the game's limits if it is the
// currently selected animal (the game only fills them for the selection).
export function adviceFor(animal, limits) {
    return recommendPrice(animal, getPriceBook(), limits || {}, { offset: priceOffset, morphName });
}

// ---------------------------------------------------------- check market

// species: as a storage or Market row names it, or "[Animal_<id>]" (marketscan.js)
function speciesUid(species) {
    for (const ctx of childrenOf(SPECIES_LIST)) {
        const name = get(ctx, 'speciesName');
        if (name == species || normSpecies(name) == normSpecies(species) || t(name) == t(species)) {
            return get(ctx, 'speciesUID');
        }
    }
    return undefined;
}

// Background check: the mod's Lua (PZ2QoL.MarketPeek) runs the Market's
// own species filter and data request while Animal Storage stays on
// screen, says "ready" once the server answered, and puts the market back
// when we release it. The price book records the listings in between.
// (The game's SetAnimalMarketScreen tab switch only exists in the Coherent
// debug player, so switching tabs from here never worked in game.)
const PEEK_ANSWER_TIMEOUT_MS = 3000;
const PEEK_TOTAL_TIMEOUT_MS = 30000;
// The Market's own paginator shows at most 20 pages (0-based pageIndex).
export const PEEK_MAX_PAGES = 20;
const PEEK_PAGE_GAP_MS = 400; // pause between pages, like a player paging
const MARKET_DATA = ['hubAnimalsData', 'animalMarketData'];
let peek = null; // { species, uid, state: 'starting'|'loading'|'reading'|'done'|'failed', message }
let peekWaiter = null;
const peekListeners = new Set();

export function getMarketCheck() {
    return peek;
}

export function onMarketCheckChanged(fn) {
    peekListeners.add(fn);
    return () => peekListeners.delete(fn);
}

// When each species' market check last ended: { at, ok }. The Market desk
// asks for a check of every species it lists (a failed check counts too, so
// a check that can't run never blocks listing at the game's price).
const checkedAt = new Map();
export const PRICE_CHECK_FRESH_MS = 30 * 60 * 1000;

export function priceCheckOf(species) {
    return checkedAt.get(species) || null;
}

export function isPriceCheckFresh(species, now = Date.now()) {
    const c = checkedAt.get(species);
    return !!c && now - c.at < PRICE_CHECK_FRESH_MS;
}

function setPeek(changes) {
    peek = Object.assign({}, peek, changes);
    if ((changes.state === 'done' || changes.state === 'failed') && peek.species) checkedAt.set(peek.species, { at: Date.now(), ok: changes.state === 'done' });
    callAll(peekListeners, peek);
}

function isPeekBusy() {
    return !!peek && (peek.state == 'starting' || peek.state == 'loading' || peek.state == 'reading');
}

// Lua -> page: 'loading' | 'ready' | 'busy' | 'failed' | 'done'
function onPeekState(state, detail) {
    if (peekWaiter) peekWaiter(state, detail);
    else if (state == 'failed' && isPeekBusy()) setPeek({ state: 'failed', message: `Market check failed: ${detail}` });
}

// Lua's answers arrive a frame later (TriggerEventAtNextAdvance), so a
// late 'done' from the previous check can reach the next one's waiter.
// accept: the states this wait is for; anything else is ignored.
const START_STATES = ['loading', 'ready', 'busy', 'failed'];
const LOAD_STATES = ['ready', 'failed', 'nopaging', 'busy'];
function nextPeekState(timeoutMs, accept) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            peekWaiter = null;
            resolve({ state: 'timeout' });
        }, timeoutMs);
        peekWaiter = (state, detail) => {
            if (accept && !accept.includes(state)) return;
            clearTimeout(timer);
            peekWaiter = null;
            resolve({ state, detail });
        };
    });
}

// Lets Lua put the market back and waits for its 'done', so the answer
// cannot be mistaken for the next check's.
async function releasePeek() {
    const done = nextPeekState(2000, ['done', 'failed']);
    engine.trigger('PZ2QoL_MarketPeekRelease');
    await done;
}

function marketListingsFor(species) {
    const id = normSpecies(species);
    return childrenOf(MARKET_LIST).filter(ctx => normSpecies(get(ctx, 'species')) == id);
}

// What the visible market page shows. Row ids are screen slots, reused on
// every page, so a page change is detected by content.
function pageSignature() {
    return childrenOf(MARKET_LIST).map(ctx => {
        const a = readAnimal(ctx);
        return [a.name, a.price, a.genes.size, a.genes.longevity].join(',');
    }).join('|');
}

// Waits for Lua's 'loading' -> 'ready' after a request or page change.
async function awaitPeekReady() {
    let reply = await nextPeekState(PEEK_ANSWER_TIMEOUT_MS, START_STATES.concat(['nopaging']));
    if (reply.state == 'loading') reply = await nextPeekState(PEEK_TOTAL_TIMEOUT_MS, LOAD_STATES);
    return reply;
}

// Reads the visible page once the DataStore has caught up with Lua.
// fresh: false if the page never changed (nothing new to record).
async function readPeekPage(species, isFresh) {
    let rows = [], fresh = false;
    for (let i = 0; i < 10; i++) {
        rows = marketListingsFor(species);
        fresh = isFresh();
        if (rows.length && fresh) break;
        await sleep(150);
    }
    if (fresh) recordVisibleListings();
    return { rows, fresh };
}

// Fetches the current Market listings for one species without leaving
// Animal Storage. Click-started only; one at a time.
// Returns { ok, total, fatal, listings ([{ price, isCC }] still for sale),
// pagesRead, pages (the game's count, null unknown) }; fatal means checking
// other species is pointless too (no game-side script, storage closed).
// opts.quiet: no error toast (the multi-species check sums them up).
// opts.maxPages: read no further than this many pages.
export async function checkMarketFor(species, opts = {}) {
    const maxPages = Math.min(PEEK_MAX_PAGES, opts.maxPages || PEEK_MAX_PAGES);
    if (isPeekBusy()) return { ok: false, total: 0, fatal: false, busy: true, message: 'A market check is already running.' };
    // one server action at a time: never during a listing
    if (listingStarting || engineRunning()) return { ok: false, total: 0, fatal: false, busy: true, message: 'A listing is running; check prices when it is done.' };
    setPeek({ species, uid: undefined, state: 'starting', message: 'Asking the market…' });
    const peekStart = Date.now();
    dlog('peek', 'start', { species, quiet: !!opts.quiet });
    const fail = (title, detail, fatal = false) => {
        dlog('peek', 'failed', { species, title, detail: detail == undefined ? undefined : String(detail), fatal: fatal || undefined, ms: Date.now() - peekStart });
        setPeek({ state: 'failed', message: detail ? `${title}: ${detail}` : title });
        if (!opts.quiet) reportError('lister', title, detail);
        return { ok: false, total: 0, fatal: fatal || /Animal Storage/.test(String(detail || '')), busy: title == 'Market check is busy', message: detail || title };
    };
    // a freshly bound collection fills asynchronously; give it a moment
    let uid = speciesUid(species);
    for (let i = 0; uid == undefined && i < 10; i++) {
        await sleep(100);
        uid = speciesUid(species);
    }
    if (uid == undefined) {
        return fail('Cannot check the market for this species', `The game's species list has no id for ${speciesName(species)}.`);
    }
    setPeek({ uid });
    breadcrumb('peek_start');
    const answer = nextPeekState(PEEK_ANSWER_TIMEOUT_MS, START_STATES);
    dlog('peek', 'request', { species, uid });
    engine.trigger('PZ2QoL_MarketPeek', uid);
    let reply = await answer;
    dlog('peek', 'reply', { species, state: reply.state, detail: reply.detail || undefined, ms: Date.now() - peekStart });
    if (reply.state == 'timeout') {
        return fail('Market check got no answer', "The mod's game-side script did not reply. Install a matching PZ2QoL build (Main.ovl and UI together), then reopen Animal Storage.", true);
    }
    if (reply.state == 'loading') {
        setPeek({ state: 'loading', message: `Loading ${speciesName(species)} listings…` });
        reply = await nextPeekState(PEEK_TOTAL_TIMEOUT_MS, LOAD_STATES);
        dlog('peek', 'reply', { species, state: reply.state, detail: reply.detail || undefined, ms: Date.now() - peekStart });
    }
    if (reply.state != 'ready') {
        // Lua still holds the market after a timeout: let it put it back
        if (reply.state == 'timeout') await releasePeek();
        const title = reply.state == 'busy' ? 'Market check is busy' : 'Market check failed';
        return fail(title, reply.state == 'timeout' ? 'The game never reported the market data as loaded.' : reply.detail);
    }
    // the DataStore reaches the page a frame or two after Lua sees the answer
    const before = countForSpecies(species);
    let total = 0, cc = 0, pagesRead = 0, pages = 1, pagesKnown = false, stopNote = '', lastSig = null, luaFinished = false;
    const listings = [];
    let gamePages = null;
    try {
        for (let page = 0; ; page++) {
            setPeek({ state: 'reading', message: page == 0 ? 'Recording prices…' : `Recording prices, page ${page + 1}${pagesKnown ? ` of ${pages}` : ''}…` });
            const prevSig = lastSig;
            const { rows, fresh } = await readPeekPage(species, () => {
                if (page == 0) return true;
                const index = get(MARKET_DATA, 'pageIndex');
                return (typeof index !== 'number' || index == page) && pageSignature() != prevSig;
            });
            if (!fresh) {
                // the page did not change: past the end, or paging is not
                // shown to the page while the market is hidden
                if (pagesKnown) stopNote = ` (page ${page + 1} did not show)`;
                dlog('peek', 'page_stale', { species, page, rows: rows.length, pagesKnown });
                break;
            }
            lastSig = pageSignature();
            pagesRead++;
            total += rows.length;
            for (const ctx of rows) {
                if (!isLiveAsk(ctx)) continue;
                const a = readAnimal(ctx);
                listings.push({ price: a.price, isCC: a.isCC });
            }
            const pageCc = rows.filter(ctx => get(ctx, 'auctionIsConservationCredits')).length;
            cc += pageCc;
            // the game's page count; without it keep going until a page
            // comes back unchanged
            const known = get(MARKET_DATA, 'pages');
            pagesKnown = typeof known === 'number' && known > 0;
            gamePages = pagesKnown ? known : null;
            pages = Math.min(PEEK_MAX_PAGES, pagesKnown ? known : PEEK_MAX_PAGES);
            dlog('peek', 'page_read', { species, page, rows: rows.length, cc: pageCc, pages: pagesKnown ? known : 'unknown', book: countForSpecies(species) });
            if (page + 1 >= Math.min(pages, maxPages)) break;
            await sleep(PEEK_PAGE_GAP_MS);
            breadcrumb('peek_page');
            const next = awaitPeekReady();
            engine.trigger('PZ2QoL_MarketPeekPage', page + 1);
            const r = await next;
            dlog('peek', 'page_reply', { species, page: page + 1, state: r.state, detail: r.detail || undefined });
            if (r.state == 'failed') luaFinished = true; // Lua already put the market back
            if (r.state != 'ready') {
                // keep what was read; say why the rest is missing
                stopNote = r.state == 'nopaging' ? ' (this game version cannot change pages here)'
                    : ` (page ${page + 2} did not load${r.detail ? `: ${r.detail}` : ''})`;
                break;
            }
        }
    }
    catch (e) {
        // a check left 'reading' would block every listing until a reload
        return fail('Market check failed', `An error in the mod while recording the market's prices (${e && e.message}). Try the check again; if it repeats, the debug log has the details.`);
    }
    finally {
        if (!luaFinished) await releasePeek();
    }
    breadcrumb('peek_done');
    const added = countForSpecies(species) - before;
    dlog('peek', 'done', { species, listings: total, cc, pages: pagesRead, added, note: stopNote || undefined, ms: Date.now() - peekStart, released: !luaFinished });
    const where = pagesRead == 1 ? '1 market page' : `${pagesRead} market pages`;
    setPeek({
        state: 'done',
        message: total
            ? `Checked: ${total} ${speciesName(species)} listing${total == 1 ? '' : 's'} on ${where} (${cc} for CC)${added > 0 ? `, ${added} new` : ''}${stopNote}.`
            : `Checked: no ${speciesName(species)} listings for Conservation Credits on the market right now${stopNote}.`,
    });
    return { ok: true, total, fatal: false, listings, pagesRead, pages: gamePages };
}

// Several species, one after another (each with all its pages). Only
// started by a click; one market check at a time, with the game-side
// cooldown between species; Stop ends it after the current species.
const PEEK_SPECIES_GAP = 3200; // the Lua side refuses checks < 3 s apart
// the browser harness has no Lua cooldown; the game always waits the full gap
const peekGapMs = () => (typeof window !== 'undefined' && window.__PZ2QOL_TEST_PEEK_GAP_MS >= 0 && typeof engine !== 'undefined' && engine.__harness ? window.__PZ2QOL_TEST_PEEK_GAP_MS : PEEK_SPECIES_GAP);
let peekAll = null; // { list, index, done, failed, listings, stopRequested, finished, message }

export function getMultiMarketCheck() {
    return peekAll;
}

function setPeekAll(changes) {
    peekAll = Object.assign({}, peekAll, changes);
    callAll(peekListeners, peekAll);
}

export function isMultiCheckBusy() {
    return !!peekAll && !peekAll.finished;
}

export function stopMultiCheck() {
    if (isMultiCheckBusy() && !peekAll.stopRequested) setPeekAll({ stopRequested: true, message: `${peekAll.message} Stopping after this species…` });
}

// opts.maxPages: as checkMarketFor's. -> Map(species -> checkMarketFor's
// answer) for the species it got to, or null when it could not start.
export async function checkMarketForAll(speciesList, opts = {}) {
    if (isListingBusy()) return null;
    const list = Array.from(new Set(speciesList.filter(Boolean)));
    if (!list.length) return null;
    const reads = new Map();
    breadcrumb('peek_all_start');
    dlog('peek', 'all_start', { n: list.length, species: list });
    setPeekAll({ list, index: 0, done: 0, failed: [], listings: 0, stopRequested: false, finished: false, message: '' });
    let lastStart = 0;
    for (let i = 0; i < list.length; i++) {
        if (peekAll.stopRequested) break;
        const species = list[i];
        const wait = peekGapMs() - (Date.now() - lastStart);
        setPeekAll({ index: i, message: `Checking ${speciesName(species)} (${i + 1} of ${list.length})…` });
        if (wait > 0) await sleep(wait);
        if (peekAll.stopRequested) break;
        lastStart = Date.now();
        const check = { quiet: true, maxPages: opts.maxPages };
        let r = await checkMarketFor(species, check);
        if (!r.ok && r.busy && !peekAll.stopRequested) {
            await sleep(peekGapMs());
            lastStart = Date.now();
            r = await checkMarketFor(species, check);
        }
        reads.set(species, r);
        dlog('peek', 'all_species', { i: i + 1, species, ok: r.ok, total: r.total, busy: r.busy || undefined, fatal: r.fatal || undefined, msg: r.ok ? undefined : r.message });
        if (r.ok) setPeekAll({ done: peekAll.done + 1, listings: peekAll.listings + r.total });
        else setPeekAll({ failed: peekAll.failed.concat(`${speciesName(species)}: ${r.message || 'failed'}`) });
        if (r.fatal) break;
    }
    const f = peekAll.failed;
    const stopped = peekAll.done + f.length < list.length;
    const message = `${stopped ? 'Stopped' : 'Done'}: checked ${peekAll.done} of ${list.length} species, ${peekAll.listings} listing${peekAll.listings == 1 ? '' : 's'} found`
        + (f.length ? `; ${f.length} failed (${f[0]}${f.length > 1 ? ', …' : ''})` : '') + '.';
    if (f.length) reportError('lister', `Market check failed for ${f.length} species`, f.join('\n'));
    breadcrumb('peek_all_end');
    dlog('peek', 'all_end', { done: peekAll.done, failed: f.length, listings: peekAll.listings, stopped, msg: message });
    setPeekAll({ finished: true, message });
    return reads;
}

// --------------------------------------------------------------- selling

// Selected animals a run would list (listercore listerBlockOf).
function sellableKeys(keys) {
    return keys.filter(k => !listerBlockOf(animalForKey(k)));
}

// "2 on the market, 1 juvenile": the selected animals a run leaves out, by why.
function leftOutText(keys) {
    const counts = new Map();
    for (const k of keys) {
        const block = listerBlockOf(animalForKey(k));
        if (block) counts.set(block, (counts.get(block) || 0) + 1);
    }
    return Array.from(counts, ([block, n]) => `${n} ${BLOCK_WORDS[block].toLowerCase()}`).join(', ');
}

const SINGLE_BLOCK_TEXT = { listed: 'Already on the market.', pregnant: PREGNANT_TEXT, shoal: SHOAL_TEXT, quick: FRONTIER_TEXT };

// The game's own answer for the one selected animal (its Trade button:
// tradeAllowed, the problems in tradeDisallowedReason), which covers what
// no row shows (NoBirthZoo, CashSeeded...); '' when it allows trading.
function gameTradeRefusal() {
    if (selectedKeys().length !== 1 || get(STORAGE_ACTIONS, 'tradeAllowed') !== false) return '';
    const why = reasonText('untradeable', get(STORAGE_ACTIONS, 'tradeDisallowedReason'), t);
    const release = get(STORAGE_ACTIONS, 'quickReleaseAllowed') === true;
    const ways = [];
    if (get(STORAGE_ACTIONS, 'quickTradeAllowed') === true) ways.push('Quick trade it for cash from the Market desk');
    if (release) ways.push('Quick release it from the Market desk', 'release it to a reserve');
    return `The game won't put it on the market${why ? ` (${why})` : ''}.${ways.length ? ` ${ways.join(', or ')}.` : ''}${release ? '' : ' It earns no CC: keep it to breed, its young can be sold.'}`;
}

// Why the panel's one selected animal can't be sold, or ''.
function singleBlockText(a) {
    const own = blockOf(a);
    if (own) return SINGLE_BLOCK_TEXT[own] || `${BLOCK_WORDS[own]}: it can't be listed now.`;
    const game = gameTradeRefusal();
    if (game) return game;
    const block = listerBlockOf(a);
    if (!block) return '';
    return SINGLE_BLOCK_TEXT[block] || `${BLOCK_WORDS[block]}: it can't be listed now.`;
}

// Labels of the animals in engine runs (results carry only GUIDs).
const labelByGuid = new Map();
// What each run's job left out (engine run req -> { noid, unanswered, asked, inJob }),
// so the run's summary can repeat it.
const jobNotes = new Map();

// The note for an engine state's run, or null.
export function jobNote(s) {
    return (s && s.req != undefined && jobNotes.get(String(s.req))) || null;
}

export function labelOf(guid) {
    return labelByGuid.get(String(guid)) || 'animal';
}

export function animalLabel(a) {
    return `${a.species ? speciesName(a.species) : 'animal'} ${SEX[a.gender] || ''} "${t(a.name)}"`.replace(/\s+/g, ' ');
}

// From a List click until the engine has the job: no market check may start
// in between (one franchise request at a time).
let listingStarting = false;

// A listing (or a market check) is running or starting.
export function isListingBusy() {
    return listingStarting || engineRunning() || isMultiCheckBusy() || isPeekBusy();
}

// The storage list as it is now (readAnimal rows).
export function storageRows() {
    return childrenOf(STORAGE_LIST).map(ctx => readAnimal(ctx));
}

// What the engine can do: the kept answer when it is recent and says the
// engine works, else asked again (a recent "no" may be over already).
async function currentCaps(pageRows) {
    const kept = capsAgeMs() < CAPS_REUSE_MS ? lastCaps() : null;
    return kept && engineUsable(kept, pageRows) ? kept : engineCaps({ force: true });
}

// Lists these storage animals (readAnimal rows) at their recommended prices
// through the Lua engine; nothing is listed when the engine can't be used.
// hours: 'max' (the game's longest, default) or 'default'.
// advise: the price the caller showed for each animal; verdicts and
// gameBlocked: what the caller knows the game allows (deskRows).
// Returns { ok, count, message }.
export async function listAnimals(animals, { hours = 'max', onRefused = 'leave', refusedMax = null, advise = a => adviceFor(a, {}), verdicts = null, gameBlocked = null } = {}) {
    dlog('lister', 'list_request', { n: animals.length, hours, onRefused: onRefused !== 'leave' ? onRefused : undefined, refusedMax: refusedMax ?? undefined, busy: isListingBusy() || undefined, franchise: isFranchise(), offset: priceOffset || undefined, paceMs: getPaceMs('lister') });
    if (isListingBusy()) return { ok: false, count: 0, message: 'A listing or market check is already running.' };
    if (!isFranchise()) {
        reportError('lister', 'Listing is only available in Franchise mode');
        return { ok: false, count: 0, message: 'Franchise only.' };
    }
    listingStarting = true;
    try {
        return await startListingJob(animals, { hours, onRefused, refusedMax, advise, verdicts, gameBlocked });
    }
    finally {
        listingStarting = false;
    }
}

async function startListingJob(animals, { hours, onRefused, refusedMax, advise, verdicts, gameBlocked }) {
    const pageRows = childrenOf(STORAGE_LIST).length;
    const caps = await currentCaps(pageRows);
    dlog('lister', 'list_path', { engine: engineUsable(caps, pageRows), capsOk: caps ? caps.ok : undefined, luaRows: caps ? caps.rows : undefined, pageRows, why: engineWhyNot(caps, pageRows) || undefined });
    if (!engineUsable(caps, pageRows)) {
        const why = `${engineWhyNot(caps, pageRows)} Reopen Animal Storage and try again.`;
        breadcrumb('lister_engine_unusable');
        reportError('lister', 'Nothing was listed: the listing engine is not ready', why, { silent: true });
        return { ok: false, count: 0, message: `Nothing was listed. ${why}` };
    }
    // asked again at the click (one round trip): ids may have come since the desk read them
    const guids = await resolveGuids(animals.map(identityOf), { retry: true });
    const rows = deskRows(animals, guids, advise, guids.failed, gameBlocked, verdicts);
    const { text, items } = encodeJob(rows, { paceMs: getPaceMs('lister'), hours, onRefused, refusedMax, offset: priceOffset });
    // the job as the page built it: each animal's price decision, and why any was left out
    try {
        const inJob = new Set(items);
        rows.forEach((r, i) => {
            const a = r.a || {};
            if (inJob.has(r)) {
                logPriceDecision('job', r.guid, r.advice, { i: i + 1, guid: r.guid, key: r.key, species: a.species, gender: a.gender, maturity: a.maturity });
            }
            else {
                dlog('lister', 'job_left_out', { i: i + 1, guid: r.guid || undefined, key: r.key, why: r.block === 'pregnant' ? 'pregnant' : r.block === 'noid' ? 'noid' : !r.guid ? 'noguid' : r.block || 'badkey', species: a.species, detail: r.block === 'pregnant' ? PREGNANT_TEXT : undefined });
            }
        });
        const notRows = animals.length - rows.length;
        dlog('lister', 'job_built', { animals: animals.length, rows: rows.length, inJob: items.length, guids: guids.size, noIdBlocked: rows.filter(r => r.block === 'noid').length || undefined, unanswered: guids.unanswered.size || undefined, skippedNoId: notRows || undefined });
    }
    catch (e) {
        // the log never stops a listing
    }
    // animals asked for without an id: the game found none (or another animal), or did not answer in time
    const unanswered = rows.filter(r => !r.guid && guids.unanswered.has(r.key)).length;
    const noid = rows.filter(r => !r.guid && !guids.unanswered.has(r.key) && (!r.block || r.block === 'noid')).length;
    if (!items.length) {
        const shoals = animals.filter(a => a.isShoal).length;
        const why = !rows.length && shoals ? SHOAL_TEXT
            : !rows.length ? 'None of the selected animals could be found in storage.'
                : unanswered ? `${unanswered} of the selected animals: ${UNANSWERED_TEXT}.`
                    : noid ? `${noid} of the selected animals could not be identified in Animal Storage. Press Read storage again; if it stays, the game-side engine could not read their ids.`
                        : 'None of the selected animals can be listed now (on the market, moving, pregnant, juvenile or elderly).';
        breadcrumb(unanswered ? 'lister_nothing_unanswered' : noid ? 'lister_nothing_noid' : 'lister_nothing_blocked');
        reportError('lister', 'Nothing to list', why);
        return { ok: false, count: 0, message: why };
    }
    for (const r of items) labelByGuid.set(r.guid, animalLabel(r.a));
    // fewer in the job than asked for: "Listing 3 of 39: 36 couldn't be identified by the game"
    const partial = partialJobText({ inJob: items.length, asked: animals.length, noid, unanswered });
    const started = await startEngineRun(text);
    dlog('lister', 'list_started', { ok: started.ok, count: items.length, asked: animals.length, noid: noid || undefined, unanswered: unanswered || undefined, msg: started.message || undefined });
    if (started.pending) breadcrumb('lister_engine_pending');
    else if (!started.ok) reportError('lister', 'The listing engine did not start', started.message);
    else if ((noid || unanswered) && started.req != undefined) jobNotes.set(String(started.req), { noid, unanswered, asked: animals.length, inJob: items.length });
    return { ok: started.ok, count: items.length, total: animals.length, noid, partial, message: started.message };
}

// The prices the panel shows: the game's own value blended in for the one
// selected animal (the game gives it only for the selection).
function panelAdvice(keys) {
    const limits = keys.length == 1 ? tradeLimits() : {};
    return a => adviceFor(a, a.key === keys[0] ? limits : {});
}

// Lists the given storage animals (child keys) at their recommended prices.
export async function sellAtRecommendedPrice(keys) {
    dlog('lister', 'sell_click', { keys: keys.length, enabled });
    if (!enabled) {
        reportError('lister', 'The market lister is turned off', 'Turn it on in the storage toolbar first.');
        return;
    }
    await listAnimals(keys.map(k => animalForKey(k)), { advise: panelAdvice(keys) });
}

export function stopListing() {
    dlog('lister', 'stop_click', { engine: engineRunning() });
    if (engineRunning()) stopEngineRun();
}

// ------------------------------------------------------------------ panel

// ---- panel rendering (redesigned: cards, stat tiles, price strip chart)

const SEX_CLASS = { [Gender.Male]: 'male', [Gender.Female]: 'female' };
const CONF_LEVEL = { none: 0, low: 1, medium: 2, high: 3 };

let panel = null;
let body = null;
let countPill = null;
let offsetControl = null;
let paceControl = null;
let sectionButtons = null;
let lastRender = '';

// Parts other modules add to the panel (marketscan.js): { button() -> a
// node for the header or null, block() -> a node on top of the body or null,
// signature() -> a string that changes when either should be drawn again }.
const sections = [];

export function addListerSection(section) {
    sections.push(section);
    lastRender = '';
}

// "Price vs recommended  [-]  -10%  [+]": one global offset in 5% steps;
// click the value to go back to 0.
export function buildOffsetControl() {
    const value = h('div.PZ2QoL_segItem.PZ2QoL_offsetValue', { title: 'Reset to the recommended price', onClick: () => setPriceOffset(0) });
    const less = h('div.PZ2QoL_segItem', { text: '−', title: `${Math.round(OFFSET_STEP * 100)}% lower`, onClick: () => setPriceOffset(priceOffset - OFFSET_STEP) });
    const more = h('div.PZ2QoL_segItem', { text: '+', title: `${Math.round(OFFSET_STEP * 100)}% higher`, onClick: () => setPriceOffset(priceOffset + OFFSET_STEP) });
    const node = h('div.PZ2QoL_segmented.PZ2QoL_offset', { title: 'Applied to every recommended price, including the prices the lister lists at. Under sells faster, over earns more.' },
        h('div.PZ2QoL_segLabel', { text: 'Price vs recommended' }), less, value, more);
    node.__update = () => {
        setText(value, offsetLabel(priceOffset) || '±0%');
        setClass(value, 'on', true);
        setClass(value, 'under', priceOffset < 0);
        setClass(value, 'over', priceOffset > 0);
        setClass(less, 'disabled', priceOffset <= -OFFSET_LIMIT);
        setClass(more, 'disabled', priceOffset >= OFFSET_LIMIT);
    };
    node.__update();
    return node;
}

function buildPanel() {
    countPill = h('div.PZ2QoL_pill.subtle');
    offsetControl = buildOffsetControl();
    // the pause between listings: a compact slider in the header
    paceControl = paceSlider('lister', { compact: true });
    sectionButtons = h('div.PZ2QoL_listerSections');
    body = h('div.PZ2QoL_listerBody');
    panel = h('div.PZ2QoL_card.PZ2QoL_lister', null,
        h('div.PZ2QoL_cardHeader', null,
            icon('IconTrade', 'brown', 'lg'),
            h('div.PZ2QoL_cardTitles', null,
                h('div.PZ2QoL_cardTitle', { text: 'Market lister' }),
                h('div.PZ2QoL_cardSubtitle', { text: 'Prices from Conservation Credit listings you have seen on the Market and in your History' })),
            h('div.PZ2QoL_flex1'),
            sectionButtons,
            paceControl,
            offsetControl,
            countPill),
        body);
    document.body.appendChild(panel);
}

function statTile(sexLabel, cls, g) {
    const has = g && g.count;
    return h(`div.PZ2QoL_statTile.${cls}${has ? '' : '.empty'}`, null,
        h('div.PZ2QoL_statTileHead', null, h(`div.PZ2QoL_sexDot.${cls}`, { text: sexLabel }), h('div.PZ2QoL_statTileLabel', { text: has ? `${g.count} listed` : 'none listed' })),
        h('div.PZ2QoL_statTileValue', { text: has ? fmtInt(g.median) : '–' }),
        h('div.PZ2QoL_statTileSub', { text: has ? `${fmtInt(g.min)}–${fmtInt(g.max)} CC · gene ${g.medianScore ?? '–'}` : 'no data yet' }));
}

// Horizontal strip: every listing of the species as a dot by price, plus
// the game's own value and our recommendation.
function priceStrip(species, book, advice) {
    const live = book.filter(l => l.species == species && l.isCC && l.price > 0 && l.source != 'history');
    const values = live.map(l => l.price);
    if (advice.price > 0) values.push(advice.price);
    // the game's value only joins the scale when it is near the market;
    // an outlier would squash every dot into one corner
    const lo0 = Math.min(...values);
    const hi0 = Math.max(...values);
    const gameOnScale = advice.gameValue > 0 && (values.length == 0 || (advice.gameValue >= lo0 * 0.5 && advice.gameValue <= hi0 * 1.5));
    if (gameOnScale) values.push(advice.gameValue);
    if (values.length < 2) return null;
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi - lo < 1) { lo *= 0.9; hi *= 1.1; }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const x = p => `${((p - lo) / (hi - lo) * 100).toFixed(2)}%`;
    const compIds = new Set(advice.comps.list.map(l => l.id));
    const track = h('div.PZ2QoL_stripTrack');
    for (const l of live) {
        track.appendChild(h(`div.PZ2QoL_stripDot.${SEX_CLASS[l.gender] || 'other'}${compIds.has(l.id) ? '.comp' : ''}`, {
            style: { left: x(l.price) },
            title: `${SEX[l.gender] || ''} gene ${l.score ?? '–'} · ${fmtInt(l.price)} CC`,
        }));
    }
    if (gameOnScale) {
        track.appendChild(h('div.PZ2QoL_stripMark.game', { style: { left: x(advice.gameValue) }, title: `Game value ${fmtInt(advice.gameValue)} CC` }));
    }
    if (advice.price > 0) {
        track.appendChild(h('div.PZ2QoL_stripMark.rec', { style: { left: x(advice.price) }, title: `Recommended ${fmtInt(advice.price)} CC` },
            h('div.PZ2QoL_stripFlag', { text: fmtInt(advice.price) })));
    }
    return h('div.PZ2QoL_strip', null,
        track,
        h('div.PZ2QoL_stripAxis', null,
            h('div', { text: `${fmtInt(lo)} CC` }),
            h('div.PZ2QoL_stripLegend', null,
                h('div.PZ2QoL_legendItem.male', { text: '♂' }),
                h('div.PZ2QoL_legendItem.female', { text: '♀' }),
                h('div.PZ2QoL_legendItem.game', { text: gameOnScale || !(advice.gameValue > 0) ? 'game value' : `game value ${fmtInt(advice.gameValue)} (off scale)` }),
                h('div.PZ2QoL_legendItem.rec', { text: 'recommended' })),
            h('div', { text: `${fmtInt(hi)} CC` })));
}

function confidenceMeter(conf) {
    const level = CONF_LEVEL[conf] ?? 0;
    return h('div.PZ2QoL_confMeter', { title: CONFIDENCE[conf] },
        [1, 2, 3].map(i => h(`div.PZ2QoL_confSeg.lvl${level}${i <= level ? '.on' : ''}`)),
        h('div.PZ2QoL_confLabel', { text: CONFIDENCE[conf] }));
}

function animalColumn(a) {
    const g = geneScore(a);
    return h('div.PZ2QoL_col.animal', null,
        h('div.PZ2QoL_colLabel', { text: 'Selected animal' }),
        h('div.PZ2QoL_animalName', null,
            h(`div.PZ2QoL_sexDot.${SEX_CLASS[a.gender] || 'other'}`, { text: SEX[a.gender] || '·' }),
            h('div.PZ2QoL_animalSpecies', { text: a.species ? speciesName(a.species) : 'Animal' })),
        h('div.PZ2QoL_animalNick', { text: t(a.name) }),
        h('div.PZ2QoL_geneRow', null,
            h('div.PZ2QoL_scoreStack', null,
                h(`div.PZ2QoL_bigScore.${tierOf(g)}`, { text: g == null ? '–' : String(g), title: 'Gene score' }),
                // the game's genetics rating (Rating column), used for pricing
                medalOf(a) != undefined ? h(`div.PZ2QoL_medalPill.${medalOf(a)}`, { text: medalLabel(medalOf(a)), title: 'Genetics rating shown by the game' }) : null,
                morphPill(a)),
            h('div.PZ2QoL_geneList', null, GENES.filter(x => relevantGenes(a).includes(x.id)).map(x => {
                const v = a.genes[x.id];
                const pct = typeof v === 'number' ? Math.round(v * 100) : null;
                return h('div.PZ2QoL_geneLine', { title: `${x.label} ${pct ?? '–'}%` },
                    icon(x.icon, 'brown', 'xs'),
                    h('div.PZ2QoL_geneTrack', null, h(`div.PZ2QoL_geneFill.${tierOf(pct)}`, { style: { width: `${pct ?? 0}%` } })),
                    h('div.PZ2QoL_geneVal', { text: pct == null ? '–' : String(pct) }));
            }))));
}

function marketColumn(a, book, advice) {
    const s = speciesMarketSummary(a.species, book);
    const closest = advice.comps.list.slice()
        .sort((x, y) => Math.abs((x.score ?? 0) - (advice.score ?? 0)) - Math.abs((y.score ?? 0) - (advice.score ?? 0)))
        .slice(0, 6);
    return h('div.PZ2QoL_col.market', null,
        h('div.PZ2QoL_colLabel', { text: `Live market · ${speciesName(a.species)}` }),
        h('div.PZ2QoL_tiles', null,
            statTile('♂', 'male', s.male),
            statTile('♀', 'female', s.female),
            s.juvenile.count ? statTile('juv', 'juvenile', s.juvenile) : null,
            s.history.count ? statTile('you', 'history', s.history) : null),
        medalRow(s, medalOf(a)),
        morphRow(s, morphOf(a, normalMorphLabel(a.species, book))),
        priceStrip(a.species, book, advice) || h('div.PZ2QoL_emptyNote', { text: 'No prices recorded for this species yet. Use “Check market prices”.' }),
        closest.length ? h('div.PZ2QoL_compRow', null,
            h('div.PZ2QoL_compLabel', { text: 'Closest' }),
            closest.map(c => h(`div.PZ2QoL_compChip.${SEX_CLASS[c.gender] || 'other'}`, { title: `${SEX[c.gender] || ''} ${medalLabel(medalOf(c))} gene ${c.score ?? '–'}` },
                medalOf(c) != undefined ? h(`span.PZ2QoL_medalDot.${medalOf(c)}`) : null,
                h('span.PZ2QoL_compGene', { text: `G${c.score ?? '–'}` }),
                // the listed price, also for a listing scaled from another medal
                h('span', { text: fmtInt(c.rawPrice ?? c.price) })))) : null);
}

// A colour morph label as text: loc tokens ("[...]") through the game's
// translation, plain text as it is.
function morphName(s) {
    return /^\[.*\]$/.test(String(s)) ? t(s) : String(s);
}

// The animal's colour morph (the game's label), when it has one: it is
// priced against listings of the same morph (pricing.js comparables).
function morphPill(a) {
    const m = morphOf(a, normalMorphLabel(a.species, getPriceBook()));
    if (!m) return null;
    const name = morphText(m, morphName);
    return h('div.PZ2QoL_medalPill.morph', { text: name.length > 12 ? name.slice(0, 11) + '…' : name, title: `Colour morph: ${name}. Priced against ${name} listings when there are enough.` });
}

// Live CC colour-morph listings of the species (normal animals left out).
function morphRow(s, mine) {
    const morphs = Object.keys(s.byMorph || {});
    if (!morphs.length) return null;
    return h('div.PZ2QoL_medalRow.morph', null,
        h('div.PZ2QoL_compLabel', { text: 'Colour morphs' }),
        morphs.map(m => {
            const g = s.byMorph[m];
            const name = morphText(m, morphName);
            return h(`div.PZ2QoL_medalChip.morph${m == mine ? '.mine' : ''}`, { title: `${name}: ${g.count} listed, median ${fmtInt(g.median)} CC` },
                h('span.PZ2QoL_medalName', { text: `${name} ×${g.count}` }),
                h('span', { text: fmtInt(g.median) }));
        }));
}

// Live CC listings of the species by genetics medal (only when recorded),
// the selected animal's medal highlighted.
function medalRow(s, mine) {
    const medals = Object.keys(s.byMedal || {});
    if (!medals.length) return null;
    return h('div.PZ2QoL_medalRow', null,
        h('div.PZ2QoL_compLabel', { text: 'By medal' }),
        medals.map(m => {
            const g = s.byMedal[m];
            return h(`div.PZ2QoL_medalChip.${m}${m == mine ? '.mine' : ''}`, { title: `${medalLabel(m)}: ${g.count} listed (${g.males}♂ ${g.females}♀), ${fmtInt(g.min)}–${fmtInt(g.max)} CC` },
                h(`span.PZ2QoL_medalDot.${m}`),
                h('span.PZ2QoL_medalName', { text: `${medalLabel(m)} ×${g.count}` }),
                h('span', { text: fmtInt(g.median) }));
        }));
}

// The engine's run in the panel.
function engineRunBlock(s) {
    const tl = tally(s);
    // the desk's Check storage: nothing is listed
    if (s.mode === 'check') {
        const running = s.phase === 'running';
        return h(`div.PZ2QoL_run.${running ? 'running' : s.phase === 'done' ? 'done' : 'stopped'}`, null,
            h('div.PZ2QoL_runHead', null,
                h('div.PZ2QoL_runTitle', { text: running ? 'Checking storage…' : 'Storage check ended' }),
                h('div.PZ2QoL_flex1'),
                h('div.PZ2QoL_pill.ok', { text: `${tl.checked}/${tl.total} checked` })),
            h('div.PZ2QoL_listerStatus.clamp', { text: 'Market desk: reading what the game allows for each animal. Nothing is sold or listed.' }));
    }
    // the desk's Quick trade / Quick release
    if (s.mode === 'quicktrade' || s.mode === 'release') {
        const running = s.phase === 'running';
        const trade = s.mode === 'quicktrade';
        const n = trade ? tl.traded : tl.released;
        return h(`div.PZ2QoL_run.${running ? 'running' : s.phase === 'done' ? 'done' : 'stopped'}`, null,
            h('div.PZ2QoL_runHead', null,
                h('div.PZ2QoL_runTitle', { text: running ? (trade ? 'Quick trading…' : 'Releasing…') : s.phase === 'done' ? 'Finished' : 'Stopped' }),
                h('div.PZ2QoL_flex1'),
                h('div.PZ2QoL_pill.ok', { text: `${n}/${tl.total} ${trade ? 'quick-traded' : 'released'}` })),
            h('div.PZ2QoL_listerStatus.clamp', { text: s.message || 'Market desk: one animal at a time; open the desk to follow it.', title: s.message || '' }));
    }
    const processed = tl.total - tl.pending - tl.working;
    const pct = tl.total ? Math.round(processed / tl.total * 100) : 0;
    const state = s.phase === 'running' ? 'running' : s.phase === 'done' ? 'done' : 'stopped';
    const cur = s.results[s.index];
    const status = state === 'running'
        ? `${processed + 1 > tl.total ? tl.total : processed + 1}/${tl.total}: ${cur ? labelOf(cur.guid) : ''} · ${STEP_WORDS[s.step] || s.message || 'Working…'}${s.waited >= 2 ? ` (${Math.round(s.waited)}s)` : ''}`
        : summaryText(s, fmtInt, jobNote(s)) + (s.phase === 'closed' ? ' Animal Storage was closed.' : '');
    const notListed = s.results.filter(r => r.status !== 'listed' && r.status !== 'pending' && r.status !== 'working');
    return h(`div.PZ2QoL_run.${state}`, null,
        h('div.PZ2QoL_runHead', null,
            h('div.PZ2QoL_runTitle', { text: state == 'running' ? 'Listing…' : state == 'stopped' ? 'Stopped' : 'Finished' }),
            h('div.PZ2QoL_flex1'),
            h('div.PZ2QoL_pill.ok', { text: `${tl.listed} listed` }),
            notListed.length ? h('div.PZ2QoL_pill.warn', { text: `${notListed.length} not listed` }) : null),
        h('div.PZ2QoL_progress', null, h('div.PZ2QoL_progressFill', { style: { width: `${pct}%` } })),
        h('div.PZ2QoL_listerStatus.clamp', { text: status, title: status }),
        notListed.slice(-2).map(r => {
            const text = `${labelOf(r.guid)}: ${resultText(r, t)}`;
            return h('div.PZ2QoL_runSkip', { text: `Not listed · ${text}`, title: text });
        }));
}

function runBlock() {
    const es = getEngineState();
    return es ? engineRunBlock(es) : null;
}

function recColumn(keys, single, advice) {
    const busy = engineRunning();
    const col = h('div.PZ2QoL_col.rec');
    if (single) {
        col.appendChild(h('div.PZ2QoL_colLabel', { text: advice.offset ? `Recommended price ${offsetLabel(advice.offset)}` : 'Recommended price' }));
        col.appendChild(h(`div.PZ2QoL_recPrice.conf_${advice.confidence}`, null,
            icon('Icon_ConservationCredits', 'none', 'md'),
            h('div.PZ2QoL_listerRecPrice', { text: advice.price > 0 ? `${fmtInt(advice.price)} CC` : 'No recommendation' }),
            advice.offset && advice.price > 0 && advice.basePrice != advice.price
                ? h('div.PZ2QoL_recBase', { text: `${fmtInt(advice.basePrice)} before ${offsetLabel(advice.offset)}`, title: 'Recommended price before your offset' }) : null));
        col.appendChild(confidenceMeter(advice.confidence));
        col.appendChild(h('div.PZ2QoL_recWhy', { text: advice.reason }));
    }
    else {
        const total = sellableKeys(keys).map(k => adviceFor(animalForKey(k), {})).reduce((sum, x) => sum + (x.price > 0 ? x.price : 0), 0);
        col.appendChild(h('div.PZ2QoL_colLabel', { text: `${keys.length} animals selected${priceOffset ? ` · prices ${offsetLabel(priceOffset)}` : ''}` }));
        col.appendChild(h('div.PZ2QoL_recPrice.total', null,
            icon('Icon_ConservationCredits', 'none', 'sm'),
            h('div.PZ2QoL_listerRecPrice', { text: `≈ ${fmtInt(total)} CC total` })));
        if (!getEngineState()) col.appendChild(h('div.PZ2QoL_recWhy', { text: "Each animal is priced with the game's own limits when it is listed. Animals the game can't trade (e.g. juveniles) are skipped." }));
    }
    const actions = h('div.PZ2QoL_actions');
    if (busy) {
        actions.appendChild(h('div.PZ2QoL_btn.negative', { onClick: () => stopListing() }, icon('Icon_Close', 'white', 'sm'), h('span', { text: 'Stop' })));
    }
    else {
        const n = single ? keys.length : sellableKeys(keys).length;
        const label = !single ? `Sell ${n} at recommended prices`
            : (advice && advice.confidence == 'none' ? 'Sell at game price' : 'Sell at recommended price');
        const sell = h('div.PZ2QoL_btn.positive', {
            onClick: () => {
                if (!sell.classList.contains('disabled')) sellAtRecommendedPrice(keys);
            },
        }, icon('IconTrade', 'white', 'sm'), h('span', { text: label }));
        const blocked = single ? singleBlockText(single) : '';
        if (blocked) {
            sell.classList.add('disabled');
            sell.title = blocked;
        }
        const leftOut = single ? '' : leftOutText(keys);
        if (leftOut) sell.title = `Left out: ${leftOut}.`;
        if (!single && n == 0) sell.classList.add('disabled');
        const checkingAll = isMultiCheckBusy();
        if (checkingAll || isPeekBusy()) {
            sell.classList.add('disabled');
            sell.title = 'Wait for the market check to finish';
        }
        actions.appendChild(sell);
        if (!single) actions.appendChild(multiCheckButton(keys));
        if (single) {
            const known = countForSpecies(single.species);
            const checking = isPeekBusy();
            const check = h('div.PZ2QoL_btn', { onClick: () => checkMarketFor(single.species), title: "Loads this species' current Market listings in the background; the screen stays on Animal Storage" },
                icon('IconSearch', 'brown', 'sm'),
                h('span', { text: checking ? 'Checking market…' : known ? `Refresh prices (${known} known)` : 'Check market prices' }));
            if (checking) check.classList.add('disabled');
            actions.appendChild(check);
        }
    }
    col.appendChild(actions);
    const blockedText = single && !busy ? singleBlockText(single) : '';
    if (blockedText) col.appendChild(h('div.PZ2QoL_recWhy', { text: blockedText }));
    if (single && peek && peek.species == single.species && peek.message) {
        col.appendChild(h(`div.PZ2QoL_peekStatus.${peek.state}`, { text: peek.message, title: peek.message }));
    }
    if (!single) {
        const status = multiCheckStatus();
        if (status) col.appendChild(status);
    }

    const rb = runBlock();
    if (rb) col.appendChild(rb);
    return col;
}

// The selected species, most-selected first (the order they are checked in).
function speciesInOrder(keys) {
    const n = new Map();
    for (const k of keys) {
        const sp = animalForKey(k).species;
        if (sp) n.set(sp, (n.get(sp) || 0) + 1);
    }
    return Array.from(n.keys()).sort((x, y) => n.get(y) - n.get(x));
}

// "Refresh prices" for every selected species (under Sell), or Stop.
function multiCheckButton(keys) {
    if (isMultiCheckBusy()) {
        return h('div.PZ2QoL_btn.negative', { onClick: () => stopMultiCheck(), title: 'Stops after the species being checked now' },
            icon('Icon_Close', 'white', 'sm'), h('span', { text: 'Stop checking' }));
    }
    const species = speciesInOrder(keys);
    const button = h('div.PZ2QoL_btn', { onClick: () => checkMarketForAll(species), title: "Loads each selected species' Market listings (all pages) in the background, one species after another; the screen stays on Animal Storage" },
        icon('IconSearch', 'brown', 'sm'),
        h('span', { text: `Refresh prices (${species.length} species)` }));
    if (isPeekBusy() || engineRunning()) button.classList.add('disabled');
    return button;
}

// How the multi-species check is going.
function multiCheckStatus() {
    if (!peekAll || !peekAll.message) return null;
    const state = !peekAll.finished ? 'reading' : peekAll.failed.length ? 'failed' : 'done';
    const detail = !peekAll.finished && peek && peek.message ? ` ${peek.message}` : '';
    return h(`div.PZ2QoL_peekStatus.${state}`, { text: peekAll.message + detail, title: peekAll.message + detail });
}

// Big selections (30+ animals) stay compact: a per-species summary on top,
// the individual animals in a scrolling table underneath, worst value
// (no price) last so nothing important hides below the fold.
function multiColumn(keys) {
    const rows = keys.map(k => {
        const a = animalForKey(k);
        return { a, adv: adviceFor(a, {}), g: geneScore(a) };
    });
    const groups = new Map();
    for (const r of rows) {
        const key = r.a.species || '?';
        let grp = groups.get(key);
        if (!grp) {
            grp = { species: key, n: 0, males: 0, females: 0, total: 0, scores: [] };
            groups.set(key, grp);
        }
        grp.n++;
        if (r.a.gender == Gender.Male) grp.males++;
        if (r.a.gender == Gender.Female) grp.females++;
        if (r.adv.price > 0) grp.total += r.adv.price;
        if (r.g != null) grp.scores.push(r.g);
    }
    const groupList = Array.from(groups.values()).sort((x, y) => y.n - x.n);
    const shownGroups = groupList.slice(0, 4);
    rows.sort((x, y) => (y.adv.price > 0) - (x.adv.price > 0) || (y.g ?? -1) - (x.g ?? -1));
    return h('div.PZ2QoL_col.multi', null,
        h('div.PZ2QoL_colLabel', { text: `Selection · ${keys.length} animals · ${groups.size} species` + (groupList.length > shownGroups.length ? ` (top ${shownGroups.length} shown)` : '') }),
        h('div.PZ2QoL_groupRow', null,
            shownGroups.map(grp => {
                const avg = grp.scores.length ? Math.round(grp.scores.reduce((s, v) => s + v, 0) / grp.scores.length) : null;
                return h('div.PZ2QoL_groupChip', { title: `${speciesName(grp.species)}: ${grp.n} selected, average gene ${avg ?? '–'}, about ${fmtInt(grp.total)} CC` },
                    h('div.PZ2QoL_groupName', { text: speciesName(grp.species) }),
                    h('div.PZ2QoL_groupMeta', null,
                        h('span.PZ2QoL_groupCount', { text: `×${grp.n}` }),
                        grp.males ? h('span.male', { text: `${grp.males}♂` }) : null,
                        grp.females ? h('span.female', { text: `${grp.females}♀` }) : null,
                        h(`span.PZ2QoL_miniScore.${tierOf(avg)}`, { text: avg == null ? '–' : String(avg) }),
                        h('span.PZ2QoL_groupTotal', { text: `≈${fmtInt(grp.total)}` })));
            }),
            null),
        h('div.PZ2QoL_tableScroll', null, rows.map(({ a, adv, g }) =>
            h('div.PZ2QoL_tableRow', null,
                h(`div.PZ2QoL_sexDot.${SEX_CLASS[a.gender] || 'other'}`, { text: SEX[a.gender] || '·' }),
                h('div.PZ2QoL_tableName', { text: `${speciesName(a.species)} · ${t(a.name)}` }),
                medalOf(a) != undefined ? h(`span.PZ2QoL_medalDot.${medalOf(a)}`, { title: medalLabel(medalOf(a)) }) : null,
                h(`div.PZ2QoL_miniScore.${tierOf(g)}`, { text: g == null ? '–' : String(g) }),
                h(`div.PZ2QoL_tablePrice.conf_${adv.confidence}`, { text: adv.price > 0 ? `${fmtInt(adv.price)} CC` : '–', title: CONFIDENCE[adv.confidence] })))));
}

function renderPanel(force) {
    const keys = selectedKeys().filter(k => get(STORAGE_LIST.concat(k), 'id') != undefined);
    const book = getPriceBook();
    const es = getEngineState();
    const signature = JSON.stringify([keys, get(STORAGE_ACTIONS, 'tradeAllowed'), book.length, enabled, isFranchise(), priceOffset, peek && [peek.state, peek.message], peekAll && [peekAll.message, peekAll.finished, peekAll.stopRequested],
        es && [es.run, es.phase, es.index, es.step, Math.round(es.waited || 0), es.results.map(r => r.status).join('')], sections.map(s => s.signature())]);
    if (offsetControl) offsetControl.__update();
    if (!force && signature == lastRender) return;
    lastRender = signature;
    clear(body);
    clear(sectionButtons);
    setText(countPill, `${fmtInt(book.filter(l => l.isCC).length)} prices recorded`);

    if (!isFranchise()) {
        body.appendChild(h('div.PZ2QoL_empty', null, icon('IconInformation', 'brown', 'lg'), h('div.PZ2QoL_listerMsg', { text: 'Listing animals is only available in Franchise mode.' })));
        return;
    }
    for (const s of sections) {
        const button = s.button();
        const block = s.block();
        if (button) sectionButtons.appendChild(button);
        if (block) body.appendChild(block);
    }
    if (keys.length == 0 && !engineRunning()) {
        body.appendChild(h('div.PZ2QoL_empty', null, icon('IconInformation', 'brown', 'lg'),
            h('div.PZ2QoL_listerMsg', { text: 'Select an animal, or tick several, to see live market prices and a recommended price.' })));
        const rb = runBlock();
        if (rb) body.appendChild(rb);
        return;
    }
    const row = h('div.PZ2QoL_cols');
    if (keys.length == 1) {
        const a = animalForKey(keys[0]);
        const advice = adviceFor(a, tradeLimits());
        row.appendChild(animalColumn(a));
        row.appendChild(marketColumn(a, book, advice));
        row.appendChild(recColumn(keys, a, advice));
    }
    else {
        row.appendChild(multiColumn(keys));
        row.appendChild(recColumn(keys, null, null));
    }
    body.appendChild(row);
}

let prewarmed = false;
function place() {
    if (!prewarmed) {
        // bind the collections early so they are filled before the first
        // click (the DataStore is not ready while modules are loading)
        try {
            childrenOf(SPECIES_LIST);
            childrenOf(STORAGE_LIST);
            prewarmed = true;
        }
        catch (e) {
            // try again next tick
        }
    }
    const header = document.querySelector('.AnimalMarketStorage_header');
    const anchor = visibleBox(header) ? header : null;
    // what the game-side listing engine can do, kept fresh while storage is open
    if (anchor && isFranchise()) engineCaps({ maxAgeMs: 8000 }).catch(() => {});
    // a game popup on top (Compare Mates from Storage...): step aside, as the bars do
    if (!enabled || !anchor || isGamePopupOpen()) {
        if (panel) panel.style.display = 'none';
        return;
    }
    if (!panel) buildPanel();
    // sits directly under the storage toolbar, same width
    const bar = document.querySelector('.PZ2QoL_bar.storage');
    const barVisible = bar && bar.style.display != 'none';
    const r = barVisible ? bar.getBoundingClientRect() : anchor.getBoundingClientRect();
    panel.style.display = 'flex';
    panel.style.left = `${Math.round(r.left)}px`;
    panel.style.top = `${Math.round(r.bottom + 8)}px`;
    panel.style.width = `${Math.round(r.width)}px`;
    stepAside(panel, GAME_COVERS, 'lister', header.parentElement);
    renderPanel(false);
}

export function installLister() {
    document.body.classList.toggle('PZ2QoL_listerOn', enabled);
    // a hidden panel is drawn when place() shows it again
    const renderIfShown = () => {
        if (!panel) return;
        if (panel.style.display === 'none') lastRender = '';
        else renderPanel(true);
    };
    onPriceBookChanged(renderIfShown);
    onMarketCheckChanged(renderIfShown);
    onEngineState(renderIfShown);
    // a pace change during an engine run applies from the next pause
    onPace(kind => {
        if (kind === 'lister' && engineRunning()) setEnginePace(getPaceMs('lister'));
    });
    if (typeof engine !== 'undefined') engine.on('PZ2QoL_MarketPeekState', (state, detail) => onPeekState(state, detail));
    onListerSettingChanged(() => {
        lastRender = '';
        place();
    });
    // Only positions and refreshes the panel; it never starts a listing.
    setInterval(() => {
        try {
            place();
        }
        catch (e) {
            reportError('ui', 'Lister panel failed', e, { silent: true });
        }
    }, 300);
}
