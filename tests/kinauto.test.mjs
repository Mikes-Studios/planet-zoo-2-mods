// node --test tests/kinauto.test.mjs
// Auto mode's deciding part (kinautocore.js) and its memory
// (kinautoledger.js). Design: docs/DESIGN-autopilot.md section 16.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel, Sex } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { TRADE, simulatePlan } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { PROGRAMME_SEARCH, PROGRAMME_STEPS, planProgramme } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import {
    AUTO_LIMITS, EVERY_CHOICES, SPECIES_DEFAULTS, calendarMonths, dueText, everyText, everyWords, locksOf, normalizeSpecies, observeChanges, realTimeText,
    planAutoRun, programmeOptionsFor, relatedAdultPairs, speciesFingerprints,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import {
    LEDGER_VERSION, emptyLedger, fitBudget, isManualAnimal, isPinnedAnimal, ledgerView, logAction, normalizeLedger, noteManualMoves,
    noteReversal, noteUndone, pruneLedger, refusedMoves, resumeSpecies, savedSize, setSpeciesSettings, settleAction, speciesOn,
    speciesSettings, togglePinAnimal, undoOf,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautoledger.js';
import { makeZoo, rng } from './helpers/zoogen.mjs';

const M = Sex.Male, F = Sex.Female;
const G = (a, b) => ({ F: a.repeat(6) + b.repeat(6), I: a.repeat(6) + b.repeat(6), S: 'AAAAAACCCCCC', L: 'AAAAAACCCCCC' });
const FACTS = { Lion: { maturity: 3, infertility: 15, life: 20 } };
const an = (id, sex, hab, par = [], over = {}) => Object.assign({
    id, key: 'animal_' + id, guid: 'g' + id, name: 'N' + id, species: 'Lion', sex, juv: false, contra: false, infertile: false,
    hab, loc: 'H' + hab, lt: hab ? 'habitat' : 'trade', par: par.map(p => 'g' + p), mates: [], genes: G('C', 'D'), age: 6,
}, over);
const snap = (animals, habs = ['1', '2', '3']) => ({
    v: 1, seq: 1, scope: 'park', mode: 'offline', park: 'P',
    habitats: habs.map(h => ({ id: h, name: 'H' + h })), habs: habs.map(h => ({ id: h, name: 'H' + h, hid: 'h' + h })),
    animals, anc: {}, speciesFacts: FACTS, tradeCentre: { id: '99', name: 'Trade Centre' },
});
const DEST = (ids, sp = 'Lion') => ({ bySpecies: { [sp]: Object.fromEntries(ids.map(i => [i, { ok: true }])) }, habitats: [], tradeCentre: { id: '99', name: 'Trade Centre' } });
const INFO = (habs, max = 6) => ({
    social: { min: 2, max }, mating: 'polygyny', fertilityAges: { maturity: 3, infertility: 15 },
    habitats: Object.fromEntries(habs.map(h => [h, { available: { land: 4000 }, required: { land: 1000 }, adults: 2 }])),
});
const HABS = ['1', '2', '3'];
const run = (model, over = {}) => planAutoRun(Object.assign({
    model, species: 'Lion', info: INFO(HABS), destinations: DEST(HABS), assignments: null,
    settings: { thin: false }, view: {}, tradeFree: null,
}, over));
const RISKY = () => [an('a', M, '1'), an('m', F, '1', [], { genes: G('E', 'F') }), an('d', F, '1', ['a', 'm']), an('b', M, '2'), an('c', F, '2')];

// ---------------------------------------------------------------- settings

test('settings: defaults, and only known values are kept', () => {
    assert.deepEqual(normalizeSpecies(null), Object.assign({}, SPECIES_DEFAULTS));
    const s = normalizeSpecies({ on: 1, every: 12, step: 1, trade: false, thin: 0, fill: 'strict' });
    assert.deepEqual(s, { on: true, every: 12, step: 1, trade: false, thin: false, fill: 'strict' });
    const bad = normalizeSpecies({ on: 'yes', every: 7, step: 9, trade: 'no', fill: 'nope' });
    assert.equal(bad.on, false);
    assert.equal(bad.every, SPECIES_DEFAULTS.every);
    assert.equal(bad.step, SPECIES_DEFAULTS.step);
    assert.equal(bad.trade, true);
    assert.equal(bad.fill, SPECIES_DEFAULTS.fill);
    assert.ok(EVERY_CHOICES.includes(SPECIES_DEFAULTS.every));
    assert.equal(normalizeSpecies({ every: 30 }).every, SPECIES_DEFAULTS.every, 'the old real-time minutes are not months');
});

test('game time: the park calendar in months, and its texts', () => {
    assert.equal(calendarMonths({ year: 2, month: 4, monthProp: 0.5 }), 2 * 12 + 3 + 0.5);
    assert.equal(calendarMonths({ year: 2, month: 1 }), 24);
    assert.equal(calendarMonths({ park: true }), null);
    assert.equal(calendarMonths(null), null);
    assert.deepEqual(EVERY_CHOICES.map(everyWords), ['1 month', '1 season', '2 seasons', '1 year']);
    assert.equal(everyText(3), 'every season');
    assert.equal(everyText(12), 'every year');
    assert.equal(everyText(6), 'every 2 seasons');
    assert.equal(dueText(0), 'now');
    assert.equal(dueText(0.4), 'in under a month');
    assert.equal(dueText(1.1), 'in 1 month');
    assert.equal(dueText(2.6), 'in 2.5 months');
    // 3 months at a month per 2 real minutes
    assert.equal(realTimeText(3, 1 / 120000), 'about 6 min');
    assert.equal(realTimeText(3, 0), '', 'paused: no real-time estimate');
    assert.equal(realTimeText(3, null), '');
});

test('the programme\'s options are the board\'s for the same slider step, switch and make-up', () => {
    PROGRAMME_STEPS.forEach((st, k) => {
        const o = programmeOptionsFor(normalizeSpecies({ step: k, trade: k % 2 === 0 }), '1:3');
        assert.equal(o.moveCost, st.cost);
        assert.equal(o.useTradeCentre, k % 2 === 0);
        assert.equal(o.ratio, '1:3');
        if (st.outsider != null) assert.equal(o.outsiderCost, st.outsider);
        else assert.ok(!('outsiderCost' in o));
        assert.equal(o.maxEvaluations, PROGRAMME_SEARCH.maxEvaluations);
        assert.equal(o.timeBudgetMs, PROGRAMME_SEARCH.timeBudgetMs);
        assert.ok(!('pinIds' in o), 'no pins: the board\'s options exactly');
    });
    assert.ok(programmeOptionsFor(normalizeSpecies({}), 'auto', new Set(['x'])).pinIds.has('x'));
});

// ------------------------------------------------------------- the engine

test('programme pinIds: a pinned breeder counts where it is but never moves', () => {
    const model = buildKinModel(snap(RISKY()));
    const free = planProgramme(model, 'Lion', INFO(HABS), DEST(HABS), { options: { moveCost: 0.04 } });
    assert.ok(free.moves.length, 'the father and daughter are split');
    const movedIds = free.moves.map(m => m.id);
    const pinned = planProgramme(model, 'Lion', INFO(HABS), DEST(HABS), { options: { moveCost: 0.04, pinIds: new Set(movedIds) } });
    for (const m of pinned.moves) assert.ok(!movedIds.includes(m.id), `${m.id} was pinned`);
    // a pinned breeder at the trade centre stays there
    const withTrade = buildKinModel(snap(RISKY().concat([an('t', F, '', [], { genes: G('G', 'H') })])));
    const pull = planProgramme(withTrade, 'Lion', INFO(HABS), DEST(HABS), { options: { moveCost: 0, pinIds: new Set(['t']) } });
    assert.ok(!pull.moves.some(m => m.id === 't'));
});

test('a run is the Breeding programme\'s plan when nothing is held back', () => {
    for (let seed = 1; seed <= 25; seed++) {
        const z = makeZoo(seed, { assign: false });
        const model = buildKinModel(z.snap);
        for (const sp of z.species) {
            const settings = normalizeSpecies({ step: seed % 4 });
            // the programme on the zoo as the game has it (a juvenile is planned once it is grown)
            const prog = planProgramme(model, sp, z.info[sp], z.dest, { options: programmeOptionsFor(settings) });
            const r = planAutoRun({ model, species: sp, info: z.info[sp], destinations: z.dest, settings: Object.assign({}, settings, { thin: false }), view: {} });
            const kept = new Set(r.held.filter(x => x.why === 'the last breeder of its sex stays').map(x => x.id));
            // (a juvenile never goes to the trade centre: youth is left alone)
            const want = prog.moves.filter(m => !model.animals.get(m.id).preg && !kept.has(m.id) && !(model.animals.get(m.id).juv && m.to === TRADE)).map(m => `${m.id}>${m.to}`).sort();
            assert.deepEqual(r.moves.map(m => `${m.id}>${m.to}`).sort(), want, `seed ${seed} ${sp}`);
            assert.ok(r.moves.every(m => m.stage === 'programme'));
        }
    }
});

// Hands off keeps an animal where it is, except a pregnant or young one
// waiting at the trade centre: it goes into a habitat (it can only give
// birth or grow up there). A move by the player holds nothing: Auto mode's
// plan wins on its species.
test('hands off: never moved, by the programme or by Thin out, but out of the trade centre when it must', () => {
    for (let seed = 30; seed <= 50; seed++) {
        const z = makeZoo(seed, { assign: false });
        const model = buildKinModel(z.snap);
        const r0 = rng(seed);
        const all = Array.from(model.animals.values());
        const pinned = new Set(all.filter(() => r0.chance(0.25)).map(a => a.id));
        for (const sp of z.species) {
            const r = planAutoRun({ model, species: sp, info: z.info[sp], destinations: z.dest, settings: { thin: true, fill: 'strict' }, view: { pinned } });
            for (const m of r.moves) {
                const a = model.animals.get(m.id);
                const housed = a.lt === 'trade' && (a.preg || a.juv) && m.to !== TRADE;
                assert.ok(!pinned.has(m.id) || housed, `seed ${seed}: ${m.id} moved`);
                assert.ok(!a.moving, 'never one on the move');
                if (a.preg) assert.ok(housed, `seed ${seed}: a pregnant female moves only from the trade centre into a habitat`);
                if (m.stage === 'thin') assert.ok(!a.juv, 'Thin out never sends young');
                // a juvenile only grows up in a habitat: it moves only from the trade centre into one
                if (a.juv) assert.ok(housed, `seed ${seed}: a juvenile moved out of its habitat`);
            }
        }
    }
});

test('an animal Auto mode sent to the trade centre is not brought back', () => {
    const animals = RISKY().concat([an('t', F, '', [], { genes: G('G', 'H') })]);
    const model = buildKinModel(snap(animals));
    const free = run(model, { settings: { thin: false, step: 3 } });
    const fromTrade = free.moves.find(m => m.id === 't');
    assert.ok(fromTrade, 'without the memory the programme uses her');
    const held = run(model, { settings: { thin: false, step: 3 }, view: { leaving: new Set(['t']) } });
    assert.ok(!held.moves.some(m => m.id === 't'));
    assert.ok(locksOf(model, 'Lion', { leaving: new Set(['t']) }).pins.has('t'));
});

test('Thin out comes first: the old leave a full habitat, so the programme keeps its breeders', () => {
    // room for 4 adults (space 4000 / 1000 each): a breeding pair, a second
    // pair, and two old ones past breeding
    const old = { age: 17, infertile: true, genes: G('A', 'B') };
    const animals = [an('a', M, '1'), an('b', F, '1', [], { genes: G('E', 'F') }), an('c', M, '1', [], { genes: G('G', 'H') }), an('d', F, '1', [], { genes: G('I', 'J') }),
        an('o1', M, '1', [], old), an('o2', F, '1', [], old), an('y', F, '1', ['a', 'b'], { juv: true, age: 1 })];
    const info = { social: { min: 2, max: 8 }, mating: 'mixed', fertilityAges: { maturity: 3, infertility: 15 }, habitats: { 1: { available: { land: 4000 }, required: { land: 6000 }, adults: 6 } } };
    const model = buildKinModel(snap(animals, ['1']));
    const r = run(model, { info, destinations: DEST(['1']), settings: { thin: true, fill: 'full' } });
    const thin = r.moves.filter(m => m.stage === 'thin');
    assert.deepEqual(thin.map(m => m.id).sort(), ['o1', 'o2'], JSON.stringify(r.moves));
    assert.ok(thin.every(m => m.to === TRADE && m.reason.startsWith('Thin out: ')));
    assert.ok(!r.moves.some(m => ['a', 'b', 'c', 'd', 'y'].includes(m.id)), `the breeders and the young stay: ${JSON.stringify(r.moves)}`);
    assert.ok(r.moves.indexOf(thin[0]) === 0, 'Thin out\'s moves run first');
    // without Thin out the programme can only make room by sending breeders
    // away (the old count as fixed room): that is why Thin out comes first
    const off = run(model, { info, destinations: DEST(['1']), settings: { thin: false } });
    assert.ok(off.moves.every(m => m.stage === 'programme'));
    assert.equal(off.thin, null);
    // the trade centre has room for one: the rest wait, and the panel says why
    const one = run(model, { info, destinations: DEST(['1']), settings: { thin: true, fill: 'full' }, tradeFree: 1 });
    assert.equal(one.moves.filter(m => m.to === TRADE).length, 1);
    assert.ok(one.held.some(x => x.why === 'the trade centre is full'));
    assert.ok(one.notes.length);
});

test('a move the game refused lately is held back; a move back to a habitat just left is flagged', () => {
    const model = buildKinModel(snap(RISKY()));
    const free = run(model);
    assert.ok(free.moves.length);
    const m = free.moves[0];
    const held = run(model, { view: { blocked: new Set([`${m.id}>${m.to}`]) } });
    assert.ok(!held.moves.some(x => x.id === m.id && x.to === m.to));
    assert.ok(held.held.some(x => x.id === m.id));
    const back = run(model, { view: { recentFrom: new Map([[m.id, new Set([m.to])]]) } });
    assert.equal(back.moves.find(x => x.id === m.id).reversal, true);
    assert.ok(free.moves.every(x => x.reversal === false));
});

// a move's cooldown keeps it from going back and forth, but never keeps an
// animal beside a relative of the other sex (never inbreed)
test('an animal Auto mode moved lately stays put, unless it lives beside a relative', () => {
    const model = buildKinModel(snap(RISKY()));
    const free = run(model);
    assert.ok(free.moves.length);
    const cooled = new Set(free.moves.map(m => m.id));
    const inKinPair = new Set((relatedAdultPairs(model).get('Lion') || []).flat());
    const r = run(model, { view: { cooled } });
    assert.ok(!r.moves.some(m => cooled.has(m.id) && !inKinPair.has(m.id)), JSON.stringify(r.moves));
    // the ledger marks a moved animal cooled for the cooldown window
    const l = emptyLedger();
    const x = free.moves[0];
    settleAction(l, logAction(l, model, x, { run: 1, clock: 3, realNow: 0, species: 'Lion' }), x, true, { clock: 3, realNow: 0 });
    assert.ok(ledgerView(l, model, 3 + AUTO_LIMITS.cooldownYears, 0).cooled.has(x.id));
    assert.ok(!ledgerView(l, model, 3 + AUTO_LIMITS.cooldownYears + 0.01, 0).cooled.has(x.id));
});

// a juvenile only grows up in a habitat and the game still treats one about
// to grow up as young, so the run leaves her alone; once she is grown (Auto
// mode runs a species as soon as one of its young grows up) it parts them
test('a youngster next to her father is left alone, and parted from him once grown', () => {
    // habitat 1: father a, mother m, their daughter (2.8 of 3 years); habitat 2: an unrelated pair
    const animals = [an('a', M, '1'), an('m', F, '1', [], { genes: G('E', 'F') }), an('y', F, '1', ['a', 'm'], { juv: true, age: 2.8 }), an('b', M, '2', [], { genes: G('G', 'H') }), an('c', F, '2', [], { genes: G('I', 'J') })];
    const young = run(buildKinModel(snap(animals)));
    assert.ok(!young.moves.some(m => m.id === 'y'), `the young one stays: ${JSON.stringify(young.moves)}`);
    const grown = animals.map(a => (a.id === 'y' ? Object.assign({}, a, { juv: false, age: 3.1 }) : a));
    const r = run(buildKinModel(snap(grown)));
    assert.ok(r.moves.some(m => m.id === 'y' || m.id === 'a'), `father and daughter split: ${JSON.stringify(r.moves)}`);
    // a baby is not moved
    const baby = animals.map(a => (a.id === 'y' ? Object.assign({}, a, { age: 0.5 }) : a));
    const r2 = run(buildKinModel(snap(baby)));
    assert.ok(!r2.moves.some(m => m.id === 'y'));
});

test('the last breeding male or female of a species stays, unless it would live beside a relative', () => {
    // a brother and sister, the only Lions: never inbreed sends one away
    const animals = [an('p', M, '1', [], { genes: G('E', 'F') }), an('q', F, '1', [], { genes: G('G', 'H') }), an('s', M, '1', ['p', 'q']), an('t', F, '1', ['p', 'q'])];
    const only = animals.filter(a => a.id === 's' || a.id === 't');
    const model = buildKinModel(Object.assign(snap(only, ['1']), { anc: { gp: { name: 'P' }, gq: { name: 'Q' } } }));
    const r = run(model, { info: INFO(['1']), destinations: DEST(['1']) });
    assert.equal(r.moves.filter(m => m.to === TRADE).length, 1, JSON.stringify(r.moves));
    // with an unrelated pair beside them, the last breeder of each sex is kept
    const pair = [an('s', M, '1'), an('t', F, '2')];
    const kept = run(buildKinModel(snap(pair, ['1', '2'])), { info: INFO(['1', '2']), destinations: DEST(['1', '2']) });
    assert.ok(!kept.moves.some(m => m.to === TRADE), JSON.stringify(kept.moves));
});

// Runs over and over on a zoo that does not change otherwise: they stop
// finding work (no animal goes back and forth).
test('runs settle: a zoo left alone needs no more moves after a few runs, and nothing goes back and forth', () => {
    let maxRuns = 0;
    for (let seed = 60; seed <= 110; seed++) {
        const z = makeZoo(seed, { assign: false });
        let model = buildKinModel(z.snap);
        for (const sp of z.species) {
            const settings = { thin: seed % 2 === 0, fill: 'balanced', step: seed % 4 };
            // the runtime's memory, as it keeps it between runs
            const l = emptyLedger();
            const from = new Map();     // id -> habitats it left
            let runs = 0, clock = 0;
            for (;;) {
                const view = ledgerView(l, model, clock, 0);
                const r = planAutoRun({ model, species: sp, info: z.info[sp], destinations: z.dest, settings, view });
                if (!r.moves.length) break;
                runs++;
                assert.ok(runs <= 6, `seed ${seed} ${sp}: still moving after 6 runs: ${JSON.stringify(r.moves)}`);
                for (const m of r.moves) {
                    const a = model.animals.get(m.id);
                    const here = a.hab || (a.lt === 'trade' ? TRADE : '');
                    assert.ok(!m.reversal && !(from.get(m.id) || new Set()).has(m.to), `seed ${seed} ${sp}: ${m.id} back to ${m.to}`);
                    if (!from.has(m.id)) from.set(m.id, new Set());
                    from.get(m.id).add(here);
                    settleAction(l, logAction(l, model, m, { run: runs, clock, realNow: 0, species: sp }), m, true, { clock, realNow: 0 });
                }
                model = simulatePlan(model, r.moves, z.dest);
                clock += 0.02;
            }
            maxRuns = Math.max(maxRuns, runs);
        }
    }
    assert.ok(maxRuns >= 1, 'some zoos needed work');
});

// --------------------------------------------------------------- watching

test('observeChanges: the player\'s moves are noticed, Auto mode\'s own are not', () => {
    const m1 = buildKinModel(snap(RISKY()));
    const s1 = observeChanges({}, m1, new Map()).seen;
    const moved = RISKY().map(a => (a.id === 'b' ? Object.assign(a, { hab: '3' }) : a.id === 'c' ? Object.assign(a, { hab: '3' }) : a));
    const m2 = buildKinModel(snap(moved));
    const obs = observeChanges(s1, m2, new Map([['c', { to: '3' }]]));
    assert.deepEqual(obs.moved, ['b']);
    // on the move: not counted until it arrives
    const m3 = buildKinModel(snap(RISKY().map(a => (a.id === 'a' ? Object.assign(a, { moving: true, hab: '' , lt: 'transit' }) : a))));
    assert.deepEqual(observeChanges(s1, m3, new Map()).moved, []);
});

test('fingerprints follow where the animals live, not their age', () => {
    const m1 = buildKinModel(snap(RISKY()));
    const older = RISKY().map(a => Object.assign(a, { age: a.age + 0.25 }));
    const m2 = buildKinModel(snap(older));
    assert.equal(speciesFingerprints(m1).get('Lion'), speciesFingerprints(m2).get('Lion'));
    const m3 = buildKinModel(snap(RISKY().map(a => (a.id === 'b' ? Object.assign(a, { hab: '3' }) : a))));
    assert.notEqual(speciesFingerprints(m1).get('Lion'), speciesFingerprints(m3).get('Lion'));
});

// ------------------------------------------------------------------ ledger

test('ledger: the old zoo-wide data starts afresh; settings per species; turning on runs at once', () => {
    assert.deepEqual(normalizeLedger({ v: 1, on: true, preset: 'guardian' }), emptyLedger());
    const l = emptyLedger();
    assert.equal(l.v, LEDGER_VERSION);
    assert.equal(speciesSettings(l, 'Lion').on, false);
    setSpeciesSettings(l, 'Lion', { on: true, every: 12 }, 100);
    assert.equal(l.sp.Lion.on, true);
    assert.equal(l.sp.Lion.next, 0, 'the first run comes at once');
    l.sp.Lion.next = 112;
    setSpeciesSettings(l, 'Lion', { every: 3 }, 100);
    assert.equal(l.sp.Lion.next, 103, 'a shorter interval counts from now');
    setSpeciesSettings(l, 'Lion', { step: 0, thin: false }, 101);
    assert.equal(l.sp.Lion.next, 103, 'other choices keep the schedule');
    assert.deepEqual(speciesOn(l), ['Lion']);
    noteReversal(l, 'Lion', 1);
    assert.equal(noteReversal(l, 'Lion', 1.2), true);
    assert.deepEqual(speciesOn(l), [], 'stopped after two reversals');
    resumeSpecies(l, 'Lion');
    assert.deepEqual(speciesOn(l), ['Lion']);
    setSpeciesSettings(l, 'Lion', { on: false });
    assert.deepEqual(speciesOn(l), []);
    // what comes back from the save
    const back = normalizeLedger(JSON.parse(JSON.stringify(l)));
    assert.equal(back.sp.Lion.every, 3);
    assert.equal(back.sp.Lion.next, l.sp.Lion.next);
    assert.equal(back.sp.Lion.step, 0);
    assert.equal(back.sp.Lion.thin, false);
});

test('ledger: what was done, refusals, the trade centre, the player\'s moves, pins and Undo', () => {
    const model = buildKinModel(snap(RISKY()));
    const l = emptyLedger();
    // a move to the trade centre: remembered as leaving
    // a move the run marks as leaving (to be sold): Thin out's are
    const x = { id: 'd', to: TRADE, reason: 'Thin out: too many', stage: 'thin', leave: true };
    const e = logAction(l, model, x, { run: 1, clock: 2, realNow: 1000, species: 'Lion' });
    assert.equal(e.o, 'wait');
    settleAction(l, e, x, true, { clock: 2, realNow: 1000 });
    assert.equal(e.o, 'ok');
    assert.equal(l.leave.gd, 1);
    assert.deepEqual(l.hist.gd, [['H1', 'h1', 2]]);
    let view = ledgerView(l, model, 2, 1000);
    assert.ok(view.leaving.has('d'));
    assert.ok(view.recentFrom.get('d').has('1'));
    // refused three times: no longer tried
    const y = { id: 'b', to: '3', reason: 'breeding programme', stage: 'programme' };
    for (let i = 0; i < 3; i++) settleAction(l, logAction(l, model, y, { run: 2, clock: 2, realNow: 2000, species: 'Lion' }), y, false, { clock: 2, realNow: 2000, why: 'refused' });
    view = ledgerView(l, model, 2, 2000 + 60 * 60 * 1000);
    assert.ok(view.blocked.has('b>3'));
    assert.deepEqual(refusedMoves(l, model, 'Lion'), [{ id: 'b', to: '3' }]);
    // a busy gate does not count against the move
    const z = { id: 'c', to: '3' };
    settleAction(l, logAction(l, model, z, { run: 2, clock: 2, realNow: 2000, species: 'Lion' }), z, false, { clock: 2, realNow: 2000, why: 'busy', noFail: true });
    assert.ok(!Object.keys(l.fails).some(k => k.startsWith('gc>')));
    // the player moved one: held for a while, and no longer "leaving"
    noteManualMoves(l, model, ['d'], 2);
    assert.ok(!l.leave.gd);
    assert.ok(ledgerView(l, model, 2 + AUTO_LIMITS.manualYears - 0.1, 0).manual.has('d'));
    assert.ok(!ledgerView(l, model, 2 + AUTO_LIMITS.manualYears + 0.1, 0).manual.has('d'));
    assert.ok(isManualAnimal(l, model, 'd', 2.5));
    // pins
    assert.equal(togglePinAnimal(l, model, 'a'), true);
    assert.ok(isPinnedAnimal(l, model, 'a'));
    assert.ok(ledgerView(l, model, 2, 0).pinned.has('a'));
    assert.equal(togglePinAnimal(l, model, 'a'), false);
    // undo: back where it came from
    const moved = buildKinModel(snap(RISKY().map(a => (a.id === 'd' ? Object.assign(a, { hab: '', lt: 'trade' }) : a))));
    const u = undoOf(l, moved, e);
    assert.deepEqual(u.action, { id: 'd', to: '1' });
    noteUndone(l, moved, e, 3);
    assert.equal(e.u, 1);
    assert.equal(undoOf(l, moved, e).why, 'already undone');
    assert.ok(l.manual.gd > 3, 'what Undo restores is left alone');
});

test('ledger: memories run out, gone animals are forgotten, the saved size stays in budget', () => {
    const model = buildKinModel(snap(RISKY()));
    const l = emptyLedger();
    l.hist.gd = [['H1', 'h1', 0]];
    l.hist.gone = [['H1', 'h1', 0]];
    l.pins.gone = 1;
    l.manual.ga = 1;
    l.fails['gb>H3'] = [1, 0, 0];
    l.rev.Lion = [0];
    pruneLedger(l, model, 5);
    assert.deepEqual(l.hist, {});
    assert.ok(!l.pins.gone);
    assert.ok(!l.manual.ga);
    assert.deepEqual(l.fails, {});
    assert.deepEqual(l.rev, {});
    const big = emptyLedger();
    setSpeciesSettings(big, 'Lion', { on: true });
    big.pins.gx = 1;
    for (let i = 0; i < 400; i++) {
        big.hist['g' + i] = [['Habitat with a long name ' + i, 'h' + i, i / 100]];
        big.log.push({ i, n: 'An animal with a long name ' + i, r: 'breeding programme: breeds with someone', f: 'Habitat', to: 'Habitat' });
    }
    fitBudget(big, 12000);
    assert.ok(savedSize(big) <= 12000);
    assert.ok(Object.keys(big.hist).length <= 150);
    assert.equal(big.sp.Lion.on, true, 'settings are never trimmed');
    assert.equal(big.pins.gx, 1, 'pins are never trimmed');
    const e = emptyLedger();
    e.log.push({ r: '♂♀→' });
    assert.equal(savedSize(e), JSON.stringify(e).length + 15);
});
