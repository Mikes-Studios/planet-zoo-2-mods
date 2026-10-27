// Auto mode runtime (park HUD page): for every species the player put on
// Auto (Species board), on its schedule, works out Thin out (if chosen) and
// the species' Breeding programme with kinautocore.js and runs the moves
// one at a time like the board's Execute. Remembers what it did
// (kinautoledger.js, kept in the zoo's PZ2QoL data). Design:
// docs/DESIGN-autopilot.md section 16.
//
// With no species on Auto in this zoo it does nothing at all: no listeners,
// no timers, no scans, nothing saved. installAutopilot() only reads the
// zoo's data to learn whether a species is on.
//
// When a run is due it plans and runs by itself, in every park, Franchise
// included: turning Auto mode on for a species is the player's opt-in
// (developer, 2026-10-19; CLAUDE.md). One move at a time, each confirmed by
// the game, the game's gate before each.
import { getKinModel, getKinSettings, onKin, requestKinScan, setContraception, setKinAlertFilter } from '/js/mods/pz2qol/kin.js';
import { getPlanRun, moveOutcome, onPlanRun, requestDestinations, requestSpeciesInfo, requestStoredAdults, runPlan, stopPlan } from '/js/mods/pz2qol/kinmoves.js';
import { getUserData, onUserData, setUserData, userDataEpoch, userDataStatus } from '/js/mods/pz2qol/userstore.js';
import { assignmentsOf, getAssignments, onAssignments, toggleAssignment } from '/js/mods/pz2qol/kinassign.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { isCollective } from '/js/mods/pz2qol/kincore.js';
import { isGamePopupOpen } from '/js/mods/pz2qol/ui.js';
import { TRADE } from '/js/mods/pz2qol/kinboardcore.js';
import { ownGeneScore, planProgrammeAsync, programmeLogData } from '/js/mods/pz2qol/kinprogramme.js';
import { ratioChoice } from '/js/mods/pz2qol/progprefs.js';
import { AUTO_CPU, deepJob } from '/js/mods/pz2qol/kinprogdeep.js';
import { getPref } from '/js/mods/pz2qol/prefs.js';
import { TUNE_PREF } from '/js/mods/pz2qol/kinprogtune.js';
import { freshBloodNeeds } from '/js/mods/pz2qol/kinbloodline.js';
import { storedRowAges } from '/js/mods/pz2qol/storedages.js';
import {
    AUTO_LIMITS, scheduledDue, bestForNeeds, bestFreshBlood, calendarMonths, genePercents, marketMatesFor, mergeStorageSuggestions, withAgeingAdvice, withoutAgeing, withoutParkAnimals, finishAutoRun, freshNotices, kinConflicts, marketDimFor, mergeSellAdvice, speciesToSwitchOn, cleanupRun, withoutHabitats, freeParked, groupSires, guardChanges, heldKinIds, sireStandard, withGuardsLifted, storageAdditions, storageTrial, storageUpgrades, waitingAtTradeCentre, observeChanges, prepareAutoRun, programmeOptionsFor, speciesFingerprints,
} from '/js/mods/pz2qol/kinautocore.js';
import {
    cleanFor, cleanHabitatIds, emptyLedger, fitBudget, forgetSpecies, guardedGuids, isManualAnimal, isPinnedAnimal, ledgerView, logAction, normalizeLedger, noteManualMoves, noteReversal,
    noteGuard, noteTradeAges, noteUndone, pruneLedger, resumeSpecies, setSpeciesSettings, settleAction, speciesOn, speciesSettings, speciesSwitchedOn, togglePinAnimal, undoOf,
} from '/js/mods/pz2qol/kinautoledger.js';

const DATA_KEY = 'kinAuto';
const SELL_ADVICE_MAX_CHARS = 20000; // Lua's Kin.tRelays.SellAdvice.nMax: a longer list is refused there
const TICK_MS = 1000;
const SCAN_MS = 10000;
const SCAN_FAST_MS = 3000;
const SAVE_EVERY_MS = 30000;
const CAL_MS = 5000;                 // the park's calendar is read this often while on
const CLEAN_GAP_MS = 15000;          // Clean up looks at each species again this long after its last run
const RATE_MS = 10000;               // game speed measured over at least this long
const GATE_TIMEOUT_MS = 4000;
const GATE_ASKS = 3;                 // unanswered gate requests before a move is skipped
const GATE_SILENT_WHY = 'the game did not answer its checks before the move';
const PAUSED_WHY = 'the game refused several moves; it tries again later';
// Lua's answer when the animal is on its way somewhere already (Kin.Move): not a refusal
const ALREADY_MOVING_WHY = 'This animal is already being moved.';
const UNCONFIRMED_WHY = 'not confirmed';
// a move answered so is on its way most likely: this long before it is asked again
const ON_THE_WAY_MS = 5 * 60 * 1000;
// the player went to the hub mid-run: the park is back when they return
const NO_PARK_WHY = 'no park is loaded';
const SETTLING_WHY = 'the zoo just loaded: watching it for a minute first';
const QUIET_MS = 30000;              // a run's half-done pairs are not news this long after it
const MOVING_RETRY_MS = 15000;       // a growing-up box or a keeper's transport is over by then; a hub visit too
// a move not finished after this much park time is stuck (a keeper who
// never delivers): it no longer holds its species' runs back, and counts
// where it is. Real time only until the park's calendar is read.
const STUCK_MOVE_MONTHS = 1;
const STUCK_MOVE_MS = 90000;
// a contraception switch the scan does not show yet is asked again after this, and told after GUARD_TRIES
const GUARD_RETRY_MS = 5000;
const GUARD_TRIES = 3;

const A = {
    installed: false,
    running: false,          // the runtime is started (a species on Auto in this zoo)
    ledger: null,
    ledgerEpoch: -1,         // the store read the ledger belongs to
    epoch: -1,
    model: null,
    cal: null,               // the park's calendar: { months, at, rate (months per ms), base }
    calAsking: false,
    monthSec: null,          // the game's month length at 1x (GetMonthDurationInSeconds)
    seen: null,
    kinKeys: new Map(),      // species -> the related pairs a run was last asked for (noteKinConflicts)
    waitingKeys: new Map(),  // species -> the animals waiting at the trade centre a run was last asked for (noteWaiting)
    young: new Set(),        // ids of the young animals last scan (noteHerdChanges)
    herd: new Set(),         // ids of every animal last scan (noteHerdChanges)
    changedAt: new Map(),    // species -> park years of its last birth, arrival or young grown up (freeParked)
    retryAt: new Map(),      // species -> when to run again after a run's move found its animal already moving or the park away
    needKeys: new Map(),     // species -> Set of the plan notices told this load (noteNeeds); Run now and switching on tell them again
    lastWhy: '',             // the last reason no run could start, as logged
    playerRunMoves: null,    // the window's or board's run already marked expected (notePlayerRun)
    sellAdvice: new Map(),   // guid -> the session's sell advice (mergeSellAdvice), for the Storage window
    skipWhy: new Map(),      // stored adult guid -> why it is not offered, as last logged
    wanted: new Map(),       // species -> Set of stored adults' guids the programme would bring in (noteAdditions): never sell advice
    movingSince: new Map(),  // id -> { at (ms), months (park calendar or null) }: first seen on the move (stuckMoving)
    stuckTold: new Set(),    // ids of stuck moves already told
    guardAsked: new Map(),   // id -> { on, at, tries }: a contraception switch asked of the game (guardKin)
    expected: new Map(),     // id -> { to, until }
    prints: new Map(),       // species -> fingerprint
    cleanAt: new Map(),      // Clean up: species -> real ms of its next look
    cleanDone: new Map(),    // Clean up: species found empty -> its cleanupRun clean
    queue: [],               // species waiting for their turn, in order (one run at a time)
    planning: null,          // species being planned
    acting: null,            // { species, step, total, text }
    pausedUntil: new Map(),  // species -> ms (refusals)
    quiet: new Map(),        // species -> ms: its new pairs are not alerted
    lastPlan: new Map(),     // species -> the last plan made (the panel's preview)
    session: 0,              // bumped by stop(): a plan or run of an older session (another zoo) ends
    changed: new Map(),      // species -> settings version: a plan made with older settings is dropped
    loadAt: 0,
    scans: 0,
    lastScan: 0,
    lastTick: 0,
    lastSave: 0,
    saveDirty: false,
    lastGate: null,
    timers: [],
    unsub: [],
    listeners: new Set(),
    toastHook: null,
};

function safe(fn, what) {
    try {
        return fn();
    }
    catch (e) {
        reportError('mod', `Auto mode: ${what}`, e, { silent: true });
        return undefined;
    }
}

function notify() {
    A.listeners.forEach(fn => safe(() => fn(), 'listener'));
}

export function onAutopilot(fn) {
    A.listeners.add(fn);
    return () => A.listeners.delete(fn);
}

// The UI module tells the runtime how to show its notices.
export function setAutopilotToastHook(fn) {
    A.toastHook = typeof fn === 'function' ? fn : null;
}

function toast(kind, data) {
    if (A.toastHook) safe(() => A.toastHook(kind, data), 'toast');
}

// ------------------------------------------------------------ the calendar

