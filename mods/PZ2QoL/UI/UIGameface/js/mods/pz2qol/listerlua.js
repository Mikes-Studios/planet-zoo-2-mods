// Market desk: the page side of the Lua listing engine (Main/pz2qol.lister.lua).
// The engine runs inside Animal Storage, works
// on animal GUIDs and calls the game's own listing function; this module
// asks what it can do, turns storage row keys into GUIDs, starts and stops
// runs, and keeps the engine's latest state for the panels.
import { breadcrumb } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { encodeSeen, normalizeState, readSeen } from '/js/mods/pz2qol/listercore.js';
import { get } from '/js/mods/pz2qol/game.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

const ANSWER_TIMEOUT_MS = 2500;
const CAPS_MAX_AGE_MS = 4000;
const RESOLVE_BATCH = 250;
const WATCH_POLL_MS = 100;     // how often the page reports while the engine selects
const WATCH_MAX_MS = 60000;    // a watch the engine never ends stops by itself
const LATE_ANSWER_MS = 120000; // a start without an answer is still reconciled this long

let installed = false;
let reqSeq = 0;
// request ids unique per page load (a reloaded page must never take a
// running run's state for its own)
const PAGE = Math.random().toString(36).slice(2, 7);
const waiters = new Map();     // req -> resolve(answer)
let caps = null;               // the last capabilities answer
let capsAt = 0;
let capsAsking = null;         // the Hello in flight (asks are shared)
let state = null;              // the engine's latest state (normalizeState)
let ownRuns = new Set();       // reqs of runs this page started
const listeners = new Set();
const guidCache = new Map();   // row key -> { fp, guid, via }
const failCache = new Map();   // row key -> { fp, wait, next }: Lua found no id (backed off)
const RESOLVE_BACKOFF_MS = 5000;
const RESOLVE_BACKOFF_MAX_MS = 120000;
let lastResolveSig = '';
let watch = null;              // { req, key, timer, since, reported }
let logged = { sig: '', results: new Map() }; // the last engine state written to the debug log

// The debug log (debuglog.js): each change of the engine's state, and each
// animal's result as the page first sees it (Lua logs its own side).
function logState(s) {
    try {
        const sig = [s.run, s.req, s.phase, s.index, s.step, s.message, s.refused ? 1 : 0].join('|');
        if (sig !== logged.sig) {
            logged.sig = sig;
            dlog('lister', 'engine_state', { run: s.run, req: s.req, phase: s.phase, index: s.index, total: s.total, step: s.step || undefined, msg: s.message || undefined, refused: s.refused || undefined, own: ownRuns.has(String(s.req)) || undefined });
        }
        (s.results || []).forEach((r, i) => {
            if (!r || r.status === 'pending' || r.status === 'working') return;
            const k = `${s.run}|${r.guid}`;
            const v = `${r.status}|${r.kind}|${r.price}`;
            if (logged.results.get(k) === v) return;
            logged.results.set(k, v);
            if (logged.results.size > 3000) logged.results.clear();
            dlog('lister', 'engine_result', { run: s.run, i: i + 1, guid: r.guid, status: r.status, kind: r.kind || undefined, price: r.price ?? undefined, hours: r.hours ?? undefined, capped: r.capped || undefined, usedDefault: r.usedDefault || undefined, detail: r.detail || undefined });
        });
    }
    catch (e) {
        // the log never breaks the engine view
    }
}

function parse(json) {
    try {
        return typeof json === 'string' ? JSON.parse(json) : json;
    }
    catch (e) {
        return null;
    }
}

function install() {
    if (installed || typeof engine === 'undefined') return;
    installed = true;
    const answer = (req, json) => {
        const fn = waiters.get(String(req));
        if (!fn) return;
        waiters.delete(String(req));
        fn(parse(json));
    };
    engine.on('PZ2QoL_ListerCaps', answer);
    engine.on('PZ2QoL_ListerIds', answer);
    engine.on('PZ2QoL_DeskFiltersState', answer);
    engine.on('PZ2QoL_ListerState', json => {
        const s = normalizeState(parse(json));
        if (!s) return;
        // the engine sends each verdict once: the run's later states carry null for it
        if (state && state.run === s.run) s.results.forEach((r, i) => {
            const before = state.results[i];
            if (r.verdict == null && before && before.guid === r.guid) r.verdict = before.verdict;
        });
        logState(s);
        // a refused start (another run, storage closed) keeps the run shown
        if (!s.refused) state = s;
        // a run that ended: nothing more to watch
        if (!s.refused && s.phase !== 'running') stopWatch();
        notify(s);
    });
    engine.on('PZ2QoL_ListerWatch', (req, key) => startWatch(req, key));
}

