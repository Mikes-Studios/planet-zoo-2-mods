// Breeding window: the Breeding programme in a small window where the game
// opens its own info panels (top right).
//
//   setup     where it opens: tick habitats in a list (or the one on the
//             game's panel), then add the species that go in all of them;
//             "Plan" opens a species' programme. The same assignments as
//             the Habitats tab, so a mixed habitat is one list.
//   head      title, the habitat or species (click for the species list), close
//   picker    search, then the species in the zoo, in Animal Storage, and
//             every other species the game knows (its Zoopedia)
//   tabs      Habitats   the habitats set aside for the species; "Pick in
//                        the park" sets one aside by clicking it in the
//                        world (its fence or gate, or an animal in it)
//             Programme  the Breeding programme's plan (Classic optimiser,
//                        the board's settings), and Run
//             Auto mode  the species' Auto mode panel (kinautoui.js)
//
// It takes the info panel's place: opening it closes the game's info panel,
// and a game info panel opening closes it, so the two are never on screen
// together. While picking, the game's panel that a click opens is read
// (InfoPanel_SetContext: the habitat or animal) and closed again.
// The Species board is untouched: this window shares its data (habitat
// assignments, make-up, the programme slider, Auto mode) and closes when
// the board opens.
//
// Gameface: own DOM under <body>, explicit display:flex, no native
// scrolling (kinpanel.js), events from Lua driven from the page's own timer.
import { Sex } from '/js/mods/pz2qol/kincore.js';
import { TRADE, homeOf, placeName, speciesList } from '/js/mods/pz2qol/kinboardcore.js';
import {
    habitatChoices, habitatRows, habitatSpeciesRows, infoPanelTarget, pickedHabitat, programmeSignature, runnableMoves, speciesChoices, staleDeepText,
} from '/js/mods/pz2qol/breedwincore.js';
import { getKinModel, locatePlace, markKinActive, onKin, onKinSettings, requestKinScan } from '/js/mods/pz2qol/kin.js';
import { getPlanRun, onPlanRun, planBlockedReason, requestDestinations, requestSpeciesInfo, runPlan, stopPlan } from '/js/mods/pz2qol/kinmoves.js';
import { PROGRAMME_STEPS, groupRule, planProgrammeAsync, programmeProblemSig, withFreshYoung } from '/js/mods/pz2qol/kinprogramme.js';
import {
    makeupFixed, makeupShort, programmeHabitats, programmeKey, programmeOptions, ratioChoice, saveProgStep, savedProgStep, stepRatioChoice,
} from '/js/mods/pz2qol/progprefs.js';
import {
    AUTO_CPU, CPU_ORDER, CPU_STEPS, CUSTOM_STEPS, DEEP_PRESETS, PRESET_ORDER, PRESET_WORDS, cpuOf, deepJob, deepKey, deepResult, deepSettings, durationText,
    estimateSeconds, getOptimiser, latestDeepResult, msPerStartFor, onDeep, onOptimiser, setOptimiser, startDeep, stopDeep,
} from '/js/mods/pz2qol/kinprogdeep.js';
import { PROGRAMME_TUNING, TUNE_PREF, tuningChoice, tuningCount } from '/js/mods/pz2qol/kinprogtune.js';
import { getAssignments, onAssignments, toggleAssignment, assignmentStorage } from '/js/mods/pz2qol/kinassign.js';
import { getStorageCounts, onStorageCounts, requestStorageCounts } from '/js/mods/pz2qol/tradejump.js';
import { fetchRow } from '/js/mods/pz2qol/storagefetch.js';
import { getPref, setPref, updatePref } from '/js/mods/pz2qol/prefs.js';
import { onUserData } from '/js/mods/pz2qol/userstore.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { HABITAT_SPECIES } from '/js/mods/pz2qol/speciesrules.js';
import { sexSymbol } from '/js/mods/pz2qol/kinui.js';
import {
    btn as kitBtn, closeButton, closeOtherPanels, makeGuard, makeScroll, refreshBars, registerPanel, restoreScroll, speciesName, switchEl as kitSwitch, trunc,
} from '/js/mods/pz2qol/kinpanel.js';
import { clear, crossMark, h, icon, setClass, setText, visibleBox } from '/js/mods/pz2qol/ui.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';

const TICK_MS = 200;
const NOTICE_MS = 8000;
// how long after a park click the game's own panel is closed for us
const CLOSE_GAME_MS = 2500;
// storage counts: species per Lua call (tradejump.lua nMaxSpecies), one call a tick
const STORED_CHUNK = 40;
const STORED_MAX = 320;
const MOVES_SHOWN = 40;

const guard = makeGuard('Breeding window');
const btn = (...args) => kitBtn(guard, ...args);
const switchEl = (...args) => kitSwitch(guard, ...args);

const W = {
    root: null,
    el: {},
    open: false,
    species: null,
    tab: 'habitats',          // habitats | programme | auto
    picker: false,            // the species list is showing
    query: '',
    picking: false,           // "Pick in the park" is on
    setup: null,              // "Choose habitats": { habs: [ids], step: habitats | species }
    notice: null,             // { text, tone, until }
    dest: null,
    prog: null,
    boxes: {},
    scroll: {},
    unsub: [],
    timer: 0,
    queued: false,
    // the game's info panel
    gameShown: false,
    lastCtx: null,
    closeGameUntil: 0,        // close a game info panel that shows before this
    keepUntil: 0,             // a panel we asked for (Show in park) does not close us
    // species the game knows, and which of them are in storage
    storedQueue: [],
    storedAsked: 0,
    autoMod: null,
    autoFailed: false,
};

// ---------------------------------------------------------------- helpers

function notice(text, tone = 'info') {
    W.notice = { text, tone, until: Date.now() + NOTICE_MS };
    renderNotice();
}

function queueRender() {
    if (!W.open || W.queued) return;
    W.queued = true;
    setTimeout(() => {
        W.queued = false;
        if (W.open) renderAll();
    }, 30);
}

function whereName(model, to) {
    return placeName(model, to, destFor(model));
}

function destFor(model) {
    const d = W.dest;
    const tc = (d && d.tradeCentre) || (model && model.tradeCentre) || null;
    if (!d) return tc ? { bySpecies: {}, habitats: [], tradeCentre: tc } : null;
    return d.tradeCentre || !tc ? d : Object.assign({}, d, { tradeCentre: tc });
}

function speciesAnimals(model, species) {
    const out = [];
    if (!model || !species) return out;
    for (const a of model.animals.values()) if (a.species === species && !a.exhibit) out.push(a);
    return out;
}

function countsText(m, f, young = 0) {
    const bits = [];
    if (m) bits.push(`${m} ♂`);
    if (f) bits.push(`${f} ♀`);
    if (young) bits.push(`${young} young`);
    return bits.join(' · ');
}

// Animal Storage counts known so far: Map species -> { m, f }
function storedCounts(zoo) {
    const stored = new Map();
    for (const sp of new Set(zoo.map(s => s.species).concat(HABITAT_SPECIES))) {
        const v = getStorageCounts(sp);
        if (v) stored.set(sp, v);
    }
    return stored;
}

function assignedCounts(model) {
    const out = new Map();
    for (const [, set] of getAssignments(model)) for (const sp of set || []) out.set(sp, (out.get(sp) || 0) + 1);
    return out;
}

// ---------------------------------------------------- the game's info panel

function closeGamePanel() {
    try {
        engine.trigger('InfoPanel_UI_Close');
    }
    catch (e) {
        // no engine (tests)
    }
}

function onSetContext(ctx) {
    W.lastCtx = Array.isArray(ctx) ? ctx.slice() : null;
    if (!W.open) return;
    if (W.picking) {
        W.closeGameUntil = Date.now() + CLOSE_GAME_MS;
        // handled on the next tick (not inside the game's event)
        W.pickCtx = W.lastCtx;
    }
}

function onPanelShow() {
    W.gameShown = true;
    if (!W.open) return;
    const now = Date.now();
    if (W.picking || now < W.keepUntil) {
        W.closeGameUntil = Math.max(W.closeGameUntil, now + CLOSE_GAME_MS);
        return;
    }
    // the player opened something else: it takes the window's place
    W.yieldPending = true;
}

function onPanelHide() {
    W.gameShown = false;
}

function listen(name, fn) {
    engine.on(name, (...args) => {
        try {
            fn(...args);
        }
        catch (e) {
            reportError('ui', `Breeding window: ${name} failed`, e, { silent: true });
        }
    });
}

let eventsOn = false;
function installEvents() {
    if (eventsOn || typeof engine === 'undefined') return;
    eventsOn = true;
    listen('InfoPanel_SetContext', onSetContext);
    listen('InfoPanel_Show', onPanelShow);
    listen('InfoPanel_Hide', onPanelHide);
}

// ------------------------------------------------------------ picking

function startPicking() {
    if (!W.species) return;
    W.picking = true;
    breadcrumb('bw_pick_on');
    if (W.gameShown) closeGamePanel();
    renderAll();
}

function stopPicking() {
    if (!W.picking) return;
    W.picking = false;
    W.pickCtx = null;
    renderAll();
}

