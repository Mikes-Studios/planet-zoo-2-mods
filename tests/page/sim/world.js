// Auto mode over a generated world as the game runs it: each species in
// turn, run again while a run moves animals (what moved cools down, what
// went to the trade centre is leaving), every run held to the STEP rules
// and the zoo it settles in to the SETTLED rules; an animal moved back
// where it came from before the species settles is a flip-flop.
import { simulatePlan } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { SETTLED_RULES, STEP_RULES, checkRun, runAuto, storedRules } from './rules.js';
import { TRADE } from '../zoo.js';

export const MAX_RUNS = 4; // a species still moving animals after this many runs does not settle

// One species to its settled zoo. -> { runs: [run], found: [{ rule, text }] }
export function settleSpecies(world, sp, { only = null } = {}) {
    const base = world.viewOf(sp);
    const view = { pinned: base.pinned.slice(), manual: base.manual.slice(), cooled: base.cooled.slice(), leaving: base.leaving.slice() };
    const runs = [];
    const found = [];
    const from = new Map(); // id -> where this settle moved it from
    for (;;) {
        const run = runAuto(world, sp, world.model, view);
        runs.push(run);
        found.push(...checkRun(world, sp, run, { model: world.model, view, rules: STEP_RULES, only }));
        if (!run.moves.length) {
            found.push(...checkRun(world, sp, run, { model: world.model, view, rules: SETTLED_RULES, only }));
            break;
        }
        for (const m of run.moves) {
            const a = world.model.animals.get(String(m.id));
            const here = a ? a.hab || TRADE : '';
            if (from.get(String(m.id)) === String(m.to) && (!only || only.includes('flipflop'))) found.push({ rule: 'flipflop', text: `${m.id} moved back to ${m.to} within one settle` });
            from.set(String(m.id), here);
        }
        world.model = simulatePlan(world.model, run.moves, null);
        for (const m of run.moves) {
            view.cooled.push(String(m.id));
            if (m.leave) view.leaving.push(String(m.id));
        }
        if (runs.length >= MAX_RUNS && (!only || only.includes('settled'))) {
            const moved = runs.slice(-2).flatMap(r => r.moves.map(m => `${m.id}>${m.to}`)).join(' ');
            found.push({ rule: 'settled', text: `still moving after ${MAX_RUNS} runs (${moved})` });
            break;
        }
        if (runs.length >= MAX_RUNS) break;
    }
    return { runs, found };
}

// Every species of the world. -> [{ species, rule, text }]
export function autoPass(world, { only = null } = {}) {
    const out = [];
    for (const sp of world.species) {
        const { found } = settleSpecies(world, sp, { only });
        if (!only || only.includes('stored')) found.push(...storedRules(world, sp).map(text => ({ rule: 'stored', text })));
        for (const v of found) out.push(Object.assign({ species: sp }, v));
    }
    return out;
}