// The engine's selection watch (pz2qol.lister.lua _Watch): while it selects
// an animal, report what this page's DataStore shows for it every 100 ms
// (PZ2QoL_ListerSeen). Read only; nothing is sent to the game but the report.
function startWatch(req, key) {
    req = String(req == undefined ? '' : req);
    key = String(key == undefined ? '' : key);
    if (!req || !key) {
        stopWatch();
        return;
    }
    if (watch && watch.req === req && watch.key === key) {
        watch.since = Date.now();   // asked again: keep going
        return;
    }
    stopWatch(true);
    breadcrumb('lister_watch');
    dlog('lister', 'page_watch', { key, req });
    watch = { req, key, since: Date.now(), reported: false, timer: null };
    reportSeen();
    if (watch) watch.timer = setInterval(reportSeen, WATCH_POLL_MS);
}

function stopWatch(quiet = false) {
    if (!watch) return;
    clearInterval(watch.timer);
    if (!quiet) dlog('lister', 'page_watch_end', { key: watch.key, req: watch.req, reported: watch.reported });
    watch = null;
    if (!quiet) breadcrumb('lister_watch_end');
}

function reportSeen() {
    const w = watch;
    if (!w) return;
    if (Date.now() - w.since > WATCH_MAX_MS) {
        stopWatch();
        return;
    }
    try {
        // with this page's id: a quick run stops if another page (a reload) reports
        const text = encodeSeen(Object.assign(readSeen(w.key, get), { page: PAGE }));
        engine.trigger('PZ2QoL_ListerSeen', w.req, text);
        if (!w.reported) {
            w.reported = true;
            breadcrumb('lister_seen');
        }
        // what the page reports, each time it changes (Lua logs what it used)
        if (w.lastText !== text) {
            w.lastText = text;
            dlog('lister', 'page_seen', { key: w.key, req: w.req, text });
        }
    }
    catch (e) {
        stopWatch();
    }
}

function notify(s = state) {
    callAll(listeners, s);
}

function ask(event, args, timeoutMs = ANSWER_TIMEOUT_MS) {
    install();
    if (typeof engine === 'undefined') return Promise.resolve(null);
    const req = `L${PAGE}_${++reqSeq}`;
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            waiters.delete(req);
            resolve(null);
        }, timeoutMs);
        waiters.set(req, v => {
            clearTimeout(timer);
            resolve(v);
        });
        try {
            engine.trigger(event, req, ...args);
        }
        catch (e) {
            clearTimeout(timer);
            waiters.delete(req);
            resolve(null);
        }
    });
}

// What the Lua side can do: { ok, missing, storage, online, rows, running }
// or { ok: false, reason: 'noanswer' } (no answer in time, e.g. storage still loading).
// maxAgeMs: an answer younger than this is used as it is.
export function engineCaps({ force = false, maxAgeMs = CAPS_MAX_AGE_MS } = {}) {
    if (!force && caps && Date.now() - capsAt < maxAgeMs) return Promise.resolve(caps);
    if (capsAsking) return capsAsking;
    const askedAt = Date.now();
    capsAsking = ask('PZ2QoL_ListerHello', []).then(c => {
        const was = caps && caps.ok;
        caps = c && typeof c === 'object' ? c : { ok: false, reason: 'noanswer' };
        capsAt = Date.now();
        capsAsking = null;
        dlog('lister', 'caps', { ok: caps.ok, reason: caps.reason, storage: caps.storage, online: caps.online, rows: caps.rows, running: caps.running, missing: caps.missing && caps.missing.length ? caps.missing : undefined, version: caps.version, ms: capsAt - askedAt });
        if (was !== caps.ok) breadcrumb(caps.ok ? 'lister_engine_ok' : 'lister_engine_off');
        return caps;
    });
    return capsAsking;
}

// The game's own storage filters while the desk is open (pz2qol.lister.lua
// DeskFilters): 'clear' (kept, then reset as the game's Reset all filters
// does) or 'restore' (put back; after a run if one is going). Resolves
// { ok, cleared, detail } or null (no answer in time).
export function deskFilters(action) {
    breadcrumb(`desk_filters_${action}`);
    dlog('desk', 'filters_ask', { action });
    return ask('PZ2QoL_DeskFilters', [String(action)]).then(a => {
        dlog('desk', 'filters_answer', { action, answered: !!a, ok: a ? a.ok : undefined, cleared: a ? a.cleared : undefined, detail: a ? a.detail : undefined });
        return a;
    });
}

