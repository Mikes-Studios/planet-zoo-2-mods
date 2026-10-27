// node --test tests/kin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildKinModel, normalizeSnapshot, Pedigree, predictOffspring, ownGrades, offspringScore, relationWord,
    animalSeverity, animalPairs, explainRelation, habitatSummary, habitatByName, habitatsAtRisk, mateCandidates,
    newRisks, relativesOf, percent, Sex, pairSeverity, describeRelation, kinClusters, canLocate,
    normalizeStored, withStored,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { countsExcluding, riskHabitatsExcluding } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { DEFAULT_CLOSE_KINSHIP } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';

const M = Sex.Male, F = Sex.Female;
const an = (id, sex, par, over = {}) => Object.assign({
    id, key: `animal_${id}`, guid: 'g' + id, name: id.toUpperCase(), species: 'Lion', sex, juv: false, contra: false,
    infertile: false, preg: false, hab: '1', loc: 'Savannah Habitat', par: par.map(p => p ? 'g' + p : ''), mates: [],
}, over);

// Savannah (habitat 1), lions:
//   a (father of k1, k2, h1), b (dead), e (dead)
//   k1 x k2 full siblings; h1 their half-sister (mother e), on contraception
// Jungle (habitat 2), tigers:
//   gp (grandfather of y), x and y first cousins (their parents p1, p2 are
//   full siblings, children of gp and gm), z a juvenile half-sister of x
const tiger = (id, sex, par, over = {}) => an(id, sex, par, Object.assign({ species: 'Tiger', hab: '2', loc: 'Jungle Habitat' }, over));
function zoo(extra = []) {
    return {
        v: 1, seq: 3, scope: 'park',
        habitats: [{ id: '1', name: 'Savannah Habitat' }, { id: '2', name: 'Jungle Habitat' }, { id: '3', name: 'Plains Habitat' }],
        animals: [
            an('a', M, ['', '']),
            an('k1', M, ['a', 'b']),
            an('k2', F, ['a', 'b']),
            an('h1', F, ['a', 'e'], { contra: true }),
            an('u', F, ['', ''], { hab: '3', loc: 'Plains Habitat' }),
            tiger('gp', M, ['', '']),
            tiger('x', M, ['p1', 'q1']),
            tiger('y', F, ['p2', 'q2']),
            tiger('z', F, ['q1', 'r'], { juv: true, infertile: true }),
            ...extra,
        ],
        anc: { gp1: ['ggp', 'ggm'], gp2: ['ggp', 'ggm'], gb: [], ge: [], gq1: [], gq2: [], gr: [] },
    };
}

test('normalize: defaults, strings, unknown parents dropped', () => {
    const s = normalizeSnapshot({ animals: [{ id: 5, guid: 0, par: ['', 0, 'g1'], sex: 1 }], anc: { '': ['x'], g1: ['', 'g2'] } });
    assert.equal(s.animals[0].id, '5');
    assert.equal(s.animals[0].guid, '');
    assert.deepEqual(s.animals[0].par, ['g1']);
    assert.equal(s.animals[0].key, 'animal_5');
    assert.deepEqual(s.anc, { g1: ['g2'] });
    assert.equal(s.scope, 'park');
});

test('kinship coefficients follow the textbook values', () => {
    const ped = new Pedigree(normalizeSnapshot(zoo()));
    assert.equal(ped.kinship('ga', 'gk1'), 0.25);         // parent / child
    assert.equal(ped.kinship('gk1', 'gk2'), 0.25);        // full siblings
    assert.equal(ped.kinship('gk1', 'gh1'), 0.125);       // half siblings
    assert.equal(ped.kinship('gx', 'gy'), 0.0625);        // first cousins
    assert.equal(ped.kinship('ggp', 'gy'), 0.125);        // grandparent
    assert.equal(ped.kinship('gx', 'gz'), 0.125);         // half siblings via q1
    assert.equal(ped.kinship('ga', 'gu'), 0);
    assert.equal(ped.kinship('ga', 'ga'), 0.5);
});