function handlePick(ctx) {
    const model = getKinModel();
    const species = W.species;
    if (!species) return;
    const p = pickedHabitat(ctx, model);
    // debug builds: which panel kinds a park click really opens
    dlog('kin', 'bw_pick', { kind: String(ctx && ctx[1]), id: String(ctx && ctx[2]), hab: p.hab || '', error: p.error ? 1 : 0 });
    if (p.error) {
        breadcrumb('bw_pick_miss');
        notice(p.error, 'warn');
        return;
    }
    const name = p.name || whereName(model, p.hab);
    const set = getAssignments(model).get(String(p.hab));
    if (set && set.has(species)) {
        notice(`${name} is already set aside for ${speciesName(species)}.`, 'info');
        return;
    }
    toggleAssignment(model, p.hab, species, name);
    breadcrumb(p.via === 'animal' ? 'bw_pick_animal' : 'bw_pick_habitat');
    const others = set ? Array.from(set).filter(x => x !== species) : [];
    notice(`${name}: set aside for ${speciesName(species)}${others.length ? ` (with ${others.map(speciesName).join(', ')})` : ''}.${assignmentStorage() === 'memory' ? ' Kept until you close the game.' : ''}`, 'ok');
    // the habitat checks for a new habitat
    loadDest(true);
    renderAll();
}

// --------------------------------------------------- choose habitats

function clearSearch() {
    W.query = '';
    if (W.el.search) W.el.search.value = '';
}

// hab: a habitat to open on (its species step), or null for the habitat list
function startSetup(hab = null) {
    W.setup = { habs: hab ? [String(hab)] : [], step: hab ? 'species' : 'habitats' };
    W.picker = false;
    W.picking = false;
    W.scroll = {};
    clearSearch();
    breadcrumb('bw_setup_on');
    if (W.gameShown) closeGamePanel();
    openPickerData();
    renderAll();
}

function setupStep(step) {
    W.setup.step = step;
    W.scroll = {};
    clearSearch();
    renderAll();
}

function toggleSetupHabitat(hab) {
    const habs = W.setup.habs;
    W.setup.habs = habs.includes(hab) ? habs.filter(x => x !== hab) : habs.concat(hab);
    renderAll();
}

// the chosen habitats: [{ hab, name, species, animals }]
function setupHabitats(model) {
    const chosen = new Set(W.setup.habs);
    return habitatChoices(model, getAssignments(model)).filter(r => chosen.has(r.hab));
}

function setupWhere(habs) {
    return habs.length === 1 ? habs[0].name : `${habs.length} habitats`;
}

// add: set aside in every chosen habitat, else in none of them
function setSetupSpecies(model, species, add) {
    const habs = setupHabitats(model);
    const assignments = getAssignments(model);
    for (const x of habs) {
        if ((assignments.get(x.hab) || new Set()).has(species) !== add) toggleAssignment(model, x.hab, species, x.name);
    }
    breadcrumb(add ? 'bw_setup_add' : 'bw_setup_remove');
    if (add) notice(`${speciesName(species)} goes in ${setupWhere(habs)}.${assignmentStorage() === 'memory' ? ' Kept until you close the game.' : ''}`, 'ok');
    else notice(`${speciesName(species)} taken off ${setupWhere(habs)}.`, 'info');
    renderAll();
}

function openSpeciesProgramme(species) {
    W.setup = null;
    W.picking = false;
    clearSearch();
    chooseSpecies(species);
    W.tab = 'programme';
    renderAll();
}

// ------------------------------------------------------------ species

function chooseSpecies(species) {
    W.setup = null;
    const sp = species ? String(species) : null;
    if (sp === W.species) {
        W.picker = false;
        renderAll();
        return;
    }
    W.species = sp;
    W.picker = false;
    W.picking = false;
    clearSearch();
    W.prog = null;
    W.scroll = {};
    const model = getKinModel();
    // a species with nothing set aside starts on its habitats
    const assigned = sp && model ? Array.from(getAssignments(model).values()).some(s => s && s.has(sp)) : false;
    W.tab = sp && assigned && speciesAnimals(model, sp).length ? 'programme' : 'habitats';
    breadcrumb('bw_species');
    if (sp) requestStorageCounts([sp]);
    loadDest(false);
    renderAll();
}

// Storage counts for every species the game knows, a chunk a tick (the
// species in the zoo first). Asked once per picker opening (tradejump.js
// keeps answers 60 s).
function askStored(list) {
    const seen = new Set();
    const q = [];
    for (const sp of list) if (sp && !seen.has(sp)) {
        seen.add(sp);
        q.push(sp);
    }
    W.storedQueue = q.slice(0, STORED_MAX);
}

function openPicker() {
    W.picker = !W.picker || !W.species || !!W.setup;
    W.picking = false;
    if (W.setup) {
        W.setup = null;
        clearSearch();
    }
    if (W.picker) {
        breadcrumb('bw_picker');
        openPickerData();
    }
    renderAll();
    if (W.picker && W.el.search) setTimeout(() => {
        try {
            W.el.search.focus();
        }
        catch (e) {
            // no focus here
        }
    }, 0);
}

// ------------------------------------------------------- destinations

function loadDest(force) {
    const model = getKinModel();
    const ids = speciesAnimals(model, W.species).map(a => a.id);
    if (!ids.length) return;
    const sp = W.species;
    requestDestinations(ids, { force }).then(d => {
        if (d) W.dest = d;
        if (W.species === sp) queueRender();
    }, () => {});
}

// ----------------------------------------------------------- programme

function habitatsToDescribe(model, species) {
    return programmeHabitats(model, species, W.dest, getAssignments(model));
}

const habsKey = habs => habs.slice().sort().join(',');

// A habitat built, completed or found suitable after the game's facts were
// read would be planned with a guessed room: when the habitats change and
// one of them has no facts, the game is asked again and the plan redone.
function refreshFacts(p, model) {
    const habs = habitatsToDescribe(model, p.species);
    const key = habsKey(habs);
    if (key === p.factsFor) return;
    p.factsFor = key;
    const known = (p.info && p.info.habitats) || {};
    if (!habs.some(hb => !known[hb])) return;
    breadcrumb('bw_programme_facts_again');
    requestSpeciesInfo(p.species, habs).then(info => {
        if (W.prog !== p || !info || typeof info !== 'object' || info.error) return;
        p.info = info;
        p.infoError = '';
        if (p.job) p.job.cancelled = true;
        p.job = null;
        p.resultKey = '';
        p.problem = null;
        queueRender();
    }, e => reportError('mod', 'Breeding window: species facts failed', e, { silent: true }));
}

// The programme for the window's species: the game's facts first, then the
// Classic optimiser in slices (the page stays responsive), again whenever
// the species' animals, its habitats set aside or the settings change.
function ensureProgramme(model) {
    const species = W.species;
    if (!species || !model) return null;
    let p = W.prog;
    if (!p || p.species !== species) {
        p = W.prog = { species, state: 'loading', info: null, infoError: '', step: savedProgStep(), useTrade: true, sig: '', key: '', result: null, resultKey: '', job: null, error: null, factsFor: '' };
        const ids = speciesAnimals(model, species).map(a => a.id);
        const ready = ids.length ? requestDestinations(ids).then(d => {
            if (d) W.dest = d;
        }, () => {}) : Promise.resolve();
        ready.then(() => {
            const habs = habitatsToDescribe(getKinModel() || model, species);
            p.factsFor = habsKey(habs);
            return requestSpeciesInfo(species, habs);
        }).then(info => {
            if (W.prog !== p) return;
            p.info = info && typeof info === 'object' && !info.error ? info : null;
            p.infoError = info && info.error ? String(info.error) : '';
            p.state = 'ready';
            queueRender();
        }, e => {
            reportError('mod', 'Breeding window: species facts failed', e, { silent: true });
            if (W.prog !== p) return;
            p.state = 'ready';
            queueRender();
        });
        return p;
    }
    if (p.state !== 'ready') return p;
    refreshFacts(p, model);
    const assignments = getAssignments(model);
    const key = `${programmeKey(p)}#${programmeSignature(model, species, assignments)}`;
    if (p.resultKey === key || (p.job && p.job.key === key)) return p;
    if (p.job) p.job.cancelled = true;
    const job = { key, progress: 0, cancelled: false };
    p.job = job;
    const options = programmeOptions(p);
    // it starts by itself as the zoo changes: the gentle pace, the player plays meanwhile
    const cpu = AUTO_CPU;
    const live = () => !job.cancelled && W.prog === p;
    breadcrumb('bw_programme_search');
    planProgrammeAsync(model, species, p.info || {}, destFor(model), {
        assignments,
        options,
        sliceMs: cpu.sliceMs,
        restMs: cpu.restMs,
        onProgress: v => {
            job.progress = v;
            if (live()) renderProgress(v);
        },
        isCancelled: () => !live(),
    }).then(r => {
        if (!live()) return;
        p.job = null;
        p.error = null;
        p.result = r || null;
        p.resultKey = key;
        queueRender();
    }, e => {
        if (!live()) return;
        p.job = null;
        p.error = e;
        p.result = null;
        p.resultKey = key;
        reportError('ui', 'Breeding window: the breeding programme failed', e);
        queueRender();
    });
    return p;
}

