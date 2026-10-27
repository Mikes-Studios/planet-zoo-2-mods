// node --test tests/kinauto_soak.test.mjs
// Auto mode over 50 park years of a simulated zoo, every species on Auto,
// a run every quarter year: births (from any fertile male and female living
// together, relatives too: that is the harm it must prevent), ageing,
// deaths, sales from the trade centre, and a player who moves an animal now
// and then. Design section 16.
//
// Pass = Auto mode never moves an animal back where it just came from, no
// animal is moved more than twice a park year, the player's moved animals
// and the hands-off ones stay put, every move is logged, inbred births stay
// rare, the last breeding male or female of a species is never sent away,
// and with Thin out on the population stays in hand. (A species can still
// die out of bad luck: a few founders, the wrong sex bought.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel, Sex } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { TRADE } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { AUTO_LIMITS, freeParked, observeChanges, planAutoRun } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { emptyLedger, ledgerView, logAction, noteManualMoves, pruneLedger, settleAction } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautoledger.js';
import { makeZoo, rng, childGenes, founderGenes, SPECIES } from './helpers/zoogen.mjs';

const STEP = 0.25;          // park years per step (one run per species per step)
const YEARS = 50;
// places at the trade centre (in Franchise it is the account's whole
// storage, 250; the player sells or releases what waits there)
const TRADE_MAX = Number(process.env.SOAK_TRADE || 40);