// The park's date from the gate's answer: the schedule counts its months
// (game time: it stops while paused, runs faster at 2x and 5x).
function noteGate(g) {
    if (!g) return;
    A.lastGate = g;
    if (typeof g.monthSec === 'number' && g.monthSec > 0) A.monthSec = g.monthSec;
    const m = calendarMonths(g);
    if (m == null) return;
    const now = Date.now();
    // first reading, or the date went back (another zoo): start afresh
    if (!A.cal || m < A.cal.months - 0.5) {
        A.cal = { months: m, at: now, rate: null, base: { m, at: now } };
        return;
    }
    A.cal.months = Math.max(A.cal.months, m);
    A.cal.at = now;
    if (now - A.cal.base.at >= RATE_MS) {
        A.cal.rate = Math.max(0, (m - A.cal.base.m) / (now - A.cal.base.at));
        A.cal.base = { m, at: now };
    }
}

// Calendar years (the park's months / 12): the holds and windows of the
// memory (kinautoledger.js) are counted in these.
function parkYears() {
    return A.cal ? A.cal.months / 12 : (A.ledger ? A.ledger.clock : 0);
}

// Months per real ms at the speed the game runs now (0 while paused), or
// the game's 1x month length until it is measured; null if neither.
function gameRate() {
    if (A.cal && A.cal.rate != null) return A.cal.rate;
    return A.monthSec ? 1 / (A.monthSec * 1000) : null;
}

// --------------------------------------------------------------- storage

// This zoo's data, only once the store has read this zoo's data ('file').
// Before that (a park loading, the hub, no player profile) the store may
// still hold the previous zoo's data: Auto mode is off then.
function storeReady() {
    return userDataStatus() === 'file';
}

function loadLedger() {
    A.ledgerEpoch = userDataEpoch();
    return storeReady() ? normalizeLedger(getUserData(DATA_KEY)) : emptyLedger();
}

// Only into the zoo the ledger was read from (never queued for later).
function saveLedger(force) {
    if (!A.ledger) return;
    if (!storeReady() || A.ledgerEpoch !== userDataEpoch()) {
        A.saveDirty = false;
        return;
    }
    if (!force && Date.now() - A.lastSave < SAVE_EVERY_MS) {
        A.saveDirty = true;
        return;
    }
    A.lastSave = Date.now();
    A.saveDirty = false;
    safe(() => {
        fitBudget(A.ledger);
        setUserData(DATA_KEY, JSON.parse(JSON.stringify(A.ledger)));
    }, 'save');
}

// The mod moves this species' animals: Auto mode is on for it (stopped or
// not), or Clean up is emptying the zoo.
export function autoManages(species) {
    const l = A.ledger && A.ledgerEpoch === userDataEpoch() ? A.ledger : null;
    return !!l && (cleaningZoo(l) || speciesSwitchedOn(l).includes(species));
}

export function getAutopilotLedger() {
    return A.ledger;
}

function currentLedger() {
    if (!A.ledger || A.ledgerEpoch !== userDataEpoch()) A.ledger = loadLedger();
    return A.ledger;
}

// ---------------------------------------------------------------- state

function gameMode() {
    const m = A.model || getKinModel();
    return (m && m.mode) || 'unknown';
}

export function isAutopilotOn() {
    return !!A.ledger && (A.ledger.clean || speciesOn(A.ledger).length > 0);
}

// A plan may still move animals: a Clean up plan while that Clean up runs, a
// breeding plan while its species is on and the zoo is not being cleaned up.
// One made before a Clean up started, stopped or changed is not (a breeding
// plan from before could fill a habitat being emptied).
function planLive(l, plan) {
    const sp = plan.species;
    if (plan.cleanKey !== cleanKey(l)) return false;
    return plan.clean ? !!l.clean : !cleaningZoo(l) && !!(l.sp[sp] && l.sp[sp].on) && !l.stopped[sp];
}

function notLiveWhy(l, plan) {
    if (plan.cleanKey === cleanKey(l)) return 'Auto mode was turned off';
    if (!l.clean) return 'Clean up stopped';
    return plan.clean ? 'Clean up changed its habitats' : 'Clean up started';
}

const cleanKey = l => JSON.stringify((l && l.clean) || false);
const cleaningZoo = l => !!(l && l.clean && l.clean.zoo);

// What Clean up empties this load: null, { zoo: true } or { habs: Set(habitat id) }.
function cleanScope(l = A.ledger, model = A.model) {
    if (!l || !l.clean) return null;
    return l.clean.zoo ? { zoo: true } : { habs: cleanHabitatIds(l, model) };
}

// The species Clean up runs for: every one in the zoo, or those with an animal in its habitats.
function cleanScopeSpecies(scope) {
    if (!scope) return [];
    if (scope.zoo) return zooSpecies(A.model);
    const out = new Set();
    for (const a of A.model ? A.model.animals.values() : []) {
        if (a.species && !a.exhibit && a.alive !== false && scope.habs.has(String(a.hab))) out.add(a.species);
    }
    return Array.from(out).filter(sp => !isCollective(A.model, sp));
}

// The whole of it, for the UI: { storage, running, mode, acting, planning,
// queue: [species], on: [species] }
export function getAutopilotState() {
    return {
        storage: userDataStatus(), running: A.running, mode: gameMode(),
        acting: A.acting, planning: A.planning, queue: A.queue.slice(), on: speciesOn(A.ledger),
        settling: A.running && !settled(),
        monthSec: A.monthSec, rate: gameRate(),
    };
}

// One species, for its panel and button:
// { settings, status, why, left (months of game time to the next run, null
//   before the calendar is read), rate (months per real ms, 0 paused),
//   pausedMs, queued (place in the queue, 1 = next), last, plan, log }
//   status: off | stopped | paused | acting | planning | queued | waiting | due
export function getSpeciesAuto(species) {
    const l = A.ledger && A.ledgerEpoch === userDataEpoch() ? A.ledger : null;
    const s = speciesSettings(l, species);
    const left = A.cal ? Math.max(0, (s.next || 0) - A.cal.months) : null;
    const out = { settings: s, status: 'off', why: '', left, rate: gameRate(), pausedMs: 0, last: s.last || null, plan: A.lastPlan.get(species) || null, log: [] };
    if (l) out.log = l.log.filter(e => e.sp === species);
    if (!s.on) return out;
    if (l && l.stopped[species]) {
        out.status = 'stopped';
        out.why = l.stopped[species];
    }
    else if (A.acting && A.acting.species === species) out.status = 'acting';
    else if (A.planning === species) out.status = 'planning';
    else if (pausedNow(species)) {
        out.status = 'paused';
        out.why = PAUSED_WHY;
        out.pausedMs = A.pausedUntil.get(species) - Date.now();
    }
    else if (A.queue.includes(species)) {
        out.status = 'queued';
        out.queued = A.queue.indexOf(species) + 1;
        out.why = A.running ? (blockedNow() || speciesBlocked(species) || (A.planning || A.acting ? 'another species is running' : '')) : '';
    }
    else if (A.running && !A.cal) {
        out.status = 'due';
        out.why = 'reading the park\'s calendar';
    }
    else if (left > 0) out.status = 'waiting';
    else {
        out.status = 'due';
        out.why = A.running ? (blockedNow() || speciesBlocked(species)) : 'starting';
    }
    return out;
}

// ------------------------------------------------------------- settings

// Changes a species' Auto settings ({ on, every, step, trade, thin, fill }).
// -> false when the zoo's data can't be kept (Auto mode can't be turned on).
export function setSpeciesAuto(species, patch) {
    if (!storeReady()) return false;
    const l = currentLedger();
    const wasOn = !!(l.sp[species] && l.sp[species].on);
    setSpeciesSettings(l, species, patch || {}, A.cal ? A.cal.months : null);
    if (!wasOn && l.sp[species].on) {
        forgetSpecies(l, A.model || getKinModel(), species);
        A.needKeys.delete(species);
    }
    bump(species);
    if (patch && patch.on === false) {
        dequeue(species);
        A.lastPlan.delete(species);
        const run = getPlanRun();
        if (A.acting && A.acting.species === species && run.running && run.owner === 'autopilot') stopPlan();
    }
    if (!wasOn && l.sp[species].on) breadcrumb('auto_species_on');
    else if (wasOn && !l.sp[species].on) breadcrumb('auto_species_off');
    saveLedger(true);
    sync();
    notify();
    return true;
}

function bump(species) {
    A.changed.set(species, (A.changed.get(species) || 0) + 1);
}

// The board's make-up for the species changed (kinautoui.js): a plan made
// with the old one is dropped.
export function speciesChoicesChanged(species) {
    bump(species);
    notify();
}

export function resumeSpeciesAuto(species) {
    const l = currentLedger();
    resumeSpecies(l, species);
    A.pausedUntil.delete(species);
    saveLedger(true);
    sync();
    notify();
}

// Start or stop the runtime as the zoo's data says.
function sync() {
    const want = storeReady() && A.ledgerEpoch === userDataEpoch() && isAutopilotOn();
    if (want && !A.running) start();
    else if (!want && A.running) stop();
}