// What the tab shows: Classic's plan, or a deep result for the same
// settings (exact, or the latest one: stale). { r, kind, entry, stale, classic }
function problemSigFor(p, model) {
    const key = programmeKey(p);
    if (p.problem && p.problem.model === model && p.problem.key === key) return p.problem.sig;
    let sig = '';
    try {
        sig = programmeProblemSig(model, p.species, p.info || {}, destFor(model), { assignments: getAssignments(model), options: programmeOptions(p) });
    }
    catch (e) {
        reportError('mod', 'Breeding window: deep search signature failed', e, { silent: true });
    }
    p.problem = { model, key, sig };
    return sig;
}

function programmeView(model) {
    const p = W.prog;
    if (!p || p.state !== 'ready') return null;
    const classic = p.result;
    const opt = getOptimiser();
    if (opt.engine !== 'deep') return { r: classic, kind: 'classic', entry: null, stale: false, classic };
    const key = programmeKey(p), dkey = deepKey(opt);
    const sig = problemSigFor(p, model);
    const exact = deepResult(p.species, key, dkey, sig);
    const entry = exact || latestDeepResult(p.species, key, dkey);
    if (entry && entry.r) return { r: withFreshYoung(entry.r, classic), kind: 'deep', entry, stale: !exact, classic };
    return { r: classic, kind: 'classic', entry: null, stale: false, classic };
}

const breedersOf = r => (r && r.before ? r.before.breedingPairs * 2 + r.before.idle : 0);

function runDeep(p, model, { resume = null, auto = false } = {}) {
    const classic = p.result;
    if (!classic || p.job) return false;
    const opt = getOptimiser();
    breadcrumb(auto ? 'bw_deep_auto' : 'bw_deep_run');
    startDeep({
        species: p.species, key: programmeKey(p), dkey: deepKey(opt), psig: problemSigFor(p, model), breeders: breedersOf(classic),
        model, info: p.info || {}, dest: destFor(model), assignments: getAssignments(model), options: programmeOptions(p),
        warm: classic.moves, warmTotal: classic.score, resume, settings: deepSettings(opt), cpu: auto ? AUTO_CPU : cpuOf(opt),
    });
    renderAll();
    return true;
}

// Deep starts by itself with the saved settings (as on the board), once
// per setting and zoo, 1 s after the last change, never over a running job.
function maybeAutoDeep(p, model, view) {
    const opt = getOptimiser();
    if (opt.engine !== 'deep' || !deepSettings(opt).auto) return;
    if (!view || view.kind === 'deep' || !view.classic || view.classic.exact || p.job || deepJob()) return;
    const want = `${programmeKey(p)}|${deepKey(opt)}|${problemSigFor(p, model)}`;
    if (p.autoDone === want || p.autoWant === want) return;
    if (p.autoTimer) clearTimeout(p.autoTimer);
    p.autoWant = want;
    p.autoTimer = setTimeout(guard('Deep auto', () => {
        p.autoTimer = 0;
        p.autoWant = '';
        const m = getKinModel();
        if (W.prog !== p || !m || deepJob()) return;
        if (`${programmeKey(p)}|${deepKey(getOptimiser())}|${problemSigFor(p, m)}` !== want) return;
        if (runDeep(p, m, { auto: true })) p.autoDone = want;
        else queueRender();
    }), 1000);
}

function gainText(total, classicTotal, suffix = '') {
    if (total == null || classicTotal == null || !(total > classicTotal + 1e-9)) return '';
    if (classicTotal > 0) return `+${(Math.round((total - classicTotal) / classicTotal * 1000) / 10).toFixed(1)} % over Classic${suffix}`;
    return `better than Classic${suffix}`;
}

function deepProgressText(j) {
    const bits = [`start ${Math.min(j.planned, j.done + 1)} of ${j.planned}`];
    const gain = gainText(j.total, j.warmTotal, ' so far');
    if (gain) bits.push(gain);
    if (j.msPerStart != null) {
        let left = (j.planned - j.done) * j.msPerStart / 1000;
        const lim = j.settings.limitMin > 0 ? j.settings.limitMin * 60 - (Date.now() - j.startedAt) / 1000 : Infinity;
        left = Math.max(0, Math.min(left, lim));
        bits.push(`~${durationText(left)} left`);
    }
    return j.stopRequested ? 'Stopping: finishing the current step…' : `Deep search · ${bits.join(' · ')}`;
}

function renderDeepProgress() {
    const j = deepJob();
    if (!W.root || !W.open || !j) return;
    const pct = `${Math.round(Math.max(0, Math.min(1, j.progress || 0)) * 100)}%`;
    for (const n of W.root.querySelectorAll('.PZ2QoL_bwDeepFill')) n.style.width = pct;
    for (const n of W.root.querySelectorAll('.PZ2QoL_bwDeepText.live')) setText(n, deepProgressText(j));
}

// The deep search's line: running, stopped, done, stale, or its Run button.
function deepEl(p, model, view) {
    const opt = getOptimiser();
    if (opt.engine !== 'deep') return null;
    const j = deepJob();
    const settings = deepSettings(opt);
    const key = programmeKey(p), dkey = deepKey(opt);
    const mine = !!j && j.species === p.species && j.key === key && j.dkey === dkey;
    const row = (cls, ...kids) => h(`div.PZ2QoL_bwDeep.${cls}`, null, ...kids);
    if (mine) {
        const pct = `${Math.round(Math.max(0, Math.min(1, j.progress || 0)) * 100)}%`;
        return row('running',
            h('div.PZ2QoL_bwDeepText.live', { text: deepProgressText(j) }),
            h('div.PZ2QoL_bwBar', null, h('div.PZ2QoL_bwDeepFill.PZ2QoL_bwBarFill', { style: { width: pct } })),
            btn(j.stopRequested ? 'Stopping…' : 'Stop', null, () => { stopDeep(p.species); renderAll(); }, { cls: j.stopRequested ? 'small.disabled' : 'small.stop', title: 'End the deep search now and keep the best plan it found' }));
    }
    const classic = view && view.classic;
    if (classic && classic.exact && !(view && view.kind === 'deep')) {
        return row('exact', h('div.PZ2QoL_bwDeepText', { text: 'Classic already scored every layout: this is the best plan there is.' }));
    }
    const ready = !!classic && !p.job;
    const est = durationText(estimateSeconds(breedersOf(classic), settings, msPerStartFor(p.species)));
    const runBtn = (label, resume = null) => btn(label, null, () => runDeep(p, model, { resume }), { cls: ready ? 'small.primary' : 'small.disabled' });
    const other = j && !mine ? `Another deep search is running (${trunc(speciesName(j.species), 16)}, ${Math.round((j.progress || 0) * 100)} %). ` : '';
    const e = view && view.kind === 'deep' ? view.entry : null;
    if (e) {
        const gain = gainText(e.r.score, e.warmTotal) || 'the same as Classic';
        if (view.stale) return row('stale', h('div.PZ2QoL_bwDeepText', { text: `${other}${staleDeepText(view)} Run it again to run its moves.` }), runBtn('Run again'));
        if (e.stopped && e.resume) return row('stopped', h('div.PZ2QoL_bwDeepText', { text: `${other}Deep stopped after ${e.done} of ${e.planned} starts · ${gain}.` }), runBtn('Continue', e.resume));
        return row('done', h('div.PZ2QoL_bwDeepText', { text: `${other}Deep · ${e.done} start${e.done === 1 ? '' : 's'} · ${gain}` }));
    }
    const wait = settings.auto && !j ? 'Deep starts in a moment. ' : '';
    return row('idle', h('div.PZ2QoL_bwDeepText', { text: `${other || wait}This plan is Classic's.` }), runBtn(`Run deep (~${est})`));
}

function renderProgress(v) {
    if (!W.root) return;
    const pct = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
    for (const n of W.root.querySelectorAll('.PZ2QoL_bwBusyFill')) n.style.width = pct;
    for (const n of W.root.querySelectorAll('.PZ2QoL_bwBusyPct')) setText(n, pct);
}

function runProgramme() {
    const model = getKinModel();
    const p = W.prog;
    const view = programmeView(model);
    const r = view && view.r;
    if (!model || !p || !r) return;
    const blocked = planBlockedReason(model);
    if (blocked) return notice(blocked, 'warn');
    const stale = staleDeepText(view);
    if (stale) return notice(`${stale} Run the deep search again first (or switch the optimiser to Classic in More options).`, 'warn');
    const plan = runnableMoves(model, r.moves);
    if (!plan.length) return notice('Nothing to move: the groups are already the best the optimiser found.', 'ok');
    // a deep search of this species stops (its best is kept)
    const dj = deepJob();
    if (dj && dj.species === p.species) stopDeep(dj.species);
    breadcrumb('bw_programme_run');
    W.ranFor = p.species;
    runPlan(plan, { destinations: destFor(model), owner: 'window' }).then(r => {
        if (r && r.ok === false && r.detail && !getPlanRun().finished) notice(r.detail, 'bad');
        queueRender();
    }, e => {
        reportError('mod', 'Breeding window: the plan could not run', e);
        queueRender();
    });
    renderAll();
}

