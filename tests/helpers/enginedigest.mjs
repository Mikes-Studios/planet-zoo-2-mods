// What the Species board's engines answer for the seeded zoos, as plain
// JSON, recorded in engines_golden.json (record_engines_golden.mjs);
// tests/engines_equivalence.test.mjs checks the engines still answer exactly
// this with no Autopilot option set (design section 0a: off changes nothing).
import { buildKinModel } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { suggestPlan } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { planProgramme } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import { cullPlan } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincull.js';
import { makeZoo } from './zoogen.mjs';

export const SEEDS = Array.from({ length: 40 }, (_, i) => 1000 + i * 7);

const ids = list => list.map(x => ({ id: x.id, to: x.to, reason: x.reason || '' }));

export function digestZoo(seed) {
    const z = makeZoo(seed);
    const model = buildKinModel(z.snap);
    const out = {};
    for (const sp of z.species) {
        const info = () => JSON.parse(JSON.stringify(z.info[sp]));
        const d = {};
        d.suggest = ids(suggestPlan(model, sp, z.dest, { allowTrade: false, includeKin: true, assignments: z.assignments }));
        d.suggestTrade = ids(suggestPlan(model, sp, z.dest, { allowTrade: true, includeKin: false, assignments: null }));
        // spareOut off: the golden record predates non-breeders leaving over the make-up (2026-10-19)
        for (const [k, options] of [['prog', { moveCost: 0.04, spareOut: false }], ['progFew', { moveCost: 0.15, useTradeCentre: false, spareOut: false }]]) {
            const p = planProgramme(model, sp, info(), z.dest, { assignments: z.assignments, options });
            d[k] = p && { system: p.system, moves: p.moves, score: p.score, startScore: p.startScore, before: p.before, after: p.after, evaluations: p.evaluations, fromTrade: p.fromTrade, tradeWaiting: p.tradeWaiting, habitats: p.habitats, capacity: p.capacity };
        }
        for (const [k, options] of [['cull', { fill: 0.85 }], ['cullHard', { fill: 0.55, genes: 'below', oldAlways: true, young: true }]]) {
            const c = cullPlan(model, sp, info(), { options });
            d[k] = c && { moves: c.moves, habitats: c.habitats.map(h => ({ hab: h.hab, adults: h.adults, target: h.target, capacity: h.capacity, room: h.room, cull: h.cull.map(x => x.id + ':' + x.reason), keep: h.keep.map(x => x.id + ':' + x.why) })), before: c.before, after: c.after, poorKept: c.poorKept, estimated: c.estimated };
        }
        out[sp] = d;
    }
    return out;
}

export function digestAll() {
    return Object.fromEntries(SEEDS.map(s => [s, digestZoo(s)]));
}