// What Auto mode learns by watching one zoo load: started afresh when it
// starts, stops, or sees a new zoo load (whose entity ids are new).
function forgetZoo() {
    A.loadAt = Date.now();
    A.scans = 0;
    A.seen = null;
    A.cal = null;
    A.calAsking = false;
    A.kinKeys.clear();
    A.waitingKeys.clear();
    A.young.clear();
    A.herd.clear();
    A.changedAt.clear();
    A.retryAt.clear();
    A.needKeys.clear();
    A.movingSince.clear();
    A.stuckTold.clear();
    A.guardAsked.clear();
    A.expected.clear();
    A.lastPlan.clear();
    A.skipWhy.clear();
    A.wanted.clear();
    A.cleanAt.clear();
    A.cleanDone.clear();
}

function start() {
    if (A.running) return;
    A.running = true;
    forgetZoo();
    A.lastTick = Date.now();
    A.unsub.push(onKin((model, scope) => {
        if (scope && scope !== 'park') return;
        safe(() => onModel(model), 'model');
    }));
    A.unsub.push(onPlanRun(r => {
        notePlayerRun(r);
        notify();
    }));
    A.timers.push(setInterval(() => safe(tick, 'tick'), TICK_MS));
    loadBoard().catch(() => {});
    setKinAlertFilter(p => {
        const until = A.quiet.get(p.species);
        return until != null && Date.now() < until;
    });
    requestKinScan('auto_start', { force: true, delay: 200 });
}

function stop() {
    A.running = false;
    A.session++;
    // a run of ours still going belongs to the zoo that ended: stopped
    const run = getPlanRun();
    if (run.running && run.owner === 'autopilot') safe(() => stopPlan(), 'stop run');
    for (const t of A.timers) clearInterval(t);
    A.timers = [];
    for (const fn of A.unsub) safe(fn, 'unsubscribe');
    A.unsub = [];
    setKinAlertFilter(null);
    A.quiet.clear();
    A.prints.clear();
    A.pausedUntil.clear();
    A.queue = [];
    A.acting = null;
    A.planning = null;
    // nothing of the old zoo is used again (a new zoo's model and gate come fresh)
    A.model = null;
    A.lastGate = null;
    forgetZoo();
}

// A plan or run started now is still wanted later (same session, same zoo
// data, same ledger).
function stillHere() {
    const sess = A.session, epoch = userDataEpoch(), led = A.ledger;
    return () => A.running && A.session === sess && userDataEpoch() === epoch && A.ledger === led && storeReady();
}

// ------------------------------------------------------------- watching

function settled() {
    return A.scans >= AUTO_LIMITS.settleScans && Date.now() - A.loadAt >= AUTO_LIMITS.settleMs;
}

function onModel(model) {
    // no park model (the hub's Animal Storage or Market is open): what was
    // told stays told; a new zoo load clears it below (epoch)
    if (!model || model.scope !== 'park') {
        A.model = null;
        A.seen = null;
        return;
    }
    // another zoo load (or a store read pending): the ledger may belong to
    // another zoo; checkZoo() decides again once this zoo's data is read
    if (A.ledgerEpoch !== userDataEpoch() || !storeReady()) {
        checkZoo();
        return;
    }
    if (A.epoch !== userDataEpoch()) {
        A.epoch = userDataEpoch();
        forgetZoo();
        A.sellAdvice = new Map();
        safe(() => engine.trigger('PZ2QoL_SellAdviceSet', '[]'), 'sell advice');
    }
    A.model = model;
    A.scans++;
    A.lastScan = Date.now();
    const l = A.ledger;
    if (A.cal) l.clock = parkYears();
    const now = Date.now();
    for (const [id, e] of A.expected) {
        const a = model.animals.get(id);
        if (now > e.until && !(a && a.moving)) A.expected.delete(id);
    }
    // what changed that Auto mode did not do
    const first = !A.seen;
    const obs = observeChanges(A.seen || {}, model, A.expected);
    A.seen = obs.seen;
    // arrived where Auto mode sent it: no longer expected
    for (const [id, e] of A.expected) {
        const a = model.animals.get(id);
        if (!a || a.moving) continue;
        const here = a.hab || (a.lt === 'trade' ? TRADE : '');
        if (here === String(e.to)) A.expected.delete(id);
    }
    if (!first && obs.moved.length) {
        noteManualMoves(l, model, obs.moved, parkYears());
        A.saveDirty = true;
        breadcrumb('auto_manual_move');
    }
    pruneLedger(l, model, parkYears());
    if (noteTradeAges(l, model, new Set(speciesSwitchedOn(l)), parkYears())) A.saveDirty = true;
    noteMoving(model);
    noteKinConflicts(model, l);
    guardKin(model, l);
    noteWaiting(model, l);
    noteHerdChanges(model, l);
    A.prints = speciesFingerprints(model);
    if (A.saveDirty) saveLedger(false);
    notify();
}

// Never inbreed (kinautocore guardChanges): contraception on a female beside
// a relative who can breed, on the species Auto mode keeps or Clean up
// empties; off again once she is apart, only after the zoo is read fully.
function guardKin(model, l) {
    // a species Auto mode stopped for stays guarded: never inbreed holds while the player looks
    const on = new Set(speciesSwitchedOn(l));
    const scope = cleanScope(l, model);
    const mine = a => (scope && (scope.zoo || scope.habs.has(String(a.hab)))) || on.has(a.species);
    const { on: guard, off: lift } = guardChanges(model, guardedGuids(l));
    const want = new Map();
    const guarding = guardOn();
    for (const f of guard) if (guarding && mine(f)) want.set(f.id, true);
    if (settled()) for (const f of lift) want.set(f.id, false);
    // switched off: the guards Auto mode set come off again
    if (!guarding && settled()) for (const a of model.animals.values()) if (a.guid && a.contra && l.guard[a.guid]) want.set(a.id, false);
    const now = Date.now();
    for (const [id, ask] of A.guardAsked) {
        const a = model.animals.get(id);
        if (!a || a.contra === ask.on || want.get(id) !== ask.on) A.guardAsked.delete(id);
    }
    for (const [id, bOn] of want) {
        const f = model.animals.get(id);
        const ask = A.guardAsked.get(id);
        if (ask && now - ask.at < GUARD_RETRY_MS) continue;
        const tries = ask ? ask.tries + 1 : 1;
        if (tries > GUARD_TRIES) {
            if (bOn && tries === GUARD_TRIES + 1) {
                dlog('auto', 'guard_failed', { species: f.species, animal: f.name, hab: f.hab });
                toast('guardFailed', { species: f.species, id, name: f.name });
            }
            A.guardAsked.set(id, { on: bOn, at: now, tries: GUARD_TRIES + 2 });
            continue;
        }
        A.guardAsked.set(id, { on: bOn, at: now, tries });
        if (!setContraception(id, bOn)) continue;
        noteGuard(l, f.guid, bOn);
        A.saveDirty = true;
        dlog('auto', bOn ? 'guard_on' : 'guard_off', { species: f.species, animal: f.name, hab: f.hab });
    }
    // a guarded female off contraception (by the player, or apart) and not at risk: no longer Auto mode's
    for (const a of model.animals.values()) {
        if (!a.guid || a.contra || !l.guard[a.guid] || want.get(a.id) === true) continue;
        noteGuard(l, a.guid, false);
        A.saveDirty = true;
    }
}

// How long each animal has been on the move, and one notice per stuck move.
function noteMoving(model) {
    const now = Date.now();
    for (const a of model.animals.values()) {
        if (!a.moving) {
            A.movingSince.delete(a.id);
            A.stuckTold.delete(a.id);
            continue;
        }
        const since = A.movingSince.get(a.id);
        if (!since) A.movingSince.set(a.id, { at: now, months: A.cal ? A.cal.months : null });
        // seen before the calendar was read: park time counts from the first reading
        else if (since.months == null && A.cal) since.months = A.cal.months;
    }
    for (const id of A.movingSince.keys()) if (!model.animals.has(id)) A.movingSince.delete(id);
    for (const id of stuckMoving()) {
        if (A.stuckTold.has(id)) continue;
        A.stuckTold.add(id);
        const a = model.animals.get(id);
        dlog('auto', 'stuck_move', { species: a.species, animal: a.name, hab: a.hab, seconds: Math.round((now - A.movingSince.get(id).at) / 1000) });
        toast('stuck', { species: a.species, id, name: a.name });
    }
}

// ids of the animals on the move for STUCK_MOVE_MONTHS of park time (a
// paused game never makes one stuck)
function stuckMoving() {
    const out = new Set();
    for (const [id, since] of A.movingSince) {
        const stuck = since.months != null && A.cal ? A.cal.months - since.months >= STUCK_MOVE_MONTHS : Date.now() - since.at >= STUCK_MOVE_MS;
        if (stuck) out.add(id);
    }
    return out;
}

