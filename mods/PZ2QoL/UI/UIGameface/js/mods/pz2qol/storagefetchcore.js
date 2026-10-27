// "Bring to the trade centre": the pure parts, no DOM and no engine, so node
// tests can run them (tests/storagefetch.test.js). See storagefetch.js for
// the runtime, pz2qol.storagefetch.lua / pz2qol.storagesend.lua for Lua and
// docs/PLAN-storage-to-trade-centre.md for the design.
//
//  1. Species board (park): one click asks Lua to open Animal Storage for the
//     species (PZ2QoL_FetchStart), with the park's own animals of it so the
//     hub never sends one that is already here.
//  2. Animal Storage (hub): the species' rows are picked (pickRows), ticked
//     and sent with the game's own Send to Zoo, once.
//  3. Back in the zoo: each arrival goes to the trade centre, ONE at a time
//     (runTradeArrivals), confirmed by the game, with the player's pause.
//     An animal already in the trade centre costs nothing. Failures are
//     skipped and the run carries on; only Stop ends it.
import { normSpecies } from './scores.js';

const CONFIRM_TIMEOUT_MS = 12000;
const CONFIRM_POLL_MS = 600;
const BUSY_WAIT_MS = 10000;
const BUSY_POLL_MS = 500;
export const ERROR_PAUSE_MS = 8000; // after a refused or unconfirmed request online
export const COUNTDOWN_MS = 3000;   // the hub card's last chance to cancel
export const TICK_WAIT_MS = 3000;   // the game ticks the rows within this
// "Bring all": every species in storage at once (the developer, 2026-10-19).
// Carried as the species through Lua and the hub page.
export const ALL_SPECIES = '*';

export function isAllSpecies(species) {
    return String(species == null ? '' : species) === ALL_SPECIES;
}

// What the cards call the animals: "Okapi" or "stored animals".
export function fetchName(species, nameOf = x => x) {
    return isAllSpecies(species) ? 'stored animals' : nameOf(species);
}

// ------------------------------------------------------------- exclusion

// A name as both sides compare it (Lua keeps only these characters too).
export function cleanName(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim();
}

// How a park animal and a Storage row are compared by name: the same sex,
// species and name ("Bring all" spans species, and names repeat across them).
function nameKey(sex, species, name) {
    return `${Number(sex) || 0}:${normSpecies(species)}:${cleanName(name)}`;
}

// The park's own animals of the species (every species for ALL_SPECIES) as
// the exclude list Lua carries to the hub: "g:<guid>" and
// "n:<sex>:<species>:<name>" items, comma separated.
export function excludeList(animals, species) {
    const all = isAllSpecies(species);
    const want = normSpecies(species);
    const out = [];
    for (const a of animals || []) {
        if (!a || (!all && normSpecies(a.species) !== want)) continue;
        if (a.guid != null && /^[\w.-]+$/.test(String(a.guid))) out.push('g:' + String(a.guid));
        if (cleanName(a.name) && normSpecies(a.species)) out.push('n:' + nameKey(a.sex, a.species, a.name));
    }
    return Array.from(new Set(out)).join(',');
}

// Named stored animals (an approved upgrade, a best-fit partner), as
// "m:<sex>:<F>.<I>.<S>.<L>:<name>" items in the same list. Franchise Storage
// rows carry no animal GUID the park can match, so the row is the one with
// that sex, name and all four gene grades (percent). animals: [{ sex, name,
// genes: [fertility, immunity, size, longevity] }]
export function matchItems(animals) {
    return (animals || []).filter(a => a && Array.isArray(a.genes) && a.genes.length === 4 && a.genes.every(Number.isFinite))
        .map(a => `m:${Number(a.sex) || 0}:${a.genes.map(v => Math.round(v)).join('.')}:${cleanName(a.name)}`).join(',');
}

// The list Lua carries for one click: the named animals first (Lua refuses
// a request whose cap would cut through them), then the park's own animals.
// match: matchItems' animals, or none for every stored one. -> { exclude },
// or { error } when animals were named but none can be told apart by its
// genes (bringing every stored one instead is never right).
export function fetchRequest(animals, species, match) {
    const named = matchItems(match);
    if (match && match.length && !named) return { error: 'unnamed' };
    return { exclude: [named, excludeList(animals, species)].filter(Boolean).join(',') };
}