test('game rule: parent/child and shared parent only', () => {
    const ped = new Pedigree(normalizeSnapshot(zoo()));
    assert.equal(ped.gameInbred('ga', 'gk2'), true);
    assert.equal(ped.gameInbred('gk1', 'gk2'), true);
    assert.equal(ped.gameInbred('gk1', 'gh1'), true);
    assert.equal(ped.gameInbred('gx', 'gy'), false);      // cousins: not flagged by the game
    assert.equal(ped.gameInbred('ggp', 'gy'), false);     // grandparent: not flagged
});

test('relations and words', () => {
    const ped = new Pedigree(normalizeSnapshot(zoo()));
    const r = (x, y) => ped.relation('g' + x, 'g' + y);
    assert.equal(r('k1', 'a').code, 'parent');
    assert.equal(relationWord(r('k1', 'a'), M), 'father');
    assert.equal(relationWord(r('a', 'k2'), F), 'daughter');
    assert.equal(relationWord(r('k1', 'k2'), F), 'sister');
    assert.equal(relationWord(r('k2', 'h1'), F), 'half-sister');
    assert.equal(relationWord(r('y', 'gp'), M), 'grandfather');
    assert.equal(relationWord(r('gp', 'y'), F), 'granddaughter');
    assert.equal(relationWord(r('x', 'y'), F), 'cousin');
    assert.equal(r('x', 'y').full, true);
    assert.equal(r('a', 'u'), null);
});

test('aunt/uncle and niece/nephew', () => {
    // n's mother is k2; k1 is k2's full brother, so k1 is n's uncle
    const ped = new Pedigree(normalizeSnapshot(zoo([an('n', F, ['k2', 'u'])])));
    const r = ped.relation('gn', 'gk1');
    assert.equal(r.code, 'auntUncle');
    assert.equal(relationWord(r, M), 'uncle');
    assert.equal(relationWord(ped.relation('gk1', 'gn'), F), 'niece');
    assert.equal(ped.kinship('gn', 'gk1'), 0.125);
    assert.equal(ped.gameInbred('gn', 'gk1'), false);
});

test('model: pairs, severities and per-animal badges', () => {
    const m = buildKinModel(zoo());
    const sev = (x, y) => m.pairs.find(p => (p.a.id == x && p.b.id == y) || (p.a.id == y && p.b.id == x))?.severity;
    assert.equal(sev('a', 'k2'), 'risk');
    assert.equal(sev('k1', 'k2'), 'risk');
    assert.equal(sev('a', 'h1'), 'covered');
    assert.equal(sev('k1', 'h1'), 'covered');
    assert.equal(sev('x', 'y'), 'kin');
    assert.equal(sev('gp', 'y'), 'kin');
    assert.equal(sev('x', 'z'), 'future');                 // juvenile counts as later, not covered
    assert.equal(sev('a', 'k1'), undefined);               // same sex
    assert.equal(sev('k2', 'u'), undefined);               // different habitat
    assert.equal(animalSeverity(m, 'k2'), 'risk');
    assert.equal(animalSeverity(m, 'h1'), 'covered');
    assert.equal(animalSeverity(m, 'y'), 'kin');
    assert.equal(animalSeverity(m, 'u'), null);
    assert.deepEqual(m.counts, { risk: 2, kin: 2, future: 1, held: 0, covered: 2, distant: 0 });
    // male first in every pair
    for (const p of m.pairs) assert.notEqual(p.a.sex, F);
    assert.equal(describeRelation(m, m.animals.get('k1'), m.animals.get('k2')), 'sister');
});

test('model: habitat summaries and lookups', () => {
    const m = buildKinModel(zoo());
    const s = habitatSummary(m, '1');
    assert.equal(s.name, 'Savannah Habitat');
    assert.deepEqual(s.counts, { risk: 2, kin: 0, future: 0, held: 0, covered: 2 });
    assert.equal(s.species[0].species, 'Lion');
    assert.equal(s.species[0].males.length, 2);
    assert.equal(habitatByName(m, 'Jungle Habitat').id, '2');
    assert.deepEqual(habitatsAtRisk(m).map(h => h.id), ['1', '2']);
});