// Relatives that now share a habitat (one grew up, or a move by hand): that
// species runs at once instead of waiting for its schedule. Once per new
// situation (kinConflicts' key), so a pair the plan can't separate yet is
// not planned again every scan.
function noteKinConflicts(model, l) {
    const now = kinConflicts(model, stuckMoving());
    const on = new Set(speciesOn(l));
    for (const [sp, key] of now) {
        if (!on.has(sp) || A.kinKeys.get(sp) === key) continue;
        A.kinKeys.set(sp, key);
        breadcrumb('auto_kin_conflict');
        dlog('auto', 'kin_conflict', { species: sp, pairs: key });
        enqueue(sp, true);
    }
    for (const sp of A.kinKeys.keys()) if (!now.has(sp)) A.kinKeys.delete(sp);
}

// A plan run from the breeding window or the Species board moves animals
// the way the programme wants them: expected, so not taken for moves made
// by hand (one moved during a run is left alone for the rest of it).
function notePlayerRun(r) {
    if (!r || !r.running || r.owner === 'autopilot' || r.owner === 'undo' || !r.moves || r.moves === A.playerRunMoves) return;
    A.playerRunMoves = r.moves;
    const model = A.model || getKinModel();
    for (const m of r.moves) {
        A.expected.set(String(m.id), { to: m.to, until: Date.now() + 60 * 60 * 1000 });
        // sent to the trade centre to leave (Thin out, a spare): it stays
        // there, as Auto mode's own sends do; a breeder with no place does not
        const a = m.to === TRADE && (m.spare || m.leave) && A.ledger && model ? model.animals.get(String(m.id)) : null;
        if (a && a.guid) {
            A.ledger.leave[a.guid] = 1;
            A.saveDirty = true;
        }
    }
    dlog('auto', 'player_run', { owner: r.owner, moves: r.moves.length });
}

// Animals waiting at the trade centre for a place (young, approved
// arrivals) do not age there: their species runs at once, once per new set.
function noteWaiting(model, l) {
    // leaving: sent there to leave, by a run, on its way, or landed in the run still moving (its marks come as it settles)
    const leaving = new Set([...ledgerView(l, model, parkYears(), Date.now()).leaving, ...onTheirWay(), ...(A.acting && A.acting.leaving ? A.acting.leaving : [])]);
    const now = waitingAtTradeCentre(model, leaving);
    const on = new Set(speciesOn(l));
    for (const [sp, key] of now) {
        if (!on.has(sp) || A.waitingKeys.get(sp) === key) continue;
        A.waitingKeys.set(sp, key);
        dlog('auto', 'waiting', { species: sp, ids: key });
        enqueue(sp, true);
    }
    for (const sp of A.waitingKeys.keys()) if (!now.has(sp)) A.waitingKeys.delete(sp);
}

// What shifts a species' best layout between runs: a birth or an arrival
// (A.changedAt, for freeParked), and a young animal grown up, a new breeder
// the plan has not weighed (a better sire than the one in place, a mate for
// a lone one). Its species runs at once instead of waiting for its schedule
// on a young one grown up, or on a birth or arrival while a breeder waits
// at the trade centre (noteWaiting) for the place it may have now.
function noteHerdChanges(model, l) {
    const on = new Set(speciesOn(l));
    const young = new Set();
    const herd = new Set();
    const grown = new Map();
    const changed = new Set();
    for (const a of model.animals.values()) {
        herd.add(a.id);
        if (A.herd.size && !A.herd.has(a.id)) changed.add(a.species);
        if (a.juv) young.add(a.id);
        else if (A.young.has(a.id) && on.has(a.species)) grown.set(a.species, (grown.get(a.species) || []).concat(a.name));
    }
    A.young = young;
    A.herd = herd;
    for (const sp of changed) A.changedAt.set(sp, parkYears());
    for (const [sp, names] of grown) {
        A.changedAt.set(sp, parkYears());
        dlog('auto', 'grew_up', { species: sp, animals: names.join(' ') });
        enqueue(sp, true);
    }
    for (const sp of changed) {
        if (!on.has(sp) || grown.has(sp) || !A.waitingKeys.has(sp)) continue;
        dlog('auto', 'herd_changed', { species: sp, waiting: A.waitingKeys.get(sp) });
        enqueue(sp, true);
    }
}

// The Storage window's "Sell advice" filter runs on the hub's page: Lua
// holds the list between the two pages (PZ2QoL_SellAdviceSet).
async function noteSellAdvice(species, r, model) {
    const epoch = A.epoch;
    const stored = await requestStoredAdults(species);
    if (A.epoch !== epoch || !A.running) return;
    const known = stored && !stored.error && !stored.capped ? stored : null;
    setSellAdvice(mergeSellAdvice(A.sellAdvice, model, species, r && r.sellable, { keep: r && r.keep, stored: known, wanted: A.wanted.get(species), ages: A.ledger && A.ledger.ages, rowAges: storedRowAges(), earlySale: earlySale(), maxChars: SELL_ADVICE_MAX_CHARS }));
}

// The Kin setting Habitat set aside turns Auto on (autoForAssigned)
function autoOnAssign() {
    return (getKinSettings() || {}).autoOnAssign !== false;
}

// The Kin setting Breeders to storage before elderly (kinageing sellsBeforeElderly)
function earlySale() {
    return (getKinSettings() || {}).autoEarlySale !== false;
}

// The Kin setting Bring waiting animals into a habitat (programmeOptionsFor housing)
function houseWaiting() {
    return (getKinSettings() || {}).autoHouseWaiting !== false;
}

// The Kin setting Contraception near a relative (guardKin)
function guardOn() {
    return (getKinSettings() || {}).autoContraception !== false;
}

// Animal Storage's adults Auto mode may suggest: not the park's own, nor one
// it last saw at the trade centre near elderly
async function storedForAuto(model, species) {
    return withoutAgeing(withoutParkAnimals(model, species, await requestStoredAdults(species)), A.ledger && A.ledger.ages, storedRowAges(), earlySale());
}

function setSellAdvice(next) {
    const json = JSON.stringify(Array.from(next.values()));
    if (json === JSON.stringify(Array.from(A.sellAdvice.values()))) return;
    A.sellAdvice = next;
    dlog('auto', 'sell_advice', { animals: next.size });
    try {
        engine.trigger('PZ2QoL_SellAdviceSet', json);
    }
    catch (e) {
        reportError('mod', 'Auto mode: the sell advice could not reach the Storage window', e, { silent: true });
    }
}

// Stored adults that would breed better than the weakest of their sex in
// a habitat set aside for the species (storageUpgrades, Franchise: the
// stored adults the game's Compare Mates lists).
function upgradesFor(species, plan, model, assignments, stored) {
    const moved = new Map(plan.moves.map(m => [String(m.id), String(m.to)]));
    const endOf = a => moved.get(String(a.id)) || a.hab || null;
    // why each other stored adult is not offered, in the log when it changes
    const onSkip = (s, why) => {
        if (A.skipWhy.get(s.guid) === why) return;
        A.skipWhy.set(s.guid, why);
        dlog('auto', 'storage_skip', { species, name: s.name, sex: s.sex, score: ownGeneScore(s), why });
    };
    return storageUpgrades(model, species, stored, { assignments, endOf, onSkip });
}

// Stored adults the programme would bring into the species' habitats as
// they stand (storageTrial: a harem's extra females, a pair for an empty
// habitat), asked only after a run that moves nothing. One it would bring
// in is still needed: never advised to sell. -> [addition] or null when
// the zoo changed meanwhile
async function additionsFor(species, run, stored) {
    const { model, info, dest, assignments, settings, ratio } = run;
    const trial = storageTrial(model, species, stored);
    if (!trial) return [];
    const cpu = AUTO_CPU;
    const epoch = A.epoch;
    const r = await planProgrammeAsync(trial.model, species, info || {}, dest, {
        assignments,
        options: programmeOptionsFor(settings, ratio, new Set(trial.pinIds), getPref(TUNE_PREF), houseWaiting()),
        sliceMs: cpu.sliceMs,
        restMs: cpu.restMs,
        isCancelled: () => A.epoch !== epoch || !A.running,
    });
    if (A.epoch !== epoch || !A.running) return null;
    const all = storageAdditions(trial, r);
    const wanted = new Set(all.map(x => String(x.guid)));
    A.wanted.set(species, wanted);
    const kept = new Map(Array.from(A.sellAdvice).filter(([g]) => !wanted.has(g)));
    if (kept.size !== A.sellAdvice.size) setSellAdvice(kept);
    return all;
}

// An animal on its way from storage is in neither storage nor the zoo, so
// each run until it arrives would offer the next best for its place: an
// animal, and a habitat's place of one sex, are told in one notice per zoo
// load (Run now tells them again). told: the species' told keys.
function untold(told, items) {
    const slot = x => `slot|${x.hab}|${x.sex}`;
    const fresh = items.filter(x => !told.has(`store|${x.guid}`) && !told.has(slot(x)));
    for (const x of fresh) {
        told.add(`store|${x.guid}`);
        told.add(slot(x));
    }
    return fresh;
}