// ------------------------------------------------------------- render

function ensureRoot() {
    if (W.root && W.root.parentNode) return W.root;
    const el = W.el = {};
    el.title = h('div.PZ2QoL_bwTitle', { text: 'Breeding programme' });
    el.speciesName = h('span.PZ2QoL_bwSpeciesName');
    el.speciesMeta = h('span.PZ2QoL_bwSpeciesMeta');
    el.speciesBtn = h('div.PZ2QoL_bwSpecies', {
        title: 'Pick another species',
        onClick: guard('Species', openPicker),
    }, h('div.PZ2QoL_bwSpeciesText', null, el.speciesName, el.speciesMeta), h('div.PZ2QoL_bwChevron'));
    el.head = h('div.PZ2QoL_bwHead', null,
        h('div.PZ2QoL_bwPattern'),
        h('div.PZ2QoL_bwHeadRow', null,
            h('div.PZ2QoL_bwLogo', null, icon('Icon_Heart', 'white', 'sm')),
            h('div.PZ2QoL_bwTitles', null, el.title, el.speciesBtn),
            closeButton(guard, 'Close (Esc)', () => closeBreedingWindow(), true)));
    el.search = h('input.PZ2QoL_bwSearch', { type: 'text', placeholder: 'Search every species…', maxlength: '40' });
    el.search.addEventListener('input', () => {
        clearTimeout(W.searchTimer);
        W.searchTimer = setTimeout(() => {
            W.query = el.search.value || '';
            renderAll();
        }, 200);
    });
    // typing goes to the box, not to the game's shortcuts (Esc still closes)
    el.search.addEventListener('keydown', e => {
        if (e.key !== 'Escape' && e.keyCode !== 27) e.stopPropagation();
    });
    el.searchRow = h('div.PZ2QoL_bwSearchRow', null, h('div.PZ2QoL_bwSearchIcon'), el.search);
    el.tabs = h('div.PZ2QoL_bwTabs');
    el.body = h('div.PZ2QoL_kb.PZ2QoL_bwBody');
    el.notice = h('div.PZ2QoL_bwNotice.hidden');
    const root = h('div.PZ2QoL_bw.hidden', null, el.head, el.searchRow, el.tabs, el.body, el.notice);
    root.addEventListener('mousedown', e => e.stopPropagation());
    root.addEventListener('click', e => e.stopPropagation());
    root.addEventListener('dragstart', e => e.preventDefault());
    root.addEventListener('wheel', e => {
        e.preventDefault();
        e.stopPropagation();
    });
    document.body.appendChild(root);
    W.root = root;
    return root;
}

function renderHead(model) {
    const el = W.el;
    if (W.setup) {
        const habs = setupHabitats(model);
        if (W.setup.step !== 'species' || !habs.length) {
            setText(el.speciesName, 'Choose habitats');
            setText(el.speciesMeta, habs.length ? `${habs.length} ticked` : 'tick the ones to set up');
            return;
        }
        setText(el.speciesName, trunc(setupWhere(habs), 26));
        setText(el.speciesMeta, habs.length === 1 ? `${habs[0].species.length} species` : trunc(habs.map(x => x.name).join(', '), 40));
        return;
    }
    if (!W.species) {
        setText(el.speciesName, 'Choose a species');
        setText(el.speciesMeta, '');
        return;
    }
    setText(el.speciesName, trunc(speciesName(W.species), 26));
    const list = speciesAnimals(model, W.species).filter(a => a.alive !== false);
    const m = list.filter(a => a.sex === Sex.Male && !a.juv).length;
    const f = list.filter(a => a.sex === Sex.Female && !a.juv).length;
    const y = list.filter(a => a.juv).length;
    const c = getStorageCounts(W.species);
    const bits = [];
    bits.push(list.length ? countsText(m, f, y) : 'none in the zoo');
    if (c && c.m + c.f > 0) bits.push(`${c.m + c.f} in storage`);
    setText(el.speciesMeta, bits.join(' · '));
}

function renderTabs(model) {
    const el = W.el;
    clear(el.tabs);
    const hide = W.picker || !W.species || !!W.setup;
    setClass(el.tabs, 'hidden', hide);
    if (hide) return;
    const n = Array.from(getAssignments(model).values()).filter(s => s && s.has(W.species)).length;
    let autoText = 'Auto mode';
    if (W.autoMod && W.autoMod.autoButtonInfo) {
        try {
            const b = W.autoMod.autoButtonInfo(W.species);
            if (b && b.on) autoText = b.text;
        }
        catch (e) {
            // the plain label
        }
    }
    const tab = (id, label) => h(`div.PZ2QoL_bwTab${W.tab === id ? '.on' : ''}`, {
        'data-tab': id,
        onClick: guard('Tab', () => {
            W.tab = id;
            W.picking = id === 'habitats' && W.picking;
            renderAll();
        }),
    }, h('span', { text: label }));
    el.tabs.appendChild(tab('habitats', n ? `Habitats (${n})` : 'Habitats'));
    el.tabs.appendChild(tab('programme', 'Programme'));
    if (!W.autoFailed) el.tabs.appendChild(tab('auto', trunc(autoText, 18)));
}

function renderNotice() {
    const n = W.el.notice;
    if (!n) return;
    const v = W.notice && Date.now() < W.notice.until ? W.notice : null;
    setClass(n, 'hidden', !v);
    if (!v) return;
    n.className = `PZ2QoL_bwNotice tone_${v.tone}`;
    setText(n, v.text);
}

function renderAll() {
    if (!W.open || !W.root) return;
    try {
        const model = getKinModel();
        renderHead(model);
        setClass(W.el.searchRow, 'hidden', !(W.picker || W.setup));
        renderTabs(model);
        const body = W.el.body;
        clear(body);
        W.boxes = {};
        if (W.setup) body.appendChild(setupEl(model));
        else if (W.picker || !W.species) body.appendChild(pickerEl(model));
        else if (W.tab === 'programme') body.appendChild(programmeEl(model));
        else if (W.tab === 'auto') body.appendChild(autoEl(model));
        else body.appendChild(habitatsEl(model));
        renderNotice();
        setTimeout(() => refreshBars(W.boxes), 0);
    }
    catch (e) {
        reportError('ui', 'Breeding window: drawing failed', e);
    }
}

function scrollBox(key) {
    const box = makeScroll(`bwScroll.${key}`, { onScroll: (x, y) => { W.scroll[key] = y; } });
    W.boxes[key] = box;
    return box;
}

function finishScroll(box, key) {
    restoreScroll(box, 0, W.scroll[key] || 0);
    return box.wrap;
}

function empty(title, text, ...actions) {
    return h('div.PZ2QoL_bwEmpty', null,
        h('div.PZ2QoL_bwEmptyTitle', { text: title }),
        text ? h('div.PZ2QoL_bwEmptyText', { text }) : null,
        actions.length ? h('div.PZ2QoL_bwEmptyActions', null, ...actions) : null);
}

function section(title, ...kids) {
    return h('div.PZ2QoL_bwSection', null,
        h('div.PZ2QoL_bwSectionTitle', { text: title }),
        ...kids);
}

// --------------------------------------------------------- the picker

function pickerEl(model) {
    const box = scrollBox('picker');
    const c = box.content;
    const zoo = speciesList(model);
    const stored = storedCounts(zoo);
    const ch = speciesChoices({ zoo, stored, catalogue: HABITAT_SPECIES, assigned: assignedCounts(model), query: W.query, nameOf: speciesName });
    const rowEl = r => {
        const bits = [];
        if (r.zoo) bits.push(`${countsText(r.males, r.females) || r.zoo} in the zoo`);
        if (r.stored) bits.push(`${r.stored} in storage`);
        if (r.assigned) bits.push(`${r.assigned} habitat${r.assigned === 1 ? '' : 's'} set aside`);
        return h(`div.PZ2QoL_bwPick${r.species === W.species ? '.on' : ''}`, {
            'data-species': r.species,
            onClick: guard('Choose species', () => chooseSpecies(r.species)),
        },
            h('div.PZ2QoL_bwPickName', { text: trunc(r.name, 30) }),
            h('div.PZ2QoL_bwPickMeta', { text: bits.join(' · ') || 'not in your zoo or storage' }));
    };
    if (ch.zoo.length) c.appendChild(section('In your zoo', ...ch.zoo.map(rowEl)));
    if (ch.stored.length) c.appendChild(section('In Animal Storage', ...ch.stored.map(rowEl)));
    if (ch.other.length) c.appendChild(section('Every other species', ...ch.other.map(rowEl), ch.more ? h('div.PZ2QoL_bwHint', { text: `${ch.more} more: type more of the name.` }) : null));
    if (!ch.zoo.length && !ch.stored.length && !ch.other.length) {
        c.appendChild(empty(W.query ? 'No species found' : 'No animals yet',
            W.query ? 'No species name matches the search.' : 'Type a species name to search every species the game knows.'));
    }
    else if (!W.query) {
        c.appendChild(h('div.PZ2QoL_bwHint', { text: 'Type to search every species the game knows.' }));
    }
    return h('div.PZ2QoL_bwPane', null,
        h('div.PZ2QoL_bwActions', null,
            btn('Choose habitats', null, () => startSetup(), { cls: 'primary.wide', title: 'Tick habitats in a list, then add the species that go in them' })),
        finishScroll(box, 'picker'));
}

