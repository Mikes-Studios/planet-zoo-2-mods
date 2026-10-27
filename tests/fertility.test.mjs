// node --test tests/fertility.test.mjs
// Fertility over an animal's life: too young, not mature yet, fertile, the
// last fertile years, too old; and what that means for kin risks, Suggest
// fixes, Find a mate and the breeding programme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel, fertilityOf, fertilityText, fertilityTag, mateCandidates, Sex } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { breedingPairs, fertileAdult, suggestPlan } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { isBreeder, longevityWeight, planProgramme } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';

const M = Sex.Male, F = Sex.Female;
const LION = { maturity: 3, infertility: 15, life: 20 };
const an = (id, sex, hab, par = [], over = {}) => Object.assign({
    id, key: 'animal_' + id, guid: 'g' + id, name: id, species: 'Lion', sex, juv: false, contra: false, infertile: false,
    hab, loc: 'H' + hab, lt: 'habitat', par: par.map(p => 'g' + p), mates: [], age: 6, ageQ: 2,
    genes: { F: 'AAAAAABBBBBB', I: 'AAAAAABBBBBB', S: 'AAAAAACCCCCC', L: 'AAAAAACCCCCC' },
}, over);
const snap = (animals, facts = { Lion: LION }) => ({
    v: 1, seq: 1, scope: 'park', mode: 'offline', habitats: ['1', '2', '3'].map(h => ({ id: h, name: 'H' + h })), animals, anc: {}, speciesFacts: facts,
});
const model = (animals, facts) => buildKinModel(snap(animals, facts));

test('fertility states from the flags, age and the species fertility ages', () => {
    const m = model([
        an('cub', F, '1', [], { juv: true, infertile: true, age: 1 }),
        an('teen', F, '1', [], { infertile: true, age: 2.5, ageQ: 1 }),
        an('prime', M, '1', [], { age: 6 }),
        an('late', M, '1', [], { age: 13.5 }),
        an('old', M, '1', [], { infertile: true, age: 16, ageQ: 3 }),
        an('oldNoFlag', M, '1', [], { age: 15.2 }),
        an('sterile', F, '1', [], { infertile: true, age: 7 }),
    ]);
    const st = id => m.animals.get(id).fert;
    assert.equal(st('cub').state, 'juvenile');
    assert.equal(st('cub').yearsToMature, 2);
    assert.equal(st('teen').state, 'young');
    assert.equal(st('prime').state, 'fertile');
    assert.equal(st('prime').yearsLeft, 9);
    assert.equal(st('late').state, 'ending'); // last fifth of 12 fertile years (2.4)
    assert.equal(st('old').state, 'old');
    assert.equal(st('oldNoFlag').state, 'old');
    assert.equal(st('sterile').state, 'sterile');
    assert.equal(fertilityText(m.animals.get('cub')), 'breeds in about 2 years');
    assert.equal(fertilityText(m.animals.get('old')), 'too old to breed');
    assert.equal(fertilityText(m.animals.get('late')), 'fertile for about 2 years more');
    assert.equal(fertilityTag(m.animals.get('old')).cls, 'old');
    assert.equal(fertilityTag(m.animals.get('late')).cls, 'ending');
    assert.equal(fertilityTag(m.animals.get('prime')), null);
});

test('a species that never becomes infertile is fertile for life', () => {
    const f = fertilityOf(an('t', F, '1', [], { age: 80 }), { maturity: 10, infertility: 999 });
    assert.equal(f.state, 'fertile');
    assert.equal(f.yearsLeft, null);
    assert.equal(fertilityText({ fert: f }), 'fertile for life');
});

test('an old father with his daughter is covered, with the reason', () => {
    const m = model([an('dad', M, '1', [], { infertile: true, age: 16, ageQ: 3 }), an('d', F, '1', ['dad', 'mum'])]);
    const p = m.pairs.find(x => x.species === 'Lion');
    assert.equal(p.severity, 'covered');
    assert.equal(p.cover, 'dad is too old to breed');
});