// A run's notices: what to bring from storage as one list (the programme's
// additions, a pick for each need they leave open, the upgrades for the
// places left: mergeStorageSuggestions), and the needs, sell, keep and
// elderly notices. While arrivals of the species wait at the trade centre
// they are placed first: the storage trial holds every park animal where
// it stands, so they would look stuck there, and their places would be
// asked of storage again.
async function noteRunNotices(species, r, plan, model, assignments, run) {
    if (!A.needKeys.has(species)) A.needKeys.set(species, new Set());
    const told = A.needKeys.get(species);
    const waiting = A.waitingKeys.has(species);
    const fresh = freshNotices(told, atTradeCentre(waiting ? Object.assign({}, r, { needs: [] }) : r, model));
    const moved = new Map(((r && r.moves) || []).map(m => [String(m.id), String(m.to)]));
    const endOf = a => moved.get(String(a.id)) || a.hab || null;
    // the Market's dim line for each need (marketDimFor), and the mates its
    // listings' calves are predicted with (marketMatesFor)
    const needs = fresh ? fresh.needs.map(n => Object.assign({}, n, { dimBelow: marketDimFor(model, species, n.sex), market: marketMatesFor(model, species, n, endOf) })) : [];
    let items = [];
    let unfilled = needs;
    if (!waiting) {
        // the park's own animals can still be in the game's storage list
        const stored = await storedForAuto(model, species);
        if (stored && !stored.error && stored.animals.length) {
            const additions = run ? await additionsFor(species, run, stored) : [];
            if (!additions) return;
            const taken = new Set(additions.map(x => x.guid));
            const rest = Object.assign({}, stored, { animals: stored.animals.filter(s => !taken.has(s.guid)) });
            const byGuid = new Map(stored.animals.map(s => [s.guid, s]));
            const picks = bestForNeeds(model, species, rest, needs, { endOf });
            const withPicks = needs.map((n, i) => Object.assign({}, n, {
                bring: picks[i].map(({ guid, young }) => ({ guid, name: byGuid.get(guid).name, sex: byGuid.get(guid).sex, genes: genePercents(byGuid.get(guid)), young, listed: !!byGuid.get(guid).forSale })),
            }));
            const merged = mergeStorageSuggestions({ additions, needs: withPicks, upgrades: upgradesFor(species, plan, model, assignments, stored) });
            items = untold(told, merged.items);
            unfilled = merged.unfilled;
        }
    }
    if (fresh) {
        const out = Object.assign({ species }, fresh, { needs: unfilled, sellTotal: ((r && r.sellable) || []).length });
        dlog('auto', 'notice', {
            species,
            needs: unfilled.map(n => `${n.hab}:${n.sex}`).join(' '),
            sell: out.sellable.map(x => x.id).join(' '),
            keep: out.keep.map(x => x.id).join(' '),
            blockers: out.blockers.map(b => b.id).join(' '),
        });
        if (unfilled.length || out.sellable.length || out.keep.length || out.blockers.length) toast('needs', out);
    }
    if (!items.length) return;
    for (const x of items) dlog('auto', 'storage', { species, role: x.role, name: x.name, sex: x.sex, young: x.young, hab: x.hab, replaces: x.replacesName || '' });
    toast('storage', { species, items });
}

// Calves growing up with no unrelated partner of the other sex in the zoo
// (kinbloodline.js), each sex wanted told once per zoo load with the best
// stored animal for them, so a partner arrives before they can breed.
async function noteFreshBlood(species, model) {
    if (!A.needKeys.has(species)) A.needKeys.set(species, new Set());
    const told = A.needKeys.get(species);
    const fresh = freshBloodNeeds(model, species).filter(n => {
        const k = `fresh|${n.sex}`;
        if (told.has(k)) return false;
        told.add(k);
        return true;
    });
    if (!fresh.length) return;
    const stored = await storedForAuto(model, species);
    const readable = stored && !stored.error;
    const needs = fresh.map(n => ({
        sex: n.sex,
        calves: n.calves.map(c => ({ id: c.id, name: c.name, hab: c.hab })),
        bring: readable ? bestFreshBlood(model, species, stored, n) : undefined,
        dimBelow: marketDimFor(model, species, n.sex),
        mates: n.calves.filter(c => c.genes).map(c => c.genes),
    }));
    for (const n of needs) dlog('auto', 'fresh_blood', { species, sex: n.sex, calves: n.calves.map(c => c.name).join(' '), bring: n.bring ? n.bring.name : readable ? 'none in storage' : 'storage unread' });
    toast('fresh', { species, needs });
}

// A sire breeding well under the species' standard (sireStandard) as the
// last option: told once per zoo load, to replace.
function noteWeakSires(species, plan, model, dest) {
    const l = A.ledger;
    const { std, floor, below } = sireStandard(l.std[species] || null, groupSires(model, species, plan.moves, dest), parkYears());
    if (std && (!l.std[species] || l.std[species][0] !== std[0] || l.std[species][1] !== std[1])) {
        l.std[species] = std;
        A.saveDirty = true;
    }
    if (!A.needKeys.has(species)) A.needKeys.set(species, new Set());
    const told = A.needKeys.get(species);
    for (const { a, avg, mates } of below) {
        const key = `replace|${a.id}`;
        if (told.has(key)) continue;
        told.add(key);
        dlog('auto', 'weak_sire', { species, animal: a.name, hab: a.hab, average: avg, standard: std[0] });
        toast('replace', { species, id: a.id, name: a.name, avg, std: std[0], mates, floor });
    }
}

// The sell and keep advice waits until Auto mode has the animal at the
// trade centre, the only place the Storage window lists it from.
function atTradeCentre(r, model) {
    if (!r || !r.sellable) return r;
    const there = x => {
        const a = model.animals.get(String(x.id));
        return a && a.lt === 'trade' && !a.moving;
    };
    return Object.assign({}, r, { sellable: r.sellable.filter(there), keep: (r.keep || []).filter(there) });
}

// What a species' plan could not fill from the zoo and the trade centre
// (partners to bring from storage or buy, elderly animals in the way), and
// the weak animals it can do without (to sell): each told once per zoo
// load (freshNotices), whether or not run notices are on.
// A need's bring: the best fitting stored animals ([{ guid, name, young }],
// [] when none fits), or none when the stored adults could not be read.
// ------------------------------------------------------------- deciding

let boardModule = null;
function loadBoard() {
    if (boardModule) return Promise.resolve(boardModule);
    return import('/js/mods/pz2qol/kinboard.js').then(m => (boardModule = m));
}

// The player is working on this species on the board (a staged plan with
// its animals, its Breeding programme or Thin out open, a drag, a Move now)
function boardBusy(species) {
    try {
        return !!(boardModule && boardModule.isBoardBusy && boardModule.isBoardBusy(species));
    }
    catch (e) {
        return false;
    }
}

// Every reason nothing can start now (none: it can).
function blockedReasons() {
    if (!A.running) return ['off'];
    if (!A.model) return ['no park'];
    const out = [];
    if (!settled()) out.push(SETTLING_WHY);
    if (getPlanRun().running) out.push('a plan is running');
    if (isGamePopupOpen()) out.push('a game window is open');
    return out;
}

function blockedNow() {
    return blockedReasons()[0] || '';
}

function pausedNow(species) {
    const until = A.pausedUntil.get(species);
    return until != null && Date.now() < until;
}

function speciesBlocked(species) {
    const model = A.model;
    if (!model) return 'no park';
    if (pausedNow(species)) return PAUSED_WHY;
    const stuck = stuckMoving();
    if (Array.from(model.animals.values()).some(a => a.species === species && a.moving && !stuck.has(a.id))) return 'some of them are on the move';
    if (boardBusy(species)) return 'you are planning this species on the board';
    const dj = safe(() => deepJob(), 'deep job');
    if (dj && dj.species === species) return 'a deep search of this species is running';
    return '';
}

// ----------------------------------------------------------------- queue
// One run at a time: species whose turn has come wait in a queue, in the
// order they came due, and run one after another. Nothing is skipped or
// asked for again while another run (Auto mode's or the board's) goes on;
// a species that can't run just now (its animals on the move, the player
// planning it on the board) lets the next one go first and keeps its place.

function enqueue(species, front = false) {
    if (A.queue.includes(species)) {
        if (!front) return;
        dequeue(species);
    }
    if (front) A.queue.unshift(species);
    else A.queue.push(species);
}

function dequeue(species) {
    A.queue = A.queue.filter(x => x !== species);
}

// Every species whose run is due joins the queue (once).
function queueDue() {
    const l = A.ledger;
    if (cleaningZoo(l)) return queueClean();
    if (l && l.clean) queueClean();
    if (!A.cal || !l) return;
    for (const sp of speciesOn(l)) {
        const retry = (A.retryAt.get(sp) || Infinity) <= Date.now();
        if (!retry && !scheduledDue(l.sp[sp], A.cal.months, Date.now())) continue;
        if (A.planning === sp || (A.acting && A.acting.species === sp)) continue;
        if (pausedNow(sp)) continue;
        if (A.model && isCollective(A.model, sp)) continue;
        A.retryAt.delete(sp);
        enqueue(sp);
    }
}

// Clean up: every species it runs for, each again a short while after its
// last run (a birth or a young one growing up is seen soon). Habitats with
// nothing left in them end it once the zoo is read.
function queueClean() {
    const now = Date.now();
    const scope = cleanScope();
    const all = cleanScopeSpecies(scope);
    if (scope.habs && !all.length && settled()) return endClean([]);
    for (const sp of all) {
        if ((A.cleanAt.get(sp) || 0) > now) continue;
        if (A.planning === sp || (A.acting && A.acting.species === sp)) continue;
        enqueue(sp);
    }
}