test('explanations name the link', () => {
    const m = buildKinModel(zoo());
    const g = id => m.animals.get(id);
    assert.match(explainRelation(m, g('k1'), g('k2')), /full siblings/);
    assert.match(explainRelation(m, g('k2'), g('h1')), /half-siblings: they share A\./);
    assert.match(explainRelation(m, g('x'), g('y')), /first cousins/);
    assert.match(explainRelation(m, g('a'), g('u')), /not related/);
});

test('close-kin threshold moves cousins to distant', () => {
    const m = buildKinModel(zoo(), { closeKinship: 0.1 });
    const p = m.pairs.find(q => q.a.id == 'x' && q.b.id == 'y');
    assert.equal(p.severity, 'distant');
    assert.equal(animalSeverity(m, 'y'), 'kin');           // still kin through grandfather gp (1/8)
    assert.equal(animalPairs(m, 'x').length, 1);           // only the half-sister z
    assert.equal(animalPairs(m, 'x', { includeDistant: true }).length, 2);
});

test('mated relatives sort first', () => {
    const snap = zoo();
    snap.animals.find(a => a.id == 'k1').mates = ['k2'];
    const m = buildKinModel(snap);
    assert.equal(m.pairs[0].a.id, 'k1');
    assert.equal(m.pairs[0].mated, true);
});

test('offspring prediction matches the game formula', () => {
    const homo = { F: 'AAAAAABBBBBB', I: 'AAAAAABBBBBB' };
    const p = predictOffspring(homo, homo);
    assert.deepEqual(p.fertility, { min: 0, max: 1, mean: 0.5 });
    const q = predictOffspring({ F: 'CCCCCCDDDDDD' }, { F: 'EEEEEEFFFFFF' });
    assert.deepEqual(q.fertility, { min: 1, max: 1, mean: 1 });
    const s = predictOffspring({ S: 'AAAAAACCCCCC' }, { S: 'BBBBBBBBBBBB' });
    assert.deepEqual(s.size, { min: 0.5, max: 1, mean: 0.75 });
    assert.equal(predictOffspring(null, homo), null);
    assert.equal(predictOffspring({ F: 'short' }, homo), null);
    assert.deepEqual(ownGrades({ F: 'AAAAAABBBBBB', S: 'AAAAAACCCCCC' }), { fertility: 1, size: 0.5 });
    assert.equal(offspringScore(p), 50);
    // dotted form for multi-letter alleles
    assert.deepEqual(predictOffspring({ F: 'A1.A1.A1.A1.A1.A1.B2.B2.B2.B2.B2.B2' }, { F: 'A1.A1.A1.A1.A1.A1.B2.B2.B2.B2.B2.B2' }).fertility, { min: 0, max: 1, mean: 0.5 });
});

test('mate finder: unrelated first, game-flagged last', () => {
    const snap = zoo();
    for (const a of snap.animals) a.genes = { F: 'CCCCCCDDDDDD', I: 'CCCCCCDDDDDD' };
    snap.animals.find(a => a.id == 'u').genes = { F: 'EEEEEEFFFFFF', I: 'EEEEEEFFFFFF' };
    const m = buildKinModel(snap);
    const list = mateCandidates(m, 'k1');
    assert.deepEqual(list.map(c => c.animal.id), ['u', 'h1', 'k2']); // h1 half-sister (1/8) after... both game; k2 full
    assert.equal(list[0].tier, 'none');
    assert.equal(list[0].score, 100);
    assert.equal(list[0].sameHabitat, false);
    assert.equal(list[2].game, true);
    assert.equal(mateCandidates(m, 'nope').length, 0);
});

