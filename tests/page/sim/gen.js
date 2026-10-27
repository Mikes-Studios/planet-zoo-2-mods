// Random zoos for the rule checks (tests/rules.test.js, tools/sim.mjs): a
// plain description fast-check can generate and shrink, and the world built
// from it, in the shape Auto mode's run takes (kinautocore planAutoRun).
import fc from 'fast-check';
import { buildKinModel, normalizeStored } from '../../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { HIPPO, HIPPO_FACTS, Sex, TRADE } from '../zoo.js';

export const GIRAFFE = 'Giraffe_Reticulated';
export const SPECIES = [HIPPO, GIRAFFE];
// animals.fdb Lifecycle_LongevityData, as tests/zoo.js has the hippo's
export const FACTS = {
    [HIPPO]: HIPPO_FACTS,
    [GIRAFFE]: { maturity: 4, infertility: 26, life: 30, social: { min: 2, max: 12 } },
};

// mostly false: one in `n`
const rare = n => fc.integer({ min: 1, max: n }).map(x => x === 1);

// parents: an earlier animal by index, or one the zoo never had (a shared
// outside parent still makes siblings)
const parentArb = fc.option(fc.integer({ min: 0, max: 40 }), { freq: 2 });

// genes near the zoo's own level (a herd is bred from a few lines), now and
// then far off it
const offArb = fc.oneof({ arbitrary: fc.integer({ min: -1, max: 1 }), weight: 8 }, { arbitrary: fc.integer({ min: -5, max: 5 }), weight: 1 });

const animalArb = fc.record({
    sp: fc.integer({ min: 0, max: SPECIES.length - 1 }),
    sex: fc.constantFrom(Sex.Male, Sex.Female),
    place: fc.integer({ min: 0, max: 4 }), // 0: the trade centre, else a habitat (wrapped to the zoo's count)
    stage: fc.constantFrom('prime', 'prime', 'young', 'juv', 'ageing', 'old'),
    fi: offArb, // fertility and immunity: off the zoo's level (tests/zoo.js strands)
    sl: offArb, // size and longevity: off the zoo's level
    mum: parentArb,
    dad: parentArb,
    preg: rare(8),
    contra: rare(10),
    hands: rare(12), // hands off (the player's pin)
    lock: fc.constantFrom('none', 'none', 'none', 'manual', 'cooled'),
    leaving: rare(4), // at the trade centre: sent there to leave
});

const storedArb = fc.record({
    sp: fc.integer({ min: 0, max: SPECIES.length - 1 }),
    sex: fc.constantFrom(Sex.Male, Sex.Female),
    fi: offArb,
    sl: offArb,
    mum: parentArb,
    listed: rare(3),
});

export const worldArb = fc.record({
    habs: fc.integer({ min: 1, max: 4 }),
    species: fc.integer({ min: 1, max: SPECIES.length }),
    // per habitat: a bit per species set aside there (0: none, Auto then
    // takes every habitat the species lives in)
    assign: fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 4, maxLength: 4 }),
    assigned: fc.boolean(),
    sandbox: fc.boolean(), // the game's social groups off (the owner's setting)
    sexMax: fc.option(fc.record({ male: fc.integer({ min: 1, max: 2 }), female: fc.integer({ min: 2, max: 10 }) })),
    thin: fc.boolean(),
    level: fc.record({ fi: fc.integer({ min: 1, max: 6 }), sl: fc.integer({ min: 1, max: 6 }) }),
    trade: fc.boolean(),
    animals: fc.array(animalArb, { maxLength: 40, size: 'medium' }),
    stored: fc.array(storedArb, { maxLength: 6 }),
});

function strandsOf(level, d) {
    const clamp = v => Math.max(0, Math.min(6, v));
    const fi = clamp(level.fi + d.fi), sl = clamp(level.sl + d.sl);
    const hetero = 'AAAAAA' + 'a'.repeat(fi) + 'A'.repeat(6 - fi);
    const good = 'A'.repeat(sl * 2) + 'a'.repeat(12 - sl * 2);
    return { F: hetero, I: hetero, S: good, L: good };
}

function ageOf(stage, facts) {
    if (stage === 'juv') return facts.maturity * 0.4;
    if (stage === 'young') return facts.maturity + 1;
    if (stage === 'old') return facts.infertility + 1;
    // turns elderly within the run: Auto mode's ageing step (a year ahead) comes into play
    if (stage === 'ageing') return facts.infertility - 1.5;
    return (facts.maturity + facts.infertility) / 2;
}

export const habId = i => `H${i + 1}`;

// The park scan's model of these animals (kincore buildKinModel).
export function modelOf(animals, species, habs, sandbox, facts = FACTS) {
    return buildKinModel({
        animals,
        habitats: habs.map(id => ({ id, name: id, kind: 'habitat' })),
        speciesFacts: Object.fromEntries(species.map(sp => [sp, facts[sp]])),
        rules: sandbox ? { socialGroups: false, overcrowding: false } : { socialGroups: true, overcrowding: true },
    });
}