export function lastCaps() {
    return caps;
}

// How old the last answer is (Infinity: none yet).
export function capsAgeMs() {
    return caps ? Date.now() - capsAt : Infinity;
}

// Whether runs go through the engine. pageRows: how many storage rows the
// page sees; when it sees some and Lua reads none, Lua cannot read the list.
export function engineUsable(c, pageRows = 0) {
    if (!c || !c.ok || c.storage === false) return false;
    if (pageRows > 0 && !(c.rows > 0)) return false;
    return true;
}

export function engineWhyNot(c, pageRows = 0) {
    if (!c || c.reason === 'noanswer') return "The mod's game-side listing engine did not answer in time (Animal Storage may still be loading).";
    if (Array.isArray(c.missing) && c.missing.length) return `This game version lacks ${c.missing.join(', ')}, which the listing engine calls.`;
    if (c.storage === false) return 'Animal Storage is not open on the game side.';
    if (pageRows > 0 && !(c.rows > 0)) return 'The game-side engine cannot read the storage list yet (it may still be loading).';
    return '';
}

// Row keys -> GUID strings, cached while the row's content stays the same
// (keys are positions: a rebuilt list gives a key another animal). Lua sends
// what each row held when it read the GUID; a GUID is kept only if that is
// still the animal the page read (else the list changed in between).
// rows: [{ key, fp, name, species, gender }]. Returns Map key -> guid, with
// .failed: Set of the keys Lua answered for and could not identify, or
// identified as another animal than the page's row (the desk blocks them
// 'noid'), and .unanswered: Set of the keys in batches Lua did not answer in
// time (unblocked; asked again next time).
// Back-off (in game 2026-10-18 the desk asked the same 59 failing keys every
// second for 10 minutes): a failed key is asked again only when its row
// changed, after a growing wait (5 s doubling to 2 min), or with
// opts.retry (desk open, the storage list changed, Read storage again, a
// List click), which asks Lua about every row again (cached ids too: a list
// change can make a fingerprint or a lossy id ambiguous).
export async function resolveGuids(rows, opts = {}) {
    const retry = !!(opts && opts.retry);
    const now = Date.now();
    const out = new Map();
    out.failed = new Set();
    out.unanswered = new Set();
    const markFailed = r => {
        const f = failCache.get(r.key);
        const wait = f && f.fp === r.fp ? Math.min(RESOLVE_BACKOFF_MAX_MS, f.wait * 2) : RESOLVE_BACKOFF_MS;
        failCache.set(r.key, { fp: r.fp, wait, next: Date.now() + wait });
        // an id it had before no longer counts
        guidCache.delete(r.key);
        out.failed.add(r.key);
    };
    const need = [];
    let backedOff = 0;
    for (const r of rows) {
        const c = guidCache.get(r.key);
        if (c && c.fp === r.fp && !retry) {
            out.set(r.key, c.guid);
            continue;
        }
        const f = failCache.get(r.key);
        if (f && f.fp === r.fp && !retry && now < f.next) {
            out.failed.add(r.key);
            backedOff++;
            continue;
        }
        need.push(r);
    }
    const log = { rows: rows.length, cached: out.size, asked: need.length, got: 0, failed: 0, mismatch: 0, noanswer: 0, backedOff, retry: retry || undefined, via: {}, mismatchKeys: [] };
    for (let i = 0; i < need.length; i += RESOLVE_BATCH) {
        const batch = need.slice(i, i + RESOLVE_BATCH);
        const ans = await ask('PZ2QoL_ListerResolve', [batch.map(r => r.key).join(',')]);
        const ids = ans && ans.ids && typeof ans.ids === 'object' ? ans.ids : null;
        if (!ids) {
            // the later batches are still asked; these keys stay unblocked
            log.noanswer += batch.length;
            for (const r of batch) out.unanswered.add(r.key);
            continue;
        }
        if (Array.isArray(ans.failed)) log.failed += ans.failed.length;
        const held = ans.rows && typeof ans.rows === 'object' ? ans.rows : {};
        const via = ans.via && typeof ans.via === 'object' ? ans.via : {};
        for (const r of batch) {
            const g = ids[r.key];
            if (g == undefined || g === '') {
                // answered without an id: blocked until it is asked again
                markFailed(r);
                continue;
            }
            const h = held[r.key];
            if (!h || h.name !== r.name || h.species !== r.species || Number(h.gender) !== Number(r.gender)) {
                // Lua read another animal at this key (the list changed in between)
                breadcrumb('lister_resolve_mismatch');
                markFailed(r);
                log.mismatch++;
                if (log.mismatchKeys.length < 8) log.mismatchKeys.push(r.key);
                continue;
            }
            const guid = String(g);
            const how = typeof via[r.key] === 'string' ? via[r.key] : 'id';
            guidCache.set(r.key, { fp: r.fp, guid, via: how });
            failCache.delete(r.key);
            out.set(r.key, guid);
            log.via[how] = (log.via[how] || 0) + 1;
            log.got++;
        }
    }
    // logged when Lua was asked (the backed-off keys alone change nothing)
    if (log.asked || !log.cached) {
        const sig = JSON.stringify([log.rows, log.asked, log.got, log.failed, log.mismatch, log.noanswer, log.via]);
        if (sig !== lastResolveSig || log.retry) dlog('lister', 'resolve', Object.assign(log, { mismatchKeys: log.mismatchKeys.length ? log.mismatchKeys : undefined }));
        lastResolveSig = sig;
    }
    return out;
}