test('new risks: only pairs that became risky', () => {
    const before = buildKinModel(zoo());
    const snap = zoo();
    snap.animals.find(a => a.id == 'h1').contra = false;    // contraception lifted
    const after = buildKinModel(snap);
    const fresh = newRisks(before, after);
    assert.deepEqual(fresh.map(p => [p.a.id, p.b.id]).sort(), [['a', 'h1'], ['k1', 'h1']]);
    assert.equal(newRisks(after, after).length, 0);
    assert.equal(newRisks(null, after).length, 4);
    assert.equal(newRisks(before, after, { includeKin: true }).length, 2);
});

test('muted species: no new-risk alerts and no alert counts, the model itself unchanged', () => {
    const before = buildKinModel(zoo());
    const snap = zoo();
    snap.animals.find(a => a.id == 'h1').contra = false;
    snap.animals.find(a => a.id == 'z').juv = false;          // the tiger half-sister grows up
    snap.animals.find(a => a.id == 'z').infertile = false;
    const after = buildKinModel(snap);
    const all = newRisks(before, after);
    assert.ok(all.some(p => p.species === 'Lion') && all.some(p => p.species === 'Tiger'));
    const lionsMuted = newRisks(before, after, { muted: new Set(['Lion']) });
    assert.ok(lionsMuted.length > 0 && lionsMuted.every(p => p.species === 'Tiger'));
    assert.equal(newRisks(before, after, { muted: new Set() }).length, all.length);
    // counts
    assert.deepEqual(countsExcluding(after, null), after.counts);
    assert.deepEqual(countsExcluding(after, new Set()), after.counts);
    const c = countsExcluding(after, new Set(['Lion']));
    const lionRisk = after.pairs.filter(p => p.species === 'Lion' && p.severity === 'risk').length;
    assert.ok(lionRisk > 0);
    assert.equal(c.risk, after.counts.risk - lionRisk);
    assert.equal(countsExcluding(after, new Set(['Lion', 'Tiger'])).risk, 0);
    assert.deepEqual(riskHabitatsExcluding(after, new Set(['Lion'])).map(h => h.name), ['Jungle Habitat']);
    assert.deepEqual(riskHabitatsExcluding(after, new Set()).map(h => h.name).sort(), ['Jungle Habitat', 'Savannah Habitat']);
});

test('storage: the relatives of one', () => {
    const m = buildKinModel(zoo());
    const of = relativesOf(m, 'k1');
    assert.deepEqual(of.map(r => r.animal.id).sort(), ['a', 'h1', 'k2']);
});

test('helpers', () => {
    assert.equal(percent(0.25), '25%');
    assert.equal(percent(0.0625), '6.25%');
    assert.equal(percent(0.125), '12.5%');
    assert.equal(percent(0), '0%');
    assert.equal(pairSeverity({ juv: true }, { contra: false }, 'game'), 'future');
    assert.equal(pairSeverity({ infertile: true }, {}, 'game'), 'covered');
});

test('malformed pedigree (cycle) does not hang', () => {
    const snap = { animals: [an('c1', M, ['c2']), an('c2', F, ['c1'])], anc: {}, habitats: [] };
    const m = buildKinModel(snap);
    assert.ok(m.pairs.length <= 1);
});

test('large zoo builds quickly', () => {
    const animals = [];
    for (let i = 0; i < 800; i++) {
        const par = i < 40 ? ['', ''] : [String(i - 40 + (i % 3)), String(i - 20)];
        animals.push(an(String(i), i % 2 ? F : M, par, { hab: String(i % 3), species: 'S', loc: 'H' + (i % 3) }));
    }
    const t = Date.now();
    const m = buildKinModel({ animals, anc: {}, habitats: [] });
    console.log('800 animals, 3 habitats:', Date.now() - t, 'ms'); assert.ok(Date.now() - t < 4000, `took ${Date.now() - t} ms`);
    assert.ok(m.pairs.length > 0);
});