// ---------------------------------------------------- choose habitats

function setupHabitatsEl(model) {
    const n = W.setup.habs.length;
    const q = W.query.trim().toLowerCase();
    const rows = habitatChoices(model, getAssignments(model)).filter(r => !q || r.name.toLowerCase().includes(q));
    const box = scrollBox('setupHabs');
    const c = box.content;
    for (const r of rows) {
        const meta = [r.species.length ? r.species.slice(0, 2).map(s => trunc(speciesName(s), 18)).join(', ') + (r.species.length > 2 ? '…' : '') : 'nothing set aside'];
        meta.push(r.animals ? `${r.animals} animal${r.animals === 1 ? '' : 's'}` : 'empty');
        c.appendChild(h(`div.PZ2QoL_bwPick${W.setup.habs.includes(r.hab) ? '.on' : ''}`, {
            'data-hab': r.hab,
            onClick: guard('Choose habitat', () => toggleSetupHabitat(r.hab)),
        },
            h('div.PZ2QoL_bwPickName', { text: trunc(r.name, 30) }),
            h('div.PZ2QoL_bwPickMeta', { text: meta.join(' · ') })));
    }
    if (!rows.length) c.appendChild(h('div.PZ2QoL_bwHint', { text: q ? 'No habitat name matches the search.' : 'No habitats found in this zoo yet.' }));
    return h('div.PZ2QoL_bwPane', null,
        h('div.PZ2QoL_bwActions', null,
            btn(n ? `Next: species for ${n} habitat${n === 1 ? '' : 's'}` : 'Tick one or more habitats', null, () => { if (n) setupStep('species'); },
                { cls: `primary.wide${n ? '' : '.disabled'}`, title: 'Add the species that go in the ticked habitats' })),
        finishScroll(box, 'setupHabs'));
}

// n: habitats chosen; r.count: how many of them have the species
function setupRow(model, r, n) {
    const meta = [];
    if (r.count && r.count < n) meta.push(`in ${r.count} of ${n}`);
    const here = countsText(r.here.m, r.here.f, r.here.young);
    if (here) meta.push(`${here} here now`);
    if (r.zoo) meta.push(`${r.zoo} in the zoo`);
    if (r.stored) meta.push(`${r.stored} in storage`);
    const add = h('div.PZ2QoL_bwIconBtn.add', {
        title: n === 1 ? `${r.name} goes here` : `${r.name} goes in all ${n}`,
        onClick: guard('Add species', () => setSetupSpecies(model, r.species, true)),
    }, h('div.PZ2QoL_bwPlusH'), h('div.PZ2QoL_bwPlusV'));
    const remove = h('div.PZ2QoL_bwIconBtn.remove', {
        title: n === 1 ? `Take ${r.name} off this habitat` : `Take ${r.name} off all ${n}`,
        onClick: guard('Remove species', () => setSetupSpecies(model, r.species, false)),
    }, crossMark());
    return h(`div.PZ2QoL_bwHab.${r.count ? 'assigned' : here ? 'living' : 'other'}`, { 'data-species': r.species },
        h('div.PZ2QoL_bwHabMark'),
        h('div.PZ2QoL_bwHabText', null,
            h('div.PZ2QoL_bwHabName', { text: trunc(r.name, 30) }),
            h('div.PZ2QoL_bwHabMeta', { text: meta.join(' · ') || 'not in your zoo or storage' })),
        r.count ? btn('Plan', null, () => openSpeciesProgramme(r.species), { cls: 'small', title: `Plan which ${r.name} go into its habitats` }) : null,
        r.count < n ? add : null,
        r.count ? remove : null);
}

function setupSpeciesEl(model) {
    const habs = setupHabitats(model);
    const n = habs.length;
    const zoo = speciesList(model);
    const rows = habitatSpeciesRows({
        habs: habs.map(x => x.hab), model, assignments: getAssignments(model), zoo, stored: storedCounts(zoo), catalogue: HABITAT_SPECIES, query: W.query, nameOf: speciesName,
    });
    const box = scrollBox('setup');
    const c = box.content;
    c.appendChild(section(n === 1 ? 'Goes here' : `Goes in these ${n}`,
        rows.ticked.length ? rows.ticked.map(r => setupRow(model, r, n))
            : h('div.PZ2QoL_bwHint', { text: 'Nothing yet. Add a species below.' })));
    const add = [...rows.living, ...rows.yours, ...rows.other].map(r => setupRow(model, r, n));
    if (rows.more) add.push(h('div.PZ2QoL_bwHint', { text: `${rows.more} more: type more of the name.` }));
    if (!W.query) add.push(h('div.PZ2QoL_bwHint', { text: 'Type above to search every species the game knows.' }));
    c.appendChild(section('Add a species', ...add));
    return h('div.PZ2QoL_bwPane', null,
        h('div.PZ2QoL_bwActions', null,
            btn('‹ Habitats', null, () => setupStep('habitats'), { cls: 'primary.wide', title: 'Back to the habitat list (Esc)' })),
        finishScroll(box, 'setup'));
}

function setupEl(model) {
    return W.setup.step === 'species' && W.setup.habs.length ? setupSpeciesEl(model) : setupHabitatsEl(model);
}

// ------------------------------------------------------- Habitats tab

function habRow(model, r, kind) {
    const n = r.here.m + r.here.f + r.here.young;
    const meta = [];
    meta.push(n ? countsText(r.here.m, r.here.f, r.here.young) : 'none here yet');
    if (r.others.length) meta.push(`with ${r.others.slice(0, 2).map(s => trunc(speciesName(s), 16)).join(', ')}${r.others.length > 2 ? '…' : ''}`);
    if (kind === 'assigned' && r.shared.length) meta.push(`also for ${r.shared.slice(0, 2).map(s => trunc(speciesName(s), 16)).join(', ')}`);
    if (r.ok === false) meta.push(r.reason ? `the game: ${r.reason}` : 'the game says it can\'t go there');
    const show = h('div.PZ2QoL_bwIconBtn.show', {
        title: 'Show it in the park',
        onClick: guard('Show habitat', () => {
            const sample = speciesAnimals(model, W.species).find(a => a.hab === r.hab);
            W.keepUntil = Date.now() + 4000;
            locatePlace(r.hab, sample ? sample.id : '');
        }),
    }, h('div.PZ2QoL_bwEye'));
    const action = kind === 'assigned'
        ? h('div.PZ2QoL_bwIconBtn.remove', {
            title: `No longer set aside for ${speciesName(W.species)}`,
            onClick: guard('Remove habitat', () => {
                toggleAssignment(model, r.hab, W.species, r.name);
                breadcrumb('bw_unassign');
                notice(`${r.name}: no longer set aside for ${speciesName(W.species)}.`, 'info');
                renderAll();
            }),
        }, crossMark())
        : h('div.PZ2QoL_bwIconBtn.add', {
            title: `Set aside for ${speciesName(W.species)}`,
            onClick: guard('Add habitat', () => {
                toggleAssignment(model, r.hab, W.species, r.name);
                breadcrumb('bw_assign');
                notice(`${r.name}: set aside for ${speciesName(W.species)}.`, 'ok');
                renderAll();
            }),
        }, h('div.PZ2QoL_bwPlusH'), h('div.PZ2QoL_bwPlusV'));
    return h(`div.PZ2QoL_bwHab.${kind}${r.ok === false ? '.refused' : ''}`, { 'data-hab': r.hab },
        h('div.PZ2QoL_bwHabMark'),
        h('div.PZ2QoL_bwHabText', null,
            h('div.PZ2QoL_bwHabName', { text: trunc(r.name, 30) }),
            h('div.PZ2QoL_bwHabMeta', { text: meta.join(' · ') })),
        show, action);
}