export function forgetGuids() {
    guidCache.clear();
    failCache.clear();
}

// Starts a run (the job text from encodeJob). Resolves { ok, message } once
// the engine reports the run (ok) or refused it, or did not answer.
export function startEngineRun(text) {
    install();
    if (typeof engine === 'undefined') return Promise.resolve({ ok: false, message: 'No game-side engine.' });
    const req = `R${PAGE}_${++reqSeq}`;
    ownRuns.add(req);
    breadcrumb('lister_engine_start');
    const lines = String(text || '').split('\n');
    dlog('lister', 'engine_start', { req, head: lines[0], animals: Math.max(0, lines.filter(Boolean).length - 1) });
    return new Promise(resolve => {
        let done = false;
        const off = onEngineState(s => {
            if (done || !s || s.req !== req) return;
            done = true;
            off();
            clearTimeout(timer);
            const ok = !s.refused && (s.phase === 'running' || s.total > 0);
            dlog('lister', 'engine_started', { req, ok, run: s.run, msg: ok ? undefined : s.message });
            resolve({ ok, req, message: ok ? '' : s.message || 'The engine refused the run.' });
        });
        // No answer in time does not mean it did not start:
        // say so, and keep listening; the next state for this request id
        // settles it (logged as engine_started_late; the run card shows it).
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            dlog('lister', 'engine_started', { req, ok: false, pending: true, msg: 'no answer yet' });
            let late = null;
            const offLate = onEngineState(s => {
                if (!s || s.req !== req) return;
                offLate();
                clearTimeout(late);
                const ok = !s.refused && (s.phase === 'running' || s.total > 0);
                breadcrumb(ok ? 'lister_engine_started_late' : 'lister_engine_refused_late');
                dlog('lister', 'engine_started_late', { req, ok, run: s.run, msg: ok ? undefined : s.message });
            });
            late = setTimeout(() => offLate(), LATE_ANSWER_MS);
            off();
            resolve({ ok: false, pending: true, req, message: "The game-side engine has not answered yet; it may still start. Watch the run card before trying again." });
        }, ANSWER_TIMEOUT_MS * 2);
        try {
            engine.trigger('PZ2QoL_ListerStart', req, text);
        }
        catch (e) {
            done = true;
            off();
            clearTimeout(timer);
            resolve({ ok: false, message: String(e && e.message) });
        }
    });
}

export function stopEngineRun() {
    install();
    breadcrumb('lister_engine_stop');
    dlog('lister', 'engine_stop', { run: state ? state.run : undefined, index: state ? state.index : undefined, step: state ? state.step : undefined });
    try {
        engine.trigger('PZ2QoL_ListerStop');
    }
    catch (e) {
        // no engine: nothing runs
    }
}

export function setEnginePace(ms) {
    install();
    dlog('lister', 'engine_pace', { ms: Math.round(ms) });
    try {
        engine.trigger('PZ2QoL_ListerPace', Math.round(ms));
    }
    catch (e) {
        // applied to the next run
    }
}

export function getEngineState() {
    return state;
}

export function engineRunning() {
    return !!state && state.phase === 'running';
}

// Whether the current state belongs to a run this page started.
export function isOwnRun(s = state) {
    return !!s && ownRuns.has(String(s.req));
}

export function onEngineState(fn) {
    install();
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// test hook
export function _resetEngineForTests() {
    caps = null;
    capsAt = 0;
    capsAsking = null;
    state = null;
    ownRuns = new Set();
    guidCache.clear();
    failCache.clear();
    waiters.clear();
    stopWatch(true);
    logged = { sig: '', results: new Map() };
}