function zooSpecies(model) {
    if (!model) return [];
    const all = new Set();
    for (const a of model.animals.values()) if (a.species && !a.exhibit && a.alive !== false) all.add(a.species);
    return Array.from(all).filter(sp => !isCollective(model, sp));
}

function cleansNow(species) {
    return cleanScopeSpecies(cleanScope()).includes(species);
}

// The next species that can run now (it leaves the queue), or null.
function takeNext() {
    const l = A.ledger;
    for (const sp of A.queue) {
        if (!l || (!cleansNow(sp) && (!l.sp[sp] || !l.sp[sp].on || l.stopped[sp]))) {
            dequeue(sp);
            return takeNext();
        }
        if (speciesBlocked(sp)) continue;
        dequeue(sp);
        return sp;
    }
    return null;
}

// the animals Auto mode sent to the trade centre that may still be on their way there
function onTheirWay() {
    const out = [];
    for (const [id, e] of A.expected) if (e.to === TRADE) out.push(String(id));
    return out;
}

function tradeFree(model) {
    // the game's own numbers (PZ2QoL_AutoGate), else unknown (a send to a
    // full centre is refused and skipped); the game counts an animal a
    // keeper still carries there only now and then, so Auto mode's own on
    // their way take a place already
    const g = A.lastGate;
    if (!g || typeof g.tcMax !== 'number' || typeof g.tcCount !== 'number') return null;
    let coming = 0;
    for (const [id, e] of A.expected) {
        const a = model && model.animals.get(id);
        if (e.to === TRADE && a && a.lt !== 'trade') coming++;
    }
    return Math.max(0, g.tcMax - g.tcCount - coming);
}

// The habitats the game should describe for the species (as the board asks).
function habitatsFor(model, species, dest) {
    const habs = new Set();
    for (const a of model.animals.values()) if (a.species === species && a.hab) habs.add(a.hab);
    const d = dest && dest.bySpecies && dest.bySpecies[species];
    if (d) for (const [h, v] of Object.entries(d)) if (v && v.ok) habs.add(String(h));
    for (const [h, set] of getAssignments(model)) if (set && set.has(species)) habs.add(String(h));
    return Array.from(habs);
}

// One species' plan for the zoo as it is now (null: cancelled).
async function makePlan(species) {
    const here = stillHere();
    const version = A.changed.get(species) || 0;
    const fresh = () => here() && (A.changed.get(species) || 0) === version;
    const model = A.model;
    if (!model) return null;
    const ids = [];
    for (const a of model.animals.values()) if (a.species === species && !a.exhibit) ids.push(a.id);
    let dest = await requestDestinations(ids);
    const info0 = await requestSpeciesInfo(species, habitatsFor(A.model || model, species, dest));
    const info = info0 && !info0.error ? info0 : null;
    const gate = await askGate();
    if (!fresh()) return null;
    noteGate(gate);
    const l = A.ledger;
    const key = cleanKey(l);
    // a female guarded against inbreeding is planned as the breeder she is (withGuardsLifted)
    let cur = l ? withGuardsLifted(A.model, guardedGuids(l)) : A.model;
    const scope = cleanScope(l, cur);
    if (cur && scope && (scope.zoo || cleanScopeSpecies(scope).includes(species))) {
        const plan = cleanPlan(species, cur, dest, scope, key);
        const breeds = !!(l.sp[species] && l.sp[species].on && !l.stopped[species]);
        if (scope.zoo || plan.moves.length || !breeds) return plan;
    }
    if (!cur || !l || !l.sp[species] || !l.sp[species].on) return null;
    const settings = l.sp[species];
    const ratio = ratioChoice(species);
    let assignments = getAssignments(cur);
    if (scope) ({ model: cur, destinations: dest, assignments } = withoutHabitats(cur, dest, assignments, scope.habs));
    const view = ledgerView(l, cur, parkYears(), Date.now());
    // the ledger's hold on the species by name, so a trace replays as the run saw it (tools/trace-to-zoo.mjs)
    const held = set => Array.from(set).map(id => cur.animals.get(id)).filter(a => a && a.species === species).map(a => a.name).join(',');
    const parked = freeParked(cur, species, view, A.changedAt.get(species));
    view.cooled = parked.cooled;
    view.recentFrom = parked.recentFrom;
    if (parked.freed.length) dlog('auto', 'unparked', { species, animals: held(parked.freed) });
    dlog('auto', 'view', { species, pinned: held(view.pinned), manual: held(view.manual), cooled: held(view.cooled), leaving: held(view.leaving) });
    const input = { model: cur, species, info, destinations: dest, assignments, settings, ratio, view, tradeFree: tradeFree(cur), earlySale: earlySale(), houseWaiting: houseWaiting() };
    // Thin out first, then the programme on the zoo as it leaves it
    const cpu = AUTO_CPU;
    const fp = A.prints.get(species);
    const solve = p => planProgrammeAsync(p.model, species, info || {}, dest, {
        assignments,
        options: programmeOptionsFor(p.settings, ratio, p.pins, getPref(TUNE_PREF), houseWaiting()),
        sliceMs: cpu.sliceMs,
        restMs: cpu.restMs,
        isCancelled: () => !fresh() || !A.ledger.sp[species] || !A.ledger.sp[species].on,
    });
    let prep = prepareAutoRun(input);
    let r = await solve(prep);
    // another zoo, the species turned off, or its settings changed meanwhile:
    // this plan is not used (the next tick plans again)
    if (!fresh() || !A.ledger.sp[species] || !A.ledger.sp[species].on) return null;
    let plan = finishAutoRun(input, prep, r);
    // never inbreed: a held move that leaves a related pair together gets the other of the pair moved (heldKinIds)
    const hold = heldKinIds(input, plan);
    if (hold.length) {
        dlog('auto', 'replan_kin', { species, hold: held(new Set(hold)) });
        prep = prepareAutoRun(input, hold);
        r = await solve(prep);
        if (!fresh() || !A.ledger.sp[species] || !A.ledger.sp[species].on) return null;
        plan = finishAutoRun(input, prep, r);
    }
    // a run that still moves animals leaves another zoo (a lock it lifts, a
    // partner it frees): its needs wait for the run that moves nothing
    r = withAgeingAdvice(r, cur, species, input.earlySale);
    const told = r && plan.moves.length ? Object.assign({}, r, { needs: [] }) : r;
    plan.fp = fp;
    plan.cleanKey = key;
    plan.session = A.session;
    plan.at = Date.now();
    plan.destinations = dest;
    A.lastPlan.set(species, plan);
    noteSellAdvice(species, r, cur).catch(e => reportError('mod', 'Auto mode: sell advice failed', e, { silent: true }));
    const run = plan.moves.length ? null : { model: cur, info, dest, assignments, settings: prep.settings, ratio };
    noteRunNotices(species, told, plan, cur, assignments, run).catch(e => reportError('mod', 'Auto mode: the run notices failed', e, { silent: true }));
    noteFreshBlood(species, cur).catch(e => reportError('mod', 'Auto mode: fresh blood check failed', e, { silent: true }));
    noteWeakSires(species, plan, cur, dest);
    const nameOf = id => ((cur.animals.get(String(id)) || {}).name || String(id));
    dlog('auto', 'plan', {
        species,
        moves: plan.moves.length,
        held: plan.held.length,
        locked: prep.locked.size,
        kinBefore: r && r.before ? r.before.relatedPairs : '',
        kinAfter: r && r.after ? r.after.relatedPairs : '',
    });
    dlog('auto', 'plan_groups', Object.assign({ species }, programmeLogData(r)));
    for (const m of plan.moves) dlog('auto', 'plan_move', { species, animal: nameOf(m.id), to: m.to, why: m.reason || '' });
    for (const x of plan.held) dlog('auto', 'plan_held', { species, animal: nameOf(x.id), why: x.why });
    return plan;
}

// Clean up's run for one species (kinautocore cleanupRun).
function cleanPlan(species, cur, dest, scope, key) {
    const l = A.ledger;
    const view = ledgerView(l, cur, parkYears(), Date.now());
    const plan = cleanupRun({ model: cur, species, destinations: dest, view: Object.assign({}, view, { leaving: [...view.leaving, ...onTheirWay()] }), tradeFree: tradeFree(cur), habs: scope.habs });
    Object.assign(plan, { fp: A.prints.get(species), cleanKey: key, session: A.session, at: Date.now(), destinations: dest });
    A.cleanAt.set(species, Date.now() + CLEAN_GAP_MS);
    const c = plan.clean;
    const nameOf = id => ((cur.animals.get(String(id)) || {}).name || String(id));
    dlog('auto', 'clean', { species, moves: plan.moves.length, pregnant: c.pregnant, young: c.young, elderly: c.elderly.join(','), kept: c.kept.join(','), done: c.done });
    for (const m of plan.moves) dlog('auto', 'plan_move', { species, animal: nameOf(m.id), to: m.to, why: m.reason || '' });
    noteCleaned(species, c);
    return plan;
}