test('a cub whose father will be too old by the time she grows up is covered', () => {
    const later = model([an('dad', M, '1', [], { age: 14 }), an('cub', F, '1', ['dad', 'mum'], { juv: true, infertile: true, age: 1 })]);
    const p = later.pairs[0];
    assert.equal(p.severity, 'covered');
    assert.match(p.cover, /dad will be too old to breed by the time cub can/);
    const soon = model([an('dad', M, '1', [], { age: 8 }), an('cub', F, '1', ['dad', 'mum'], { juv: true, infertile: true, age: 1 })]);
    assert.equal(soon.pairs[0].severity, 'future');
});

test('an adult not mature yet is a later risk, not covered', () => {
    const m = model([an('dad', M, '1', [], { age: 7 }), an('teen', F, '1', ['dad', 'mum'], { infertile: true, age: 2.5, ageQ: 1 })]);
    assert.equal(m.pairs[0].severity, 'future');
});

test('Suggest fixes: old animals are not breeders, a breeder in its last years counts half', () => {
    const m = model([
        an('old', M, '1', [], { infertile: true, age: 16, ageQ: 3 }),
        an('late', M, '2', [], { age: 13.5 }),
        an('f1', F, '1'), an('f2', F, '2'),
    ]);
    assert.equal(fertileAdult(m.animals.get('old')), false);
    assert.equal(breedingPairs(m, '1', 'Lion').pairs, 0);
    const b2 = breedingPairs(m, '2', 'Lion');
    assert.equal(b2.pairs, 1);
    // the late male counts half, his partner whole
    assert.equal(b2.bred, 1.5);
});

test('Suggest fixes explains why a moved animal does not breed', () => {
    // the old father has to leave his daughters' habitat; he does not breed anywhere
    const m = model([
        an('dad', M, '1', [], { age: 16, ageQ: 3, infertile: true }),
        an('d1', F, '1', ['dad', 'mum']), an('d2', F, '1', ['dad', 'mum']),
    ]);
    // covered pairs need no fix: nothing to suggest
    assert.equal(suggestPlan(m, 'Lion', { bySpecies: { Lion: { 2: { ok: true } } }, habitats: [] }).length, 0);
});

test('Find a mate ranks animals that can breed before too old ones', () => {
    const m = model([
        an('f', F, '1'),
        an('oldM', M, '2', [], { infertile: true, age: 16, ageQ: 3, genes: { F: 'BBBBBBBBBBBB', I: 'BBBBBBBBBBBB', S: 'BBBBBBBBBBBB', L: 'BBBBBBBBBBBB' } }),
        an('m', M, '3'),
    ]);
    const c = mateCandidates(m, 'f');
    assert.deepEqual(c.map(x => x.animal.id), ['m', 'oldM']);
    assert.equal(c[1].breeds, 'never');
});

test('breeding programme: old animals are not breeders, young partners preferred', () => {
    const m = model([
        an('late', M, '1', [], { age: 14 }), an('young', M, '2', [], { age: 4 }), an('f', F, '3', [], { age: 5 }),
    ]);
    assert.equal(isBreeder(an('o', M, '1', [], { fert: { state: 'old' } })), false);
    const info = { mating: 'monogamy', social: { max: 2 }, fertilityAges: { maturity: 3, infertility: 15 } };
    assert.ok(longevityWeight(m.animals.get('late'), m.animals.get('f'), info) < longevityWeight(m.animals.get('young'), m.animals.get('f'), info));
    const plan = planProgramme(m, 'Lion', info, { bySpecies: { Lion: { 1: { ok: true }, 2: { ok: true }, 3: { ok: true } } }, habitats: [] });
    const where = id => {
        const mv = plan.moves.find(x => x.id === id);
        return mv ? String(mv.to) : m.animals.get(id).hab;
    };
    // the female ends up with the young male, not the one about to age out
    assert.equal(where('f'), where('young'));
    assert.notEqual(where('f'), where('late'));
});

test('the programme uses the snapshot fertility ages when the game was not asked', () => {
    const m = model([an('old', M, '1', [], { age: 16 }), an('f', F, '2')]);
    const plan = planProgramme(m, 'Lion', {}, null);
    assert.equal(plan.after.breedingPairs, 0);
});
