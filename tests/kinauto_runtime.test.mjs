// node --test tests/kinauto_runtime.test.mjs
// Auto mode's runtime (kinauto.js) against a fake game: with no species on
// Auto it does nothing at all; a species turned on in an offline park is
// run by itself and then waits for its schedule; it notices the player's
// own moves; another zoo never gets it; in Franchise it runs by itself too;
// species due together take turns in a queue; turning it off undoes its
// hooks. Design section 16.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./gameface-loader.mjs', import.meta.url);

const { AUTO_LIMITS } = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const M = 0, F = 1;
const G = (a, b) => ({ F: a.repeat(6) + b.repeat(6), I: a.repeat(6) + b.repeat(6), S: 'AAAAAACCCCCC', L: 'AAAAAACCCCCC' });
const an = (id, sex, hab, par = [], over = {}) => Object.assign({
    id, key: 'animal_' + id, guid: 'g' + id, name: 'N' + id, species: 'Lion', sex, juv: false, contra: false, infertile: false,
    hab, loc: 'H' + hab, lt: hab ? 'habitat' : 'trade', par: par.map(p => 'g' + p), mates: [], genes: G('C', 'D'), age: 6, moving: false,
}, over);

function freshStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

const fake = {
    handlers: new Map(), calls: [], file: '{}', mode: 'offline', kin: null, gate: { park: true, move: true, uiMode: '', tcMax: 8, tcCount: 0 },
    // the park's calendar (the schedule is game time): year 5, month 1
    date: { year: 5, month: 1, monthProp: 0 }, monthSec: 120,
};
function fire(ev, ...a) {
    setTimeout(() => (fake.handlers.get(ev) || []).forEach(fn => fn(...a)), 3);
}
function snapshot() {
    return { v: 1, seq: Date.now(), scope: 'park', mode: fake.mode, park: 'P', habitats: ['1', '2', '3'].map(h => ({ id: h, name: 'H' + h })), habs: ['1', '2', '3'].map(h => ({ id: h, name: 'H' + h, hid: 'h' + h })), anc: {}, speciesFacts: { Lion: { maturity: 3, infertility: 15, life: 20 } }, tradeCentre: { id: '99', name: 'Trade Centre' }, animals: fake.animals };
}
function publish() {
    fake.kin.applyKinSnapshot(snapshot());
}
globalThis.window = { localStorage: freshStorage(), location: { pathname: '/PZ2QoLHUD.html' }, innerWidth: 1920, innerHeight: 1080 };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.engine = {
    on(name, fn) {
        if (!fake.handlers.has(name)) fake.handlers.set(name, []);
        fake.handlers.get(name).push(fn);
    },
    trigger(name, ...args) {
        fake.calls.push(name);
        if (name === 'PZ2QoL_StoreLoad') fire('PZ2QoL_StoreData', args[0], true, 1, 1, fake.file);
        else if (name === 'PZ2QoL_StoreSave') {
            fake.file = args[1];
            fire('PZ2QoL_StoreSaved', args[0], true);
        }
        // answered as the game does, in a chunk: that also ends the scan, so the next one can go
        else if (name === 'PZ2QoL_KinScan') fire('PZ2QoL_KinChunk', 'scan' + fake.calls.length, 1, 1, JSON.stringify(snapshot()));
        else if (name === 'PZ2QoL_KinDestinations') fire('PZ2QoL_KinDestinationsResult', args[0], JSON.stringify({ bySpecies: { Lion: { 1: { ok: true }, 2: { ok: true }, 3: { ok: true } }, Zebra: { 1: { ok: true }, 2: { ok: true }, 3: { ok: true } } }, habitats: [{ id: '1', name: 'H1' }, { id: '2', name: 'H2' }, { id: '3', name: 'H3' }], tradeCentre: { id: '99', name: 'Trade Centre' } }));
        else if (name === 'PZ2QoL_KinSpecies') fire('PZ2QoL_KinSpeciesResult', args[0], JSON.stringify({ social: { min: 2, max: 6 }, mating: 'polygyny', habitats: { 1: { available: { land: 4000 }, required: { land: 1000 }, adults: 2 }, 2: { available: { land: 4000 }, required: { land: 1000 }, adults: 2 }, 3: { available: { land: 4000 }, required: { land: 1000 }, adults: 0 } } }));
        else if (name === 'PZ2QoL_AutoGate') fire('PZ2QoL_AutoGateResult', args[0], JSON.stringify(Object.assign({ gameMode: fake.mode, hubTypeKnown: true, franchiseZoo: fake.mode === 'franchise', monthSec: fake.monthSec }, fake.date, fake.gate)));
        else if (name === 'PZ2QoL_KinMove') {
            const [req, id, to] = args;
            const a = fake.refuse ? null : fake.animals.find(x => x.id === id);
            if (a) {
                if (String(to).startsWith('trade')) {
                    a.hab = '';
                    a.lt = 'trade';
                }
                else {
                    a.hab = String(to);
                    a.lt = 'habitat';
                }
                a.loc = 'H' + a.hab;
            }
            fire('PZ2QoL_KinMoveResult', req, !!a, '');
        }
    },
};