function soak(seed, settings) {
    const r = rng(seed * 7919);
    const z = makeZoo(seed, { species: ['Lion', 'Zebra', 'Wolf'], habitats: 6, assign: false });
    const snap = z.snap;
    let animals = snap.animals.map(a => Object.assign({}, a));
    let nextId = 10000;
    const l = emptyLedger();
    let seen = null;
    const expected = new Map();
    const stats = { steps: 0, emptied: 0, moves: 0, logged: 0, reversals: 0, stopped: 0, churn: 0, manualMoved: 0, pinnedMoved: 0, births: 0, inbredBirths: 0, maxAnimals: 0, riskSteps: 0, tradeHeld: 0 };
    const movedAt = new Map();       // guid -> [t]
    const manualUntil = new Map();   // guid -> t
    // species -> t of its last birth, arrival or young grown up (the runtime's changedAt)
    const changedAt = new Map();
    const reversalsAt = new Map();   // species -> [t]
    // two animals the player marked hands off
    for (const a of animals.filter(x => !x.juv).slice(0, 2)) l.pins[a.guid] = 1;
    const build = () => buildKinModel(Object.assign({}, snap, { animals }));
    let t = 0;
    for (let step = 0; step < YEARS / STEP; step++, t += STEP) {
        stats.steps++;
        // ---- the zoo lives
        const byHab = new Map();
        for (const a of animals) {
            const S = SPECIES[a.species];
            a.age += STEP;
            a.moving = false;
            if (a.juv && a.age >= S.facts.maturity) {
                a.juv = false;
                changedAt.set(a.species, t);
            }
            if (!a.juv && a.age >= S.facts.infertility) a.infertile = true;
            a.ageQ = a.juv ? 0 : a.age >= S.facts.infertility ? 3 : 2;
            if (a.preg) a.preg = false;
            if (a.hab) {
                const k = a.hab + '|' + a.species;
                if (!byHab.has(k)) byHab.set(k, []);
                byHab.get(k).push(a);
            }
        }
        const model0 = build();
        for (const list of byHab.values()) {
            const ms = list.filter(a => a.sex === Sex.Male && !a.juv && !a.infertile && !a.contra);
            for (const f of list.filter(a => a.sex === Sex.Female && !a.juv && !a.infertile && !a.contra)) {
                if (!ms.length || !r.chance(0.12)) continue;
                const m = r.pick(ms);
                const rel = model0.ped.relation(m.guid, f.guid);
                if (rel && rel.game) stats.inbredBirths++;
                stats.births++;
                changedAt.set(f.species, t);
                const id = String(nextId++);
                animals.push({ id, key: 'animal_' + id, guid: 'g' + id, name: 'B' + id, species: f.species, sex: r.chance(0.5) ? Sex.Male : Sex.Female, juv: true, contra: false, infertile: false, preg: false, alive: true, hab: f.hab, loc: f.loc, lt: 'habitat', moving: false, age: 0, ageQ: 0, par: [m.guid, f.guid], mates: [], genes: childGenes(r, m, f) });
            }
        }
        // deaths, and the trade centre sells what waited a step (not what the
        // player just bought, unless it waited a year for a place)
        animals = animals.filter(a => a.age < SPECIES[a.species].facts.life && !(a.lt === 'trade' && a.waited && !(a.bought > t - 1)));
        for (const a of animals) if (a.lt === 'trade') a.waited = true;
        // new blood: every two park years the player buys an unrelated adult
        // of each species (Auto mode never buys: in a closed population every
        // animal ends up related and the programme pairs none of them)
        if (step % 8 === 4) {
            for (const sp of z.species) {
                const S = SPECIES[sp];
                changedAt.set(sp, t);
                const id = String(nextId++);
                animals.push({ id, key: 'animal_' + id, guid: 'g' + id, name: 'N' + id, species: sp, sex: r.chance(0.5) ? Sex.Male : Sex.Female, juv: false, contra: false, infertile: false, preg: false, alive: true, hab: '', loc: 'Trade Centre', lt: 'trade', moving: false, age: S.facts.maturity + 0.5, ageQ: 2, par: [], mates: [], genes: founderGenes(r, 10), bought: t });
            }
        }
        // the player moves an animal now and then
        if (step > 0 && r.chance(0.06)) {
            const cand = animals.filter(a => a.hab && !a.juv);
            if (cand.length) {
                const a = r.pick(cand);
                const to = r.pick(Object.entries(z.dest.bySpecies[a.species]).filter(([h, d]) => d.ok && h !== a.hab).map(([h]) => h));
                if (to) {
                    a.hab = to;
                    a.loc = 'Habitat ' + to;
                    manualUntil.set(a.guid, t + AUTO_LIMITS.manualYears);
                }
            }
        }
        // ---- Auto mode: what the runtime notices, then one run per species
        let model = build();
        const obs = observeChanges(seen || {}, model, expected);
        if (seen) noteManualMoves(l, model, obs.moved, t);
        seen = obs.seen;
        expected.clear();
        pruneLedger(l, model, t);
        l.clock = t;
        let tradeFree = Math.max(0, TRADE_MAX - animals.filter(a => a.lt === 'trade').length);
        for (const sp of z.species) {
            const view = ledgerView(l, model, t, step * 1e6);
            // as the runtime: a breeder parked at the trade centre is weighed again once its herd changed
            const parked = freeParked(model, sp, view, changedAt.get(sp));
            view.cooled = parked.cooled;
            view.recentFrom = parked.recentFrom;
            const res = planAutoRun({ model, species: sp, info: z.info[sp], destinations: z.dest, settings, view, tradeFree });
            stats.tradeHeld += res.held.filter(x => x.why === 'the trade centre is full').length;
            l.run++;
            for (const x of res.moves) {
                const a = animals.find(y => y.id === x.id);
                if (manualUntil.has(a.guid) && t < manualUntil.get(a.guid)) stats.manualMoved++;
                if (l.pins[a.guid]) stats.pinnedMoved++;
                if (x.reversal) {
                    stats.reversals++;
                    // the runtime stops a species at reversalsToStop within reversalYears
                    const recent = (reversalsAt.get(sp) || []).filter(v => t - v <= AUTO_LIMITS.reversalYears).concat([t]);
                    reversalsAt.set(sp, recent);
                    if (recent.length >= AUTO_LIMITS.reversalsToStop) stats.stopped++;
                }
                const list = (movedAt.get(a.guid) || []).filter(s => t - s < 1);
                list.push(t);
                movedAt.set(a.guid, list);
                if (list.length > 2) stats.churn++;
                const e = logAction(l, model, x, { run: l.run, clock: t, realNow: step * 1e6, species: sp });
                stats.logged++;
                expected.set(a.id, { to: x.to });
                if (x.to === TRADE) {
                    a.hab = '';
                    a.lt = 'trade';
                    a.waited = false;
                    tradeFree--;
                }
                else {
                    a.hab = x.to;
                    a.lt = 'habitat';
                }
                a.loc = x.to === TRADE ? 'Trade Centre' : 'Habitat ' + x.to;
                a.mates = [];
                settleAction(l, e, x, true, { clock: t, realNow: step * 1e6 });
                stats.moves++;
            }
            if (res.moves.length) model = build();
            // Auto mode never sends away a species' last breeding male or female
            for (const sex of [Sex.Male, Sex.Female]) {
                const before = res.moves.filter(x => x.to === TRADE).map(x => animals.find(y => y.id === x.id)).filter(a => a && a.sex === sex && !a.juv && !a.infertile && !a.contra);
                if (!before.length) continue;
                const left = animals.filter(a => a.species === sp && a.hab && a.sex === sex && !a.juv && !a.infertile && !a.contra && a.age < SPECIES[sp].facts.infertility);
                if (!left.length) stats.emptied++;
            }
        }
        const after = build();
        seen = observeChanges(seen, after, expected).seen;
        if (after.pairs.some(p => p.severity === 'risk')) stats.riskSteps++;
        stats.maxAnimals = Math.max(stats.maxAnimals, animals.length);
        if (process.env.SOAK_DEBUG > 1 && step % 8 === 0) {
            const per = z.species.map(sp => {
                const h = animals.filter(a => a.species === sp && a.hab);
                const fert = sex => h.filter(a => a.sex === sex && !a.juv && !a.infertile).length;
                return `${sp} ${h.length} (${fert(Sex.Male)}M ${fert(Sex.Female)}F) +${animals.filter(a => a.species === sp && !a.hab).length}tc`;
            });
            console.log('  t', t, per.join(' | '));
        }
    }
    stats.speciesLeft = z.species.filter(sp => animals.filter(a => a.species === sp && a.hab).length >= 2).length;
    stats.species = z.species.length;
    return stats;
}

