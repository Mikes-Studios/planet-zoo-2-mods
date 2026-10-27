// Trade shortcuts: from the Species board or the Kin planner's "Find a
// mate" straight to the hub's Animal Storage or Market, for one species.
// Idea: a Nexus comment (2026-10-18).
//
// Park (HUD page):
//   - tradeRow(species, opts): the Storage and Market buttons (and, on the
//     board, the species' adults in storage). One click asks Lua
//     (PZ2QoL_TradeOpen) to open the hub the way the game's own buttons do
//     (pz2qol.tradejump.lua); the panel closes when it worked.
//   - requestStorageCounts([species]): adults of each species in Animal
//     Storage (PZ2QoL_TradeCounts, live from the game), only from the
//     player's clicks (board opened, species picked, Rescan), never a timer.
// Hub (Frontend page):
//   - Lua hands over the species for Storage (PZ2QoL_TradeFilter) once the
//     page says hello; when Animal Storage is on screen the page sets the
//     mod's Species filter chip (bars.js, session only, one click clears it)
//     and confirms (PZ2QoL_TradeAck). The Market species filter is the
//     game's own (set before the hub opens) and stays set afterwards, as
//     with the game's Zoopedia button. A notice's Market also hands over
//     the sex wanted, a dim line and, strict, the calf floor its listings
//     must meet (formatTradeExtra): once the Market is up the page sets the
//     game's own filters and the mod's dim line, and confirms the same way.
// Nothing here is sent to Frontier: it only opens screens and filters lists.
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { isFrontendPage, isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { isBreedingHeatmapOn, setBreedingHeatmap } from '/js/mods/pz2qol/kin.js';
import { getPlanRun } from '/js/mods/pz2qol/kinmoves.js';
import { getSendRun } from '/js/mods/pz2qol/storagesend.js';
import { getStorageSource, setStorageFilters } from '/js/mods/pz2qol/listfilter.js';
import { h, icon, visibilityWatch, visibleBox } from '/js/mods/pz2qol/ui.js';
import { HUB_OPEN_ERRORS } from '/js/mods/pz2qol/storagefetchcore.js';
import { countsText, formatTradeExtra, normSpecies, parseCounts, parseTradeExtra, pendingStep, STRICT_MARKET_EVENTS, tradeBlockReason } from '/js/mods/pz2qol/tradejumpcore.js';
import { get, MARKET_EVENT, sendScreenEvent } from '/js/mods/pz2qol/game.js';
import { setMarketDimBelow } from '/js/mods/pz2qol/badges.js';
import { clearMarketMates, setMarketMates } from '/js/mods/pz2qol/marketcalves.js';

const ANSWER_TIMEOUT_MS = 6000;
const COUNTS_FRESH_MS = 60000;
const ERROR_SHOW_MS = 9000;
const HUB_TICK_MS = 500;
// the Market's extras: kept this long for the Market to come up, applied this
// long after it is on screen (the game's own species filter loads first)
const PENDING_MARKET_MS = 60000;
const MARKET_SETTLE_MS = 1000;

const OPEN_ERRORS = Object.freeze(Object.assign({}, HUB_OPEN_ERRORS, {
    badkind: 'Unknown screen',
    noanswer: 'The game did not answer. Use the Market & Storage button instead.',
}));

// ------------------------------------------------------------ talking to Lua

let reqSeq = 0;
const waiting = new Map(); // reqId -> resolve
let listening = false;

function listen() {
    if (listening || typeof engine === 'undefined') return;
    listening = true;
    const answer = (reqId, value) => {
        const done = waiting.get(String(reqId));
        if (!done) return;
        waiting.delete(String(reqId));
        done(value);
    };
    engine.on('PZ2QoL_TradeOpenResult', (reqId, ok, detail) => answer(reqId, { ok: ok === true, detail: detail ? String(detail) : '' }));
    engine.on('PZ2QoL_TradeCountsResult', (reqId, json) => answer(reqId, json == null ? null : String(json)));
}

function ask(event, timeoutValue, ...args) {
    listen();
    if (typeof engine === 'undefined') return Promise.resolve(timeoutValue);
    const reqId = 't' + (++reqSeq);
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            if (waiting.delete(reqId)) resolve(timeoutValue);
        }, ANSWER_TIMEOUT_MS);
        waiting.set(reqId, v => {
            clearTimeout(timer);
            resolve(v);
        });
        try {
            engine.trigger(event, reqId, ...args);
        }
        catch (e) {
            waiting.delete(reqId);
            clearTimeout(timer);
            resolve(timeoutValue);
        }
    });
}