export function parseExclude(csv) {
    const guids = new Set();
    const names = new Set();
    const match = [];
    for (const raw of String(csv == null ? '' : csv).split(',')) {
        const s = raw.trim();
        if (s.startsWith('g:') && s.length > 2) guids.add(s.slice(2));
        else if (s.startsWith('m:')) {
            const parts = s.split(':');
            const genes = (parts[2] || '').split('.').map(Number);
            if (parts.length >= 4 && genes.length === 4 && genes.every(Number.isFinite)) match.push({ sex: Number(parts[1]) || 0, genes, name: parts.slice(3).join(':') });
        }
        else if (/^n:\d+:\w+:./.test(s)) names.add(s.slice(2));
    }
    return { guids, names, match };
}

// A Storage row's gene grades in percent, in matchItems' order (the list
// shows 0..1 or 0..100; null where it shows none)
function rowGenes(r) {
    const g = r.genes || {};
    const pct = v => (typeof v === 'number' ? (v <= 1.5 ? v * 100 : v) : null);
    return [g.fertility, g.immunity, g.size, g.longevity].map(pct);
}

// r: { sex, name, genes: { fertility, immunity, size, longevity } }; m: a
// parseExclude match ({ sex, name (cleanName), genes: [percent x4] })
export function rowMatches(r, m) {
    if ((Number(r.sex) || 0) !== m.sex || cleanName(r.name) !== m.name) return false;
    return rowGenes(r).every((v, i) => v != null && Math.abs(v - m.genes[i]) <= 2);
}

// ------------------------------------------------------------ hub: request

export const PENDING_MAX_MS = 600000; // Lua drops its request after as long (nPendingSeconds)
export const FRESH_MAX_MS = 10000;    // a click's Animal Storage comes up within this

// What the hub page does with the request Lua handed it (p: { fresh, at }):
// 'fresh' (the click just opened Storage: cover it, then count down),
// 'later' (any other visit: wait for the player's Send) or 'expired' (drop).
export function handOverState(p, nowMs) {
    if (!p || nowMs - p.at > PENDING_MAX_MS) return 'expired';
    return p.fresh && nowMs - p.at < FRESH_MAX_MS ? 'fresh' : 'later';
}

// ------------------------------------------------------------ hub: rows

// Adults first (fertile ones, then old), then young; then by name.
function rank(r) {
    const m = Number(r.maturity);
    if (m === 0) return 2;
    if (m >= 4 && m <= 6) return 1;
    return 0;
}

// rows: [{ id, key, name, species, sex, maturity, isShoal, isMoving,
//   auctionTimerSeconds, guid? }] (the storage list, any species).
// o: { species (ALL_SPECIES: every one), room (-1 or null: unknown), exclude: parseExclude() }.
// -> { picked, left (no room), shoals, moving, listed, cancel (named but
// listed: its listing is cancelled first), here }
export function pickRows(rows, o = {}) {
    const all = isAllSpecies(o.species);
    const want = normSpecies(o.species);
    const ex = o.exclude || { guids: new Set(), names: new Set(), match: [] };
    // named animals: each match takes one row
    const wanted = ex.match && ex.match.length ? ex.match.slice() : null;
    const out = { picked: [], left: [], shoals: [], moving: [], listed: [], cancel: [], here: [] };
    const ok = [];
    for (const r of rows || []) {
        if (!r || r.id == null || r.key == null || (!all && normSpecies(r.species) !== want)) continue;
        // named and matched by its genes: it is that stored animal, even
        // when a park animal has the same game-given name
        let named = false;
        if (wanted) {
            const k = wanted.findIndex(m => rowMatches(r, m));
            if (k < 0) continue;
            wanted.splice(k, 1);
            named = true;
        }
        if (r.isShoal) out.shoals.push(r);
        else if (r.isMoving) out.moving.push(r);
        else if (isListedRow(r)) (named ? out.cancel : out.listed).push(r);
        else if ((r.guid != null && ex.guids.has(String(r.guid))) || (!named && ex.names.has(nameKey(r.sex, r.species, r.name)))) out.here.push(r);
        else ok.push(r);
    }
    ok.sort((a, b) => rank(a) - rank(b) || cleanName(a.name).localeCompare(cleanName(b.name)) || String(a.id).localeCompare(String(b.id)));
    // null / undefined / -1: room unknown, no cap
    const room = o.room == null || o.room === '' ? NaN : Number(o.room);
    const cap = Number.isFinite(room) && room >= 0 ? room : Infinity;
    out.picked = ok.slice(0, cap);
    out.left = ok.slice(cap);
    return out;
}

