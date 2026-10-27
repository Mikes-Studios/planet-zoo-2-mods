// Park years with Auto mode on: every half year each species settles (as
// Auto mode runs while the zoo changes, and again when an animal grows up),
// then the zoo lives on: pairs
// conceive, calves are born and grow up beside their relatives, animals age
// and die, and the player now and then moves one by hand or pins it. Locks
// expire as Auto mode's ledger lets them (AUTO_LIMITS). Every run is held to
// the rules, and an animal Auto mode moves back where it came from within a
// year, with nothing in its species changed by anyone else, is a flip-flop.
// Pairs conceive the moment young ones grow up, before Auto mode can move
// anyone (a keeper takes a while to come): only its contraception guard
// (guardChanges) stands between relatives then, and any conception between
// relatives breaks the inbred rule.
import fc from 'fast-check';
import { AUTO_LIMITS, guardChanges, withGuardsLifted } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { relatedPair } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import { mustHouse, simulatePlan } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { FACTS, Sex, TRADE, buildWorld, modelOf, worldArb } from './gen.js';
import { SETTLED_RULES, STEP_RULES, checkRun, runAuto } from './rules.js';

export const STEP_YEARS = 0.5;

export const lifeArb = fc.record({
    world: worldArb,
    years: fc.integer({ min: 2, max: 8 }),
    seed: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
    // the player's hand: per half year, an animal (by index, wrapped) and what is done to it
    hand: fc.array(fc.record({ step: fc.nat(15), pick: fc.nat(60), act: fc.constantFrom('move', 'trade', 'pin') }), { maxLength: 4 }),
});

function random(seed) {
    let x = seed >>> 0 || 1;
    return () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x / 4294967296;
    };
}

// A calf's genes: one strand half from each parent, locus by locus.
function calfGenes(mum, dad, rnd) {
    const out = {};
    for (const k of ['F', 'I', 'S', 'L']) {
        let s = '';
        for (let i = 0; i < 12; i++) s += (rnd() < 0.5 ? mum : dad).genes[k][i];
        out[k] = s;
    }
    return out;
}

const live = (world, a) => world.model.animals.get(a.id);

