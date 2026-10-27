// Breeding programme: the optimiser settings (Classic or Deep, the Deep
// presets, CPU use; the player's default in every zoo) and the Deep search
// job. One job at a time, owned by this module, not by the board's panel:
// closing the panel or the board leaves it running, a park end drops it.
// Results are kept for the session (the last few), keyed by species,
// programme setting, deep setting and the problem signature
// (kinprogramme.js programmeProblemSig: what the search reads). A stopped
// job can continue: the same rounds give the same plan
// (docs/PLAN-deep-optimiser.md).
import { planProgrammeAsync, programmeLogData } from '/js/mods/pz2qol/kinprogramme.js';
import { getPref, onPrefs, updatePref } from '/js/mods/pz2qol/prefs.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';

// Starts, effort (rounds per start, times Classic's), exact repairs and
// the wall-clock limit (minutes, 0: none). Times measured in Node at 100
// breeders (6-10 s a start); the panel shows the live estimate.
export const DEEP_PRESETS = Object.freeze({
    quick: Object.freeze({ label: 'Quick', starts: 4, effort: 1, repair: 'light', limitMin: 2, auto: true }),
    standard: Object.freeze({ label: 'Standard', starts: 12, effort: 1, repair: 'light', limitMin: 10, auto: true }),
    thorough: Object.freeze({ label: 'Thorough', starts: 32, effort: 1, repair: 'light', limitMin: 20, auto: true }),
    extreme: Object.freeze({ label: 'Extreme', starts: 128, effort: 2, repair: 'light', limitMin: 120, auto: true }),
    marathon: Object.freeze({ label: 'Marathon', starts: 1024, effort: 2, repair: 'light', limitMin: 0, auto: true }),
});
export const PRESET_ORDER = Object.freeze(['quick', 'standard', 'thorough', 'extreme', 'marathon', 'custom']);
export const PRESET_WORDS = Object.freeze({
    quick: 'Fast; usually most of the gain',
    standard: 'The default: on test zoos it reached the proven best plan where Classic fell short',
    thorough: 'Several minutes on big species',
    extreme: 'Long: up to two hours',
    marathon: 'Hours: its strength is the number of starts and their length, until done or Stop',
    custom: 'Your own numbers',
});

// Custom steps (the arrows step through them)
export const CUSTOM_STEPS = Object.freeze({
    starts: Object.freeze([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]),
    effort: Object.freeze([0.5, 1, 2, 4, 8]),
    repair: Object.freeze(['off', 'light', 'strong']),
    limitMin: Object.freeze([1, 2, 5, 10, 30, 60, 180, 480, 0]),
    patience: Object.freeze([0, 1, 2, 4, 8]),   // rounds of 4 starts without a better plan
});
const CUSTOM_DEFAULT = Object.freeze({ starts: 16, effort: 1, repair: 'light', limitMin: 30, patience: 0 });

// Work and rest per slice, in ms (Classic too)
export const CPU_STEPS = Object.freeze({
    gentle: Object.freeze({ label: 'Gentle', sliceMs: 8, restMs: 24 }),
    light: Object.freeze({ label: 'Light', sliceMs: 12, restMs: 12 }),
    normal: Object.freeze({ label: 'Normal', sliceMs: 24, restMs: 4 }),
    full: Object.freeze({ label: 'Full', sliceMs: 30, restMs: 0 }),
});
export const CPU_ORDER = Object.freeze(['gentle', 'light', 'normal', 'full']);
// Auto mode's runs, whatever CPU use says: they come while the player plays,
// and the page's thread is also the game's cursor and frames
export const AUTO_CPU = CPU_STEPS.gentle;

const PREF_KEY = 'progOpt';
const DEFAULTS = Object.freeze({ engine: 'classic', preset: 'standard', cpu: 'normal' });
const CACHE_MAX = 8;

const pick = (list, v, dflt) => (list.includes(v) ? v : dflt);

// The stored choice, clamped to what exists (anything unknown: the default).
// The custom numbers are only kept for the Custom preset, so later changes
// to the presets reach players who use them.
export function normalizeOptimiser(raw) {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {
        engine: pick(['classic', 'deep'], o.engine, DEFAULTS.engine),
        preset: pick(PRESET_ORDER, o.preset, DEFAULTS.preset),
        cpu: pick(CPU_ORDER, o.cpu, DEFAULTS.cpu),
    };
    if (out.preset === 'custom') {
        const c = o.custom && typeof o.custom === 'object' ? o.custom : {};
        out.custom = {};
        for (const k of Object.keys(CUSTOM_DEFAULT)) out.custom[k] = pick(CUSTOM_STEPS[k], c[k], CUSTOM_DEFAULT[k]);
    }
    return out;
}

export function getOptimiser() {
    return normalizeOptimiser(getPref(PREF_KEY));
}