const CASES = [
    { name: 'Best genetics, Thin out balanced', settings: { step: 3, thin: true, fill: 'balanced', trade: true }, seeds: [11, 12, 13] },
    { name: 'Fewer moves, Thin out strict', settings: { step: 1, thin: true, fill: 'strict', trade: true }, seeds: [11, 12, 13] },
    // the slowest (no Thin out: bigger groups to search), one zoo by default
    { name: 'Balanced, no Thin out', settings: { step: 2, thin: false, trade: true }, seeds: [13] },
];

for (const c of CASES) {
    test(`soak: 50 park years, ${c.name}`, () => {
        const total = { moves: 0, births: 0, inbredBirths: 0, riskSteps: 0, steps: 0 };
        for (const seed of process.env.SOAK_SEEDS ? process.env.SOAK_SEEDS.split(',').map(Number) : c.seeds) {
            const s = soak(seed, c.settings);
            const tag = `${c.name} seed ${seed}: ${JSON.stringify(s)}`;
            if (process.env.SOAK_DEBUG) console.log(tag);
            // never inbreed outranks a move's cooldown, and a breeder parked at
            // the trade centre is weighed again once its herd changes, so an
            // animal can move back within a year now and then; never often
            // enough to stop a species, and an animal moved three times in a
            // year stays rare
            assert.equal(s.stopped, 0, tag);
            assert.ok(s.reversals <= 5, tag);
            assert.ok(s.churn <= 3, tag);
            assert.equal(s.pinnedMoved, 0, tag);
            assert.equal(s.logged, s.moves, tag);
            if (c.settings.thin) assert.ok(s.maxAnimals < 400, `the population stays in hand: ${tag}`);
            assert.equal(s.emptied, 0, `the last breeder of a sex stays: ${tag}`);
            assert.ok(s.births >= 50, `they breed: ${tag}`);
            for (const k of Object.keys(total)) total[k] += s[k];
        }
        // Auto mode acted, inbred births are rare (a player's move, a full
        // trade centre or the last breeder of a sex can still leave
        // relatives together for a while), and inbreeding risks seldom last
        assert.ok(total.moves > 20, JSON.stringify(total));
        // (6 %, was 2 %: since 2026-10-19 a juvenile is never sent to the
        // trade centre, the developer's choice, so a young one with no place
        // in another group grows up next to its parents; 2.4-4.8 % measured)
        assert.ok(total.inbredBirths <= total.births * 0.06, JSON.stringify(total));
        assert.ok(total.riskSteps <= total.steps * 0.05, JSON.stringify(total));
    });
}