// Clean up ends by itself once every species it runs for is done (only
// elderly or hands-off animals left), so animals bought afterwards are not
// swept up.
function noteCleaned(species, c) {
    if (c.done) A.cleanDone.set(species, c);
    else A.cleanDone.delete(species);
    const all = cleanScopeSpecies(cleanScope());
    if (!all.every(sp => A.cleanDone.has(sp))) return;
    endClean(all.map(sp => Object.assign({ species: sp }, A.cleanDone.get(sp))).filter(x => x.elderly.length || x.kept.length));
}

// An emptied habitat is set aside for nothing, so Auto mode does not fill it again.
function endClean(left) {
    const habs = A.ledger.clean && A.ledger.clean.habs ? A.ledger.clean.habs.map(x => x[0]).filter(Boolean) : null;
    let unset = 0;
    for (const hab of cleanHabitatIds(A.ledger, A.model)) {
        for (const sp of assignmentsOf(A.model, hab)) {
            safe(() => {
                toggleAssignment(A.model, hab, sp);
                unset++;
            }, 'set aside');
        }
    }
    A.ledger.clean = false;
    A.cleanDone.clear();
    A.cleanAt.clear();
    saveLedger(true);
    breadcrumb('auto_clean_done');
    toast('cleaned', { left, habs, unset });
    sync();
    notify();
}

// Clean up: 'zoo' turns breeding off for every species (a move already sent
// finishes, nothing else of a breeding run does) and empties the zoo; a list
// of habitat ids empties those while Auto mode breeds on in the others; null
// stops. -> false when the zoo's data can't be kept or no habitat is known.
export function setCleanUp(target) {
    if (!storeReady()) return false;
    const l = currentLedger();
    const clean = target ? cleanFor(A.model || getKinModel(), target) : false;
    if (target && !clean) return false;
    if (clean && clean.zoo) {
        for (const s of Object.values(l.sp)) s.on = false;
        A.queue = [];
    }
    if (clean) A.lastPlan.clear();
    l.clean = clean;
    A.cleanDone.clear();
    A.cleanAt.clear();
    if (!clean) breadcrumb('auto_clean_off');
    else if (clean.zoo) breadcrumb('auto_clean_on');
    else breadcrumb('auto_clean_habs');
    saveLedger(true);
    sync();
    notify();
    return true;
}

// The Clean up running, for the UI: null, { zoo: true }, or { habs: [habitat
// id] (this load's), names: [habitat name] (as kept) }.
export function getCleanUp() {
    const l = A.ledger;
    if (!l || !l.clean) return null;
    if (l.clean.zoo) return { zoo: true };
    return { habs: Array.from(cleanHabitatIds(l, A.model || getKinModel())), names: l.clean.habs.map(x => x[0]).filter(Boolean) };
}

async function planOne(species) {
    A.planning = species;
    notify();
    try {
        const plan = await makePlan(species);
        if (!plan || plan.session !== A.session) return;
        if (!plan.moves.length) {
            finishRun(species, { moves: 0, skipped: 0, note: 'nothing to change', notes: plan.notes });
            return;
        }
        A.planning = null;
        await startRun([plan], 'auto');
    }
    catch (e) {
        reportError('mod', `Auto mode: planning ${species} failed`, e, { silent: true });
        A.pausedUntil.set(species, Date.now() + AUTO_LIMITS.pauseAfterSkipsMs);
    }
    finally {
        if (A.planning === species) A.planning = null;
        notify();
    }
}

function tick() {
    if (!A.running) return;
    const now = Date.now();
    A.lastTick = now;
    // fresher scans while on (kin.js keeps its own gap between requests)
    const gap = A.acting ? SCAN_FAST_MS : SCAN_MS;
    if (now - A.lastScan >= gap) requestKinScan('auto');
    const l = A.ledger;
    if (!l || !A.model) return;
    // the park's calendar (the schedule is game time)
    if (!A.calAsking && (!A.cal || now - A.cal.at >= CAL_MS)) {
        A.calAsking = true;
        const sess = A.session;
        askGate().then(g => {
            A.calAsking = false;
            if (A.session === sess) noteGate(g);
        }, () => {
            A.calAsking = false;
        });
    }
    if (A.saveDirty) saveLedger(false);
    queueDue();
    const why = blockedNow();
    if (why !== A.lastWhy) {
        A.lastWhy = why;
        dlog('auto', 'gate', { why: why || 'clear', queue: A.queue.join(' ') });
    }
    if (why || A.planning || A.acting) return;
    const sp = takeNext();
    if (sp) planOne(sp);
}

// Run now on the board: this species goes to the front of the queue and
// runs as soon as nothing else is running (at once if nothing is).
// -> 'now', 'queued', or why it can't.
export function runSpeciesNow(species) {
    const l = A.ledger;
    if (!l || !l.sp[species] || !l.sp[species].on) return 'Auto mode is off for this species';
    // the player's Run is the answer to a stop: it hands the species back
    if (l.stopped[species]) resumeSpeciesAuto(species);
    if (!A.running) return 'Auto mode is off for this species';
    if (A.model && isCollective(A.model, species)) return 'Auto mode does not manage shoals and colonies';
    if (A.planning === species || (A.acting && A.acting.species === species)) return 'now';
    A.pausedUntil.delete(species);
    // the player asked: the species' notices are told again
    A.needKeys.delete(species);
    enqueue(species, true);
    // the player's click does not wait out the minute after a zoo loads
    const busy = !!(A.planning || A.acting || blockedReasons().some(why => why !== SETTLING_WHY) || speciesBlocked(species));
    if (!busy) {
        dequeue(species);
        planOne(species);
    }
    notify();
    return busy ? 'queued' : 'now';
}

// A run is over (or there was nothing to do): the next one on schedule.
function finishRun(species, { moves, skipped, note, notes = [] }) {
    const l = A.ledger;
    if (!l || !l.sp[species]) return;
    const s = l.sp[species];
    s.next = (A.cal ? A.cal.months : 0) + s.every;
    s.last = { real: Date.now(), run: l.run, moves, skipped, note: note || '' };
    // what the run could not do (trade centre full, no unrelated partner)
    if (notes.length) s.last.notes = notes.slice(0, 3).map(t => String(t).slice(0, 160));
    if (skipped >= AUTO_LIMITS.skipsToPause) A.pausedUntil.set(species, Date.now() + AUTO_LIMITS.pauseAfterSkipsMs);
    saveLedger(true);
    dlog('auto', 'done', { species, moves, skipped, note: note || '' });
    if (moves || skipped) toast('done', { species, moves, skipped });
}

// ---------------------------------------------------------------- acting

const sleep = ms => new Promise(r => setTimeout(r, ms));

let gateSeq = 0;
const gateWaiting = new Map();
let gateInstalled = false;

function askGate() {
    if (typeof engine === 'undefined') return Promise.resolve(null);
    if (!gateInstalled) {
        gateInstalled = true;
        engine.on('PZ2QoL_AutoGateResult', (reqId, json) => {
            const done = gateWaiting.get(String(reqId));
            if (!done) return;
            gateWaiting.delete(String(reqId));
            let v = null;
            try {
                v = JSON.parse(json);
            }
            catch (e) {
                v = null;
            }
            done(v);
        });
    }
    const id = 'G' + (++gateSeq);
    return new Promise(resolve => {
        const t = setTimeout(() => {
            if (gateWaiting.delete(id)) resolve(null);
        }, GATE_TIMEOUT_MS);
        gateWaiting.set(id, v => {
            clearTimeout(t);
            resolve(v);
        });
        try {
            engine.trigger('PZ2QoL_AutoGate', id);
        }
        catch (e) {
            gateWaiting.delete(id);
            clearTimeout(t);
            resolve(null);
        }
    });
}

// The game's side: '' to go on, or why not now. Waits while a Franchise
// server request is in flight (as the lister does).
async function gameGate() {
    if (isGamePopupOpen()) await sleep(1500);
    let modeWaits = 0;
    let unanswered = 0;
    for (let i = 0; i < 10; i++) {
        const g = await askGate();
        noteGate(g);
        // no answer (timed out, unreadable, the Lua side not listening): never taken as a yes
        if (!g) {
            if (++unanswered >= GATE_ASKS) return GATE_SILENT_WHY;
            await sleep(1000);
            continue;
        }
        if (g.park === false) return NO_PARK_WHY;
        if (g.move === false) return 'the game does not allow moving animals right now';
        // the player may be placing animals with the game's Move screen; the
        // mode name is only a hint (it is not reset when a park ends), so
        // wait a little, then go on
        if (g.uiMode === 'AnimalMovementMode' && modeWaits < 3) {
            modeWaits++;
            await sleep(2000);
            continue;
        }
        if (g.dbBusy === true) {
            await sleep(1000);
            continue;
        }
        return '';
    }
    return 'the game stayed busy';
}

// The player's word on one animal of a run in flight: marked hands off, or
// moved by hand since the run started ('' when neither).
function handsOffWhy(l, id, manualAtStart) {
    const model = A.model || getKinModel();
    if (isPinnedAnimal(l, model, id)) return 'you marked it hands off';
    if (!manualAtStart.has(String(id)) && isManualAnimal(l, model, id, parkYears())) return 'you moved it by hand during the run';
    return '';
}