// -> [{ year, species, rule, text }]
// onRun(year, species, run, model): each run, for tools/sim.mjs --show
export function liveYears(life, { onRun = null } = {}) {
    const world = buildWorld(life.world);
    const rnd = random(life.seed);
    const animals = world.animals.map(a => Object.assign({}, a, { par: a.par.slice() }));
    const views = new Map(world.species.map(sp => [sp, world.viewOf(sp)]));
    const until = new Map(); // `${kind}|${id}` -> year a lock ends
    const lastMove = new Map(); // id -> { from, to, year, species } of Auto mode's last move
    // something not Auto mode's changed the species: what it did last is no flip-flop to undo
    const changed = sp => {
        for (const [id, m] of lastMove) if (m.species === sp) lastMove.delete(id);
    };
    const out = [];
    let born = 0;
    // GUIDs of the females Auto mode put on contraception against inbreeding
    const guarded = new Set();
    const guard = () => {
        const { on, off } = guardChanges(world.model, guarded);
        for (const f of on) {
            animals.find(x => x.id === f.id).contra = true;
            guarded.add(String(f.guid));
        }
        for (const f of off) {
            animals.find(x => x.id === f.id).contra = false;
            guarded.delete(String(f.guid));
        }
        if (on.length || off.length) rebuild();
    };
    for (const sp of world.species) {
        const v = views.get(sp);
        for (const id of v.manual) until.set(`manual|${id}`, AUTO_LIMITS.manualYears);
        for (const id of v.cooled) until.set(`cooled|${id}`, AUTO_LIMITS.cooldownYears);
    }
    const rebuild = () => {
        world.model = modelOf(animals.filter(a => a.alive !== false), world.species, world.habs, life.world.sandbox);
    };
    const settle = (year) => {
        for (const sp of world.species) {
            const view = views.get(sp);
            for (let k = 0; k < 4; k++) {
                // the planner sees a guarded female as the breeder she is (withGuardsLifted)
                const seen = withGuardsLifted(world.model, guarded);
                const run = runAuto(world, sp, seen, view);
                if (onRun) onRun(year, sp, run, seen);
                for (const v of checkRun(world, sp, run, { model: seen, view, rules: STEP_RULES })) out.push(Object.assign({ year, species: sp }, v));
                if (!run.moves.length) {
                    for (const v of checkRun(world, sp, run, { model: seen, view, rules: SETTLED_RULES })) out.push(Object.assign({ year, species: sp }, v));
                    break;
                }
                for (const m of run.moves) {
                    const a = animals.find(x => x.id === String(m.id));
                    const from = a.hab || TRADE;
                    const back = lastMove.get(a.id);
                    // the golden rule's moves (mustHouse) are no back and forth, as Auto mode's own guard counts them
                    if (back && back.from === String(m.to) && year - back.year < AUTO_LIMITS.reversalYears && !mustHouse(seen.animals.get(a.id))) out.push({ year, species: sp, rule: 'flipflop', text: `${a.id} moved ${back.from}>${back.to} at year ${back.year} and back at year ${year}` });
                    lastMove.set(a.id, { from, to: String(m.to), year, species: sp });
                    a.hab = m.to === TRADE ? '' : String(m.to);
                    a.lt = m.to === TRADE ? 'trade' : 'habitat';
                    view.cooled.push(a.id);
                    until.set(`cooled|${a.id}`, year + AUTO_LIMITS.cooldownYears);
                    if (m.leave) view.leaving.push(a.id);
                }
                world.model = simulatePlan(world.model, run.moves, null);
            }
        }
        guard();
    };
    rebuild();
    const steps = Math.round(life.years / STEP_YEARS);
    for (let step = 0; step < steps; step++) {
        const year = step * STEP_YEARS;
        // locks that ran out
        for (const [key, end] of until) {
            if (end > year) continue;
            until.delete(key);
            const [kind, id] = key.split('|');
            for (const v of views.values()) v[kind] = v[kind].filter(x => x !== id);
            // a lock that runs out opens layouts the last runs could not make
            const a = animals.find(x => x.id === id);
            if (a) changed(a.species);
        }
        settle(year);
        // the player's hand
        for (const h of life.hand.filter(x => x.step === step)) {
            const alive = animals.filter(a => a.alive !== false && !a.juv);
            const a = alive[h.pick % Math.max(1, alive.length)];
            if (!a) continue;
            const view = views.get(a.species);
            changed(a.species);
            if (h.act === 'pin') view.pinned.push(a.id);
            else {
                a.hab = h.act === 'trade' ? '' : world.habs[h.pick % world.habs.length];
                a.lt = a.hab ? 'habitat' : 'trade';
                view.manual.push(a.id);
                until.set(`manual|${a.id}`, year + AUTO_LIMITS.manualYears);
            }
        }
        // the guard sees the hand's moves and the young about to grow up
        rebuild();
        guard();
        // half a year of life
        for (const a of animals) {
            if (a.alive === false) continue;
            const facts = FACTS[a.species];
            if (a.preg) {
                changed(a.species);
                const dad = animals.find(x => x.id === a.father);
                animals.push({
                    id: `B${born}`, key: `animal_B${born}`, guid: `g_B${born}`, name: `B${born}`, species: a.species, sex: rnd() < 0.5 ? Sex.Male : Sex.Female,
                    juv: true, contra: false, infertile: false, preg: false, age: 0, ageQ: 0, hab: a.hab, lt: a.hab ? 'habitat' : 'trade',
                    par: [a.guid, dad ? dad.guid : `x_${a.species}_${Sex.Male}_lost`], genes: calfGenes(a, dad || a, rnd),
                });
                born++;
                a.preg = false;
                a.father = null;
            }
            const soon = facts.maturity - AUTO_LIMITS.growUpSoonYears;
            // a juvenile growing up soon counts as an adult relative (Auto mode's growUpSoonYears)
            if (a.juv && a.age < soon && a.age + STEP_YEARS >= soon) changed(a.species);
            a.age += STEP_YEARS;
            if (a.juv && a.age >= facts.maturity) {
                a.juv = false;
                changed(a.species);
            }
            if (a.age >= facts.life) {
                a.alive = false;
                changed(a.species);
            }
        }
        rebuild();
        // conception at once, before any keeper comes: a fertile female beside a
        // fertile male of her kind, related or not (the game does not care)
        for (const f of animals) {
            const m = live(world, f);
            if (!m || f.sex !== Sex.Female || f.juv || f.preg || f.contra || !f.hab || m.fert.state !== 'fertile') continue;
            const males = animals.filter(x => x.alive !== false && x.species === f.species && x.sex === Sex.Male && !x.juv && x.hab === f.hab && live(world, x) && live(world, x).fert.state === 'fertile');
            if (males.length && rnd() < 0.4) {
                const dad = males[Math.floor(rnd() * males.length)];
                if (relatedPair(world.model, m, live(world, dad))) out.push({ year, species: f.species, rule: 'inbred', text: `${f.id} conceived with ${dad.id}, a relative` });
                f.preg = true;
                f.father = dad.id;
                changed(f.species);
            }
        }
        rebuild();
        // an animal that grew up asks for a run at once (kinauto's grown watch)
        settle(year + STEP_YEARS / 2);
    }
    return out;
}