test('clusters keep relatives together', () => {
    const m = buildKinModel(zoo());
    const c = kinClusters(m);
    assert.equal(c.get('a'), c.get('k2'));
    assert.equal(c.get('k1'), c.get('h1'));
    assert.equal(c.get('a'), c.get('k1'));                  // joined through k2 / h1
    assert.notEqual(c.get('x'), c.get('a'));
    assert.equal(c.has('u'), false);
});

test('locate only for animals out in a habitat', () => {
    assert.equal(canLocate({ id: '12', hab: '9' }), true);
    assert.equal(canLocate({ id: '12', hab: '' }), false);         // trade centre, transit
    assert.equal(canLocate({ id: 'x7', hab: 'xe:3', exhibit: true }), false);
    assert.equal(canLocate(null), false);
});

test('new risks: a pair that moves habitat together is not new', () => {
    const before = buildKinModel(zoo());
    const snap = zoo();
    for (const a of snap.animals) if (a.hab === '1') a.hab = '3';
    const after = buildKinModel(snap);
    assert.equal(newRisks(before, after).length, 0);
});

test('shoals and colonies are left out: no pairs, no habitat counts', () => {
    const fish = (id, sex, par) => an(id, sex, par, { species: 'Clownfish', hab: '4', loc: 'Reef' });
    const snap = zoo([fish('f1', M, ['', '']), fish('f2', F, ['f1', '']), fish('f3', M, ['f1', ''])]);
    snap.habitats.push({ id: '4', name: 'Reef' });
    snap.speciesFacts = { Clownfish: { collective: true } };
    const model = buildKinModel(snap);
    assert.equal(model.pairs.filter(p => p.species === 'Clownfish').length, 0);
    assert.equal(animalSeverity(model, 'f2'), null);
    assert.equal(habitatSummary(model, '4'), null);
    assert.equal(model.habitats.get('4').name, 'Reef');
    snap.speciesFacts = {};
    assert.ok(buildKinModel(snap).pairs.some(p => p.species === 'Clownfish'), 'counted when the species is not collective');
});

// ------------------------------------------- stored adults (Find a mate, Franchise)

function storedLions() {
    return normalizeStored({
        species: 'Lion',
        animals: [
            // half-sister of k1 through their father a (mother ss, not in the zoo)
            { id: 'sS1', guid: 'S1', name: 'Sasha', species: 'Lion', sex: F, maturity: 2, par: ['ga', 'gss'], genes: { F: 'EEEEEEFFFFFF', I: 'EEEEEEFFFFFF' } },
            // unrelated, best genes
            { id: 'sS2', guid: 'S2', name: 'Nala', species: 'Lion', sex: F, maturity: 1, par: [], forSale: true, genes: { F: 'EEEEEEFFFFFF', I: 'EEEEEEFFFFFF' } },
            // unrelated, too old (6), and a not yet mature one (4), a sterile one (5)
            { id: 'sS3', guid: 'S3', name: 'Old', species: 'Lion', sex: F, maturity: 6, par: [] },
            { id: 'sS4', guid: 'S4', name: 'Teen', species: 'Lion', sex: F, maturity: 4, par: [] },
            { id: 'sS5', guid: 'S5', name: 'Barren', species: 'Lion', sex: F, maturity: 5, par: [] },
            // a male: not a candidate for k1
            { id: 'sS6', guid: 'S6', name: 'Rafi', species: 'Lion', sex: M, maturity: 2, par: [] },
        ],
        anc: { gss: ['gs1', ''] },
    });
}