// patch: { engine?, preset?, cpu?, custom? (merged) }; saved as the default,
// merged into what the store holds (another page may have saved since)
export function setOptimiser(patch) {
    updatePref(PREF_KEY, old => {
        const cur = normalizeOptimiser(old);
        const next = Object.assign({}, cur, patch || {});
        if (next.preset === 'custom') next.custom = Object.assign({}, CUSTOM_DEFAULT, cur.custom || {}, (patch && patch.custom) || {});
        else delete next.custom;
        return normalizeOptimiser(next);
    });
    const norm = getOptimiser();
    breadcrumb(`kin_prog_opt_${norm.engine}_${norm.preset}`);
    return norm;
}

export function onOptimiser(fn) {
    return onPrefs(fn);
}

// The deep search's numbers for a choice.
export function deepSettings(opt = getOptimiser()) {
    const p = opt.preset === 'custom' ? Object.assign({}, CUSTOM_DEFAULT, opt.custom || {}) : DEEP_PRESETS[opt.preset] || DEEP_PRESETS.standard;
    return {
        starts: p.starts,
        effort: p.effort,
        repair: p.repair,
        limitMin: p.limitMin,
        patience: p.patience || 0,
        // every preset starts by itself (developer, 2026-10-18): Custom too
        auto: opt.preset === 'custom' ? true : !!p.auto,
    };
}

export function cpuOf(opt = getOptimiser()) {
    return CPU_STEPS[opt.cpu] || CPU_STEPS.normal;
}

// What decides a deep result besides the zoo (CPU use only changes speed)
export function deepKey(opt = getOptimiser()) {
    const d = deepSettings(opt);
    return `${d.starts}|${d.effort}|${d.repair}|${d.limitMin}|${d.patience}`;
}

// The share of the time a CPU setting searches (the rest it leaves the game).
const busyShare = cpu => cpu.sliceMs / (cpu.sliceMs + cpu.restMs);

// A rough run time in seconds at these settings and CPU use: from a start measured earlier
// (msPerStartFor: effort 1, full CPU), else from the Node measurements (the game's UI up to twice as slow).
export function estimateSeconds(breeders, settings, msPerStart = null, cpu = cpuOf()) {
    const per = (msPerStart != null ? msPerStart / 1000 : Math.max(0.2, 0.0016 * breeders * breeders)) * settings.effort / busyShare(cpu);
    const all = per * settings.starts;
    return settings.limitMin > 0 ? Math.min(all, settings.limitMin * 60) : all;
}

export function durationText(sec) {
    if (!(sec >= 0) || !Number.isFinite(sec)) return 'a long time';
    if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
    if (sec < 3600) return `${Math.round(sec / 60)} min`;
    const hrs = sec / 3600;
    return hrs < 10 ? `${Math.round(hrs * 10) / 10} h` : `${Math.round(hrs)} h`;
}

// ------------------------------------------------------------------ jobs

let job = null;                   // the running job, or null
const results = new Map();        // cacheKey -> entry, oldest first
const listeners = new Set();
let lastMsPerStart = new Map();   // species -> ms per start at effort 1 and full CPU (for estimates)

const cacheKey = (species, key, dkey, psig) => `${species}\u0001${key}\u0001${dkey}\u0001${psig}`;

function emit(kind) {
    for (const fn of Array.from(listeners)) {
        try {
            fn(kind, job);
        }
        catch (e) {
            // a listener's business
        }
    }
}