// ------------------------------------------------------------------ park

// '' when the buttons can be used, else why not (shown under them).
export function canOpenTrade() {
    let planRunning = false, sendRunning = false;
    try {
        planRunning = !!getPlanRun().running;
    }
    catch (e) {
        // no plan state
    }
    try {
        const s = getSendRun();
        sendRunning = !!(s && s.running);
    }
    catch (e) {
        // no run state
    }
    return tradeBlockReason({
        engine: typeof engine !== 'undefined' && isHudPage(),
        // the game's own Market & Storage tab is greyed out without one
        hasBuilding: get(['park'], 'hasBuildingForAnimalStorage'),
        hubDisabled: get(['ui', 'HUD'], 'hubDisabled') === true,
        planRunning,
        sendRunning,
    });
}

let opening = false;

// Opens the hub on 'storage' or 'market' for one species. Resolves
// { ok, detail, text }; text says what went wrong.
// extra (Market, from a notice): { sex: 'm' | 'f', dimBelow, mates, floor, strict } for the hub page
export async function openTrade(kind, species, extra = {}) {
    const why = canOpenTrade();
    if (why) return { ok: false, detail: 'blocked', text: why };
    if (opening) return { ok: false, detail: 'busy', text: OPEN_ERRORS.busy };
    opening = true;
    try {
        // the game won't open the hub while a heat map panel is open
        if (isBreedingHeatmapOn()) {
            try {
                await setBreedingHeatmap(false);
            }
            catch (e) {
                // Lua closes heat maps on the way out anyway
            }
        }
        breadcrumb('trade_click_' + kind);
        const r = await ask('PZ2QoL_TradeOpen', { ok: false, detail: 'noanswer' }, String(kind), String(species || ''), formatTradeExtra(extra));
        if (r && r.ok) {
            breadcrumb('trade_open');
            return { ok: true, detail: '', text: '' };
        }
        const detail = (r && r.detail) || 'noanswer';
        if (detail === 'nohud') {
            // the game's own Market & Storage button (no Storage screen or
            // species then, but the hub opens)
            try {
                engine.trigger('HUD_OpenHubAnimalMarket');
                breadcrumb('trade_open_fallback');
                return { ok: true, detail: 'fallback', text: '' };
            }
            catch (e) {
                // fall through
            }
        }
        breadcrumb('trade_open_failed');
        return { ok: false, detail, text: OPEN_ERRORS[detail] || `The hub did not open (${detail})` };
    }
    finally {
        opening = false;
    }
}

// --------------------------------------------------------- storage counts

const counts = new Map(); // normSpecies -> { time, value: {m, f} | null, pending }
const countListeners = new Set();
let tradeCentre = null;   // { time, tc, tcNow, tcMax } from the last counts answer

// The trade centre as of the last counts answer: { tc (has one), tcNow,
// tcMax } (fields missing when unknown), or null.
export function getTradeCentreInfo() {
    return tradeCentre ? Object.assign({}, tradeCentre) : null;
}

export function onStorageCounts(fn) {
    countListeners.add(fn);
    return () => countListeners.delete(fn);
}

// { m, f } adults of the species in Animal Storage, or null (unknown or
// the game gave no answer: the line is hidden then).
export function getStorageCounts(species) {
    const c = counts.get(normSpecies(species));
    return c && c.value ? c.value : null;
}