test('stored adults: normalizeStored maps the game maturity', () => {
    const s = storedLions();
    const by = id => s.animals.find(a => a.id === id);
    assert.equal(by('sS1').stored, true);
    assert.equal(by('sS1').lt, 'storage');
    assert.equal(by('sS1').hab, '');
    assert.equal(by('sS1').contra, false);
    assert.equal(by('sS1').juv, false);
    assert.equal(by('sS1').fert.state, 'fertile');
    assert.equal(by('sS3').infertile, true);
    assert.equal(by('sS3').fert.state, 'old');
    assert.equal(by('sS4').fert.state, 'young');
    assert.equal(by('sS5').fert.state, 'sterile');
    assert.equal(by('sS2').forSale, true);
    assert.deepEqual(s.anc, { gss: ['gs1'] });
    assert.equal(normalizeStored({ error: 'notfranchise' }).error, 'notfranchise');
    assert.deepEqual(normalizeStored(null).animals, []);
});

test('stored adults: ranked with the zoo, half-sister via the pedigree lands in game', () => {
    const snap = zoo();
    for (const a of snap.animals) a.genes = { F: 'CCCCCCDDDDDD', I: 'CCCCCCDDDDDD' };
    snap.animals.find(a => a.id == 'u').genes = { F: 'EEEEEEFFFFFF', I: 'EEEEEEFFFFFF' };
    const m = buildKinModel(snap);
    const list = mateCandidates(m, 'k1', { stored: storedLions() });
    const ids = list.map(c => c.animal.id);
    // unrelated first: u (zoo, score 100) and Nala (storage, score 100): zoo first on the tie
    assert.deepEqual(ids.slice(0, 2), ['u', 'sS2']);
    assert.equal(list[1].stored, true);
    assert.equal(list[1].sameHabitat, false);
    assert.equal(list[0].stored, undefined);
    // then the unrelated stored ones that breed later / never
    assert.equal(list.find(c => c.animal.id === 'sS4').breeds, 'later');
    assert.equal(list.find(c => c.animal.id === 'sS3').breeds, 'never');
    const sis = list.find(c => c.animal.id === 'sS1');
    assert.equal(sis.tier, 'game');
    assert.equal(relationWord(sis.rel, F), 'half-sister');
    assert.ok(ids.indexOf('sS1') > ids.indexOf('sS5'), 'related after every unrelated one');
    assert.ok(!ids.includes('sS6'), 'same sex left out');
    // the model itself is untouched
    assert.equal(m.animals.size, snap.animals.length);
    assert.ok(!m.byGuid.has('S1'));
    const view = withStored(m, storedLions());
    assert.equal(view.animals, m.animals);
    assert.ok(view.byGuid.has('S1') && view.stored.has('sS1'));
    assert.match(explainRelation(view, m.animals.get('k1'), view.stored.get('sS1')), /half-siblings/);
});

test('stored adults: no stored list gives exactly today\'s candidates', () => {
    const snap = zoo();
    for (const a of snap.animals) a.genes = { F: 'CCCCCCDDDDDD', I: 'CCCCCCDDDDDD' };
    const m = buildKinModel(snap);
    const plain = mateCandidates(m, 'k1');
    for (const stored of [undefined, null, normalizeStored({ error: 'failed' }), normalizeStored({ animals: [] })]) {
        assert.deepEqual(mateCandidates(m, 'k1', { stored }), plain);
    }
    assert.ok(plain.every(c => !('stored' in c)));
});

// ------------------------------------------------ speed (Nexus: "UI lags")
// A closed flock: 100 flamingos in one habitat, 6 generations bred among
// themselves, ancestors partly gone (in anc only).
function flock(seed = 7) {
    let r = seed;
    const rnd = n => { // mulberry32
        r = (r + 0x6D2B79F5) | 0;
        let t = Math.imul(r ^ (r >>> 15), 1 | r);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (((t ^ (t >>> 14)) >>> 0) % n);
    };
    const all = [];
    let gen = [];
    for (let i = 0; i < 12; i++) gen.push({ id: 'f0_' + i, sex: i % 2 ? F : M, par: ['', ''] });
    all.push(...gen);
    for (let g = 1; g < 6; g++) {
        const next = [];
        const males = gen.filter(a => a.sex === M), females = gen.filter(a => a.sex === F);
        const n = g === 5 ? 60 : 18;
        for (let i = 0; i < n; i++) {
            const dad = males[rnd(males.length)], mum = females[rnd(females.length)];
            next.push({ id: `f${g}_${i}`, sex: rnd(2) ? F : M, par: [dad.id, mum.id] });
        }
        all.push(...next);
        gen = next.concat(gen.slice(0, 6));
    }
    const alive = all.slice(-100);
    const gone = all.slice(0, -100);
    const anc = {};
    for (const a of gone) anc['g' + a.id] = a.par.map(p => p ? 'g' + p : '');
    return {
        v: 1, seq: 1, scope: 'park', habitats: [{ id: '1', name: 'Flamingo Lagoon' }],
        animals: alive.map(a => an(a.id, a.sex, a.par, { species: 'Flamingo', loc: 'Flamingo Lagoon', juv: false })),
        anc,
    };
}

