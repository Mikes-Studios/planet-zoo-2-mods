// Market desk: list storage animals on the Franchise market from one place.
//
//   head    title, whether the game-side listing engine is ready, Close
//   left    species in storage: sellable / on the market
//   middle  the species' animals with their recommended price and state;
//           filters to pick a population (sex, age, fertility, rating, a
//           gene range, what to show; "More filters": per-gene ranges, keep
//           the best N per sex, pregnancy, storage tags, Kin, price, name);
//           the desk's own ticks (it opens with the storage screen's)
//   right   the run: how many, the total, duration, price offset, pace,
//           List N / Stop, progress and results, Retry
//
// The storage list under it is rewritten by the game all the time (every
// listed row's countdown, rebuilds after sales); the desk reads it at most
// once a second, keys its rows by the animal's GUID, and redraws only when
// something it shows changed. Nothing is listed until the player presses
// List; the engine lists one animal at a time and waits for the game.
// Gameface: own DOM under <body>, explicit display:flex, no grid, scroll
// areas from kinpanel.js.
import { childrenOf, STORAGE_DATA, STORAGE_LIST, get, readAnimal } from '/js/mods/pz2qol/game.js';
import {
    adviceFor, animalLabel, buildOffsetControl, checkMarketFor, checkMarketForAll, fingerprint, getMarketCheck, getMultiMarketCheck, getPriceOffset, identityOf, isFranchise, jobNote,
    isListingBusy, isMultiCheckBusy, isPriceCheckFresh, labelOf, listAnimals, onListerSettingChanged, onMarketCheckChanged, PRICE_CHECK_FRESH_MS,
    stopListing, stopMultiCheck,
} from '/js/mods/pz2qol/lister.js';
import {
    activeFilterCount, basisScore, BLOCK_WORDS, carryTicks, CAUTION_WORDS, NOID_TEXT, PREGNANT_TEXT, deskRows, filterRows, GENE_BASES, GENE_KEYS, normalizeFilters, resetFilters, RESULT_WORDS,
    reasonText, resultText, retryGuids, shownResult, tradeProblemKeys, sortRows, speciesCounts, STEP_WORDS, STORAGE_TAGS, summaryText, tally, tickable, tickedRows, timeLeftText, nativeFiltersOn, storageScope,
    checkMinutes, checkPaceMs, checkSummaryText, encodeCheckJob, quickOffers, refusedGuids, rowBlock, uncheckedRows, verdictsOfState,
    normalizeRefused, REFUSED_OPTIONS, refusedNote,
    acceptedMode, encodeQuickJob, FIRST_TEXT, QUICK_MODES, quickAccepted, QUICK_WARNING, quickEligible, quickMoney, quickRunSummary, quickSheet,
} from '/js/mods/pz2qol/listercore.js';
import { getPref, setPref, updatePref } from '/js/mods/pz2qol/prefs.js';
import { onShouldBlockInput } from '/js/common/core/Input.js';
import { capsAgeMs, deskFilters, engineCaps, engineRunning, engineUsable, engineWhyNot, getEngineState, onEngineState, resolveGuids, startEngineRun } from '/js/mods/pz2qol/listerlua.js';
import { getPaceMs } from '/js/mods/pz2qol/pace.js';
import { Gender, Maturity } from '/js/mods/pz2qol/scores.js';
import { medalLabel, MEDALS } from '/js/mods/pz2qol/pricing.js';
import { getStorageFilters, getStoragePredicates, setStorageVerdicts } from '/js/mods/pz2qol/listfilter.js';
import { rangeSlider } from '/js/mods/pz2qol/rangeslider.js';
import { getPriceBook, onPriceBookChanged } from '/js/mods/pz2qol/pricebook.js';
import { paceSlider } from '/js/mods/pz2qol/pace.js';
import { clear, fmtInt, h, setClass, setText, tierOf } from '/js/mods/pz2qol/ui.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog, logPriceDecision } from '/js/mods/pz2qol/debuglog.js';
import { translate } from '/js/common/core/Localisation.js';
import { getKinSettings } from '/js/mods/pz2qol/kin.js';
import { listingsCounts, listingsHidden, listingsKey, listingsSig, renderListings } from '/js/mods/pz2qol/marketreprice.js';
import { getLedger, getReprice, isRepriceReq, onRepriceChanged, repriceActive } from '/js/mods/pz2qol/repricerun.js';
import { strandedItems } from '/js/mods/pz2qol/repricecore.js';
import {
    btn as kitBtn, closeButton, closeOtherPanels, makeGuard, makeScroll, placePanel, refreshBars, registerPanel, restoreScroll, speciesName, trunc,
} from '/js/mods/pz2qol/kinpanel.js';

const READ_MS = 1000;
const READ_AGAIN_TITLE = 'Read the animals and what the game-side engine can do again';
const RULES_SELL = 'Nothing is listed until you press List · one animal at a time, each confirmed by the game · a pause between listings · Stop any time';
const RULES_LISTINGS = 'Nothing changes until you confirm a reprice · each listing taken off, then listed again, one at a time, each confirmed by the game · Stop any time';
const guard = makeGuard('Market desk');
const btn = (...args) => kitBtn(guard, ...args);

const SEX = { [Gender.Male]: '♂', [Gender.Female]: '♀' };
const SEX_CLASS = { [Gender.Male]: 'male', [Gender.Female]: 'female' };
const STAGE = {
    [Maturity.Infant]: 'Juvenile',
    [Maturity.YoungAdult]: 'Young adult',
    [Maturity.Adult]: 'Adult',
    [Maturity.Elderly]: 'Elderly',
    [Maturity.YoungAdultInfertile]: 'Young adult, infertile',
    [Maturity.AdultInfertile]: 'Adult, infertile',
    [Maturity.ElderlyInfertile]: 'Elderly, infertile',
};
const FILTERS_KEY = 'PZ2QoL.deskFilters';

// The desk's filters, kept for the session (Gameface keeps localStorage for
// the session only; it is a convenience, the desk works without it).
function loadFilters() {
    try {
        const saved = window.localStorage && JSON.parse(window.localStorage.getItem(FILTERS_KEY) || 'null');
        return normalizeFilters(saved);
    }
    catch (e) {
        return normalizeFilters(null);
    }
}

function saveFilters() {
    try {
        if (window.localStorage) window.localStorage.setItem(FILTERS_KEY, JSON.stringify(D.filters));
    }
    catch (e) {
        // session only
    }
}

const CONFIDENCE = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence (few listings)', none: "no market data: the game's own price" };

const D = {
    root: null,
    el: {},
    open: false,
    filters: null,           // normalizeFilters(), loaded on first open
    moreOpen: false,         // "More filters" shown
    ctl: null,               // controls built once (sliders, the name box)
    chosen: new Set(),       // row ids (g<guid>) the player ticked
    pendingKeys: null,       // storage keys to tick once their GUIDs are known
    hours: 'max',
    rows: [],                // deskRows()
    priceMemo: new Map(),    // row key -> { book, offset, inputs, advice } (deskAdvice)
    readSig: '',
    lastRead: 0,
    reading: false,
    readAgain: false,
    caps: null,
    timer: 0,
    queued: false,
    unsub: [],
    boxes: {},
    scroll: { rail: 0, list: 0 },
    notice: null,
    offset: null,
    pace: null,
    renderSig: '',
    sideSig: '',
    scope: null,             // storageScope(): what Animal Storage showed when the desk opened
    unfilter: '',            // the game's storage filters: '' | 'clearing' | 'cleared' | 'failed'
    cleared: false,          // cleared by the desk and not yet put back (Lua may wait for a run)
    reveal: null,            // { n }: keep the species opened on in view as the rail fills
    // 'list' | 'quicktrade' | 'release';
    // always 'list' when the desk opens (a quick mode is never remembered)
    mode: 'list',
    sheet: null,             // the confirmation sheet: { mode, info, rows, done, openedAt }
    labels: new Map(),       // guid -> label of the animals a quick run took (they leave storage)
    // 'sell' (storage animals to list) | 'listings' (My listings: staleness
    // and reprice, marketreprice.js); kept while the page lives
    view: 'sell',
};

// The live acceptance: a mode is open for more than one animal at a time
// only after a run of exactly one was confirmed gone (prefs quickAccepted).
// "When the server refuses a listing": 'leave' (default) | 'quicktrade' | 'release'
function refusedOption() {
    try {
        return normalizeRefused(getPref('deskRefused'));
    }
    catch (e) {
        return 'leave';
    }
}

function isAccepted(mode) {
    try {
        return quickAccepted(mode, getPref('quickAccepted'));
    }
    catch (e) {
        return quickAccepted(mode, null);
    }
}

function takeQuickAcceptance() {
    const m = acceptedMode(getEngineState());
    if (!m || isAccepted(m)) return;
    updatePref('quickAccepted', o => Object.assign({}, o && typeof o === 'object' ? o : {}, { [m]: true }));
    breadcrumb('desk_quick_accepted');
    dlog('desk', 'quick_accepted', { mode: m });
    notice(`${QUICK_MODES[m].label} checked: the animal left storage as it should. You can now ${QUICK_MODES[m].label.toLowerCase()} several at a time.`, 'ok');
}

// Animals a run found the game won't trade (guid -> its reason), for this
// page: they stay unticked and say why; Read storage again checks afresh.
const gameBlocked = new Map();

// What the game allows for each animal a listing run or Check storage has
// selected (guid -> listercore verdictOf): market, Quick trade, Quick
// release, Rehome. For the page;
// Read storage again clears it (runs up to verdictFloor no longer count).
const verdicts = new Map();
let verdictFloor = 0;
// Whether a Check storage run is this page's (its req) and what it was asked.
const checkRuns = new Map(); // req -> { n, species }
// GUIDs a listing run had refused by the server (this page): the player can
// quick-trade those leftovers (developer, 2026-10-18: 12 of 28 tigers refused, 255)
const refusedSet = new Set();

// The engine's results: remember the game's refusals and verdicts, untick
// the rows that can't be listed now.
function takeGameBlocks() {
    const s = getEngineState();
    if (!s || !Array.isArray(s.results)) return;
    let added = false;
    for (const r of s.results) {
        if (r.kind !== 'untradeable' || !r.guid || gameBlocked.has(r.guid)) continue;
        gameBlocked.set(r.guid, r.detail || '');
        added = true;
    }
    // the server's refusals in a listing run: offered for Quick trade
    for (const g of refusedGuids(s)) refusedSet.add(g);
    if (!(s.run > verdictFloor)) return applyBlocks(added);
    for (const [guid, v] of verdictsOfState(s)) {
        const was = verdicts.get(guid);
        if (was && was.src === v.src && was.trade === v.trade && was.quickTrade === v.quickTrade && was.quickRelease === v.quickRelease && was.rehome === v.rehome
            && was.values.quickTrade === v.values.quickTrade && was.values.quickRelease === v.values.quickRelease) continue;
        verdicts.set(guid, v);
        added = true;
    }
    applyBlocks(added);
}

// The game's verdict on a storage animal, from the desk's last read: the
// Sell advice chip's market, release and quick sell follow it.
function verdictForAnimal(a) {
    const row = a && D.rows.find(r => r.a && r.a.key === a.key);
    return (row && row.guid && verdicts.get(row.guid)) || null;
}

// The rows' blocks again from the refusals and verdicts (in place, between reads).
function applyBlocks(changed) {
    if (!changed) return;
    setStorageVerdicts(verdictForAnimal);
    let logged = 0;
    for (const row of D.rows) {
        if (!row.guid) continue;
        const was = row.block;
        Object.assign(row, rowBlock(row.a, { guid: row.guid, verdict: verdicts.get(row.guid) || null, gameBlocked }));
        if (row.block !== was && logged++ < 40) dlog('desk', 'category', { guid: row.guid, key: row.key, cat: row.cat, block: row.block || undefined, was: was || undefined, src: (row.verdict && row.verdict.src) || undefined });
    }
    pruneTicks();
}

// Only ticks the player can see and act on stay, so List sends exactly what
// is shown ticked (a quick mode ticks its own rows). -> how many went.
function pruneTicks() {
    const keep = new Set(chosenRows().filter(r => (D.mode === 'list' ? !r.block : quickEligible(r, D.mode).ok)).map(r => r.id));
    const dropped = D.chosen.size - keep.size;
    D.chosen = keep;
    return dropped;
}