async function startRun(plans, how) {
    if (A.acting) return;
    const l = A.ledger;
    const here = stillHere();
    A.acting = { species: plans[0] && plans[0].species, step: 0, total: 0, text: '' };
    breadcrumb('auto_run_start');
    notify();
    try {
        for (let plan of plans) {
            if (!plan || !here() || plan.session !== A.session) break;
            const species = plan.species;
            if (!planLive(l, plan)) continue;
            // planned on an older zoo: planned again first
            if (A.prints.get(species) !== plan.fp) {
                A.acting = { species, step: 0, total: 0, text: 'Planning again with the zoo as it is now' };
                notify();
                plan = await makePlan(species);
                if (!plan || !here()) continue;
                if (!plan.moves.length) {
                    finishRun(species, { moves: 0, skipped: 0, note: 'nothing to change', notes: plan.notes });
                    continue;
                }
            }
            // the board started a run meanwhile: this species waits at the
            // front of the queue
            if (getPlanRun().running) {
                enqueue(species, true);
                break;
            }
            l.run = (l.run || 0) + 1;
            const run = l.run;
            const model = getKinModel() || A.model;
            // a move back to a habitat left recently: two of them and Auto
            // mode stops for the species instead of trading animals back and forth
            if (plan.moves.some(x => x.reversal) && noteReversal(l, species, parkYears())) {
                breadcrumb('auto_stopped');
                saveLedger(true);
                toast('stopped', { species });
                continue;
            }
            const entries = new Map();
            for (const x of plan.moves) {
                entries.set(x.id, logAction(l, model, x, { run, clock: parkYears(), realNow: Date.now(), species }));
                A.expected.set(String(x.id), { to: x.to, until: Date.now() + 60 * 60 * 1000 });
            }
            A.quiet.set(species, Infinity);
            A.acting = { species, step: 0, total: plan.moves.length, text: 'Moving animals, one at a time', leaving: new Set(plan.moves.filter(x => x.leave).map(x => String(x.id))) };
            notify();
            const manualAtStart = ledgerView(l, model, parkYears(), Date.now()).manual;
            const res = await runPlan(plan.moves.map(x => ({ id: x.id, to: x.to })), {
                destinations: plan.destinations, owner: 'autopilot',
                beforeEach: async m => {
                    if (!here()) {
                        // another zoo: nothing more of this plan
                        safe(() => stopPlan(), 'stop run');
                        return 'another zoo was loaded';
                    }
                    if (!planLive(l, plan)) return notLiveWhy(l, plan);
                    const why = handsOffWhy(l, m.id, manualAtStart) || await gameGate();
                    if (why === GATE_SILENT_WHY) {
                        // the rest of the run would wait on the same silence
                        dlog('auto', 'gate_silent', { species });
                        safe(() => stopPlan(), 'stop run');
                    }
                    return why;
                },
            });
            A.quiet.set(species, Date.now() + QUIET_MS);
            // the zoo changed under the run: its results belong to the old one
            if (!here()) break;
            // the run never started (the board's own run got there first)
            const notRun = !res.log;
            const after = getKinModel();
            let moved = 0, skipped = 0, onTheMove = false;
            const tradeFull = tradeFree(after) === 0;
            for (const x of plan.moves) {
                const id = String(x.id);
                const a = after && after.animals.get(id);
                const { landed, asked, why } = moveOutcome(res, after, id, x.to);
                if (!landed && (why === ALREADY_MOVING_WHY || why === NO_PARK_WHY)) onTheMove = true;
                // only a move the game itself refused counts against it later
                // (not one the run never got to: Stop, the run's own checks; nor
                // one left unconfirmed, as when the hub opens mid-run, nor one to a full trade centre)
                settleAction(l, entries.get(x.id), x, landed, { why: landed ? '' : why, clock: parkYears(), realNow: Date.now(), noFail: !asked || why === ALREADY_MOVING_WHY || why === UNCONFIRMED_WHY || (x.to === TRADE && tradeFull) });
                dlog('auto', 'move', { species, animal: a ? a.name : id, to: x.to, ok: landed, why: landed ? '' : why });
                if (landed) moved++;
                else {
                    if (why === ALREADY_MOVING_WHY || why === UNCONFIRMED_WHY) A.expected.set(id, { to: x.to, until: Date.now() + ON_THE_WAY_MS });
                    else A.expected.delete(id);
                    if (asked) skipped++;
                }
            }
            if (notRun) {
                enqueue(species, true);
                break;
            }
            finishRun(species, { moves: moved, skipped, note: '', notes: plan.notes });
            // the game was moving one already (a keeper's transport, growing
            // up), or the park was away (the hub): asked again once that is
            // over, not at the next schedule
            if (onTheMove) A.retryAt.set(species, Date.now() + MOVING_RETRY_MS);
        }
    }
    catch (e) {
        reportError('mod', 'Auto mode: a run failed', e, { silent: true });
    }
    finally {
        A.acting = null;
        // another zoo loaded meanwhile: its ledger is not this run's to write
        if (A.ledger === l) saveLedger(true);
        breadcrumb('auto_run_end');
        notify();
    }
}

// ----------------------------------------------------------------- undo

// Undo log entries (one move, or a whole run): each animal goes back where
// it came from, run like any player action. What it restores is left alone
// by Auto mode for a while.
export async function undoEntries(entries) {
    const model = getKinModel();
    if (!model || !A.ledger) return { ok: false, detail: 'No zoo data yet.' };
    if (getPlanRun().running || A.acting) return { ok: false, detail: 'A plan is running. Wait for it to finish.' };
    const moves = [];
    const why = [];
    const byId = new Map();
    for (const e of entries) {
        const u = undoOf(A.ledger, model, e);
        if (!u.action) {
            why.push(`${e.n}: ${u.why}`);
            continue;
        }
        moves.push(u.action);
        byId.set(String(u.action.id), e);
        A.expected.set(String(u.action.id), { to: u.action.to, until: Date.now() + 60 * 60 * 1000 });
    }
    let done = 0;
    if (moves.length) {
        const led = A.ledger;
        const res = await runPlan(moves, { owner: 'undo', beforeEach: () => gameGate() });
        // only what the game did is undone (and then left where it is)
        const after = getKinModel();
        for (const m of moves) {
            const e = byId.get(String(m.id));
            if (moveOutcome(res, after, m.id, m.to).landed) {
                if (A.ledger === led) noteUndone(led, after, e, parkYears());
                done++;
            }
            else {
                A.expected.delete(String(m.id));
                why.push(`${e.n}: the game did not move it`);
            }
        }
    }
    saveLedger(true);
    requestKinScan('auto_undo', { force: true, delay: 300 });
    notify();
    return { ok: true, done, skipped: why };
}

// ---------------------------------------------------------------- pins

// "Auto: hands off" in the card menu: never moved by Auto mode.
export function toggleAutoPin(id) {
    if (!storeReady()) return false;
    const l = currentLedger();
    const on = togglePinAnimal(l, getKinModel(), id);
    saveLedger(true);
    notify();
    return on;
}

export function isAutoPinned(id) {
    return !!A.ledger && isPinnedAnimal(A.ledger, getKinModel(), id);
}

// Moved by the player lately: Auto mode leaves it where it is for a while.
export function isAutoHeld(id) {
    return !!A.ledger && isManualAnimal(A.ledger, getKinModel(), id, parkYears());
}

// --------------------------------------------------------------- install

// Which species are on Auto in the zoo whose data the store holds now?
// Runs on every store read (a park started or ended, a save loaded). Until
// this zoo's data is read, Auto mode is off: the previous zoo's never
// carries over.
function checkZoo() {
    safe(() => {
        const sameZoo = A.ledgerEpoch === userDataEpoch();
        if (!storeReady()) {
            if (A.running) stop();
            if (!sameZoo) A.ledger = null;
            A.ledgerEpoch = userDataEpoch();
            notify();
            return;
        }
        if (!(sameZoo && A.ledger)) {
            if (A.running) stop();
            A.ledger = loadLedger();
            A.epoch = -1;
            A.lastPlan.clear();
        }
        sync();
        notify();
    }, 'zoo');
}

// Setting a habitat aside for a species turns its Auto mode on, unless the
// player set Auto mode for it before (speciesToSwitchOn).
function autoForAssigned() {
    const model = getKinModel();
    if (!autoOnAssign() || !model || !storeReady() || A.ledgerEpoch !== userDataEpoch() || !A.ledger) return;
    for (const sp of speciesToSwitchOn(getAssignments(model), A.ledger.sp, s => isCollective(model, s))) {
        if (setSpeciesAuto(sp, { on: true })) dlog('auto', 'auto_on', { species: sp, why: 'habitat set aside' });
    }
}

export function installAutopilot() {
    if (A.installed) return true;
    A.installed = true;
    onUserData(checkZoo);
    onAssignments(() => safe(autoForAssigned, 'auto on'));
    onKin((model, scope) => {
        if (scope === 'park' && model) safe(autoForAssigned, 'auto on');
    });
    checkZoo();
    return true;
}

// for the Node tests
export function _autopilotInternals() {
    return A;
}