// What a model says about its pairs, for exact comparisons.
const pairFacts = m => m.pairs.map(p => ({ key: p.key, a: p.a.id, b: p.b.id, hab: p.hab, species: p.species, rel: p.rel, tier: p.tier,
    severity: p.severity, cover: p.cover, kinship: p.kinship, mated: p.mated, unheld: p.unheld }));

test('speed: a reused pedigree gives exactly the same model', () => {
    for (const snap of [zoo(), flock(3), flock(11)]) {
        const first = buildKinModel(snap);
        // the next scan: new objects, same parentage
        const again = buildKinModel(JSON.parse(JSON.stringify(snap)), { ped: first.ped });
        assert.equal(again.ped.reused, true, 'caches taken over');
        assert.deepEqual(pairFacts(again), pairFacts(first));
        assert.deepEqual(again.counts, first.counts);
        // parentage changed (a birth): fresh caches, still right
        const born = JSON.parse(JSON.stringify(snap));
        born.animals.push(an('newborn', F, [born.animals[0].id, born.animals[1].id], { species: born.animals[0].species, loc: born.animals[0].loc, juv: true }));
        const after = buildKinModel(born, { ped: first.ped });
        assert.equal(after.ped.reused, false);
        assert.deepEqual(pairFacts(after), pairFacts(buildKinModel(born)));
    }
});

test('speed: one relation per pair gives the same pairs as before (both directions)', () => {
    for (const snap of [zoo(), flock(5)]) {
        const m = buildKinModel(snap);
        const ped = new Pedigree(normalizeSnapshot(snap));
        // the old loop: relation in list order decides the pair, relation male-first is stored
        const want = new Map();
        for (const [hab, bySpecies] of m.groups) {
            for (const [, list] of bySpecies) {
                for (let i = 0; i < list.length; i++) {
                    for (let j = i + 1; j < list.length; j++) {
                        const x = list[i], y = list[j];
                        if (!(x.sex === Sex.Unisex || y.sex === Sex.Unisex || x.sex !== y.sex) || !x.guid || !y.guid) continue;
                        const rel = ped.relation(x.guid, y.guid);
                        if (!rel) continue;
                        const [mm, ff] = x.sex === F && y.sex !== F ? [y, x] : [x, y];
                        want.set(`${hab}|${mm.id}|${ff.id}`, { rel: mm === x ? rel : ped.relation(mm.guid, ff.guid), kinship: rel.kinship, game: rel.game });
                    }
                }
            }
        }
        assert.equal(m.pairs.length, want.size);
        for (const p of m.pairs) {
            const w = want.get(`${p.hab}|${p.a.id}|${p.b.id}`);
            assert.ok(w, 'pair ' + p.key);
            assert.deepEqual(p.rel, w.rel);
            assert.equal(p.kinship, w.kinship);
            assert.equal(p.tier, w.game ? 'game' : w.kinship >= DEFAULT_CLOSE_KINSHIP - 1e-9 ? 'close' : 'distant');
        }
    }
});

