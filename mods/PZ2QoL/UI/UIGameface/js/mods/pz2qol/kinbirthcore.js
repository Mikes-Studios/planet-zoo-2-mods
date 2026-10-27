// Overdue births (kinbirth.js). Pure, no game imports (Node tests).
import { speciesRules } from './speciesrules.js';

// a pregnancy this many times its species' length has stalled: the game
// lets the birth go once the mother is boxed and unboxed
export const OVERDUE_FACTOR = 2;

// Habitat mothers whose pregnancy has run OVERDUE_FACTOR times its length
// since it was first seen. started: Map id -> age when first seen pregnant,
// kept up to date here (a pregnancy seen for the first time starts now,
// one that ended is forgotten). -> [animal]
export function overdueMothers(model, started) {
    const out = [];
    const pregnant = new Set();
    for (const a of model ? model.animals.values() : []) {
        if (!a.preg || a.exhibit || a.lt !== 'habitat' || a.moving || typeof a.age !== 'number') continue;
        pregnant.add(a.id);
        if (!started.has(a.id)) started.set(a.id, a.age);
        const rules = speciesRules(a.species);
        const gestation = rules && rules.gestationYears;
        if (gestation > 0 && a.age - started.get(a.id) >= OVERDUE_FACTOR * gestation) out.push(a);
    }
    for (const id of Array.from(started.keys())) if (!pregnant.has(id)) started.delete(id);
    return out;
}