// Asks the game for these species' adults in storage (kept 60 s).
export function requestStorageCounts(list, { force = false } = {}) {
    if (typeof engine === 'undefined' || !isHudPage()) return;
    const now = Date.now();
    const need = [];
    for (const sp of list || []) {
        const k = normSpecies(sp);
        if (!k || need.some(x => normSpecies(x) === k)) continue;
        const c = counts.get(k);
        if (c && c.pending) continue;
        if (!force && c && now - c.time < COUNTS_FRESH_MS) continue;
        need.push(String(sp));
    }
    if (!need.length) return;
    for (const sp of need) {
        const k = normSpecies(sp);
        counts.set(k, Object.assign({}, counts.get(k) || { time: 0, value: null }, { pending: true }));
    }
    ask('PZ2QoL_TradeCounts', null, need.join(',')).then(json => {
        const c = parseCounts(json);
        const t = Date.now();
        if (c && c.ok) tradeCentre = { time: t, tc: c.tc, tcNow: c.tcNow, tcMax: c.tcMax };
        for (const sp of need) {
            const k = normSpecies(sp);
            counts.set(k, { time: t, value: c && c.ok ? (c.bySpecies[k] || null) : null, pending: false });
        }
        breadcrumb(c && c.ok ? 'trade_counts' : 'trade_counts_none');
        for (const fn of countListeners) {
            try {
                fn();
            }
            catch (e) {
                reportError('ui', 'Trade shortcuts: a counts listener failed', e, { silent: true });
            }
        }
    });
}

// ---------------------------------------------------------------- buttons

let lastError = null; // { species, text, until }

// The Storage and Market buttons for one species, in a row.
// opts: { rowCls, btnCls ('PZ2QoL_kpBtn' board / 'PZ2QoL_kpAct' planner),
//   showCounts, onOpened(), onError(text) }
export function tradeRow(species, opts = {}) {
    const { rowCls = 'PZ2QoL_kbTrade', btnCls = 'PZ2QoL_kpBtn', showCounts = false, onOpened = () => {}, onError = () => {} } = opts;
    const why = canOpenTrade();
    const err = lastError && lastError.species === species && Date.now() < lastError.until ? lastError.text : '';
    let noteText = why || err;
    const warn = !!noteText;
    if (!noteText && showCounts) noteText = countsText(getStorageCounts(species));
    const note = h(`div.PZ2QoL_tradeNote${warn ? '.warn' : ''}${noteText ? '' : '.empty'}`, { text: noteText });
    const make = (kind, label, iconName, tip) => {
        const node = h(`div.${btnCls}.PZ2QoL_tradeBtn${why ? '.disabled' : ''}`, {
            'data-trade': kind,
            title: tip,
            onClick: () => {
                if (node.classList.contains('disabled')) return;
                openTrade(kind, species).then(r => {
                    if (r.ok) {
                        lastError = null;
                        try {
                            onOpened(r);
                        }
                        catch (e) {
                            reportError('ui', 'Trade shortcuts: closing the panel failed', e, { silent: true });
                        }
                        return;
                    }
                    lastError = { species, text: r.text, until: Date.now() + ERROR_SHOW_MS };
                    note.textContent = r.text;
                    note.classList.add('warn');
                    note.classList.remove('empty');
                    try {
                        onError(r.text);
                    }
                    catch (e) {
                        // the note shows it anyway
                    }
                }, e => reportError('mod', 'Trade shortcuts: opening the hub failed', e));
            },
        }, icon(iconName, 'brown', btnCls === 'PZ2QoL_kpAct' ? 'xs' : 'sm'), h('span', { text: label }));
        return node;
    };
    return h(`div.${rowCls}`, null,
        showCounts ? note : null,
        make('storage', 'Storage', 'Icon_Animal_Trading', 'Open your Animal Storage in the hub, showing only this species'),
        make('market', 'Market', 'IconTrade', 'Open the Market in the hub, filtered to this species (the game keeps that filter until you change it)'),
        showCounts ? null : note);
}

// ------------------------------------------------------------------- hub

let pending = null;      // { seq, species, at }
let pendingMarket = null; // { seq, species, sex, dimBelow, mates, floor, at }: the Market's extras from a needs notice
let marketSince = 0;
let lastApplied = null;  // seq
let visibleSince = 0;