// A zoo from the trace (tools/trace-to-zoo.mjs) as a world: its locks as
// the trace logged them (none in a trace older than "auto view"), Auto
// mode's default settings.
export function fixtureWorld(fx) {
    const species = Object.keys(fx.speciesFacts);
    const animals = fx.animals.map(a => Object.assign({}, a, { par: a.par.slice() }));
    const assignments = new Map();
    for (const [sp, habs] of Object.entries(fx.assignments)) {
        for (const h of habs) {
            if (!assignments.has(h)) assignments.set(h, new Set());
            assignments.get(h).add(sp);
        }
    }
    const facts = fx.speciesFacts;
    return {
        desc: null, animals, species, habs: fx.habitats, assignments,
        model: modelOf(animals, species, fx.habitats, fx.sandbox, facts),
        infoOf: sp => Object.assign({ species: sp, mating: 'polygyny', fertilityAges: { maturity: facts[sp].maturity, infertility: facts[sp].infertility } }, (fx.info || {})[sp] || {}),
        viewOf: sp => {
            const v = (fx.view || {})[sp] || {};
            return { pinned: (v.pinned || []).slice(), manual: (v.manual || []).slice(), cooled: (v.cooled || []).slice(), leaving: (v.leaving || []).slice() };
        },
        storedOf: sp => normalizeStored({ species: sp, animals: [] }),
        settings: { on: true, thin: true, trade: true },
    };
}

// The description -> { model, species: [..], infoOf(sp), assignments,
// viewOf(sp), settings, storedOf(sp), desc }
export function buildWorld(desc) {
    const species = SPECIES.slice(0, desc.species);
    const habs = Array.from({ length: desc.habs }, (_, i) => habId(i));
    const animals = [];
    desc.animals.forEach((d, i) => {
        const sp = species[d.sp % species.length];
        const facts = FACTS[sp];
        const id = `A${i}`;
        const juv = d.stage === 'juv';
        const hab = d.place === 0 ? '' : habs[(d.place - 1) % habs.length];
        const parent = (ref, sex) => {
            if (ref == null) return null;
            const p = ref < i ? animals[ref] : null;
            if (p) return p.species === sp && p.sex === sex ? p.guid : null;
            return `x_${sp}_${sex}_${ref}`;
        };
        animals.push({
            id, key: `animal_${id}`, guid: `g_${id}`, name: id, species: sp, sex: d.sex,
            juv, contra: d.contra && !juv, infertile: false, preg: d.preg && !juv && d.sex === Sex.Female && d.stage !== 'old',
            age: ageOf(d.stage, facts), ageQ: juv ? 0 : d.stage === 'prime' ? 1 : 2,
            hab, lt: hab ? 'habitat' : 'trade',
            par: [parent(d.mum, Sex.Female), parent(d.dad, Sex.Male)].filter(Boolean),
            genes: strandsOf(desc.level, d),
        });
    });
    const model = modelOf(animals, species, habs, desc.sandbox);
    const assignments = new Map();
    if (desc.assigned) {
        habs.forEach((h, i) => {
            const set = new Set(species.filter((_, k) => desc.assign[i] & (1 << k)));
            if (set.size) assignments.set(h, set);
        });
    }
    const infoOf = sp => Object.assign({
        species: sp, mating: 'polygyny', social: FACTS[sp].social,
        fertilityAges: { maturity: FACTS[sp].maturity, infertility: FACTS[sp].infertility },
    }, desc.sexMax ? { sexMax: desc.sexMax } : {});
    const ids = (sp, pick) => desc.animals.map((d, i) => [d, animals[i]]).filter(([d, a]) => a.species === sp && pick(d, a)).map(([, a]) => a.id);
    const viewOf = sp => ({
        pinned: ids(sp, d => d.hands),
        manual: ids(sp, d => d.lock === 'manual'),
        cooled: ids(sp, d => d.lock === 'cooled'),
        leaving: ids(sp, (d, a) => d.leaving && a.lt === 'trade'),
    });
    const storedOf = sp => normalizeStored({
        species: sp,
        animals: desc.stored.map((d, i) => ({ d, i })).filter(({ d }) => species[d.sp % species.length] === sp).map(({ d, i }) => ({
            guid: `s_${i}`, name: `S${i}`, sex: d.sex, maturity: 2, forSale: d.listed,
            par: d.mum != null && d.mum < animals.length && animals[d.mum].species === sp && animals[d.mum].sex === Sex.Female ? [animals[d.mum].guid] : [],
            genes: strandsOf(desc.level, d),
        })),
    });
    return {
        desc, model, animals, species, habs, infoOf, viewOf, storedOf,
        assignments: assignments.size ? assignments : null,
        settings: { on: true, thin: desc.thin, trade: desc.trade },
    };
}

export { Sex, TRADE };