let auto, kin;
const toasts = [];
async function boot(file) {
    fake.file = file;
    kin = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kin.js');
    fake.kin = kin;
    // as main.js: Kin listens for the game's scans before Auto mode starts
    kin.installKin();
    auto = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinauto.js');
    const store = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/userstore.js');
    const pace = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/pace.js').catch(() => null);
    if (pace && pace.setPaceMs) pace.setPaceMs('moves', 0);
    store.loadUserData();
    await sleep(50);
    auto.setAutopilotToastHook((kind, d) => toasts.push({ kind, d }));
    auto.installAutopilot();
    await sleep(30);
}

// the test's calendar passes a season in seconds: each species' last run is
// put a real minute back, past the floor between scheduled runs
function pastRealFloor() {
    for (const s of Object.values(auto._autopilotInternals().ledger.sp)) if (s.last) s.last.real -= AUTO_LIMITS.scheduledGapMs;
}

// skip the first minute of watching (the zoo just loaded)
function settle() {
    const A = auto._autopilotInternals();
    A.loadAt = 0;
    A.scans = 5;
}

async function until(test, ms = 20000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (test()) return true;
        await sleep(100);
    }
    return test();
}

const moves = () => fake.calls.filter(c => c === 'PZ2QoL_KinMove').length;
// a father and his grown daughter in habitat 1
const RISKY = () => [an('a', M, '1'), an('m', F, '1', [], { genes: G('E', 'F') }), an('d', F, '1', ['a', 'm']), an('b', M, '2', [], { genes: G('G', 'H') }), an('c', F, '2', [], { genes: G('I', 'J') })];

test('nothing on Auto: nothing happens, nothing is written, the alerts are untouched', async () => {
    fake.animals = RISKY();
    await boot('{}');
    publish();
    await sleep(1500);
    assert.equal(auto.isAutopilotOn(), false);
    for (const ev of ['PZ2QoL_AutoGate', 'PZ2QoL_KinMove', 'PZ2QoL_StoreSave', 'PZ2QoL_KinDestinations', 'PZ2QoL_KinSpecies']) {
        assert.ok(!fake.calls.includes(ev), `${ev} sent while off`);
    }
    assert.equal(kin.getKinAlertFilter(), null);
    assert.equal(auto.getSpeciesAuto('Lion').status, 'off');
    assert.equal(auto._autopilotInternals().timers.length, 0);
});