test('speed: 100 flamingos in one habitat, 6 generations', () => {
    const snap = flock();
    let t = Date.now();
    const m = buildKinModel(snap);
    const cold = Date.now() - t;
    t = Date.now();
    const warm = buildKinModel(JSON.parse(JSON.stringify(snap)), { ped: m.ped });
    const reused = Date.now() - t;
    console.log(`100 flamingos: ${m.pairs.length} related pairs, cold build ${cold} ms, next scan ${reused} ms`);
    assert.ok(m.pairs.length > 100, 'a closed flock is full of relatives');
    assert.ok(cold < 1500, `cold build took ${cold} ms`);
    assert.ok(reused < 300, `a scan with the same parentage took ${reused} ms`);
    assert.equal(warm.pairs.length, m.pairs.length);
});

// ------------------------------------------- boxed with no destination
import { boxedStep, isBoxedWaiting, waitedText } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboxedcore.js';

test('boxed: who counts as waiting in a box with nowhere to go', () => {
    const s = { boxedIncludeTrade: false };
    assert.equal(isBoxedWaiting({ boxed: true, hab: '', lt: 'escaped' }, s), true);
    assert.equal(isBoxedWaiting({ boxed: true, hab: '', lt: 'other' }, s), true);
    assert.equal(isBoxedWaiting({ boxed: true, hab: '', lt: 'escaped', moving: true }, s), false, 'a transport job: on its way');
    assert.equal(isBoxedWaiting({ boxed: false, hab: '', lt: 'escaped' }, s), false);
    assert.equal(isBoxedWaiting({ boxed: true, hab: '9', lt: 'habitat' }, s), false);
    for (const lt of ['vet', 'quarantine', 'transit']) assert.equal(isBoxedWaiting({ boxed: true, hab: '', lt }, s), false, lt);
    assert.equal(isBoxedWaiting({ boxed: true, hab: '', lt: 'trade' }, s), false, 'trade centre: off by default');
    assert.equal(isBoxedWaiting({ boxed: true, hab: '', lt: 'trade' }, { boxedIncludeTrade: true }), true);
});

test('boxed: an alert after the delay, once, again only after it stopped waiting', () => {
    const snap = zoo([an('bx', F, ['', ''], { hab: '', loc: '', lt: 'escaped', boxed: true })]);
    const m = buildKinModel(snap);
    assert.equal(m.animals.get('bx').boxed, true, 'normalizeSnapshot keeps boxed');
    const settings = { boxedAlert: true, boxedAfterS: 10 };
    const state = new Map();
    let r = boxedStep(m, settings, state, 1000);
    assert.equal(r.due.length, 0);
    assert.equal(r.wake, 10000);
    r = boxedStep(m, settings, state, 6000);
    assert.equal(r.due.length, 0);
    assert.equal(r.wake, 5000);
    r = boxedStep(m, settings, state, 11000);
    assert.deepEqual(r.due.map(d => [d.animal.id, d.waitedMs]), [['bx', 10000]]);
    assert.equal(r.wake, null);
    assert.equal(boxedStep(m, settings, state, 60000).due.length, 0, 'only once');
    // placed: forgotten; boxed again later: a new alert after the delay
    const placed = buildKinModel(zoo([an('bx', F, ['', ''], { hab: '3', lt: 'habitat', boxed: false })]));
    boxedStep(placed, settings, state, 61000);
    assert.equal(state.size, 0);
    boxedStep(m, settings, state, 70000);
    assert.equal(boxedStep(m, settings, state, 80000).due.length, 1);
    // switched off, or the storage scope: nothing (and nothing kept)
    assert.equal(boxedStep(m, { boxedAlert: false }, new Map(), 0).due.length, 0);
    const st2 = new Map();
    boxedStep(m, { boxedAlert: true, boxedAfterS: 5 }, st2, 0);
    assert.equal(boxedStep(m, { boxedAlert: true, boxedAfterS: 5 }, st2, 5000).due.length, 1, 'the player\'s delay');
    assert.equal(waitedText(12400), '12 s');
    assert.equal(waitedText(300000), '5 min');
});