function habitatsEl(model) {
    const wrap = h('div.PZ2QoL_bwPane');
    const name = speciesName(W.species);
    if (W.picking) {
        wrap.appendChild(h('div.PZ2QoL_bwPickBanner', null,
            h('div.PZ2QoL_bwPulse'),
            h('div.PZ2QoL_bwPickBannerText', null,
                h('div.PZ2QoL_bwPickBannerTitle', { text: 'Click a habitat in the park' }),
                h('div.PZ2QoL_bwPickBannerSub', { text: `Its fence, its gate or any animal in it. Each one you click is set aside for ${trunc(name, 22)}.` })),
            btn('Done', null, stopPicking, { cls: 'small', title: 'Stop picking (Esc)' })));
    }
    else {
        wrap.appendChild(h('div.PZ2QoL_bwActions', null,
            btn('Pick habitats in the park', null, startPicking, { cls: 'primary.wide', title: `Click habitats in the world to set them aside for ${name}` })));
    }
    const rows = habitatRows(model, W.species, getAssignments(model), destFor(model));
    const box = scrollBox('habitats');
    const c = box.content;
    c.appendChild(section(`Set aside for ${trunc(name, 24)}`,
        rows.assigned.length ? rows.assigned.map(r => habRow(model, r, 'assigned'))
            : h('div.PZ2QoL_bwHint', { text: 'None yet. A habitat set aside for a species takes only that species when the mod plans moves (Breeding programme, Auto mode, Suggest fixes, Find a habitat).' })));
    if (rows.living.length) c.appendChild(section('Lives there now', ...rows.living.map(r => habRow(model, r, 'living'))));
    if (rows.suitable.length) c.appendChild(section('Could go there (the game\'s check)', ...rows.suitable.slice(0, 12).map(r => habRow(model, r, 'suitable'))));
    if (!speciesAnimals(model, W.species).length) {
        c.appendChild(h('div.PZ2QoL_bwHint', { text: `No ${name} in the zoo yet: the game's habitat check needs one of them here. You can still set habitats aside for when they arrive.` }));
        const row = fetchRow(model, W.species, { onError: t => notice(t, 'warn') });
        if (row) c.appendChild(h('div.PZ2QoL_bwFetch', null, row));
    }
    wrap.appendChild(finishScroll(box, 'habitats'));
    return wrap;
}

// ------------------------------------------------------ Programme tab

function statTile(key, label, before, after, better, fmt = v => String(v)) {
    const b = before == null ? null : before, a = after == null ? null : after;
    let tone = 'flat';
    if (b != null && a != null && a !== b) tone = (better === 'up' ? a > b : a < b) ? 'good' : 'bad';
    return h(`div.PZ2QoL_kbStat.PZ2QoL_bwStat.${tone}`, { 'data-key': key },
        h('div.PZ2QoL_kbStatLabel', { text: label }),
        h('div.PZ2QoL_kbStatValue', null,
            h('span.PZ2QoL_kbStatBefore', { text: b == null ? '–' : fmt(b) }),
            h('div.PZ2QoL_kbArrow.small'),
            h('span.PZ2QoL_kbStatAfter', { text: a == null ? '–' : fmt(a) })));
}

// Who is moving animals (kinmoves runPlan's owner), for another species' tab.
function runOwnerText(owner) {
    if (owner === 'window') return W.ranFor ? `The plan for ${speciesName(W.ranFor)} is running` : 'A plan from this window is running';
    if (owner === 'autopilot') return 'Auto mode is moving animals';
    if (owner === 'undo') return 'Auto mode is undoing its last run';
    return 'A plan from the Species board is running';
}

function runEl(model) {
    const run = getPlanRun();
    const here = run.owner === 'window' && W.ranFor === W.species;
    if (!(run.running || (run.finished && here))) return null;
    if (run.running && !here) return h('div.PZ2QoL_bwRun.other', null, h('div.PZ2QoL_bwRunText', { text: `${runOwnerText(run.owner)}; Run waits for it.` }));
    const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
    const skipped = run.log.filter(x => !x.ok).length;
    const text = run.running
        ? `${run.stopping ? 'Stopping' : 'Moving'} ${Math.min(run.done + 1, run.total)} of ${run.total}${run.current ? `: ${run.current}` : ''}`
        : `Done: ${run.done} moved${skipped ? `, ${skipped} skipped` : ''}.`;
    return h(`div.PZ2QoL_bwRun${run.running ? '.running' : '.done'}`, null,
        h('div.PZ2QoL_bwRunText', { text }),
        h('div.PZ2QoL_bwBar', null, h('div.PZ2QoL_bwBarFill', { style: { width: `${run.running ? pct : 100}%` } })),
        run.running && !run.stopping ? btn('Stop', null, () => { stopPlan(); renderAll(); }, { cls: 'small.stop', title: 'Stop after the move in progress' }) : null,
        !run.running ? btn('OK', null, () => { W.ranFor = null; renderAll(); }, { cls: 'small' }) : null);
}

function programmeEl(model) {
    const wrap = h('div.PZ2QoL_bwPane');
    const species = W.species;
    const name = speciesName(species);
    // young can't breed: with no adults out there is nothing to group yet
    const young = speciesAnimals(model, species).filter(a => a.juv && a.alive !== false).length;
    if (!speciesAnimals(model, species).some(a => !a.juv && a.alive !== false)) {
        wrap.appendChild(empty(`No adult ${trunc(name, 24)} in the zoo`, `The programme groups the adults you have: bring them from Animal Storage and it places the best ones in their habitats.${young ? ' Young stay where they are until they grow up.' : ''}`,
            btn('Habitats', null, () => { W.tab = 'habitats'; renderAll(); }, { cls: 'small' })));
        const row = fetchRow(model, species, { onError: t => notice(t, 'warn') });
        if (row) wrap.appendChild(h('div.PZ2QoL_bwFetch', null, row));
        return wrap;
    }
    const p = ensureProgramme(model);
    if (!p || p.state === 'loading') {
        wrap.appendChild(empty('Asking the game…', `${name}: group size, mating system, fertility ages and the space in each habitat.`));
        return wrap;
    }
    const view = programmeView(model);
    const r = view ? view.r : p.result;
    const busy = !!p.job && !(view && view.kind === 'deep');
    // settings: make-up, the slider, the trade centre
    const choice = ratioChoice(species);
    const rule = r && r.rule ? r.rule : groupRule(p.info || {}, choice);
    const fixed = makeupFixed(rule);
    const auto = fixed || choice === 'auto';
    const cycle = d => {
        stepRatioChoice(species, d);
        breadcrumb('bw_programme_ratio');
        renderAll();
    };
    wrap.appendChild(h('div.PZ2QoL_bwControls', null,
        h(`div.PZ2QoL_kbRatio${auto ? '' : '.mine'}${fixed ? '.fixed' : ''}`, {
            'data-ratio': fixed ? 'auto' : choice,
            title: fixed ? "Only the leader breeds in this species (the game's rule): there is no make-up to choose."
                : 'Group make-up (the same choice as on the Species board, kept for this species in this zoo)',
        },
            fixed ? null : h('div.PZ2QoL_kbRatioArrow.prev', { onClick: guard('Make-up', () => cycle(-1)) }, h('span', { text: '‹' })),
            h('div.PZ2QoL_kbRatioText', null,
                h('span.PZ2QoL_kbRatioLabel', { text: fixed ? 'Make-up (the game)' : auto ? 'Make-up (auto)' : 'Make-up' }),
                h('span.PZ2QoL_kbRatioValue', { text: makeupShort(rule) })),
            fixed ? null : h('div.PZ2QoL_kbRatioArrow.next', { onClick: guard('Make-up', () => cycle(1)) }, h('span', { text: '›' }))),
        h('div.PZ2QoL_kbSteps.PZ2QoL_bwSteps', null,
            h('span.PZ2QoL_kbStepEnd', { text: 'Fewer moves' }),
            PROGRAMME_STEPS.map((st, i) => h(`div.PZ2QoL_kbStep${i === p.step ? '.on' : ''}`, {
                'data-step': String(i),
                title: st.label,
                onClick: guard('Programme step', () => {
                    p.step = i;
                    saveProgStep(i);
                    renderAll();
                }),
            }, h('div.PZ2QoL_kbStepDot'))),
            h('span.PZ2QoL_kbStepEnd', { text: 'Best genetics' }))));
    wrap.appendChild(moreToggle());
    if (W.moreOpen) {
        wrap.appendChild(optionsEl(p, r));
        return wrap;
    }
    const deep = deepEl(p, model, view);
    if (deep) wrap.appendChild(deep);
    maybeAutoDeep(p, model, view);
    if (r && r.tradeWaiting > 0) {
        wrap.appendChild(h('div.PZ2QoL_bwRow', null,
            switchEl(`Use breeders at the trade centre (${r.tradeWaiting})`, p.useTrade !== false, () => {
                p.useTrade = p.useTrade === false;
                renderAll();
            }, 'Breeders waiting at the trade centre may join a group')));
    }
    if (!p.info) wrap.appendChild(h('div.PZ2QoL_bwWarn', { text: 'The game did not describe this species, so the plan uses estimates for room and group size.' }));
    if (busy) {
        const pct = `${Math.round(Math.max(0, Math.min(1, p.job.progress || 0)) * 100)}%`;
        wrap.appendChild(h('div.PZ2QoL_bwBusy', null,
            h('span.PZ2QoL_bwBusyText', { text: r ? 'Optimising again…' : 'Optimising the groups…' }),
            h('div.PZ2QoL_bwBar', null, h('div.PZ2QoL_bwBusyFill.PZ2QoL_bwBarFill', { style: { width: pct } })),
            h('span.PZ2QoL_bwBusyPct', { text: pct })));
    }
    const run = runEl(model);
    if (run) wrap.appendChild(run);
    if (!r) {
        if (!busy) wrap.appendChild(empty('No programme', p.error ? 'The optimiser failed for this species.' : `${name} has no animals that can breed and move.`));
        return wrap;
    }
    const b = r.before, a = r.after;
    wrap.appendChild(h('div.PZ2QoL_bwStats', { 'data-moves': String(r.moves.length) },
        statTile('pairs', 'Breeding pairs', b.breedingPairs, a.breedingPairs, 'up'),
        statTile('quality', 'Expected young', b.youngQuality, a.youngQuality, 'up'),
        statTile('related', 'Related pairs', b.relatedPairs, a.relatedPairs, 'down'),
        statTile('idle', 'No partner', b.idle, a.idle, 'down')));
    const plan = runnableMoves(model, r.moves);
    const box = scrollBox('moves');
    const c = box.content;
    if (!r.moves.length) c.appendChild(h('div.PZ2QoL_bwHint', { text: 'No moves needed: the groups are already the best the optimiser found.' }));
    for (const m of r.moves.slice(0, MOVES_SHOWN)) {
        const x = model.animals.get(String(m.id));
        if (!x) continue;
        const from = whereName(model, homeOf(x));
        const runs = plan.some(y => y.id === x.id);
        c.appendChild(h(`div.PZ2QoL_bwMove${runs ? '' : '.held'}${m.to === TRADE ? '.out' : ''}`, { 'data-id': String(x.id) },
            h(`div.PZ2QoL_bwSex.sex_${x.sex}`, { text: sexSymbol(x.sex) }),
            h('div.PZ2QoL_bwMoveText', null,
                h('div.PZ2QoL_bwMoveName', { text: trunc(x.name || `Animal ${x.id}`, 22) + (runs ? '' : ' · stays (pregnant or busy)') }),
                h('div.PZ2QoL_bwMoveWhere', { text: `${trunc(from, 18)} → ${trunc(whereName(model, m.to), 18)}` }))));
    }
    if (r.moves.length > MOVES_SHOWN) c.appendChild(h('div.PZ2QoL_bwHint', { text: `${r.moves.length - MOVES_SHOWN} more moves.` }));
    wrap.appendChild(finishScroll(box, 'moves'));
    const running = getPlanRun().running;
    const stale = staleDeepText(view);
    wrap.appendChild(h('div.PZ2QoL_bwFoot', null,
        btn(plan.length ? `Run ${plan.length} move${plan.length === 1 ? '' : 's'}` : 'Nothing to move', null, runProgramme, {
            cls: `primary.wide${plan.length && !busy && !running && !stale ? '' : '.disabled'}`,
            title: busy ? 'The optimiser is still working' : running ? 'A plan is running' : stale ? `${stale} Run the deep search again first.` : 'Move the animals one at a time, each confirmed by the game',
        })));
    return wrap;
}