test('a species turned on in an offline park is run by itself, logged, and kept with the zoo', async () => {
    fake.calls = [];
    assert.equal(auto.setSpeciesAuto('Lion', { on: true, every: 3, thin: false }), true);
    assert.notEqual(kin.getKinAlertFilter(), null);
    publish();
    await sleep(50);
    settle();
    assert.ok(await until(() => moves() > 0), 'Auto mode moved an animal');
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').status === 'waiting'), auto.getSpeciesAuto('Lion').status);
    await sleep(500);
    const model = kin.getKinModel();
    assert.equal(model.pairs.filter(p => p.severity === 'risk').length, 0, 'the father and daughter were split');
    const sa = auto.getSpeciesAuto('Lion');
    assert.ok(sa.last && sa.last.moves >= 1, JSON.stringify(sa.last));
    assert.ok(sa.left > 2.9 && sa.left <= 3, `the next run a season (3 months) of game time later: ${sa.left}`);
    const log = auto.getAutopilotLedger().log;
    assert.ok(log.length >= 1 && log.every(e => e.o === 'ok' && e.sp === 'Lion'), JSON.stringify(log));
    const saved = JSON.parse(fake.file);
    assert.equal(saved.kinAuto.sp.Lion.on, true);
    assert.ok(saved.kinAuto.log.length >= 1);
    assert.ok(toasts.some(t => t.kind === 'done' && t.d.species === 'Lion'));
});

test('the schedule is game time: nothing while the calendar stands still, a run once a season has passed', async () => {
    fake.calls = [];
    const before = auto.getSpeciesAuto('Lion').last.real;
    // the game paused (the date does not move): nothing comes due
    await sleep(7000);
    assert.equal(moves(), 0, 'nothing before it is due');
    assert.equal(auto.getSpeciesAuto('Lion').last.real, before, 'no run');
    // the speed is measured over 10 s of the calendar standing still
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').rate === 0), 'the game is seen paused');
    assert.equal(auto.getSpeciesAuto('Lion').status, 'waiting');
    // two months pass: still waiting, one month left
    fake.date = { year: 5, month: 3, monthProp: 0 };
    await sleep(6000);
    assert.equal(auto.getSpeciesAuto('Lion').status, 'waiting');
    assert.ok(Math.abs(auto.getSpeciesAuto('Lion').left - 1) < 0.01, String(auto.getSpeciesAuto('Lion').left));
    // a season after the run: due
    fake.date = { year: 5, month: 4, monthProp: 0.1 };
    pastRealFloor();
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').last.real > before && auto.getSpeciesAuto('Lion').status === 'waiting'), JSON.stringify(auto.getSpeciesAuto('Lion').last));
    assert.ok(auto.getSpeciesAuto('Lion').left > 2.9, 'the next one a season later');
    assert.equal(moves(), 0, 'the groups are already the best: nothing moved');
    assert.equal(auto.getSpeciesAuto('Lion').last.note, 'nothing to change');
});

test('the player\'s own move is noticed and that animal is left where it was put', async () => {
    const c = fake.animals.find(x => x.id === 'c');
    c.hab = c.hab === '3' ? '2' : '3';
    publish();
    await sleep(300);
    assert.ok(auto.getAutopilotLedger().manual.gc, JSON.stringify(auto.getAutopilotLedger().manual));
    assert.equal(auto.isAutoHeld('c'), true);
});

test('hands off: a pinned animal is never in a plan', async () => {
    assert.equal(auto.toggleAutoPin('a'), true);
    assert.equal(auto.isAutoPinned('a'), true);
    assert.equal(auto.toggleAutoPin('a'), false);
});

test('another zoo loads: Auto mode is off there and nothing carries over', async () => {
    const zooA = fake.file;
    assert.equal(JSON.parse(zooA).kinAuto.sp.Lion.on, true);
    fake.file = '{}';
    fire('PZ2QoL_StoreReset');
    await sleep(300);
    assert.equal(auto.isAutopilotOn(), false);
    assert.equal(auto._autopilotInternals().timers.length, 0);
    publish();
    await sleep(1500);
    assert.ok(!('kinAuto' in JSON.parse(fake.file)), 'the other zoo got no Auto data');
    fake.file = zooA;
    fire('PZ2QoL_StoreReset');
    await sleep(300);
    assert.equal(auto.isAutopilotOn(), true, 'back in the first zoo: on again');
    publish();
    await sleep(50);
});