// fn(kind: 'progress' | 'start' | 'done' | 'stopped' | 'cleared', job)
export function onDeep(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function deepJob() {
    return job;
}

export function msPerStartFor(species) {
    return lastMsPerStart.has(species) ? lastMsPerStart.get(species) : null;
}

function remember(entry) {
    const k = cacheKey(entry.species, entry.key, entry.dkey, entry.psig);
    const old = results.get(k);
    if (old && old.r && entry.r && old.r.score > entry.r.score + 1e-9) entry = Object.assign({}, entry, { r: Object.assign({}, old.r, { resume: entry.r.resume, stopped: entry.r.stopped }) });
    results.delete(k);
    results.set(k, entry);
    while (results.size > CACHE_MAX) results.delete(results.keys().next().value);
}

// The kept result for exactly these settings and this zoo, or null.
export function deepResult(species, key, dkey, psig) {
    return results.get(cacheKey(species, key, dkey, psig)) || null;
}

// The latest kept result for these settings whatever the zoo now is (to
// show as "the breeders changed since"), or null.
export function latestDeepResult(species, key, dkey) {
    let found = null;
    for (const e of results.values()) if (e.species === species && e.key === key && e.dkey === dkey) found = e;
    return found;
}

export function dropDeepResults(species) {
    for (const [k, e] of Array.from(results)) if (e.species === species) results.delete(k);
    emit('cleared');
}

// Start a deep search. args: { species, key, dkey, psig, breeders, model,
// info, dest, assignments, options (the programme's own: moveCost, ratio,
// useTradeCentre), warm (Classic's moves for the same key and zoo), resume,
// settings (deepSettings), cpu }. A running job is stopped first (its best
// is kept). -> the job.
export function startDeep(args) {
    if (job) stopDeep();
    const s = args.settings;
    const j = {
        species: args.species, key: args.key, dkey: args.dkey, psig: args.psig, breeders: args.breeders || 0,
        planned: s.starts, done: 0, bestStart: 0, total: null, warmTotal: args.warmTotal != null ? args.warmTotal : null,
        progress: 0, startedAt: Date.now(), msPerStart: null, stopRequested: false, cancelled: false, continued: !!args.resume,
        settings: s,
    };
    job = j;
    breadcrumb(args.resume ? 'kin_prog_deep_continue' : 'kin_prog_deep_start');
    const options = Object.assign({}, args.options, {
        engine: 'deep',
        starts: s.starts,
        effort: s.effort,
        repair: s.repair,
        patience: s.patience,
        wallLimitMs: s.limitMin > 0 ? s.limitMin * 60000 : Infinity,
        warm: args.resume ? null : args.warm || null,
        resume: args.resume || null,
        stop: () => j.stopRequested,
        onStart: info => {
            j.done = info.done;
            j.bestStart = info.bestStart;
            j.total = info.total;
            const fresh = info.done - (args.resume ? args.resume.round * 4 : 0);
            if (fresh > 0) j.msPerStart = Math.round((Date.now() - j.startedAt) / fresh);
            emit('start');
        },
    });
    const cpu = args.cpu || CPU_STEPS.normal;
    planProgrammeAsync(args.model, args.species, args.info || {}, args.dest || null, {
        assignments: args.assignments || null,
        options,
        sliceMs: cpu.sliceMs,
        restMs: cpu.restMs,
        onProgress: v => {
            j.progress = v;
            if (job === j) emit('progress');
        },
        isCancelled: () => j.cancelled,
    }).then(r => {
        if (j.cancelled) return;
        if (job === j) job = null;
        if (j.msPerStart != null) lastMsPerStart.set(j.species, j.msPerStart * busyShare(cpu) / s.effort);
        if (r) {
            remember({ species: j.species, key: j.key, dkey: j.dkey, psig: j.psig, r, stopped: r.stopped || null, resume: r.resume || null, done: r.starts, planned: j.planned, at: Date.now(), warmTotal: j.warmTotal });
            dlog('kin', 'prog_deep_done', Object.assign({ species: j.species, breeders: j.breeders, starts: r.starts, planned: j.planned, bestStart: r.bestStart, stopped: r.stopped || 'no', msPerStart: j.msPerStart, ms: Date.now() - j.startedAt }, programmeLogData(r)));
        }
        breadcrumb(r && r.stopped ? 'kin_prog_deep_stopped' : 'kin_prog_deep_done');
        emit(r && r.stopped ? 'stopped' : 'done');
    }, e => {
        if (job === j) job = null;
        if (!j.cancelled) reportError('ui', 'Species board: the deep search failed', e);
        emit('stopped');
    });
    emit('start');
    return j;
}

// Stop the running job (it ends at its next check with the best so far,
// which is kept and can continue). species: only if it is that species'.
export function stopDeep(species = null) {
    if (!job || (species != null && job.species !== species)) return false;
    job.stopRequested = true;
    breadcrumb('kin_prog_deep_stop');
    emit('progress');
    return true;
}

// Drop the running job without keeping a result (Recompute: the facts it
// read are old). species: only if it is that species'.
export function cancelDeep(species = null) {
    if (!job || (species != null && job.species !== species)) return false;
    job.cancelled = true;
    job = null;
    breadcrumb('kin_prog_deep_cancel');
    emit('cleared');
    return true;
}

// Drop everything (a park ends or another zoo loads: the entity ids of
// this load mean nothing in the next).
export function cancelAllDeep() {
    if (job) job.cancelled = true;
    job = null;
    results.clear();
    lastMsPerStart = new Map();
    emit('cleared');
}

// --------------------------------------------------------------- install

let installed = false;
export function installDeep() {
    if (installed) return;
    installed = true;
    try {
        if (typeof engine !== 'undefined' && engine && typeof engine.on === 'function') {
            // a park started or ended: searches over its animals are moot
            engine.on('PZ2QoL_StoreReset', why => {
                if (why !== 'park') return;
                if (job || results.size) breadcrumb('kin_prog_deep_reset');
                cancelAllDeep();
            });
        }
    }
    catch (e) {
        reportError('mod', 'Breeding programme: deep search reset hook failed', e, { silent: true });
    }
    // what this UI can do (the next step for a faster engine): WebAssembly,
    // Web Workers, cores
    try {
        breadcrumb(typeof WebAssembly === 'object' && WebAssembly && typeof WebAssembly.instantiate === 'function' ? 'wasm_yes' : 'wasm_no');
        breadcrumb(typeof Worker === 'function' ? 'worker_yes' : 'worker_no');
        const cores = typeof navigator !== 'undefined' && navigator ? Number(navigator.hardwareConcurrency) : NaN;
        dlog('kin', 'ui_caps', { wasm: typeof WebAssembly === 'object', worker: typeof Worker === 'function', cores: Number.isFinite(cores) ? cores : 'unknown' });
    }
    catch (e) {
        // only a probe
    }
}

// tests
export function _resetDeepForTests() {
    cancelAllDeep();
    listeners.clear();
}