// ------------------------------------------------- More options (drop-down)

// Every option of the programme: the optimiser (Classic or Deep, its search,
// CPU use; prefs.js, shared with the board), the trade centre switch, and
// the fine tuning (kinprogtune.js, player-wide; the board and Auto mode
// plan with it too).

function optimiserWords(opt = getOptimiser()) {
    return opt.engine === 'deep' ? `Deep · ${opt.preset === 'custom' ? 'Custom' : DEEP_PRESETS[opt.preset].label}` : 'Classic';
}

function moreToggle() {
    const n = tuningCount(getPref(TUNE_PREF));
    return h(`div.PZ2QoL_bwMore${W.moreOpen ? '.on' : ''}`, {
        'data-open': W.moreOpen ? '1' : '0',
        title: 'Every option of the Breeding programme',
        onClick: guard('More options', () => {
            W.moreOpen = !W.moreOpen;
            W.scroll.options = 0;
            breadcrumb(W.moreOpen ? 'bw_options_open' : 'bw_options_close');
            renderAll();
        }),
    },
        h('span.PZ2QoL_bwMoreLabel', { text: W.moreOpen ? 'Fewer options' : 'More options' }),
        h('span.PZ2QoL_bwMoreMeta', { text: `${optimiserWords()}${n ? ` · ${n} changed` : ''}` }),
        h('div.PZ2QoL_bwMoreChevron'));
}

// A row of choices that wraps (the window is narrow).
function seg(items, current, onPick, attr) {
    return h('div.PZ2QoL_bwSeg', { [`data-${attr}`]: String(current) }, items.map(it => h(`div.PZ2QoL_bwSegItem${it.id === current ? '.on' : ''}`, {
        'data-id': String(it.id),
        title: it.title || '',
        onClick: guard(attr, () => onPick(it.id)),
    }, h('span', { text: it.label }))));
}

function optRow(label, help, control, changed = false) {
    return h(`div.PZ2QoL_bwOpt${changed ? '.changed' : ''}`, null,
        h('div.PZ2QoL_bwOptHead', null,
            h('div.PZ2QoL_bwOptLabel', { text: label }),
            changed ? h('div.PZ2QoL_bwOptDot', { title: 'Changed from the default' }) : null),
        help ? h('div.PZ2QoL_bwOptHelp', { text: help }) : null,
        control);
}

// A custom deep number with arrows (CUSTOM_STEPS), like the board's.
function stepper(k, value, words) {
    const list = CUSTOM_STEPS[k];
    const i = Math.max(0, list.indexOf(value));
    const go = d => {
        setOptimiser({ preset: 'custom', custom: { [k]: list[Math.max(0, Math.min(list.length - 1, i + d))] } });
        renderAll();
    };
    return h('div.PZ2QoL_kbRatio.PZ2QoL_bwStepper', { 'data-k': k },
        h('div.PZ2QoL_kbRatioArrow.prev', { onClick: guard('Option', () => go(-1)) }, h('span', { text: '‹' })),
        h('div.PZ2QoL_kbRatioText', null, h('span.PZ2QoL_kbRatioValue', { text: words(value) })),
        h('div.PZ2QoL_kbRatioArrow.next', { onClick: guard('Option', () => go(1)) }, h('span', { text: '›' })));
}

function setTune(key, id) {
    // a merge, replayed on the store's latest: the other page's tuning keys stay
    updatePref(TUNE_PREF, old => {
        const tune = Object.assign({}, old && typeof old === 'object' && !Array.isArray(old) ? old : {});
        if (id === 'default') delete tune[key];
        else tune[key] = id;
        return Object.keys(tune).length ? tune : undefined;
    });
    breadcrumb('bw_tune');
    tuningChanged();
}

// Auto mode plans again with the new tuning (its ready plans are dropped).
function tuningChanged() {
    import('/js/mods/pz2qol/kinauto.js').then(m => {
        for (const sp of m.getAutopilotState().on || []) m.speciesChoicesChanged(sp);
    }).catch(() => {});
    renderAll();
}

function optionsEl(p, r) {
    const box = scrollBox('options');
    const c = box.content;
    const opt = getOptimiser();
    const setOpt = patch => {
        setOptimiser(patch);
        breadcrumb('bw_optimiser');
        renderAll();
    };
    // the optimiser
    const engine = [optRow('Optimiser', opt.engine === 'deep'
        ? 'Many starts after the Classic plan, with exact repairs: never worse than Classic, often better on big species. Runs in the background.'
        : 'One guided search, a few seconds.',
    seg([{ id: 'classic', label: 'Classic' }, { id: 'deep', label: 'Deep' }], opt.engine, v => setOpt({ engine: v }), 'engine'))];
    if (opt.engine === 'deep') {
        engine.push(optRow('Deep search', '', seg(PRESET_ORDER.map(k => ({
            id: k, label: DEEP_PRESETS[k] ? DEEP_PRESETS[k].label : 'Custom', title: PRESET_WORDS[k],
        })), opt.preset, v => setOpt({ preset: v }), 'preset')));
        if (opt.preset === 'custom') {
            const cu = opt.custom;
            engine.push(h('div.PZ2QoL_bwCustom', null,
                optRow('Starts', '', stepper('starts', cu.starts, v => String(v))),
                optRow('Effort per start', '', stepper('effort', cu.effort, v => `${v}×`)),
                optRow('Exact repairs', '', stepper('repair', cu.repair, v => ({ off: 'off', light: 'light', strong: 'strong (slower)' })[v] || v)),
                optRow('Time limit', '', stepper('limitMin', cu.limitMin, v => (v > 0 ? durationText(v * 60) : 'none'))),
                optRow('Stop early', '', stepper('patience', cu.patience, v => (v > 0 ? `after ${v} quiet round${v === 1 ? '' : 's'}` : 'off')))));
        }
    }
    engine.push(optRow('CPU use', "How much of each frame the deep searches you start here take. Gentler is smoother on slower PCs, and slower to finish. Auto mode's runs and the searches that start by themselves always go gently, so you can play while they run.",
        seg(CPU_ORDER.map(k => ({ id: k, label: CPU_STEPS[k].label })), opt.cpu, v => setOpt({ cpu: v }), 'cpu')));
    c.appendChild(section('Optimiser', ...engine));
    // this species' plan
    c.appendChild(section('This plan',
        optRow('Breeders at the trade centre', r && r.tradeWaiting > 0 ? `${r.tradeWaiting} waiting there now.` : 'None waiting there now.',
            seg([{ id: 'on', label: 'May join a group' }, { id: 'off', label: 'Leave them' }], p.useTrade !== false ? 'on' : 'off', v => {
                p.useTrade = v === 'on';
                renderAll();
            }, 'trade'), p.useTrade === false)));
    // the fine tuning, by group
    const tune = getPref(TUNE_PREF);
    const groups = new Map();
    for (const t of PROGRAMME_TUNING) {
        if (!groups.has(t.group)) groups.set(t.group, []);
        const cur = tuningChoice(tune, t.key);
        groups.get(t.group).push(optRow(t.label, t.help,
            seg(t.choices.map(x => ({ id: x.id, label: x.label })), cur ? cur.id : 'default', v => setTune(t.key, v), t.key),
            !!cur && cur.id !== 'default'));
    }
    for (const [g, rows] of groups) c.appendChild(section(g, ...rows));
    const n = tuningCount(tune);
    c.appendChild(h('div.PZ2QoL_bwHint', { text: 'Kept for every zoo. The Species board and Auto mode plan with these settings too.' }));
    const foot = h('div.PZ2QoL_bwFoot.split', null,
        btn('Reset to defaults', null, () => {
            setPref(TUNE_PREF, undefined);
            setOptimiser({ engine: 'classic', preset: 'standard', cpu: 'normal' });
            p.useTrade = true;
            breadcrumb('bw_tune_reset');
            notice('Every option is back to its default.', 'ok');
            tuningChanged();
        }, { cls: `small${n || opt.engine !== 'classic' || p.useTrade === false ? '' : '.disabled'}` }),
        btn('Done', null, () => {
            W.moreOpen = false;
            renderAll();
        }, { cls: 'small.primary' }));
    const wrap = h('div.PZ2QoL_bwOptions', null, finishScroll(box, 'options'), foot);
    return wrap;
}