// Ticks these rows (canTick decides) with their species in view (the one
// species, or all of them). -> how many the other filters still hide.
function tickInView(rows, canTick) {
    const wanted = rows.filter(canTick);
    const species = new Set(wanted.map(r => r.species));
    const want = species.size === 1 ? wanted[0].species : null;
    if (wanted.length && (D.filters.species || null) !== want) setFilters({ species: want, priceMin: 0, priceMax: 0 });
    for (const r of wanted) D.chosen.add(r.id);
    pruneTicks();
    return wanted.filter(r => !D.chosen.has(r.id)).length;
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

function notice(text, tone = 'info') {
    D.notice = { text, tone, until: Date.now() + 9000 };
    dlog('desk', 'notice', { tone, text });
    queueRender();
}

// ------------------------------------------------------------- debug log
// debuglog.js (debug builds only): what the desk read, showed and did.
// Written only when it changes: the rail's counts, the shown species'
// prices, and each shown animal's price decision (one species at a time).
const deskLogSig = { rail: '', prices: '' };

function logRead(force, pageRows, guids) {
    try {
        const counts = speciesCounts(D.rows);
        const parts = counts.map(c => `${c.species}:${c.total}/${c.sellable}/${c.listed}`);
        const sig = parts.join(' ');
        if (force || sig !== deskLogSig.rail) {
            deskLogSig.rail = sig;
            dlog('desk', 'rail', {
                source: 'storage', pageRows, rows: D.rows.length, guids: guids ? guids.size : 0, noGuid: D.rows.filter(r => !r.guid).length,
                engine: engineUsable(D.caps, pageRows), capsOk: D.caps ? D.caps.ok : undefined, luaRows: D.caps ? D.caps.rows : undefined,
                species: counts.length, scoped: D.scope && D.scope.filtered ? D.scope.species || 'yes' : undefined, unfilter: D.unfilter || undefined,
            });
            // species:total/sellable/listed, six per line
            for (let i = 0; i < parts.length; i += 6) dlog('desk', 'rail_counts', { part: i / 6 + 1, counts: parts.slice(i, i + 6).join(' ') });
        }
        logPrices();
    }
    catch (e) {
        // the log never breaks the desk
    }
}

function logPrices() {
    try {
        const sp = D.filters && D.filters.species;
        const rows = D.rows.filter(r => !sp || r.species === sp);
        const priced = rows.filter(r => r.advice && r.advice.price > 0).map(r => r.advice.price).sort((x, y) => x - y);
        const conf = {};
        for (const r of rows) {
            const c = (r.advice && r.advice.confidence) || 'none';
            conf[c] = (conf[c] || 0) + 1;
        }
        const sig = `${sp}|${rows.length}|${priced.join(',')}|${Object.keys(conf).map(k => k + conf[k]).join(',')}`;
        if (sig === deskLogSig.prices) return;
        deskLogSig.prices = sig;
        dlog('desk', 'prices', {
            species: sp || 'all', rows: rows.length, priced: priced.length, min: priced[0], median: priced.length ? priced[Math.floor(priced.length / 2)] : undefined,
            max: priced[priced.length - 1], conf, book: getPriceBook().length, checked: sp ? isPriceCheckFresh(sp) : undefined,
        });
        // each animal's decision, for one species at a time (deduped per animal)
        if (sp && rows.length <= 60) {
            for (const r of rows) {
                logPriceDecision('desk', r.guid || r.key, r.advice, { guid: r.guid || undefined, key: r.key, block: r.block || undefined, caution: r.caution || undefined, gender: r.a && r.a.gender, maturity: r.a && r.a.maturity });
            }
        }
    }
    catch (e) {
        // ignore
    }
}

// ------------------------------------------------------------------ data

// The desk's price for a storage animal; a listing asks the same price. The
// game gives its own value only for the selected animal, so none is blended in.
// Kept per row while its pricing inputs, the price book and the offset stay
// the same: every read reprices every animal.
function deskAdvice(a) {
    const book = getPriceBook();
    const offset = getPriceOffset();
    const inputs = [fingerprint(a), a.id, a.maturity, a.medal, a.colormorph, a.isExhibit, a.isShoal].join('|');
    const kept = D.priceMemo.get(a.key);
    if (kept && kept.book === book && kept.offset === offset && kept.inputs === inputs) return kept.advice;
    const advice = adviceFor(a, {});
    D.priceMemo.set(a.key, { book, offset, inputs, advice });
    return advice;
}

// New prices for the rows as read (the price book or a setting changed):
// no storage read, no ids asked again.
function repriceRows() {
    for (const r of D.rows) r.advice = deskAdvice(r.a);
    pruneTicks();
    logPrices();
    queueRender();
}

// Reads the storage list. Only when something the desk keys on changed
// (an animal arrived, left, or a row now holds another animal) are GUIDs
// asked again; countdown ticks change nothing here.
async function readRows(force = false) {
    if (D.reading) {
        // a forced read (open, Read storage again, a list change) must not be
        // lost to the timer's read in flight: it runs right after
        if (force) D.readAgain = true;
        return;
    }
    D.reading = true;
    try {
        const animals = childrenOf(STORAGE_LIST).map(ctx => readAnimal(ctx)).filter(a => a.id != undefined);
        const sig = animals.map(a => `${a.key}:${fingerprint(a)}`).join('|');
        const pageRows = animals.length;
        // ask again while the engine can't be used (it may still be starting,
        // or the list was loading), and every 10 s anyway
        if (force || !D.caps || !engineUsable(D.caps, pageRows) || capsAgeMs() > 10000) D.caps = await engineCaps({ force, maxAgeMs: 1500 });
        let guids = new Map();
        // keys the game gave no id for are asked again only when the list
        // changed, on open and on Read storage again (else backed off)
        if (engineUsable(D.caps, pageRows)) guids = await resolveGuids(animals.map(identityOf), { retry: force || sig !== D.readSig });
        // Read storage again: the game's refusals are checked afresh
        if (force) gameBlocked.clear();
        const prevRows = D.rows;
        D.rows = deskRows(animals, guids, deskAdvice, guids.failed, gameBlocked, verdicts);
        setStorageVerdicts(verdictForAnimal);
        D.chosen = carryTicks(prevRows, D.rows, D.chosen);
        D.lastRead = Date.now();
        logRead(force || sig !== D.readSig, pageRows, guids);
        if (sig !== D.readSig) {
            D.readSig = sig;
            // the storage screen's ticks, once their GUIDs are known
            if (D.pendingKeys) takeStorageTicks(D.pendingKeys);
        }
        pruneTicks();
        queueRender();
    }
    catch (e) {
        reportError('ui', 'Market desk: reading storage failed', e, { silent: true });
    }
    finally {
        D.reading = false;
        if (D.readAgain) {
            D.readAgain = false;
            setTimeout(() => readRows(true), 0);
        }
    }
}

// The animals ticked on the storage screen, ticked here too with their
// species in view; never a blocked one (a pregnant one is never taken over).
function takeStorageTicks(keys) {
    D.pendingKeys = null;
    const handed = D.rows.filter(r => keys.has(r.key));
    for (const r of handed) {
        if (r.block === 'pregnant') dlog('desk', 'tick_refused', { guid: r.guid || undefined, key: r.key, why: 'pregnant', detail: PREGNANT_TEXT });
        else if (r.block === 'noid') dlog('desk', 'tick_refused', { key: r.key, why: 'noid' });
        else if (r.block === 'untradeable') dlog('desk', 'tick_refused', { guid: r.guid || undefined, key: r.key, why: 'untradeable' });
    }
    const hidden = tickInView(handed, r => !r.block);
    if (hidden) notice(`${hidden} of the animals ticked on the storage screen ${hidden === 1 ? 'is' : 'are'} hidden by the desk's filters, so not ticked here. Reset the filters to see ${hidden === 1 ? 'it' : 'them'}.`, 'warn');
}

// What filterRows needs from the page: Kin's "close relative in storage"
// (only once Kin has read storage) and the names as the game shows them.
function filterCtx() {
    let related = null;
    try {
        related = getStoragePredicates().related || null;
    }
    catch (e) {
        related = null;
    }
    return { related, nameOf: a => String(t(a.name) || '') };
}

function rowsShown() {
    const f = D.filters;
    return sortRows(filterRows(D.rows, f, filterCtx()), f.sort, f.geneBasis);
}

// A new view drops the ticks it no longer shows (pruneTicks).
function setFilters(patch) {
    D.filters = normalizeFilters(Object.assign({}, D.filters, patch));
    D.scroll.list = 0;
    pruneTicks();
    dlog('desk', 'filters', { patch, ticked: D.chosen.size, species: D.filters.species || 'all' });
    logPrices();
    saveFilters();
    queueRender();
}

function chosenRows() {
    return tickedRows(D.rows, D.chosen, D.filters, filterCtx());
}

function resultsByGuid() {
    const s = getEngineState();
    const m = new Map();
    // a reprice's runs are shown under My listings
    if (s && !isRepriceReq(s.req) && s.mode !== 'unlist') for (const r of s.results) m.set(r.guid, r);
    return m;
}

function setView(view) {
    const v = view === 'listings' ? 'listings' : 'sell';
    if (v === D.view) return;
    if (D.sheet) closeSheet('view');
    if (v === 'sell') listingsHidden();
    D.view = v;
    dlog('desk', 'view', { view: v });
    if (v === 'listings') breadcrumb('desk_listings');
    queueRender();
}

// The two views, under the title: Sell from storage | My listings (n, stale)
function viewTabs() {
    let c = { n: 0, stale: 0, left: 0 };
    try {
        c = listingsCounts(D.rows);
    }
    catch (e) {
        // counts only
    }
    const tab = (v, label, extra, title) => h(`div.PZ2QoL_mdTab${D.view === v ? '.on' : ''}`, { 'data-view': v, title, onClick: guard('View', () => setView(v)) },
        h('span', { text: label }), extra);
    return [
        tab('sell', 'Sell from storage', null, 'List storage animals on the market'),
        tab('listings', `My listings · ${c.n}`, c.left ? h('span.PZ2QoL_mdTabBadge.left', { text: `${c.left} off` }) : c.stale ? h('span.PZ2QoL_mdTabBadge', { text: `${c.stale} stale` }) : null,
            'Your animals on the market now: which are stale, and repricing them (take off, list again at a new price)'),
    ];
}

// --------------------------------------------------------------- actions

function toggleRow(r) {
    if (D.mode !== 'list') return toggleQuick(r);
    if (r.block || isListingBusy()) return;
    if (D.chosen.has(r.id)) D.chosen.delete(r.id);
    else D.chosen.add(r.id);
    dlog('desk', 'tick', { guid: r.guid || undefined, key: r.key, on: D.chosen.has(r.id), price: r.advice ? r.advice.price : undefined, conf: r.advice ? r.advice.confidence : undefined, ticked: D.chosen.size });
    queueRender();
}

// Tick: every sellable animal shown, except those tagged Keep in storage
// (unless the Keep tag is filtered for). Untick: every animal shown.
function chooseShown(on) {
    for (const r of rowsShown()) {
        if (on && D.mode !== 'list') {
            // a quick mode: its own rows only, one at first (the live acceptance)
            if (quickEligible(r, D.mode).ok && (isAccepted(D.mode) || D.chosen.size < 1)) D.chosen.add(r.id);
        }
        else if (on && tickable(r, D.filters)) D.chosen.add(r.id);
        else if (!on) D.chosen.delete(r.id);
    }
    dlog('desk', 'tick_shown', { on, ticked: D.chosen.size, species: D.filters.species || 'all' });
    queueRender();
}

// ------------------------------------------- Quick trade / Quick release
// The right panel's mode switch; a quick
// mode recolours the panel, ticks only its own rows, and sends nothing
// until the confirmation sheet's Confirm. Then the job is frozen to the
// animals the sheet showed and the engine takes them one at a time; the
// run stops at anything unexpected.
function setMode(mode) {
    if (mode === D.mode) return;
    if (engineRunning()) return notice('Wait for the run to end (or Stop it) before switching.', 'warn');
    D.mode = QUICK_MODES[mode] ? mode : 'list';
    D.chosen.clear();
    closeSheet('mode');
    breadcrumb('desk_quick_mode');
    dlog('desk', 'mode', { mode: D.mode, accepted: D.mode !== 'list' ? isAccepted(D.mode) : undefined });
    queueRender();
}

// Quick trade the animals the server refused to list: switch to Quick trade
// (its ticks start empty), show their species, tick the ones allowed.
function tickRefused(guids) {
    const want = new Set((guids || []).map(String));
    if (engineRunning()) return notice('Wait for the run to end first.', 'warn');
    if (D.mode !== 'quicktrade') setMode('quicktrade');
    const rows = D.rows.filter(r => r.guid && want.has(r.guid));
    if (D.filters.state !== 'any') setFilters({ state: 'any' });
    const allowed = r => quickEligible(r, 'quicktrade').ok;
    const hidden = tickInView(rows, allowed);
    const n = rows.filter(r => D.chosen.has(r.id)).length;
    const not = rows.length - rows.filter(allowed).length;
    dlog('desk', 'tick_refused', { asked: want.size, inStorage: rows.length, ticked: n, notAllowed: not || undefined, hidden: hidden || undefined });
    const left = [not ? `${not} the game won't quick-trade` : '', hidden ? `${hidden} hidden by the desk's filters` : ''].filter(Boolean).join(', ');
    notice(n ? `${n} animal${n === 1 ? '' : 's'} the server refused to list ticked for Quick trade${left ? ` (${left})` : ''}.` : `None of them can be quick-traded now${left ? ` (${left})` : ''}.`, n ? 'ok' : 'warn');
    queueRender();
}

function toggleQuick(r) {
    if (isListingBusy()) return;
    if (D.chosen.has(r.id)) {
        D.chosen.delete(r.id);
    }
    else {
        const e = quickEligible(r, D.mode);
        if (!e.ok) return notice(e.why || 'Not available here.', 'warn');
        if (!isAccepted(D.mode) && D.chosen.size >= 1) return notice(`${FIRST_TEXT[D.mode]}.`, 'warn');
        D.chosen.add(r.id);
    }
    dlog('desk', 'tick', { mode: D.mode, guid: r.guid || undefined, key: r.key, on: D.chosen.has(r.id), pre: r.pre || undefined, ticked: D.chosen.size });
    queueRender();
}

function quickInfo(rows = chosenRows()) {
    return quickSheet(rows, D.mode, { fmt: fmtInt, nameOf: r => rowLabel(r.guid), accepted: isAccepted(D.mode) });
}

function openSheet() {
    if (D.mode === 'list' || engineRunning() || isListingBusy()) return;
    const info = quickInfo();
    if (!info.go.length) return notice(`Tick the animals to ${QUICK_MODES[D.mode].label.toLowerCase()} first.`, 'warn');
    D.sheet = { mode: D.mode, info, rows: info.go.slice(), done: false, openedAt: Date.now() };
    breadcrumb('desk_quick_sheet');
    dlog('desk', 'quick_sheet', { mode: D.mode, go: info.go.length, skip: info.skip.length, total: info.total, exact: info.exact });
    buildSheet();
}

function buildSheet() {
    const el = D.el.sheet;
    const sh = D.sheet;
    clear(el);
    if (!sh) {
        setClass(el, 'hidden', true);
        return;
    }
    const m = QUICK_MODES[sh.mode];
    const info = sh.info;
    const card = h('div.PZ2QoL_mdSheetCard');
    card.appendChild(h('div.PZ2QoL_mdSheetHead', { text: m.header }));
    card.appendChild(h('div.PZ2QoL_mdSheetTitle', { text: info.title }));
    const go = h('div.PZ2QoL_mdSheetList.go');
    go.appendChild(h('div.PZ2QoL_mdSheetLabel', { text: `${info.go.length === 1 ? 'This animal goes' : `These ${info.go.length} animals go`}:` }));
    for (const n of info.names) go.appendChild(h('div.PZ2QoL_mdSheetLine', { text: n }));
    if (info.more) go.appendChild(h('div.PZ2QoL_mdSheetLine.more', { text: `and ${info.more} more` }));
    card.appendChild(go);
    if (info.skip.length) {
        const sk = h('div.PZ2QoL_mdSheetList.skip');
        sk.appendChild(h('div.PZ2QoL_mdSheetLabel', { text: `Ticked but skipped (${info.skip.length}):` }));
        for (const x of info.skip.slice(0, 8)) sk.appendChild(h('div.PZ2QoL_mdSheetLine', { text: `${rowLabel(x.r.guid)}: ${x.why}`, title: x.why }));
        if (info.skip.length > 8) sk.appendChild(h('div.PZ2QoL_mdSheetLine.more', { text: `and ${info.skip.length - 8} more` }));
        card.appendChild(sk);
    }
    if (info.go.some(r => r.pre)) card.appendChild(h('div.PZ2QoL_mdSheetNote', { text: 'Some were classified from the storage list (a Frontier zoo); each animal is checked again before it goes, and skipped if the game does not allow it.' }));
    card.appendChild(h('div.PZ2QoL_mdSheetWarn', { text: QUICK_WARNING }));
    card.appendChild(h('div.PZ2QoL_mdSheetNote', { text: 'One at a time, each confirmed by storage. The run stops at anything unexpected.' }));
    const confirm = btn(`${m.confirm} (${info.go.length})`, m.cash ? 'Icon_Cash_Symbol' : 'Icon_ConservationCredits', () => confirmSheet('click'), {
        cls: `quick.confirm${engineRunning() ? '.disabled' : ''}`, tint: 'white', title: "Sends them, one at a time (also the gamepad's A, or Enter)",
    });
    sh.confirm = confirm;
    card.appendChild(h('div.PZ2QoL_mdSheetButtons', null,
        btn('Cancel', 'Icon_Close', () => closeSheet('cancel'), { title: 'Nothing is sent (Esc too)' }),
        confirm));
    el.appendChild(card);
    setClass(el, 'hidden', false);
}

// Input on the sheet is ignored this long after it opens: a double click,
// or the press that opened it, never confirms.
const SHEET_GUARD_MS = 300;

// Confirm (a click, Enter or the gamepad's A; the developer found a 2 s hold
// too much, 2026-10-18): the job is frozen to exactly the animals shown.
function confirmSheet(how) {
    const sh = D.sheet;
    if (!sh || sh.done || engineRunning()) return;
    if (Date.now() - (sh.openedAt || 0) < SHEET_GUARD_MS) {
        dlog('desk', 'quick_confirm_ignored', { how, ms: Date.now() - (sh.openedAt || 0) });
        return;
    }
    sh.done = true;
    if (sh.confirm) sh.confirm.classList.add('disabled');
    breadcrumb('desk_quick_confirm');
    dlog('desk', 'quick_confirm', { how, mode: sh.mode, n: sh.rows.length });
    const rows = sh.rows.slice();
    const mode = sh.mode;
    closeSheet('confirmed');
    startQuick(rows, mode);
}

function closeSheet(why) {
    const sh = D.sheet;
    if (!sh) return;
    D.sheet = null;
    if (why !== 'confirmed' && why !== 'mode') {
        breadcrumb('desk_quick_cancel');
    }
    dlog('desk', 'quick_sheet_close', { why });
    if (D.el.sheet) {
        clear(D.el.sheet);
        setClass(D.el.sheet, 'hidden', true);
    }
    queueRender();
}

// The gamepad while the sheet is open: A = Confirm, B = Cancel; the
// game never sees them (its own back-out would close the screen).
function sheetInput(e) {
    if (!D.sheet || !e || !e.button) return false;
    try {
        if (e.inputName === 'UI_Select') {
            if (e.button.isPressed()) confirmSheet('pad');
            return true;
        }
        if (e.inputName === 'UI_Cancel') {
            if (e.button.isPressed()) closeSheet('pad');
            return true;
        }
    }
    catch (err) {
        return false;
    }
    return false;
}

async function startQuick(rows, mode) {
    const m = QUICK_MODES[mode];
    const { text, items } = encodeQuickJob(rows, { mode, paceMs: getPaceMs('lister') });
    dlog('desk', 'quick_start', { mode, n: items.length, guids: items.map(r => r.guid).slice(0, 20) });
    if (!items.length) return notice('Nothing to send.', 'warn');
    for (const r of items) D.labels.set(String(r.guid), rowLabel(r.guid));
    breadcrumb('desk_quick_start');
    const r = await startEngineRun(text);
    dlog('desk', 'quick_started', { ok: r.ok, pending: r.pending || undefined, req: r.req, n: items.length, msg: r.message || undefined });
    if (r.pending) {
        // no answer yet: it may still have started (the run card shows it when the state comes)
        D.chosen.clear();
        return notice(r.message, 'warn');
    }
    if (!r.ok) return notice(r.message || `${m.label} did not start.`, 'warn');
    D.chosen.clear();
    notice(`${m.label}: ${items.length} animal${items.length === 1 ? '' : 's'}, one at a time. The run stops at anything unexpected; Stop ends it after the current animal.`, 'ok');
    queueRender();
}

// ------------------------------------------------------- Check storage
// Selects each not-yet-checked animal
// of the shown species in Animal Storage and records what the game allows
// (market, Quick trade, Quick release, Rehome). The engine's 'check' job
// never sends anything; Stop ends it at once, the selection ends cleared.
function checkTargets() {
    return uncheckedRows(D.rows, D.filters.species || null);
}

function checkPace() {
    return checkPaceMs(getPaceMs('lister'));
}

async function startCheck() {
    const rows = checkTargets();
    dlog('desk', 'check_click', { n: rows.length, species: D.filters.species || 'all', busy: isListingBusy() || undefined, check: D.caps ? D.caps.check : undefined });
    if (isListingBusy()) return notice('A listing or market check is running; check storage when it is done.', 'warn');
    if (!engineUsable(D.caps, D.rows.length) || !D.caps.check) {
        breadcrumb('desk_check_refused');
        const why = D.caps && engineUsable(D.caps, D.rows.length) ? 'The game-side engine did not report that it can check storage.' : engineWhyNot(D.caps, D.rows.length);
        return notice(`${why} Reopen Animal Storage and try again.`, 'warn');
    }
    if (!rows.length) return notice('Every animal shown has been checked.', 'info');
    const { text, items } = encodeCheckJob(rows, { paceMs: checkPace() });
    if (!items.length) return notice('Nothing to check.', 'info');
    breadcrumb('desk_check');
    const r = await startEngineRun(text);
    dlog('desk', 'check_started', { ok: r.ok, pending: r.pending || undefined, n: items.length, req: r.req, paceMs: checkPace(), msg: r.message || undefined });
    if (r.pending) return notice(r.message, 'warn');
    if (!r.ok) {
        breadcrumb('desk_check_refused');
        return notice(r.message || 'Check storage did not start.', 'warn');
    }
    checkRuns.set(String(r.req), { n: items.length, species: D.filters.species || null });
    notice(`Checking ${items.length} animal${items.length === 1 ? '' : 's'} in Animal Storage, one at a time. Nothing is sold or listed; Stop ends it.`, 'ok');
    queueRender();
}

function checkButton() {
    const s = getEngineState();
    const running = engineRunning();
    if (running && s && s.mode === 'check') {
        return btn('Stop checking', 'Icon_Close', () => {
            breadcrumb('desk_check_stop');
            stopListing();
        }, { cls: 'stop', tint: 'white', title: 'Stops at once; the animals not checked yet stay as they are' });
    }
    const n = checkTargets().length;
    const can = n > 0 && !isListingBusy() && engineUsable(D.caps, D.rows.length) && !!(D.caps && D.caps.check);
    const label = n ? `Check storage (${n} not checked, ≈ ${checkMinutes(n, checkPace())} min)` : 'Check storage (all checked)';
    return btn(label, 'IconSearch', startCheck, {
        cls: can ? '' : 'disabled',
        title: "Selects each animal of the species shown in Animal Storage, one at a time, and notes what the game allows: the market, Quick trade, Quick release or Rehome. Nothing is sold, listed or sent; the selection ends cleared. Stop any time.",
    });
}

async function startListing() {
    // how many ticked lack an id (the job can only hold animals the engine can identify)
    const ticked = chosenRows();
    dlog('desk', 'list_click', { busy: isListingBusy() || undefined, ticked: D.chosen.size, listable: ticked.filter(r => !r.block).length, hours: D.hours,
        noId: ticked.filter(r => !r.guid).length, noIdBlocked: ticked.filter(r => r.block === 'noid').length,
        noIdTotal: D.rows.filter(r => r.block === 'noid').length || undefined });
    if (isListingBusy()) return;
    const rows = chosenRows().filter(r => !r.block);
    if (!rows.length) return notice('Tick the animals to list first.', 'warn');
    const stale = uncheckedSpecies(rows);
    if (stale.length) return notice(`Check market prices first (${stale.length} species not checked in the last ${PRICE_CHECK_FRESH_MS / 60000} minutes).`, 'warn');
    breadcrumb('desk_list');
    const onRefused = refusedOption();
    const refusedMax = onRefused === 'release' && !isAccepted('release') ? 1 : null;
    const r = await listAnimals(rows.map(x => x.a), { hours: D.hours, onRefused, refusedMax, advise: deskAdvice, verdicts, gameBlocked });
    dlog('desk', 'list_result', { ok: r.ok, count: r.count, msg: r.message || undefined });
    if (!r.ok) notice(r.message || 'Nothing was listed.', 'warn');
    // fewer in the job than ticked: say how many and why
    else if (r.partial) notice(`${r.partial}. One at a time; you can keep browsing, Stop ends it.`, 'warn');
    else notice(`Listing ${r.count} animal${r.count === 1 ? '' : 's'}, one at a time. You can keep browsing; Stop ends it.`, 'ok');
    queueRender();
}

function retry() {
    const s = getEngineState();
    const again = new Set(retryGuids(s));
    D.chosen.clear();
    const hidden = tickInView(D.rows.filter(r => r.guid && again.has(r.guid)), r => !r.block);
    dlog('desk', 'retry', { again: again.size, ticked: D.chosen.size, hidden: hidden || undefined, run: s ? s.run : undefined });
    const hiddenText = hidden ? ` ${hidden} more ${hidden === 1 ? 'is' : 'are'} hidden by the desk's filters; Reset the filters to tick ${hidden === 1 ? 'it' : 'them'} too.` : '';
    notice(D.chosen.size ? `${D.chosen.size} ticked again. Press List to try them once more.${hiddenText}` : `Nothing to retry: the others are listed or cannot be listed.${hiddenText}`, D.chosen.size ? 'ok' : 'info');
}

// ---------------------------------------------------------------- render

function ensureRoot() {
    if (D.root && D.root.parentNode) return D.root;
    const el = D.el;
    el.sub = h('div.PZ2QoL_mdSub');
    el.engine = h('div.PZ2QoL_mdEngine');
    el.rail = h('div.PZ2QoL_mdRail');
    el.main = h('div.PZ2QoL_mdMain');
    el.side = h('div.PZ2QoL_mdSide');
    el.notice = h('div.PZ2QoL_mdNotice.hidden');
    el.scope = h('div.PZ2QoL_mdNotice.warn.hidden');
    el.status = h('div.PZ2QoL_kpStatus');
    el.check = h('div.PZ2QoL_mdCheck');
    el.tabs = h('div.PZ2QoL_mdTabs');
    // the quick trade / release confirmation, over the desk
    el.sheet = h('div.PZ2QoL_mdSheet.hidden');
    for (const ev of ['mousedown', 'click', 'wheel']) el.sheet.addEventListener(ev, e => e.stopPropagation());
    // greyed out during a run (renderHead): clearing the verdicts then would drop the run's own
    el.readAgain = btn('Read storage again', 'Icon_CircleWithArrows', () => {
        // the categories are checked afresh (Check storage or a run)
        const s = getEngineState();
        verdicts.clear();
        verdictFloor = s ? s.run : verdictFloor;
        dlog('desk', 'verdicts_cleared', { floor: verdictFloor });
        // and try again to show all of storage, if that failed
        if (D.unfilter === 'failed') {
            D.unfilter = '';
            readRows(true).then(seeAllStorage);
        }
        else readRows(true);
        notice('Reading Animal Storage again…');
    }, { title: READ_AGAIN_TITLE });
    const head = h('div.PZ2QoL_kpHead', null,
        h('div.PZ2QoL_kpLogo.desk'),
        h('div.PZ2QoL_kpTitles', null, h('div.PZ2QoL_kpTitle', { text: 'Market desk' }), el.sub),
        el.tabs,
        h('div.PZ2QoL_kpFlex'),
        el.engine,
        el.check,
        el.readAgain,
        closeButton(guard, 'Close (Esc)', () => closeMarketDesk()));
    D.offset = buildOffsetControl();
    D.pace = paceSlider('lister');
    const root = h('div.PZ2QoL_md.hidden', null,
        head,
        el.scope,
        el.notice,
        h('div.PZ2QoL_mdBody', null, el.rail, el.main, el.side),
        h('div.PZ2QoL_kpFoot', null,
            el.rules = h('div.PZ2QoL_mdRules', { text: RULES_SELL }),
            h('div.PZ2QoL_kpFlex'), el.status),
        el.sheet);
    root.addEventListener('mousedown', e => e.stopPropagation());
    root.addEventListener('click', e => e.stopPropagation());
    root.addEventListener('wheel', e => {
        e.preventDefault();
        e.stopPropagation();
    });
    // a dim layer over Animal Storage while the desk is open: the engine
    // selects each animal there before listing it (the game gives the price
    // limits only for the selection), and the storage screen need not be
    // watched or used meanwhile
    const scrim = h('div.PZ2QoL_mdScrim.hidden');
    for (const ev of ['mousedown', 'click', 'wheel']) scrim.addEventListener(ev, e => {
        e.preventDefault();
        e.stopPropagation();
    });
    document.body.appendChild(scrim);
    document.body.appendChild(root);
    D.scrim = scrim;
    D.root = root;
    return root;
}

function queueRender() {
    if (!D.open || D.queued) return;
    D.queued = true;
    setTimeout(() => {
        D.queued = false;
        renderAll();
    }, 0);
}

function renderAll(force = false) {
    if (!D.root || !D.open) return;
    try {
        // while a run selects animals in Animal Storage, nothing of it shows
        if (D.scrim) setClass(D.scrim, 'solid', engineRunning());
        const s = getEngineState();
        const sig = JSON.stringify([
            D.rows.map(r => [r.id, r.block, r.cat, r.verdict ? `${r.verdict.values.quickTrade}|${r.verdict.values.quickRelease}|${r.verdict.prices.quickTrade}` : '', r.caution, r.advice.price, r.advice.confidence, Math.ceil((r.a.auctionTimerSeconds || 0) / 300)]),
            Array.from(D.chosen), D.filters, D.moreOpen, !!filterCtx().related, D.hours, D.caps && [D.caps.ok, D.caps.rows, D.caps.storage], getPriceOffset(), isFranchise(),
            s && [s.run, s.mode, s.phase, s.results.map(r => r.status + r.kind).join(',')], D.caps && D.caps.check,
            D.notice && D.notice.until > Date.now() ? D.notice.text : '', isListingBusy(), getPriceBook().length,
            (getMarketCheck() || {}).message, (getMultiMarketCheck() || {}).message, uncheckedSpecies(chosenRows().filter(r => !r.block)).join(','),
            getKinSettings().gameSpeciesNames !== false,
            D.unfilter, D.scope && D.scope.species,
            D.mode, isAccepted('quicktrade'), isAccepted('release'), refusedOption(),
            D.view, D.view === 'listings' ? listingsSig() : '', (() => {
                const rp = getReprice();
                return rp ? `${rp.phase}|${strandedItems(rp).length}` : '';
            })(),
        ]);
        // the run's step and wait change every second and show only in the side panel
        const sideSig = JSON.stringify(s && [s.index, s.step, Math.round(s.waited || 0)]);
        if (!force && sig === D.renderSig) {
            if (sideSig !== D.sideSig) {
                D.sideSig = sideSig;
                renderSide();
            }
            return;
        }
        D.renderSig = sig;
        D.sideSig = sideSig;
        renderHead();
        renderScope();
        renderNotice();
        if (D.view === 'listings') {
            renderListings({ rail: D.el.rail, main: D.el.main, side: D.el.side }, {
                guard, btn, rows: D.rows, notice, queueRender, pace: D.pace, root: D.root, boxes: D.boxes, segmented, paceMs: getPaceMs('lister'),
            });
        }
        else {
            renderRail();
            renderMain();
            renderSide();
        }
        setTimeout(() => refreshBars(D.boxes), 0);
    }
    catch (e) {
        reportError('ui', 'Market desk: drawing failed', e, { silent: true });
    }
}

function renderHead() {
    const el = D.el;
    const pageRows = D.rows.length;
    const usable = engineUsable(D.caps, pageRows);
    const counts = speciesCounts(D.rows);
    const sellable = counts.reduce((n, c) => n + c.sellable, 0);
    const quick = counts.reduce((n, c) => n + c.quick, 0);
    const listed = counts.reduce((n, c) => n + c.listed, 0);
    clear(el.tabs);
    for (const n of viewTabs()) el.tabs.appendChild(n);
    setText(el.sub, isFranchise()
        ? `${fmtInt(D.rows.length)} animals in storage · ${fmtInt(sellable)} sellable${quick ? ` · ${fmtInt(quick)} Quick trade only` : ''} · ${fmtInt(listed)} on the market`
        : 'Listing animals is only available in Franchise mode.');
    clear(el.check);
    if (D.caps && D.view === 'sell') el.check.appendChild(checkButton());
    const running = engineRunning();
    setClass(el.readAgain, 'disabled', running);
    el.readAgain.title = running ? 'Wait for the run to end (or Stop it): the run is still reporting what the game allows for each animal' : READ_AGAIN_TITLE;
    if (el.rules) setText(el.rules, D.view === 'listings' ? RULES_LISTINGS : RULES_SELL);
    clear(el.engine);
    if (!D.caps) return;
    el.engine.appendChild(h(`div.PZ2QoL_mdEnginePill.${usable ? 'ok' : 'off'}`, {
        text: usable ? "Direct: the game's own listing call" : 'Listing engine not ready',
        title: usable
            ? 'Each animal is found by its id, selected and listed by the mod inside Animal Storage, with the same call the game\'s Trade → Confirm makes, and checked again just before sending.'
            : `${engineWhyNot(D.caps, pageRows)} Nothing can be listed until it answers: reopen Animal Storage and try again.`,
    }));
}

function renderNotice() {
    const n = D.notice;
    const el = D.el.notice;
    const show = n && n.until > Date.now();
    setClass(el, 'hidden', !show);
    if (!show) return;
    el.className = `PZ2QoL_mdNotice ${n.tone}`;
    setText(el, n.text);
    setTimeout(queueRender, Math.max(0, n.until - Date.now()) + 50);
}

// When the game's own storage filters could not be cleared, the desk can
// show only what they let through: say so, and how to see everything.
function renderScope() {
    const el = D.el.scope;
    const show = D.unfilter === 'failed' && D.scope && D.scope.known;
    setClass(el, 'hidden', !show);
    if (!show) return;
    const sp = D.scope.species;
    setText(el, `Animal Storage is filtered${sp ? ` to ${speciesName(sp)}` : ''}, so only ${sp ? 'that species is' : 'part of storage is'} listed here. Clear the filter in Animal Storage to see every species.`);
}

function renderRail() {
    const el = D.el.rail;
    const y = D.scroll.rail;
    clear(el);
    const box = makeScroll('mdRail', { onScroll: (x, yy) => { D.scroll.rail = yy; } });
    D.boxes.rail = box;
    const counts = speciesCounts(D.rows);
    const all = { species: null, total: D.rows.length, sellable: counts.reduce((n, c) => n + c.sellable, 0), quick: counts.reduce((n, c) => n + c.quick, 0), listed: counts.reduce((n, c) => n + c.listed, 0) };
    for (const c of [all].concat(counts)) {
        const on = (D.filters.species || null) === c.species;
        const chosen = D.rows.filter(r => D.chosen.has(r.id) && (c.species === null || r.species === c.species)).length;
        box.content.appendChild(h(`div.PZ2QoL_mdSpecies${on ? '.on' : ''}`, {
            'data-species': c.species || '',
            title: c.species ? speciesName(c.species) : 'Every species in storage',
            // a price range belongs to one species' prices
            onClick: guard('Species', () => {
                D.reveal = null;
                setFilters(c.species === D.filters.species ? {} : { species: c.species, priceMin: 0, priceMax: 0 });
            }),
        },
            h('div.PZ2QoL_mdSpeciesName', { text: c.species ? trunc(speciesName(c.species), 22) : 'All species' }),
            h('div.PZ2QoL_mdSpeciesMeta', null,
                h('span.sell', { text: `${c.sellable} sellable` }),
                c.quick ? h('span.quick', { text: `${c.quick} quick` }) : null,
                c.listed ? h('span.listed', { text: `${c.listed} listed` }) : null,
                chosen ? h('span.chosen', { text: `${chosen} ticked` }) : null)));
    }
    el.appendChild(box.wrap);
    restoreScroll(box, 0, revealRail(box, counts.length, y));
}

// The species the desk opened on stays in view while the rail fills (the
// full list arrives once the game's filters are cleared), until a click.
function revealRail(box, n, y) {
    const r = D.reveal;
    if (!r || r.n === n) return y;
    r.n = n;
    try {
        const on = box.content.querySelector('.PZ2QoL_mdSpecies.on');
        if (!on) return y;
        const top = on.getBoundingClientRect().top - box.content.getBoundingClientRect().top;
        const vh = box.vp.clientHeight;
        if (top >= y && top + on.offsetHeight <= y + vh) return y;
        D.scroll.rail = Math.max(0, Math.round(top - vh / 3));
        return D.scroll.rail;
    }
    catch (e) {
        return y;
    }
}

function segmented(label, value, options, onPick, title) {
    return h('div.PZ2QoL_mdSeg', { title: title || undefined },
        h('span.PZ2QoL_mdSegLabel', { text: label }),
        options.map(([v, text]) => h(`div.PZ2QoL_mdSegItem${v === value ? '.on' : ''}`, { 'data-value': v, text, onClick: guard(label, () => onPick(v)) })));
}

// Several values at once: "Any" clears them.
function multiSeg(label, values, options, onChange, title) {
    const on = new Set(values);
    return h('div.PZ2QoL_mdSeg', { title: title || undefined },
        h('span.PZ2QoL_mdSegLabel', { text: label }),
        h(`div.PZ2QoL_mdSegItem${on.size ? '' : '.on'}`, { 'data-value': 'any', text: 'Any', onClick: guard(label, () => onChange([])) }),
        options.map(([v, text, tip]) => h(`div.PZ2QoL_mdSegItem${on.has(v) ? '.on' : ''}`, {
            'data-value': String(v), text, title: tip || undefined,
            onClick: guard(label, () => {
                const next = new Set(on);
                if (next.has(v)) next.delete(v);
                else next.add(v);
                onChange(Array.from(next));
            }),
        })));
}

const pctText = (lo, hi) => (lo <= 0 && hi >= 100 ? 'All' : lo <= 0 ? `≤ ${hi}` : hi >= 100 ? `≥ ${lo}` : `${lo}–${hi}`);

// The highest recommended price in view, rounded up: the price slider's end.
function priceCeil() {
    const f = D.filters;
    let max = 0;
    for (const r of D.rows) if ((!f.species || r.species === f.species) && r.advice && r.advice.price > max) max = r.advice.price;
    return Math.max(1000, Math.ceil(max / 500) * 500, f.priceMin, f.priceMax);
}

// Built once and kept: a re-render must not interrupt a drag or typing.
function controls() {
    if (D.ctl) return D.ctl;
    const c = {};
    c.genes = rangeSlider({
        bounds: () => [0, 100],
        get: () => [D.filters.geneMin, D.filters.geneMax],
        set: (lo, hi) => setFilters({ geneMin: lo, geneMax: hi }),
        fmt: pctText,
        title: 'Gene range: drag the ends (or click the track). 0–50 shows the weakest half, e.g. to sell them and keep the rest.',
    });
    for (const k of GENE_KEYS) {
        c[k] = rangeSlider({
            bounds: () => [0, 100],
            get: () => [D.filters[k + 'Min'], D.filters[k + 'Max']],
            set: (lo, hi) => setFilters({ [k + 'Min']: lo, [k + 'Max']: hi }),
            fmt: pctText,
            cls: 'small',
            title: `${GENE_BASES[k]} gene range (animals without this gene, such as shoals, are left out once it is set)`,
        });
    }
    c.price = rangeSlider({
        bounds: () => [0, priceCeil()],
        get: () => [D.filters.priceMin, D.filters.priceMax || priceCeil()],
        set: (lo, hi) => setFilters({ priceMin: lo, priceMax: hi >= priceCeil() ? 0 : hi }),
        step: 50,
        fmt: (lo, hi, [, max]) => (lo <= 0 && hi >= max ? 'Any' : `${fmtInt(lo)}–${hi >= max ? 'max' : fmtInt(hi)}`),
        cls: 'small',
        title: 'Recommended price range, CC (the desk\'s price; the game\'s limits still apply when listing)',
    });
    const text = h('input.PZ2QoL_mdText', { type: 'text', placeholder: 'Name contains…', maxlength: '40' });
    text.addEventListener('input', () => {
        clearTimeout(c.textTimer);
        c.textTimer = setTimeout(() => setFilters({ text: text.value }), 250);
    });
    // typing goes to the box, not to the game's shortcuts (Esc still closes)
    text.addEventListener('keydown', e => {
        if (e.key !== 'Escape' && e.keyCode !== 27) e.stopPropagation();
    });
    c.text = text;
    D.ctl = c;
    return c;
}

function geneBar(f) {
    const c = controls();
    c.genes.__update();
    const basis = f.geneBasis === 'overall' ? 'Genes' : `Genes · ${GENE_BASES[f.geneBasis]}`;
    const preset = (label, lo, hi, tip) => h(`div.PZ2QoL_mdSegItem${f.geneMin === lo && f.geneMax === hi ? '.on' : ''}`, {
        text: label, title: tip, onClick: guard('Genes', () => setFilters({ geneMin: lo, geneMax: hi })),
    });
    return h('div.PZ2QoL_mdSeg.genes', { title: f.geneBasis === 'overall' ? 'The average of the genes that count for the animal (the Genes column)' : `By ${GENE_BASES[f.geneBasis].toLowerCase()} (set under More filters)` },
        h('span.PZ2QoL_mdSegLabel', { text: basis }),
        c.genes,
        preset('≤ 40', 0, 40, 'Genes 40 and below'),
        preset('≤ 50', 0, 50, 'Genes 50 and below: the weakest half'),
        preset('≥ 70', 70, 100, 'Genes 70 and above'),
        preset('All', 0, 100, 'Any genes'));
}

function moreFilters(f, ctx) {
    const c = controls();
    const box = h('div.PZ2QoL_mdMore');
    const col = (title, ...kids) => h('div.PZ2QoL_mdMoreCol', null, h('div.PZ2QoL_mdMoreTitle', { text: title }), kids);
    const geneRow = k => {
        c[k].__update();
        return h('div.PZ2QoL_mdMoreRow', null, h('span.PZ2QoL_mdMoreLabel', { text: GENE_BASES[k] }), c[k]);
    };
    const top = h('div.PZ2QoL_mdMoreLine');
    top.appendChild(col('Genes',
        segmented('By', f.geneBasis, Object.entries(GENE_BASES), v => setFilters({ geneBasis: v }),
            'What the gene range, Keep the best and the gene sort use: the average (Overall), the breeding score (fertility, longevity, immunity) or one gene'),
        h('div.PZ2QoL_mdGeneGrid', null,
            h('div.PZ2QoL_mdMoreCol', null, geneRow('size'), geneRow('longevity')),
            h('div.PZ2QoL_mdMoreCol', null, geneRow('fertility'), geneRow('immunity')))));
    const keep = f.keepBest;
    c.price.__update();
    // the box shows the filter (after Reset, or one kept from earlier)
    if (document.activeElement !== c.text && c.text.value !== f.text) c.text.value = f.text;
    top.appendChild(col('Population',
        h('div.PZ2QoL_mdSeg.stepper', { title: 'Shows only what is left after the best N males and the best N females of each species (by the gene choice under Genes · By); animals on the market are not counted. Tick all, then List: you keep the best.' },
            h('span.PZ2QoL_mdSegLabel', { text: 'Keep the best' }),
            h('div.PZ2QoL_mdSegItem', { text: '−', onClick: guard('Keep', () => setFilters({ keepBest: Math.max(0, keep - 1) })) }),
            h('span.PZ2QoL_mdStepValue', { text: keep ? `${keep} ♂ + ${keep} ♀` : 'Off' }),
            h('div.PZ2QoL_mdSegItem', { text: '+', onClick: guard('Keep', () => setFilters({ keepBest: Math.min(99, keep + 1) })) })),
        segmented('Pregnant', f.pregnant, [['any', 'Any'], ['hide', 'Hide'], ['only', 'Only']], v => setFilters({ pregnant: v }), "Pregnant animals are never listed: the market won't take one until she gives birth"),
        ctx.related || f.kin !== 'any'
            ? segmented('Kin', f.kin, [['any', 'Any'], ['related', 'Has kin'], ['unrelated', 'No kin']], v => setFilters({ kin: v }),
                'A close relative of the same species in storage (from the family records the game keeps; Kin reads them when Animal Storage opens)')
            : h('div.PZ2QoL_mdSeg.off', { title: 'Kin has not read the family records of storage yet (turn Kin on, or reopen Animal Storage)' },
                h('span.PZ2QoL_mdSegLabel', { text: 'Kin' }), h('span.PZ2QoL_mdSegNote', { text: 'not read yet' }))));
    box.appendChild(top);
    box.appendChild(h('div.PZ2QoL_mdMoreLine.other', null,
        multiSeg('Tag', f.tags, Object.entries(STORAGE_TAGS).map(([v, l]) => [Number(v), l]), v => setFilters({ tags: v }),
            'The tag set on the animal in Animal Storage. Tick all leaves Keep-tagged animals alone unless Keep is picked here.'),
        h('div.PZ2QoL_mdMoreRow', null, h('span.PZ2QoL_mdMoreLabel.short', { text: 'Price' }), c.price),
        h('div.PZ2QoL_mdMoreRow', null, h('span.PZ2QoL_mdMoreLabel.short', { text: 'Name' }), c.text)));
    return box;
}

// The species of these rows whose market prices were not checked lately,
// most animals first. List waits for them.
function uncheckedSpecies(rows) {
    const n = new Map();
    for (const r of rows) if (!isPriceCheckFresh(r.species)) n.set(r.species, (n.get(r.species) || 0) + 1);
    return Array.from(n.keys()).sort((x, y) => n.get(y) - n.get(x));
}

// Check market prices, right above List: for the ticked animals' species
// (or, with nothing ticked, the species picked on the left). List is only
// possible once each of them was checked in the last 30 minutes.
function priceCheckCard(listable) {
    const multi = getMultiMarketCheck();
    const check = getMarketCheck();
    const checking = check && (check.state === 'starting' || check.state === 'loading' || check.state === 'reading');
    const busy = isListingBusy();
    const pick = listable.length ? Array.from(new Set(listable.map(r => r.species))) : (D.filters.species ? [D.filters.species] : []);
    const stale = listable.length ? uncheckedSpecies(listable) : pick.filter(sp => !isPriceCheckFresh(sp));
    const card = h(`div.PZ2QoL_mdPriceCheck${stale.length && listable.length ? '.needed' : ''}`);
    let status = '';
    let tone = '';
    if (isMultiCheckBusy()) {
        card.appendChild(btn('Stop checking', 'Icon_Close', () => stopMultiCheck(), { cls: 'wide', title: 'Stops after the species being checked now' }));
        status = (multi && multi.message) || 'Checking…';
        tone = 'reading';
    }
    else if (checking) {
        card.appendChild(btn('Checking market…', 'IconSearch', () => {}, { cls: 'wide.disabled' }));
        status = (check && check.message) || 'Checking…';
        tone = 'reading';
    }
    else if (!pick.length) {
        status = 'Tick animals, then check their market prices here before listing.';
    }
    else {
        const todo = stale.length ? stale : pick;
        const label = stale.length
            ? (todo.length === 1 ? 'Check market prices' : `Check market prices (${todo.length} species)`)
            : 'Check prices again';
        card.appendChild(btn(label, 'IconSearch', () => (todo.length === 1 ? checkMarketFor(todo[0]) : checkMarketForAll(todo)), {
            cls: `wide${stale.length ? '.attention' : ''}${busy ? '.disabled' : ''}`,
            title: "Loads the current Market listings of these species (all pages) in the background, one species after another, so the recommended prices follow today's market. The screen stays on Animal Storage.",
        }));
        if (stale.length) {
            status = listable.length
                ? `Needed before listing: ${stale.length} of ${pick.length} species not checked in the last ${PRICE_CHECK_FRESH_MS / 60000} minutes.`
                : `Not checked in the last ${PRICE_CHECK_FRESH_MS / 60000} minutes.`;
            tone = listable.length ? 'warn' : '';
        }
        else {
            status = `✓ Prices checked for ${pick.length === 1 ? 'this species' : `all ${pick.length} species`}.`;
            tone = 'ok';
            const last = multi && multi.finished && multi.message ? multi.message : check && check.state !== 'starting' && check.message ? check.message : '';
            if (last) status += ` ${last}`;
        }
    }
    if (status) card.appendChild(h(`div.PZ2QoL_mdPriceStatus${tone ? '.' + tone : ''}`, { text: status, title: status }));
    return card;
}

// A column header that sorts; a second click on Genes flips best/worst.
function sortHead(cls, text, key) {
    const f = D.filters;
    const on = key === 'genes' ? (f.sort === 'best' || f.sort === 'worst') : f.sort === key;
    const arrow = !on ? '' : key === 'genes' ? (f.sort === 'best' ? ' ▼' : ' ▲') : key === 'price' ? ' ▼' : ' ▲';
    return h(`div.PZ2QoL_mdCell.${cls}.sortable${on ? '.on' : ''}`, {
        text: text + arrow,
        title: key === 'genes' ? 'Sort by genes (click again: worst first)' : `Sort by ${text.toLowerCase()}`,
        onClick: guard('Sort', () => setFilters({ sort: key === 'genes' ? (f.sort === 'best' ? 'worst' : 'best') : key })),
    });
}

function renderMain() {
    const el = D.el.main;
    const y = D.scroll.list;
    const c = controls();
    const typing = document.activeElement === c.text;
    clear(el);
    const f = D.filters;
    const ctx = filterCtx();
    const shown = sortRows(filterRows(D.rows, f, ctx), f.sort, f.geneBasis);
    const quickMode = D.mode !== 'list';
    let shownTickable = shown.filter(r => (quickMode ? quickEligible(r, D.mode).ok : tickable(r, f)));
    if (quickMode && !isAccepted(D.mode)) shownTickable = shownTickable.slice(0, 1);
    const counts = activeFilterCount(f);
    const species = f.species;
    el.appendChild(h('div.PZ2QoL_mdTools', null,
        segmented('Sex', f.sex, [['any', 'Any'], ['male', '♂'], ['female', '♀']], v => setFilters({ sex: v })),
        multiSeg('Age', f.ages, [['juvenile', 'Juvenile'], ['young', 'Young'], ['adult', 'Adult'], ['elderly', 'Elderly']], v => setFilters({ ages: v }), 'Pick one or more age stages'),
        segmented('Fertility', f.fertile, [['any', 'Any'], ['yes', 'Fertile'], ['no', 'Infertile']], v => setFilters({ fertile: v }), 'What the game shows: young adults, adults and elderly that can still breed are fertile'),
        multiSeg('Rating', f.medals, MEDALS.map(m => [m, medalLabel(m)]), v => setFilters({ medals: v }), "The game's genetics rating (medal); pick one or more"),
        geneBar(f),
        segmented('Show', f.state, [['any', 'All'], ['sellable', 'Sellable'], ['quick', 'Quick trade'], ['listed', 'On market'], ['blocked', 'Not sellable']], v => setFilters({ state: v }),
            "Quick trade: the game's market won't take these animals, but its Quick trade or Quick release does (known once a listing run or Check storage has selected them)")));
    const busy = isListingBusy();
    const keepLeft = shown.filter(r => !r.block && !tickable(r, f)).length;
    el.appendChild(h('div.PZ2QoL_mdTools.second', null,
        btn(`Tick all shown (${shownTickable.length})`, null, () => chooseShown(true), {
            cls: shownTickable.length && !busy ? '' : 'disabled',
            title: `Tick every sellable animal shown${keepLeft ? ` (${keepLeft} tagged Keep left alone)` : ''}`,
        }),
        btn('Untick shown', null, () => chooseShown(false), { cls: busy ? 'disabled' : '', title: 'Untick the animals shown' }),
        btn(counts.total ? `Reset (${counts.total})` : 'Reset', null, () => {
            clearTimeout(controls().textTimer);
            controls().text.value = '';
            setFilters(resetFilters(f));
        }, { cls: counts.total ? '' : 'disabled', title: 'All filters back to Any (keeps the species and the sort)' }),
        btn(`More filters${counts.more ? ` (${counts.more})` : ''}`, 'IconSettings', () => {
            D.moreOpen = !D.moreOpen;
            queueRender();
        }, { cls: D.moreOpen || counts.more ? 'on' : '', title: 'Per-gene ranges, keep the best N per sex, pregnancy, storage tags, Kin, price and name' }),
        h('div.PZ2QoL_mdShown', { text: `${fmtInt(shown.length)} of ${fmtInt(species ? D.rows.filter(r => r.species === species).length : D.rows.length)} shown` })));
    if (D.moreOpen) el.appendChild(moreFilters(f, ctx));
    // rows put in Quick trade by the storage list alone, before any check
    if (shown.some(r => r.pre)) el.appendChild(h('div.PZ2QoL_mdPreNote', { text: 'Quick trade (from the storage list): classified by where the animal came from (a Frontier zoo); each animal is checked again before it goes.' }));
    // the table
    const geneHead = f.geneBasis === 'overall' ? 'Genes' : GENE_BASES[f.geneBasis].slice(0, 5);
    el.appendChild(h('div.PZ2QoL_mdRow.head', null,
        h('div.PZ2QoL_mdCell.tick'), h('div.PZ2QoL_mdCell.sex'), sortHead('name', 'Animal', 'name'),
        h('div.PZ2QoL_mdCell.stage', { text: 'Age' }), h('div.PZ2QoL_mdCell.medal', { text: 'Rating' }), sortHead('genes', geneHead, 'genes'),
        sortHead('price', 'Price (CC)', 'price'), h('div.PZ2QoL_mdCell.state', { text: 'State' })));
    const box = makeScroll('mdList', { onScroll: (x, yy) => { D.scroll.list = yy; } });
    D.boxes.list = box;
    const results = resultsByGuid();
    if (!shown.length) {
        box.content.appendChild(h('div.PZ2QoL_mdEmpty', { text: D.rows.length ? 'No animal matches these filters.' : 'No animals in storage (or Animal Storage is still loading).' }));
    }
    const es = getEngineState() || {};
    const mode = es.mode || 'list';
    for (const r of shown) box.content.appendChild(rowEl(r, shownResult(es, results.get(r.guid)), mode));
    el.appendChild(box.wrap);
    restoreScroll(box, 0, y);
    if (typing && D.moreOpen) {
        try {
            c.text.focus();
        }
        catch (e) {
            // typing again works
        }
    }
}

function stateOf(r, res, mode = 'list') {
    const qm = QUICK_MODES[mode];
    const waiting = !!res && (res.status === 'pending' || res.status === 'notstarted');
    if (qm && res && !waiting) {
        if (res.status === 'working') return { cls: 'working', text: qm.working };
        if (res.status === qm.done) return { cls: 'done', text: `✓ ${qm.verb}${res.price ? ` · ${quickMoney(mode, res.price, fmtInt)}` : ''}` };
        // sent, but storage did not confirm it: the run stopped there
        if (res.status === 'unconfirmed') return { cls: 'refused', text: 'Sent, not confirmed: check storage', title: res.detail || 'Sent; it was still in storage when the wait ended. Check Animal Storage before anything else.' };
        const why = resultText(res, t, 'untradeable');
        return { cls: 'skipped', text: `Not sent · ${why}`, title: why };
    }
    if (res && !waiting && res.status !== 'checked') {
        if (res.status === 'working') return { cls: 'working', text: mode === 'check' ? 'Checking…' : 'Listing…' };
        if (res.status === 'listed') return { cls: 'done', text: `✓ Listed${res.price ? ` ${fmtInt(res.price)} CC` : ''}${res.capped ? ` (game ${res.capped})` : ''}` };
        // refused by the server, then quick-traded / released in the same run
        if (res.status === 'traded' || res.status === 'released') {
            const qm = QUICK_MODES[res.status === 'traded' ? 'quicktrade' : 'release'];
            return { cls: 'done', text: `✓ ${qm.verb} after refusal${res.price ? ` · ${quickMoney(res.status === 'traded' ? 'quicktrade' : 'release', res.price, fmtInt)}` : ''}`, title: 'The server refused the listing; quick action instead' };
        }
        if (res.status === 'unconfirmed') return { cls: 'refused', text: 'Sent, not confirmed: check storage', title: res.detail || '' };
        const why = resultText(res, t);
        return { cls: res.status === 'refused' ? 'refused' : 'skipped', text: `Not listed · ${why}`, title: why };
    }
    if (r.block === 'listed') return { cls: 'listed', text: `On market${r.a.price ? ` · ${fmtInt(r.a.price)} CC` : ''} · ${timeLeftText(r.a.auctionTimerSeconds)}` };
    if (r.block === 'quick' && r.pre) {
        return {
            cls: 'quick', text: 'Quick trade (from the storage list)',
            title: "Came from a Frontier zoo (the storage list's source): the market won't take it (not born in a player zoo). Not checked yet: Check storage shows what the game allows and for how much; each animal is checked again before it goes.",
        };
    }
    if (r.block === 'quick') {
        // what the game offers instead of the market, and why not the market
        const offers = quickOffers(r.verdict, fmtInt, t);
        const why = reasonText('untradeable', r.blockDetail, t);
        return {
            cls: 'quick', text: offers.join(' / ') || BLOCK_WORDS.quick,
            title: `Not for the market${why ? `: ${why}` : ''}. The game offers ${offers.join(' and ') || 'a quick action'} for it instead: switch the panel on the right to Quick trade or Quick release.`,
        };
    }
    if (r.block === 'rehome') {
        const why = reasonText('untradeable', r.blockDetail, t);
        return { cls: 'blocked', text: BLOCK_WORDS.rehome, title: `The game offers only Rehome for it (no market, no Quick trade)${why ? `: ${why}` : ''}.` };
    }
    if (r.block === 'untradeable') {
        const why = reasonText('untradeable', r.blockDetail, t);
        // sick or injured: a quarantine treats it (back to the zoo first)
        const keys = tradeProblemKeys(r.blockDetail);
        const cure = keys.includes('Infected') || keys.includes('SeriouslyInjured')
            ? ' To fix it: Return to zoo from Animal Storage, then send it to the trade centre from the Species board. With "Quarantine sick animals first" (Kin settings) it is treated in a quarantine on the way.'
            : '';
        return { cls: 'blocked', text: `${BLOCK_WORDS.untradeable}${why ? `: ${why}` : ''}`, title: `${BLOCK_WORDS.untradeable}${why ? `: ${why}` : ''}. The game's own Trade button refuses it too.${cure} Read storage again to check again.` };
    }
    if (r.block) return { cls: 'blocked', text: BLOCK_WORDS[r.block], title: r.block === 'pregnant' ? PREGNANT_TEXT : r.block === 'noid' ? NOID_TEXT : undefined };
    if (res && res.status === 'pending') return { cls: 'queued', text: 'Queued' };
    if (res && res.status === 'notstarted') return { cls: 'skipped', text: 'Not started', title: 'The run ended before it reached this animal; tick it and start again to try it.' };
    if (r.caution) return { cls: 'caution', text: CAUTION_WORDS[r.caution] };
    return { cls: 'sellable', text: 'Sellable' };
}

function geneCell(r) {
    const basis = D.filters.geneBasis;
    const v = basisScore(r, basis);
    const g = (r.a.genes || {});
    const pct = x => (typeof x === 'number' ? Math.round(x * 100) : '–');
    return h(`div.PZ2QoL_mdCell.genes.${tierOf(v)}`, {
        text: v == null ? '–' : String(v),
        title: `Size ${pct(g.size)} · Longevity ${pct(g.longevity)} · Fertility ${pct(g.fertility)} · Immunity ${pct(g.immunity)}${basis === 'overall' ? '' : ` (shown: ${GENE_BASES[basis].toLowerCase()})`}`,
    });
}

function rowEl(r, res, mode) {
    const a = r.a;
    const on = D.chosen.has(r.id);
    const st = stateOf(r, res, mode);
    const adv = r.advice;
    // a quick mode: only its own rows can be ticked; the others say why
    const q = D.mode !== 'list' ? quickEligible(r, D.mode) : null;
    const off = q ? !q.ok : !!r.block;
    // a market animal in a quick mode: what the game offers for it too
    if (q && q.ok && q.market && (st.cls === 'sellable' || st.cls === 'caution')) {
        const offer = quickOffers(r.verdict, fmtInt, t).find(x => x.startsWith(QUICK_MODES[D.mode].label));
        if (offer) st.text = `${st.text} · ${offer}`;
    }
    return h(`div.PZ2QoL_mdRow${on ? '.on' : ''}${off ? '.blocked' : ''}${q && q.ok ? '.quickok' : ''}`, {
        'data-id': r.id, 'data-key': a.key, title: q && !q.ok ? q.why : undefined,
        onClick: guard('Tick', () => toggleRow(r)),
    },
        h('div.PZ2QoL_mdCell.tick', null, h(`div.PZ2QoL_mdBox${on ? '.on' : ''}${off ? '.off' : ''}`)),
        h(`div.PZ2QoL_mdCell.sex.${SEX_CLASS[a.gender] || 'other'}`, { text: SEX[a.gender] || '·' }),
        h('div.PZ2QoL_mdCell.name', { title: `${speciesName(a.species)} · ${t(a.name)}` },
            h('span.PZ2QoL_mdName', { text: trunc(t(a.name), 22) }),
            D.filters.species ? null : h('span.PZ2QoL_mdSpeciesTag', { text: trunc(speciesName(a.species), 16) })),
        h('div.PZ2QoL_mdCell.stage', { text: STAGE[a.maturity] || '–' }),
        h('div.PZ2QoL_mdCell.medal', null, r.medal != undefined ? h(`span.PZ2QoL_medalDot.${r.medal}`, { title: medalLabel(r.medal) }) : h('span', { text: '–' })),
        geneCell(r),
        h(`div.PZ2QoL_mdCell.price.conf_${adv.confidence}`, { title: `${CONFIDENCE[adv.confidence] || ''}${adv.reason ? `: ${adv.reason}` : ''}` },
            h('span', { text: adv.price > 0 ? fmtInt(adv.price) : 'game' }),
            h(`span.PZ2QoL_mdConf.c_${adv.confidence}`)),
        h(`div.PZ2QoL_mdCell.state.${st.cls}`, { text: st.text, title: st.title || st.text }));
}

// The right panel's mode switch: List on market | Quick trade | Quick release.
function modeSwitch(running) {
    const seg = segmented('', D.mode, [['list', 'List on market'], ['quicktrade', 'Quick trade'], ['release', 'Quick release']], v => setMode(v),
        running ? 'Switch when the run has ended' : "Quick trade sells for cash at once, Quick release releases to the wild for CC at once: only for animals the market won't take; neither can be undone");
    seg.classList.add('mode');
    return seg;
}

// The panel in a quick mode: red, its header, the count and exact total,
// the live-acceptance note, the pace, the button that opens the sheet.
function quickSide(el, s, running) {
    const m = QUICK_MODES[D.mode];
    const busy = isListingBusy();
    el.appendChild(h('div.PZ2QoL_mdQuickHead', { text: m.header }));
    const info = quickInfo();
    const n = info.go.length;
    el.appendChild(h('div.PZ2QoL_mdBig', null,
        h('span.n', { text: String(n) }),
        h('span.l', { text: `animal${n === 1 ? '' : 's'} to ${m.label.toLowerCase()}` })));
    el.appendChild(h('div.PZ2QoL_mdTotal', { text: n ? `For ${info.totalText}${info.skip.length ? ` · ${info.skip.length} ticked can't go` : ''}` : `Tick the animals the game allows ${m.label} for (market ones too).` }));
    // the server's refusals from a listing run: one click to tick them
    const refusedRows = D.mode === 'quicktrade' ? D.rows.filter(r => r.guid && refusedSet.has(r.guid) && quickEligible(r, D.mode).ok && !D.chosen.has(r.id)) : [];
    if (refusedRows.length && !running) el.appendChild(btn(`Tick the ${refusedRows.length} refused by the server`, null, () => tickRefused(Array.from(refusedSet)), { cls: 'small.refused', title: 'The animals a listing run had refused by the server (this session)' }));
    if (!isAccepted(D.mode)) el.appendChild(h('div.PZ2QoL_mdQuickFirst', { text: `${FIRST_TEXT[D.mode]}.`, title: 'Until one animal has been confirmed gone from storage this way, the desk sends one at a time.' }));
    el.appendChild(D.pace);
    if (running) {
        el.appendChild(btn('Stop', 'Icon_Close', () => stopListing(), { cls: 'stop.wide', tint: 'white', title: 'Stops after the current animal' }));
    }
    else {
        const can = n > 0 && isFranchise() && !busy && engineUsable(D.caps, D.rows.length);
        el.appendChild(btn(info.button, m.cash ? 'Icon_Cash_Symbol' : 'Icon_ConservationCredits', openSheet, {
            cls: `quick.wide${can ? '' : '.disabled'}`, tint: 'white',
            title: !isFranchise() ? 'Franchise only' : busy ? 'A run or market check is going' : 'Opens a confirmation; nothing is sent until you press Confirm there',
        }));
    }
    if (s && !(isRepriceReq(s.req) || s.mode === 'unlist')) el.appendChild(runCard(s));
}

function renderSide() {
    const el = D.el.side;
    clear(el);
    const s = getEngineState();
    const running = engineRunning();
    const busy = isListingBusy();
    setClass(el, 'quick', D.mode !== 'list');
    el.appendChild(modeSwitch(running));
    if (D.mode !== 'list') return quickSide(el, s, running);
    const chosen = chosenRows();
    const listable = chosen.filter(r => !r.block);
    const total = listable.reduce((n, r) => n + (r.advice.price > 0 ? r.advice.price : 0), 0);
    const noPrice = listable.filter(r => !(r.advice.price > 0)).length;
    el.appendChild(h('div.PZ2QoL_mdCardTitle', { text: 'Listing' }));
    el.appendChild(h('div.PZ2QoL_mdBig', null,
        h('span.n', { text: String(listable.length) }),
        h('span.l', { text: `animal${listable.length === 1 ? '' : 's'} ticked` })));
    el.appendChild(h('div.PZ2QoL_mdTotal', { text: listable.length ? `≈ ${fmtInt(total)} CC asked${noPrice ? ` + ${noPrice} at the game's price` : ''}` : 'Tick animals in the list.' }));
    el.appendChild(segmented('Duration', D.hours, [['max', 'Longest'], ['default', 'Game default']], v => {
        D.hours = v;
        dlog('desk', 'duration', { hours: v });
        queueRender();
    }, "Longest: the most hours the game allows (12 h today). Game default: what the game's own slider starts at (6 h)."));
    // When the server refuses a listing (a player-wide setting, prefs 'deskRefused')
    const onRefused = refusedOption();
    const segR = segmented('If refused', onRefused, Object.entries(REFUSED_OPTIONS), v => {
        try {
            setPref('deskRefused', normalizeRefused(v) === 'leave' ? undefined : normalizeRefused(v));
        }
        catch (e) {
            // kept for the page only
        }
        dlog('desk', 'refused_option', { value: normalizeRefused(v) });
        queueRender();
    }, `When the server refuses a listing: ${Object.values(REFUSED_OPTIONS).join(', ')}. Some animals are refused by Frontier's server every time (the game's own Trade too). ${REFUSED_OPTIONS.quicktrade} / ${REFUSED_OPTIONS.release}: in the same run, right after the refusal, the animal is quick-traded or released if the game allows it (each checked again; the run stops at anything unexpected). Permanent.`);
    segR.classList.add('refused');
    el.appendChild(segR);
    D.offset.__update();
    el.appendChild(D.offset);
    el.appendChild(D.pace);
    if (!running) el.appendChild(priceCheckCard(listable));
    if (running) {
        el.appendChild(btn('Stop', 'Icon_Close', () => stopListing(), { cls: 'stop.wide', tint: 'white', title: 'Stops after the current wait; an animal already sent may still appear on the market' }));
    }
    else {
        const stale = uncheckedSpecies(listable);
        const ready = engineUsable(D.caps, D.rows.length);
        const can = listable.length && isFranchise() && !busy && !stale.length && ready;
        // the permanence, up front: the List click is the opt-in
        const note = refusedNote(onRefused, { limitOne: onRefused === 'release' && !isAccepted('release') });
        if (note) el.appendChild(h('div.PZ2QoL_mdRefusedNote', { text: note }));
        const tail = onRefused === 'quicktrade' ? ' · refused → quick trade' : onRefused === 'release' ? ' · refused → release' : '';
        el.appendChild(btn(`List ${listable.length} animal${listable.length === 1 ? '' : 's'}${tail}`, 'IconTrade', startListing, {
            cls: `primary.wide${can ? '' : '.disabled'}`, tint: 'white',
            title: !isFranchise() ? 'Franchise only' : busy ? 'A listing or market check is running'
                : !ready ? `${engineWhyNot(D.caps, D.rows.length)} Reopen Animal Storage and try again.`
                    : stale.length ? 'Check market prices first (the button above)' : 'Lists the ticked animals at their recommended prices, one at a time',
        }));
    }
    if (s && (isRepriceReq(s.req) || s.mode === 'unlist')) el.appendChild(repriceNote());
    else if (s) el.appendChild(runCard(s));
}

// The engine is busy with a reprice (My listings): a pointer there.
function repriceNote() {
    const active = repriceActive();
    return h(`div.PZ2QoL_mdRun.${active ? 'running' : 'done'}`, null,
        h('div.PZ2QoL_mdRunHead', null, h('span', { text: active ? 'Repricing your listings…' : 'Reprice' })),
        h('div.PZ2QoL_mdRunStep', { text: active ? 'Listing waits until it is done. See My listings.' : 'See My listings for how it went.' }),
        btn('Open My listings', null, () => setView('listings'), { cls: 'small' }));
}

function runCard(s) {
    const tl = tally(s);
    const processed = tl.total - tl.pending - tl.working;
    const pct = tl.total ? Math.round(processed / tl.total * 100) : 0;
    const running = s.phase === 'running';
    const cur = s.results[s.index];
    if (s.mode === 'check') return checkCard(s, tl, pct, running, cur);
    if (QUICK_MODES[s.mode]) return quickCard(s, pct, running, cur);
    const card = h(`div.PZ2QoL_mdRun.${running ? 'running' : s.phase}`);
    card.appendChild(h('div.PZ2QoL_mdRunHead', null,
        h('span', { text: running ? 'Listing…' : s.phase === 'done' ? 'Finished' : s.phase === 'closed' ? 'Stopped: storage closed' : 'Stopped' }),
        h('div.PZ2QoL_kpFlex'),
        h('span.PZ2QoL_mdRunCount', { text: `${tl.listed}/${tl.total} listed` })));
    card.appendChild(h('div.PZ2QoL_mdProgress', null, h('div.PZ2QoL_mdProgressFill', { style: { width: `${pct}%` } })));
    if (running && cur) {
        card.appendChild(h('div.PZ2QoL_mdRunNow', { text: `${labelOf(cur.guid)}` }));
        card.appendChild(h('div.PZ2QoL_mdRunStep', { text: `${STEP_WORDS[s.step] || s.message || 'Working…'}${s.waited >= 2 ? ` (${Math.round(s.waited)}s)` : ''}` }));
    }
    else {
        card.appendChild(h('div.PZ2QoL_mdRunStep', { text: summaryText(s, fmtInt, jobNote(s)) }));
        const again = retryGuids(s).length;
        if (again) card.appendChild(btn(`Tick the ${again} to retry`, null, retry, { cls: 'small', title: 'Ticks the animals that were not listed for a passing reason (server busy, refused, no confirmation, stopped)' }));
        // the server's refusals: Quick trade them instead
        const nRefused = refusedGuids(s).filter(g => D.rows.some(r => r.guid === g)).length;
        if (nRefused) card.appendChild(btn(`Quick trade the ${nRefused} refused`, 'Icon_Cash_Symbol', () => tickRefused(refusedGuids(s)), { cls: 'small', title: 'Switches to Quick trade and ticks the animals the server refused to list (those the game allows Quick trade for)' }));
    }
    const recent = s.results.filter(r => r.status !== 'pending' && r.status !== 'working').slice(-5).reverse();
    for (const r of recent) {
        const quick = r.status === 'traded' || r.status === 'released';
        const ok = r.status === 'listed' || quick;
        const full = ok ? '' : `${labelOf(r.guid)} · ${resultText(r, t)}`;
        // the game's reason stays on the line for untradeable; the others keep it in the tooltip
        const text = quick ? `${labelOf(r.guid)} · ${r.status === 'traded' ? 'quick-traded' : 'released'} after refusal${r.price ? ` · ${quickMoney(r.status === 'traded' ? 'quicktrade' : 'release', r.price, fmtInt)}` : ''}`
            : ok ? `${labelOf(r.guid)} · ${fmtInt(r.price || 0)} CC` : r.kind === 'untradeable' ? full : `${labelOf(r.guid)} · ${RESULT_WORDS[r.kind] || r.status}`;
        card.appendChild(h(`div.PZ2QoL_mdRunLine.${ok ? 'ok' : 'no'}`, { text: `${ok ? '✓' : '·'} ${text}`, title: ok ? text : full }));
    }
    return card;
}

// A quick run: "Quick-traded 6 of 7 · $7,200", why it stopped, a line per animal.
function quickCard(s, pct, running, cur) {
    const m = QUICK_MODES[s.mode];
    const done = s.results.filter(r => r.status === m.done).length;
    const card = h(`div.PZ2QoL_mdRun.quick.${running ? 'running' : s.phase}`);
    card.appendChild(h('div.PZ2QoL_mdRunHead', null,
        h('span', { text: running ? `${m.working}` : s.phase === 'done' ? 'Finished' : s.phase === 'closed' ? 'Stopped: storage closed' : 'Stopped' }),
        h('div.PZ2QoL_kpFlex'),
        h('span.PZ2QoL_mdRunCount', { text: `${done}/${s.results.length}` })));
    card.appendChild(h('div.PZ2QoL_mdProgress', null, h('div.PZ2QoL_mdProgressFill', { style: { width: `${pct}%` } })));
    card.appendChild(h('div.PZ2QoL_mdRunStep.sum', { text: quickRunSummary(s, fmtInt) }));
    if (running && cur) card.appendChild(h('div.PZ2QoL_mdRunNow', { text: `${rowLabel(cur.guid)} · ${STEP_WORDS[s.step] || s.message || 'Working…'}` }));
    else if (s.phase !== 'done' && s.message) card.appendChild(h('div.PZ2QoL_mdRunStep.why', { text: s.message, title: s.message }));
    const lines = s.results.slice(0, 12);
    for (const r of lines) {
        let text;
        let cls = 'no';
        if (r.status === m.done) {
            text = `✓ ${rowLabel(r.guid)}${r.price ? ` · ${quickMoney(s.mode, r.price, fmtInt)}` : ''}`;
            cls = 'ok';
        }
        else if (r.status === 'pending') text = `· ${rowLabel(r.guid)} · not sent`;
        else if (r.status === 'working') text = `… ${rowLabel(r.guid)}`;
        else text = `✕ ${rowLabel(r.guid)} · ${r.kind === 'unconfirmed' ? RESULT_WORDS[r.kind] : resultText(r, t, 'untradeable')}`;
        card.appendChild(h(`div.PZ2QoL_mdRunLine.${cls}`, { text, title: text }));
    }
    if (s.results.length > 12) card.appendChild(h('div.PZ2QoL_mdRunLine', { text: `and ${s.results.length - 12} more` }));
    return card;
}

// "Lion ♀ "Nala"" for a GUID the desk shows (a check run's animals never got
// a listing label; a quick run's leave storage, so their label is kept)
function rowLabel(guid) {
    const r = D.rows.find(x => x.guid === String(guid));
    if (!r) return D.labels.get(String(guid)) || labelOf(guid);
    return animalLabel(r.a);
}

// A Check storage run: progress, the animal being checked, the categories found.
function checkCard(s, tl, pct, running, cur) {
    const card = h(`div.PZ2QoL_mdRun.check.${running ? 'running' : s.phase}`);
    card.appendChild(h('div.PZ2QoL_mdRunHead', null,
        h('span', { text: running ? 'Checking storage…' : s.phase === 'done' ? 'Storage checked' : s.phase === 'closed' ? 'Check stopped: storage closed' : 'Check stopped' }),
        h('div.PZ2QoL_kpFlex'),
        h('span.PZ2QoL_mdRunCount', { text: `${tl.checked}/${tl.total} checked` })));
    card.appendChild(h('div.PZ2QoL_mdProgress', null, h('div.PZ2QoL_mdProgressFill', { style: { width: `${pct}%` } })));
    if (running && cur) {
        card.appendChild(h('div.PZ2QoL_mdRunNow', { text: rowLabel(cur.guid) }));
        card.appendChild(h('div.PZ2QoL_mdRunStep', { text: s.step === 'pause' ? 'Next one…' : 'Selecting it in Animal Storage and reading what the game allows…' }));
    }
    else {
        card.appendChild(h('div.PZ2QoL_mdRunStep', { text: checkSummaryText(s, verdicts) }));
    }
    card.appendChild(h('div.PZ2QoL_mdRunLine', { text: 'Nothing is sold, listed or sent while checking.' }));
    return card;
}

// ------------------------------------------------------------- open/close

function storageOpen() {
    const n = document.querySelector('.AnimalMarketStorage_header');
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

// What Animal Storage shows now: the list as the game gave it (its own
// filters narrow it natively) and the mod's species filter (the screen
// only; the desk reads the unfiltered rows).
function readScope() {
    let modSpecies = '';
    try {
        modSpecies = String((getStorageFilters() || {}).species || '');
    }
    catch (e) {
        modSpecies = '';
    }
    const rows = childrenOf(STORAGE_LIST).map(ctx => readAnimal(ctx));
    const total = get(STORAGE_DATA, 'animalsInStorage');
    const active = nativeFiltersOn(p => get(STORAGE_DATA.concat('filters'), p));
    return storageScope({ rows, total: typeof total === 'number' ? total : null, active, modSpecies });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// The desk lists every animal in storage, whatever Animal Storage is
// filtered to. The game's filters narrow the storage list natively (there is
// no other list, and the engine resolves and selects animals in it), so the
// game-side engine clears them while the desk is open, as the game's own
// Reset all filters does, and puts them back on close (pz2qol.lister.lua
// DeskFilters; local calls only). The storage screen's ticks become GUIDs
// first: a rebuilt list gives row keys to other animals. Without the engine
// the list stays as it is and the desk says so (renderScope).
async function seeAllStorage() {
    if (!D.open || D.unfilter === 'clearing' || D.unfilter === 'cleared') return;
    if (!D.cleared && !(D.scope && D.scope.filtered)) return;
    D.unfilter = 'clearing';
    try {
        for (let i = 0; i < 20 && (D.reading || D.pendingKeys); i++) {
            await wait(150);
            if (!D.reading && D.pendingKeys) await readRows(true);
        }
        if (!D.open) {
            D.unfilter = '';
            return;
        }
        const ans = D.pendingKeys || !engineUsable(D.caps, D.rows.length) ? null : await deskFilters('clear');
        dlog('desk', 'scope', { asked: !!ans || undefined, ok: ans ? ans.ok : undefined, detail: ans ? ans.detail : undefined, pendingKeys: !!D.pendingKeys || undefined, engine: engineUsable(D.caps, D.rows.length) });
        if (ans && ans.ok) {
            D.unfilter = 'cleared';
            D.cleared = true;
            breadcrumb('desk_scope_cleared');
            // the native rebuilds the list: read it again (the timer does too)
            D.readSig = '';
            setTimeout(() => readRows(true), 300);
        }
        else {
            D.unfilter = 'failed';
            breadcrumb('desk_scope_kept');
        }
    }
    catch (e) {
        D.unfilter = 'failed';
        reportError('ui', 'Market desk: showing all of storage failed', e, { silent: true });
    }
    finally {
        queueRender();
    }
}

// opts.keys: storage row keys to tick (the storage screen's selection).
export function openMarketDesk(opts = {}) {
    try {
        ensureRoot();
        if (!D.filters) D.filters = loadFilters();
        closeOtherPanels('desk');
        // what the storage screen was scoped to (kept while the desk's clear
        // still holds: the list is the full one then); the desk starts there
        const scopeNow = readScope();
        if (!D.cleared || scopeNow.filtered) D.scope = scopeNow;
        D.unfilter = '';
        D.reveal = null;
        // a quick mode is never remembered
        closeSheet('open');
        if (D.mode !== 'list') D.chosen.clear();
        D.mode = 'list';
        // opts.view: 'listings' opens My listings; listings a reprice left
        // off the market open it too (they need listing again)
        const rp = getReprice();
        if (opts.view === 'listings' || opts.view === 'sell') D.view = opts.view;
        else if (rp && strandedItems(rp).length && !repriceActive()) D.view = 'listings';
        if (D.scope && D.scope.species) {
            // another species than last time: no ticks it does not show (setFilters' rule)
            if (D.filters.species !== D.scope.species) D.chosen.clear();
            D.filters = normalizeFilters(Object.assign({}, D.filters, { species: D.scope.species, priceMin: 0, priceMax: 0 }));
            D.reveal = { n: -1 };
        }
        let keys = Array.isArray(opts.keys) ? opts.keys : null;
        if (!keys) {
            const sel = get(STORAGE_DATA, 'selectedAnimalIDs');
            keys = Array.isArray(sel) ? sel.slice() : [];
        }
        if (keys.length) {
            D.chosen.clear();
            D.pendingKeys = new Set(keys.map(String));
            D.readSig = '';
        }
        D.open = true;
        setClass(D.root, 'hidden', false);
        setClass(D.scrim, 'hidden', false);
        placePanel(D.root);
        breadcrumb('desk_open');
        dlog('desk', 'open', {
            keys: keys.length, pageRows: childrenOf(STORAGE_LIST).length, scopeFiltered: D.scope ? D.scope.filtered : undefined,
            scopeSpecies: D.scope ? D.scope.species || undefined : undefined, scopeActive: D.scope && D.scope.active.length ? D.scope.active : undefined,
            species: D.filters.species || 'all', filters: activeFilterCount(D.filters), hours: D.hours, offset: getPriceOffset() || undefined,
            cleared: D.cleared || undefined, running: engineRunning() || undefined,
        });
        if (!D.unsub.length) {
            D.unsub.push(onEngineState(() => {
                takeGameBlocks();
                takeQuickAcceptance();
                queueRender();
            }));
            D.unsub.push(onPriceBookChanged(repriceRows));
            D.unsub.push(onMarketCheckChanged(() => queueRender()));
            D.unsub.push(onRepriceChanged(() => queueRender()));
            D.unsub.push(onListerSettingChanged(repriceRows));
        }
        clearInterval(D.timer);
        D.timer = setInterval(() => {
            if (!D.open) return;
            if (!storageOpen()) {
                closeMarketDesk();
                return;
            }
            readRows(false);
        }, READ_MS);
        readRows(true).then(seeAllStorage);
        renderAll(true);
        return true;
    }
    catch (e) {
        reportError('ui', 'Market desk could not open', e);
        return false;
    }
}

export function closeMarketDesk() {
    try {
        dlog('desk', 'close', { cleared: D.cleared || undefined, running: engineRunning() || undefined, ticked: D.chosen.size });
        closeSheet('close');
        listingsHidden();
        D.open = false;
        clearInterval(D.timer);
        D.timer = 0;
        for (const off of D.unsub) off();
        D.unsub = [];
        if (D.root) setClass(D.root, 'hidden', true);
        if (D.scrim) setClass(D.scrim, 'hidden', true);
        // the game's storage filters back (after a run, if one is going)
        D.unfilter = '';
        if (D.cleared) {
            deskFilters('restore').then(ans => {
                if (!D.open) D.cleared = !(ans && ans.ok && ans.detail !== 'later');
            });
        }
        // a run keeps going: it lives in the game-side engine
    }
    catch (e) {
        reportError('ui', 'Market desk could not close', e, { silent: true });
    }
    return true;
}

export function isMarketDeskOpen() {
    return D.open;
}

let installed = false;
export function installMarketDesk() {
    if (installed) return true;
    installed = true;
    // the listing ledger (when the desk listed each animal) from now on
    try {
        getLedger();
    }
    catch (e) {
        // My listings assumes the listing length then
    }
    document.addEventListener('keydown', e => {
        if (!D.open) return;
        // the sheet: Esc closes it only; Enter confirms
        if (D.sheet) {
            if (e.key === 'Escape' || e.keyCode === 27) {
                e.preventDefault();
                e.stopPropagation();
                closeSheet('esc');
            }
            else if ((e.key === 'Enter' || e.keyCode === 13) && !e.repeat) {
                e.preventDefault();
                e.stopPropagation();
                confirmSheet('key');
            }
            return;
        }
        // My listings' confirmation sheet: its own Esc / Enter
        if (D.view === 'listings' && listingsKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        e.preventDefault();
        e.stopPropagation();
        closeMarketDesk();
    }, true);
    try {
        onShouldBlockInput.add(sheetInput);
    }
    catch (e) {
        // no gamepad hook: mouse and keyboard still confirm
    }
    window.addEventListener('resize', () => {
        if (!D.open) return;
        placePanel(D.root);
        setTimeout(() => refreshBars(D.boxes), 0);
    });
    return true;
}

registerPanel('desk', { open: openMarketDesk, close: closeMarketDesk, isOpen: isMarketDeskOpen });