export function isListedRow(r) {
    return r.auctionTimerSeconds != undefined && r.auctionTimerSeconds > 0;
}

export function sameSpecies(a, b) {
    const x = normSpecies(a);
    return !!x && x === normSpecies(b);
}

export function sameKeys(a, b) {
    const x = new Set((a || []).map(String));
    const y = new Set((b || []).map(String));
    if (x.size !== y.size) return false;
    for (const k of x) if (!y.has(k)) return false;
    return true;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The hub card's second line: "7 animals: 5 adults, 2 young · room for 9".
export function pickedText(p, room) {
    const n = p.picked.length;
    const young = p.picked.filter(r => Number(r.maturity) === 0).length;
    const parts = [`${plural(n, 'animal', 'animals')}${young && young < n ? `: ${n - young} adult${n - young === 1 ? '' : 's'}, ${young} young` : young ? ', all young' : ''}`];
    if (Number.isFinite(Number(room)) && Number(room) >= 0) parts.push(`room for ${room}`);
    return parts.join(' · ');
}

// Lines about the rows that stay (empty when none).
// The card's lines on the listings a named fetch cancelled first (listed:
// the rows it tried, still: the ones the game left on the market).
export function cancelLines(listed, still) {
    const off = listed.filter(r => !still.includes(r));
    const names = rows => rows.map(r => r.name || 'an animal').join(', ');
    const out = [];
    if (off.length) out.push(`Took ${names(off)} off the market.`);
    if (still.length) out.push(`${names(still)} ${still.length === 1 ? 'stays' : 'stay'} on the market: the game did not cancel ${still.length === 1 ? 'the listing' : 'the listings'}. Cancel it in Storage and bring ${still.length === 1 ? 'it' : 'them'} again.`);
    return out;
}

export function leftLines(p) {
    const out = [];
    if (p.left.length) {
        const names = p.left.slice(0, 4).map(r => r.name || 'an animal').join(', ');
        out.push(`No room for ${p.left.length} (adults went first): ${names}${p.left.length > 4 ? ', …' : ''} ${p.left.length === 1 ? 'stays' : 'stay'} in storage.`);
    }
    if (p.here.length) out.push(`${plural(p.here.length, 'is', 'are')} already in this zoo.`);
    if (p.listed.length) out.push(`${plural(p.listed.length, 'is', 'are')} on the market.`);
    if (p.moving.length) out.push(`${plural(p.moving.length, 'is', 'are')} already on the way somewhere.`);
    if (p.shoals.length) out.push(`${plural(p.shoals.length, 'shoal stays', 'shoals stay')} (send those yourself).`);
    return out;
}

// ---------------------------------------------------------------- messages

// What the player reads for each code Lua or a run gives: the hub-opening
// codes (shared with tradejump.js), the Bring click's own, and the line of
// an animal a run skipped (shared with storagesendcore.js).
export const HUB_OPEN_ERRORS = Object.freeze({
    nobuilding: 'Build a trade centre to use Market & Storage',
    nopark: 'Only while a zoo is running',
    nohub: "The game's hub could not be reached. Try again, or use the Market & Storage button.",
    badspecies: 'This species has no name the hub knows',
    busy: 'Already opening the hub…',
});

export const START_ERRORS = Object.freeze(Object.assign({}, HUB_OPEN_ERRORS, {
    notradecentre: 'Build a trade centre first',
    full: 'The trade centre is full',
    nohud: "The game's hub could not be opened from here. Open Animal Storage with the Market & Storage button and send them from there.",
    noanswer: 'The game did not answer. Try again in a moment.',
    nozoo: 'The game has not named this zoo yet, so the mod cannot be sure the animals come back here. Wait a few seconds and click Bring again.',
    unnamed: "The animals to bring have no gene grades the mod can match in Storage, so nothing was sent. Tick them in Animal Storage and use Send to Zoo yourself.",
    toolong: "Too many animals named for one request, so nothing was sent. Tick them in Animal Storage and use Send to Zoo yourself.",
}));

export const SKIP_TEXT = Object.freeze({
    noanswer: 'the game did not answer',
    nopark: 'no park is running',
    gone: 'no longer in the zoo',
    dead: 'no longer alive',
    moving: 'already on its way somewhere',
    notradecentre: 'this zoo has no trade centre',
    full: 'the trade centre is full',
    unconfirmed: 'not confirmed by the game in time',
    stopped: 'stopped before the game confirmed it',
});

// A skip code as its line (a code the catalog lacks is the game's own text).
export function skipText(code) {
    return SKIP_TEXT[code] || String(code);
}

// ------------------------------------------------------------ park: button

// '' when the button can be used, else why not.
// s: { tradeBlock (canOpenTrade() text), hasTradeCentre, tcNow, tcMax, adults (null: unknown) }
export function fetchBlockReason(s = {}) {
    if (s.tradeBlock) return s.tradeBlock;
    if (s.hasTradeCentre === false) return START_ERRORS.notradecentre;
    if (Number.isFinite(s.tcNow) && Number.isFinite(s.tcMax) && s.tcNow >= s.tcMax) {
        return s.mode === 'franchise' ? `Your storage is full (all zoos, ${s.tcNow}/${s.tcMax})` : `${START_ERRORS.full} (${s.tcNow}/${s.tcMax})`;
    }
    return '';
}

// The note under the button.
export function fetchNote(s = {}) {
    const sp = s.speciesName || 'this species';
    if (s.all) {
        const where = s.mode === 'franchise' ? 'Storage, all zoos' : 'Trade centre';
        return Number.isFinite(s.tcNow) && Number.isFinite(s.tcMax) ? `Every species · ${where} ${s.tcNow}/${s.tcMax}` : 'Every species in your Animal Storage';
    }
    // Franchise: the trade centre's count is the whole account's storage (all
    // zoos; the developer saw 90/250, 2026-10-18)
    const where = s.mode === 'franchise' ? 'storage, all zoos' : 'trade centre';
    const tc = Number.isFinite(s.tcNow) && Number.isFinite(s.tcMax) ? ` · ${where} ${s.tcNow}/${s.tcMax}` : '';
    if (s.adults == null) return `${sp} in storage: count unknown here${tc}`;
    if (s.adults === 0) return `No adult ${sp} in storage (young may be)${tc}`;
    return `${plural(s.adults, 'adult', 'adults')} in storage (+ any young)${tc}`;
}

// --------------------------------------------------------- park: arrivals

// Is the animal in the trade centre, or on its way (the game confirmed it)?
export function tradeConfirmed(f) {
    return !!f && !f.error && !f.gone && (f.lt === 'trade' || f.moving === true);
}

// Why an arrival can't be sent, as a SKIP_TEXT code ('' when it can).
// Already in the trade centre is not a skip (see runTradeArrivals).
export function arrivalSkip(f) {
    if (!f) return 'noanswer';
    if (f.error) return String(f.error);
    if (f.gone) return 'gone';
    if (f.alive === false) return 'dead';
    if (f.moving) return 'moving';
    if (f.tc === '') return 'notradecentre';
    if (Number.isFinite(f.tcNow) && Number.isFinite(f.tcMax) && f.tcNow >= f.tcMax) return 'full';
    return '';
}

// Skipped arrivals the game's own Move screen can still place.
const LEFT_FOR_MOVE_SCREEN = new Set(['full', 'noanswer']);

// The run. deps:
//   facts(id)       -> Promise<facts|null>   (PZ2QoL_SendFacts)
//   move(id)        -> Promise<{ ok, detail }> (ONE request: "trade:arrival")
//   sleep(ms)       -> Promise (should end early on Stop)
//   paceMs()        -> pause after each request (the player's 'moves' pace)
//   online          -> true in a Franchise (or unknown-mode) zoo
//   isStopped()     -> the player pressed Stop
//   onUpdate(state) -> progress
// Log entries: { id, name, ok, already?, reason?, left? } (left: the game's
// own Move screen can still take it).
export async function runTradeArrivals(ids, deps) {
    const d = Object.assign({ online: false, isStopped: () => false, onUpdate: () => {}, paceMs: () => 1500, now: () => Date.now() }, deps);
    const state = { running: true, total: ids.length, index: 0, current: null, log: [], finished: false, stopped: false };
    const update = patch => {
        Object.assign(state, patch);
        try {
            d.onUpdate(Object.assign({}, state, { log: state.log.slice() }));
        }
        catch (e) {
            // progress display must never stop the run
        }
    };
    const skip = (id, f, reason, left) => state.log.push({ id, name: f && f.name || '', ok: false, reason, left: !!left });
    update({});
    for (let i = 0; i < ids.length; i++) {
        if (d.isStopped()) {
            state.stopped = true;
            break;
        }
        const id = String(ids[i]);
        update({ index: i + 1, current: { id, name: '' } });
        let f = await d.facts(id);
        if (f && !f.error && !f.gone && f.lt === 'trade') {
            // already waiting there: nothing to send, no pause
            state.log.push({ id, name: f.name || '', ok: true, already: true });
            update({});
            continue;
        }
        // the game is still busy with a server request: wait for it first
        const busySince = d.now();
        while (f && f.busy && d.now() - busySince < BUSY_WAIT_MS && !d.isStopped()) {
            await d.sleep(BUSY_POLL_MS);
            f = await d.facts(id);
        }
        if (d.isStopped()) {
            state.stopped = true;
            break;
        }
        const code = arrivalSkip(f);
        if (code) {
            // nothing was sent to the game: no pause needed
            skip(id, f, skipText(code), LEFT_FOR_MOVE_SCREEN.has(code));
            update({});
            continue;
        }
        update({ current: { id, name: f.name || '' } });
        let r;
        try {
            r = await d.move(id);
        }
        catch (e) {
            r = { ok: false, detail: String(e && e.message || e) };
        }
        if (!r || !r.ok) {
            const detail = String((r && r.detail) || 'the game refused').replace(/\.$/, '');
            skip(id, f, /refus/i.test(detail) ? detail.charAt(0).toLowerCase() + detail.slice(1) : `refused: ${detail}`, true);
            update({});
            await d.sleep(d.online ? Math.max(ERROR_PAUSE_MS, d.paceMs()) : d.paceMs());
            continue;
        }
        const since = d.now();
        let ok = false;
        for (;;) {
            if (tradeConfirmed(await d.facts(id))) {
                ok = true;
                break;
            }
            // after Stop the sleep returns at once: one last look, then out
            if (d.isStopped() || d.now() - since >= CONFIRM_TIMEOUT_MS) break;
            await d.sleep(CONFIRM_POLL_MS);
        }
        if (!ok && d.isStopped()) {
            skip(id, f, SKIP_TEXT.stopped, true);
            update({});
            break;
        }
        if (!ok) {
            skip(id, f, SKIP_TEXT.unconfirmed, true);
            update({});
            await d.sleep(d.online ? Math.max(ERROR_PAUSE_MS, d.paceMs()) : d.paceMs());
            continue;
        }
        state.log.push({ id, name: f.name || '', ok: true });
        update({});
        await d.sleep(d.paceMs());
    }
    if (d.isStopped()) state.stopped = true;
    update({ running: false, finished: true, current: null });
    return Object.assign({}, state, { log: state.log.slice() });
}

// The end of a run: { total, already, sent, skipped, reasons, leftIds }.
// leftIds: animals the game's own Move screen can still place (refused,
// unconfirmed, no room, and the ones a Stop left untried).
export function tradeSummary(st, ids) {
    const log = (st && st.log) || [];
    const reasons = new Map();
    let already = 0, sent = 0;
    const tried = new Set();
    const left = [];
    for (const e of log) {
        tried.add(String(e.id));
        if (e.ok) {
            if (e.already) already++;
            else sent++;
        }
        else {
            reasons.set(e.reason, (reasons.get(e.reason) || 0) + 1);
            if (e.left) left.push(String(e.id));
        }
    }
    for (const id of ids || []) if (!tried.has(String(id))) left.push(String(id));
    const total = st && Number.isFinite(st.total) ? st.total : log.length;
    return {
        total, already, sent, skipped: log.length - already - sent, untried: total - log.length,
        reasons: Array.from(reasons, ([text, n]) => ({ text, n })).sort((a, b) => b.n - a.n || a.text.localeCompare(b.text)),
        leftIds: left,
    };
}

export function tradeSummaryText(s) {
    const parts = [`${s.already + s.sent} of ${s.total} in or on the way to the trade centre`];
    if (s.skipped) parts.push(`skipped ${s.skipped}`);
    if (s.untried) parts.push(`${s.untried} not tried (stopped)`);
    return parts.join(' · ');
}