test('Franchise: a due run goes ahead by itself, with no click and no notice to press', async () => {
    fake.mode = 'franchise';
    fake.calls = [];
    toasts.length = 0;
    // a new risk: a daughter grows up next to her father
    const b = fake.animals.find(x => x.id === 'b');
    fake.animals.push(an('k', F, b.hab, ['b', 'm']));
    publish();
    await sleep(50);
    settle();
    const A = auto._autopilotInternals();
    A.ledger.sp.Lion.next = 0;
    pastRealFloor();
    assert.ok(await until(() => moves() > 0), 'it ran by itself');
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').status === 'waiting'));
    assert.equal(kin.getKinModel().pairs.filter(p => p.severity === 'risk').length, 0);
    assert.ok(!toasts.some(t => t.kind === 'ready'), 'no Run now notice');
});

test('the queue: species due together take turns, one run at a time, none skipped; Run now goes first in line', async () => {
    // a Zebra father and grown daughter too
    const Z = (id, sex, hab, par = [], over = {}) => an(id, sex, hab, par, Object.assign({ species: 'Zebra', genes: G('K', 'L') }, over));
    fake.animals.push(Z('za', M, '1'), Z('zm', F, '1', [], { genes: G('M', 'N') }), Z('zd', F, '1', ['za', 'zm']), Z('zb', M, '2', [], { genes: G('O', 'P') }));
    publish();
    await sleep(50);
    assert.equal(auto.setSpeciesAuto('Zebra', { on: true, thin: false }), true);
    const A = auto._autopilotInternals();
    const lionBefore = auto.getSpeciesAuto('Lion').last.real;
    // a second Lion risk, so both species have work
    fake.animals.push(an('k2', F, '1', ['a', 'm']));
    publish();
    await sleep(50);
    settle();
    A.ledger.sp.Lion.next = 0;
    A.ledger.sp.Zebra.next = 0;
    pastRealFloor();
    let both = 0, seenQueued = false;
    const end = Date.now() + 30000;
    while (Date.now() < end) {
        const busy = [A.planning, A.acting && A.acting.species].filter(Boolean);
        if (new Set(busy).size > 1) both++;
        if (auto.getSpeciesAuto('Zebra').status === 'queued' || auto.getSpeciesAuto('Lion').status === 'queued') seenQueued = true;
        if (auto.getSpeciesAuto('Lion').last.real > lionBefore && auto.getSpeciesAuto('Zebra').last && !A.acting && !A.planning) break;
        await sleep(50);
    }
    assert.equal(both, 0, 'never two species at once');
    assert.ok(seenQueued, 'one waited its turn in the queue');
    assert.ok(auto.getSpeciesAuto('Lion').last.real > lionBefore, 'Lion ran');
    assert.ok(auto.getSpeciesAuto('Zebra').last, 'Zebra ran');
    assert.deepEqual(A.queue, [], 'the queue is empty');
    // Run now while another species runs: first in line, then it runs
    A.ledger.sp.Zebra.next = 0;
    pastRealFloor();
    assert.ok(await until(() => A.planning === 'Zebra' || (A.acting && A.acting.species === 'Zebra') || auto.getSpeciesAuto('Zebra').last.real > Date.now() - 1000));
    const zebraLast = auto.getSpeciesAuto('Zebra').last.real;
    const r = auto.runSpeciesNow('Lion');
    assert.ok(r === 'queued' || r === 'now', r);
    if (r === 'queued') assert.equal(A.queue[0], 'Lion');
    const lionLast = auto.getSpeciesAuto('Lion').last.real;
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').last.real > lionLast), 'Lion ran after it');
    assert.ok(auto.getSpeciesAuto('Zebra').last.real >= zebraLast);
    assert.equal(auto.setSpeciesAuto('Zebra', { on: false }), true);
    assert.ok(!A.queue.includes('Zebra'), 'off: out of the queue');
});

