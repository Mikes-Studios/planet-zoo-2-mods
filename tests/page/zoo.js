// Test zoos for the breeding programme: animals, family trees and habitats in the
// shape the park scan hands the page (kincore normalizeSnapshot).
import { buildKinModel, Sex } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { TRADE } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';

export { Sex, TRADE };

export const HIPPO = 'Hippopotamus_Common';
// animals.fdb Lifecycle_LongevityData: sexually mature (no longer juvenile) at 7, elderly and infertile at 40
export const HIPPO_FACTS = { maturity: 7, infertility: 40, life: 50, social: { min: 3, max: 30 } };
export const HIPPO_INFO = { species: HIPPO, mating: 'polygyny', social: { min: 3, max: 30 }, fertilityAges: { maturity: 7, infertility: 40 } };

// Same alleles for the same name: a different but fixed genome per animal,
// whatever other tests ran first.
function genome(name) {
    let x = 2166136261;
    for (let i = 0; i < name.length; i++) x = Math.imul(x ^ name.charCodeAt(i), 16777619) >>> 0;
    x = x || 1;
    const next = () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x;
    };
    const strand = () => Array.from({ length: 12 }, () => 'ABab'[next() % 4]).join('');
    return { F: strand(), I: strand(), S: strand(), L: strand() };
}

// genes at one level 0..6 for every grade (kincore ownGrades): fertility and
// immunity count loci where the two strands differ, size and longevity good alleles
export function strands(level) {
    const hetero = 'AAAAAA' + 'a'.repeat(level) + 'A'.repeat(6 - level);
    const good = 'A'.repeat(level * 2) + 'a'.repeat(12 - level * 2);
    return { F: hetero, I: hetero, S: good, L: good };
}

// One animal. Defaults: a fertile adult in its prime, living in `hab`.
export function animal(name, sex, hab, { par = [], age = 10, juv = false, contra = false, infertile = false, species = HIPPO, lt } = {}) {
    return {
        id: name, key: `animal_${name}`, guid: `g_${name}`, name, species, sex,
        juv, contra, infertile, age, ageQ: juv ? 0 : age < 14 ? 1 : 2,
        hab: hab === TRADE ? '' : hab, lt: lt || (hab === TRADE ? 'trade' : 'habitat'),
        par: par.map(p => `g_${p}`), genes: genome(`${species}|${name}`),
    };
}

// A juvenile: not yet sexually mature, so not a breeder and never moved.
export function juvenile(name, sex, hab, opts = {}) {
    return animal(name, sex, hab, Object.assign({ age: 2, juv: true }, opts));
}

// A young adult: past the juvenile age group, so already fertile.
export function youngAdult(name, sex, hab, opts = {}) {
    return animal(name, sex, hab, Object.assign({ age: 8 }, opts));
}

export function zoo(animals, { facts = { [HIPPO]: HIPPO_FACTS }, habitats = null } = {}) {
    const habs = habitats || [...new Set(animals.map(a => a.hab).filter(Boolean))];
    return buildKinModel({
        animals,
        habitats: habs.map(id => ({ id, name: id, kind: 'habitat' })),
        speciesFacts: facts,
    });
}

// Where each animal ends after the plan's moves: id -> habitat id or TRADE.
export function endPlaces(model, plan) {
    const out = new Map();
    for (const a of model.animals.values()) out.set(a.id, a.hab || (a.lt === 'trade' ? TRADE : ''));
    for (const m of plan.moves) out.set(String(m.id), String(m.to));
    return out;
}

export function residents(model, plan, hab) {
    const end = endPlaces(model, plan);
    return [...model.animals.values()].filter(a => end.get(a.id) === hab);
}