function isVisible(sel) {
    return !!visibleBox(document.querySelector(sel));
}

function hello() {
    try {
        engine.trigger('PZ2QoL_TradeHello');
    }
    catch (e) {
        // no Lua (harness)
    }
}

function ack(seq) {
    try {
        engine.trigger('PZ2QoL_TradeAck', seq);
    }
    catch (e) {
        // Lua drops it after 10 minutes anyway
    }
}

// The needs notice's Market: the game's own male / female filter (as the
// market presets send them) and the mod's dim line, once the Market is up.
function marketTick() {
    const vis = isVisible('.AnimalMarketMarket_header');
    if (!vis) {
        if (marketSince) clearMarketMates();
        marketSince = 0;
        return;
    }
    if (!marketSince) {
        marketSince = Date.now();
        hello();
    }
    if (!pendingMarket) return;
    if (Date.now() - pendingMarket.at > PENDING_MARKET_MS) {
        pendingMarket = null;
        breadcrumb('trade_market_expired');
        return;
    }
    // the list's first answer first
    if (Date.now() - marketSince < MARKET_SETTLE_MS) return;
    const p = pendingMarket;
    pendingMarket = null;
    lastApplied = p.seq;
    const events = p.strict ? STRICT_MARKET_EVENTS.slice() : [];
    if (p.sex) events.push(['FilterIsMale', p.sex === 'm'], ['FilterIsFemale', p.sex === 'f']);
    if (events.length) {
        for (const [suffix, value] of events) sendScreenEvent(MARKET_EVENT, suffix, value);
        sendScreenEvent(MARKET_EVENT, 'FilterMenuConfirm');
    }
    if (p.dimBelow != null) setMarketDimBelow(p.dimBelow);
    setMarketMates(p.mates.length ? { species: p.species, sex: p.sex, mates: p.mates, floor: p.floor, strict: p.strict } : null);
    ack(p.seq);
    breadcrumb('trade_market_applied');
}

// a filter may have come in while the page was elsewhere
const storageShown = visibilityWatch('.AnimalMarketStorage_header', hello);

function hubTick() {
    try {
        marketTick();
        visibleSince = storageShown();
        const vis = visibleSince > 0;
        if (!pending) return;
        const step = pendingStep(pending, { now: Date.now(), storageVisible: vis, rowCount: vis ? getStorageSource().length : 0, visibleSince });
        if (step === 'expire') {
            pending = null;
            breadcrumb('trade_filter_expired');
            return;
        }
        if (step !== 'apply') return;
        const p = pending;
        pending = null;
        lastApplied = p.seq;
        setStorageFilters({ species: p.species });
        ack(p.seq);
        breadcrumb('trade_filter_applied');
    }
    catch (e) {
        reportError('ui', 'Trade shortcuts: the storage filter failed', e, { silent: true });
    }
}

function installHub() {
    engine.on('PZ2QoL_TradeFilter', (seq, kind, species, extra) => {
        if (kind === 'market') {
            if (seq === lastApplied) return ack(seq);
            pendingMarket = Object.assign({ seq, at: Date.now(), species: String(species || '') }, parseTradeExtra(extra));
            breadcrumb('trade_market_got');
            return;
        }
        if (kind !== 'storage' || !species) return;
        if (seq === lastApplied) {
            // already applied (the answer to a second hello): only confirm
            ack(seq);
            return;
        }
        if (pending && pending.seq === seq) return;
        pending = { seq, species: String(species), at: Date.now() };
        breadcrumb('trade_filter_got');
    });
    setInterval(hubTick, HUB_TICK_MS);
    hello();
}

// --------------------------------------------------------------- install

let installed = false;

export function installTradeJump() {
    if (installed) return true;
    if (typeof engine === 'undefined') return false;
    installed = true;
    listen();
    if (isFrontendPage()) installHub();
    return true;
}

// Harness only.
export function _tradeState() {
    return { pending, lastApplied, visibleSince, counts: Array.from(counts.entries()) };
}