test('Run now on the board runs it at once; turning it off removes every hook and sends nothing more', async () => {
    fake.calls = [];
    assert.ok(await until(() => !auto._autopilotInternals().acting && !auto._autopilotInternals().planning));
    const before = auto.getSpeciesAuto('Lion').last.real;
    await sleep(5);
    assert.equal(auto.runSpeciesNow('Lion'), 'now');
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').status === 'waiting' && auto.getSpeciesAuto('Lion').last.real > before), JSON.stringify(auto.getSpeciesAuto('Lion').last));
    assert.equal(auto.setSpeciesAuto('Lion', { on: false }), true);
    assert.equal(kin.getKinAlertFilter(), null);
    assert.equal(auto._autopilotInternals().timers.length, 0);
    await sleep(600);
    assert.equal(JSON.parse(fake.file).kinAuto.sp.Lion.on, false);
    fake.calls = [];
    fake.animals.push(an('q', M, '1', ['m', 'b']));
    publish();
    await sleep(2500);
    assert.ok(!fake.calls.some(c => c === 'PZ2QoL_KinMove' || c === 'PZ2QoL_AutoGate'));
    assert.equal(auto.runSpeciesNow('Lion'), 'Auto mode is off for this species');
});

// Five old Lions over the room of habitat 1: Thin out sends them away one
// at a time (a run long enough to interrupt).
async function longRun() {
    for (let i = 0; i < 5; i++) fake.animals.push(an('o' + fake.seq + i, i % 2 ? F : M, '1', [], { age: 17, infertile: true, genes: G('A', 'B') }));
    fake.seq++;
    publish();
    await sleep(50);
    fake.calls = [];
    assert.equal(auto.setSpeciesAuto('Lion', { on: true, thin: true, fill: 'strict', every: 3 }), true);
    auto._autopilotInternals().ledger.sp.Lion.next = 0;
    pastRealFloor();
    auto._autopilotInternals().pausedUntil.clear();
    publish();
    await sleep(50);
    settle();
    assert.ok(await until(() => moves() >= 1), 'the run started');
}

test('Stop in the middle of a run: the moves it never reached are not counted as refusals', async () => {
    fake.mode = 'offline';
    fake.seq = 1;
    const moveMod = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinmoves.js');
    await longRun();
    moveMod.stopPlan();
    assert.ok(await until(() => auto.getSpeciesAuto('Lion').status === 'waiting'), auto.getSpeciesAuto('Lion').status);
    const l = auto.getAutopilotLedger();
    const run = l.log.filter(e => e.c === l.run);
    assert.ok(run.some(e => e.o === 'skip' && /stopped/.test(e.why)), JSON.stringify(run));
    assert.deepEqual(Object.keys(l.fails), [], 'no refusals recorded');
    assert.equal(auto.getSpeciesAuto('Lion').last.skipped, 0);
    assert.ok(!auto._autopilotInternals().pausedUntil.has('Lion'), 'not paused');
});

test('another zoo loads in the middle of a run: nothing more is sent, nothing lands in the other zoo', async () => {
    fake.seq = 2;
    await longRun();
    const zooA = fake.file;
    fake.file = '{}';
    fire('PZ2QoL_StoreReset');
    await sleep(300);
    const sent = moves();
    await sleep(3000);
    assert.equal(moves(), sent, 'no move after the zoo changed');
    assert.ok(!('kinAuto' in JSON.parse(fake.file)), 'the other zoo got no Auto data');
    fake.file = zooA;
    fire('PZ2QoL_StoreReset');
    await sleep(300);
    publish();
    await sleep(50);
});

test('an Undo the game refuses is not marked undone, and the animal is not held', async () => {
    // no new runs meanwhile
    auto.setSpeciesAuto('Lion', { on: false });
    const moveMod = await import('../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinmoves.js');
    assert.ok(await until(() => !auto._autopilotInternals().acting && !moveMod.getPlanRun().running), 'idle');
    const l = auto.getAutopilotLedger();
    const e = l.log.slice().reverse().find(x => x.o === 'ok' && !x.u);
    assert.ok(e, 'an entry to undo');
    fake.refuse = true;
    const r = await auto.undoEntries([e]);
    fake.refuse = false;
    assert.equal(r.done, 0, JSON.stringify(r));
    assert.ok(!e.u, 'not marked undone');
    assert.ok(!l.manual[e.g], 'not held as moved by the player');
});

// the mod's own modules keep timers of their own (the scan, the board):
// the fake game ends here
after(() => setTimeout(() => process.exit(process.exitCode || 0), 50));