// ------------------------------------------------------- Auto mode tab

function autoHelpers() {
    return {
        compact: true, btn, switchEl, guard, notice, renderAll, queueRender, makeScroll, restoreScroll, statTile, placeName: whereName,
        close: () => {
            W.tab = 'programme';
            renderAll();
        },
        scroll: y => {
            if (y != null) W.scroll.auto = y;
            return W.scroll.auto || 0;
        },
        box: b => {
            W.boxes.auto = b;
        },
    };
}

function loadAuto() {
    if (W.autoMod || W.autoFailed || W.autoLoading) return;
    W.autoLoading = true;
    import('/js/mods/pz2qol/kinautoui.js').then(m => {
        W.autoLoading = false;
        if (m && typeof m.autoPanelEl === 'function') W.autoMod = m;
        else W.autoFailed = true;
        queueRender();
    }, e => {
        W.autoLoading = false;
        W.autoFailed = true;
        reportError('ui', 'Breeding window: Auto mode could not load', e, { silent: true });
        queueRender();
    });
}

function autoEl(model) {
    if (!W.autoMod) {
        loadAuto();
        return empty(W.autoFailed ? 'Auto mode is not available' : 'Loading Auto mode…', '');
    }
    return h('div.PZ2QoL_bwPane.PZ2QoL_bwAuto', null, W.autoMod.autoPanelEl(model, W.species, autoHelpers()));
}

// --------------------------------------------------------------- tick

function tick() {
    if (!W.open) return;
    try {
        const now = Date.now();
        // a game info panel the player opened takes the window's place
        if (W.yieldPending) {
            W.yieldPending = false;
            if (!W.picking && now >= W.keepUntil && W.gameShown) {
                breadcrumb('bw_yield');
                closeBreedingWindow();
                return;
            }
        }
        if (W.pickCtx) {
            const ctx = W.pickCtx;
            W.pickCtx = null;
            if (W.picking) handlePick(ctx);
        }
        // the game's panel a pick (or Show in park) opened: closed again
        if (W.gameShown && now < W.closeGameUntil) closeGamePanel();
        // hidden with the game's tools column (management, photo mode, hidden UI)
        const tools = document.querySelector('.ToolsBar_root');
        const away = !!tools && !visibleBox(tools);
        setClass(W.root, 'away', away);
        W.tickN = (W.tickN || 0) + 1;
        if (W.storedQueue.length && W.tickN % 3 === 0) requestStorageCounts(W.storedQueue.splice(0, STORED_CHUNK));
        if (W.tickN % 10 === 0) {
            markKinActive();
            refreshBars(W.boxes);
        }
        if (W.notice && now >= W.notice.until) {
            W.notice = null;
            renderNotice();
        }
    }
    catch (e) {
        reportError('ui', 'Breeding window refresh failed', e, { silent: true });
    }
}

function subscribe() {
    unsubscribe();
    W.unsub.push(onKin(() => queueRender()));
    W.unsub.push(onKinSettings(() => queueRender()));
    W.unsub.push(onAssignments(() => queueRender()));
    W.unsub.push(onStorageCounts(() => {
        if (W.picker || W.setup || W.tab === 'habitats') queueRender();
        else renderHead(getKinModel());
    }));
    W.unsub.push(onPlanRun(() => queueRender()));
    W.unsub.push(onUserData(() => queueRender()));
    W.unsub.push(onOptimiser(() => queueRender()));
    W.unsub.push(onDeep(kind => (kind === 'progress' ? renderDeepProgress() : queueRender())));
    W.timer = setInterval(tick, TICK_MS);
}

function unsubscribe() {
    for (const fn of W.unsub) {
        try {
            fn();
        }
        catch (e) {
            // gone
        }
    }
    W.unsub = [];
    if (W.timer) clearInterval(W.timer);
    W.timer = 0;
}

// ---------------------------------------------------------------- api

// Opens the window. opts: { species } opens on that species; without it,
// on choosing a habitat: the one on the game's info panel, if one is shown.
export function openBreedingWindow(opts = {}) {
    try {
        if (!isHudPage()) return false;
        installEvents();
        ensureRoot();
        closeOtherPanels('breeding');
        const model = getKinModel();
        const species = opts && opts.species != null ? String(opts.species) : null;
        const shown = !species && W.gameShown && W.lastCtx ? pickedHabitat(W.lastCtx, model) : null;
        // the game's info panel gives way
        if (W.gameShown) closeGamePanel();
        const wasOpen = W.open;
        W.open = true;
        setClass(W.root, 'hidden', false);
        if (!wasOpen) subscribe();
        breadcrumb('bw_open');
        requestKinScan('window');
        markKinActive();
        loadAuto();
        if (!species) {
            startSetup(shown && !shown.error ? shown.hab : null);
            return true;
        }
        if (species !== W.species) chooseSpecies(species);
        else {
            requestStorageCounts([W.species], { force: !wasOpen });
            loadDest(false);
            renderAll();
        }
        if (W.picker) openPickerData();
        return true;
    }
    catch (e) {
        reportError('ui', 'Breeding window could not open', e);
        return false;
    }
}

// the picker's data: storage counts for the zoo's species, then every other one
function openPickerData() {
    const zoo = speciesList(getKinModel()).map(s => s.species);
    askStored(zoo.concat(HABITAT_SPECIES));
}

export function closeBreedingWindow() {
    try {
        W.open = false;
        W.picking = false;
        W.picker = false;
        W.setup = null;
        W.pickCtx = null;
        W.yieldPending = false;
        W.storedQueue = [];
        if (W.prog && W.prog.job) W.prog.job.cancelled = true;
        W.prog = null;
        unsubscribe();
        // nothing left behind on the page
        if (W.root && W.root.parentNode) W.root.parentNode.removeChild(W.root);
        W.root = null;
        W.el = {};
        breadcrumb('bw_close');
    }
    catch (e) {
        reportError('ui', 'Breeding window could not close', e, { silent: true });
    }
    return true;
}

export function isBreedingWindowOpen() {
    return W.open;
}

export function toggleBreedingWindow(opts = {}) {
    if (W.open) return closeBreedingWindow();
    return openBreedingWindow(opts);
}

let installed = false;
export function installBreedingWindow() {
    if (installed) return true;
    if (!isHudPage()) return true;
    installed = true;
    installEvents();
    document.addEventListener('keydown', e => {
        if (!W.open) return;
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        try {
            e.preventDefault();
            e.stopPropagation();
            if (W.setup && W.setup.step === 'species') setupStep('habitats');
            else if (W.setup) closeBreedingWindow();
            else if (W.picking) stopPicking();
            else if (W.picker && W.species) {
                W.picker = false;
                renderAll();
            }
            else closeBreedingWindow();
        }
        catch (err) {
            reportError('ui', 'Breeding window: Esc failed', err, { silent: true });
        }
    }, true);
    return true;
}

registerPanel('breeding', { open: openBreedingWindow, close: closeBreedingWindow, isOpen: isBreedingWindowOpen });

// tests
export function _breedingWindowState() {
    return W;
}
export { infoPanelTarget };
