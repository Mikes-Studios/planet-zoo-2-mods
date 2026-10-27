// node --test tests/kinprogramme.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel, Sex } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { TRADE, simulatePlan } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import {
    planProgramme, isBreeder, conceptionChance, youngQuality, habitatCapacity, estimateSpacePerAdult,
    groupRule, parseRatio, reduceRatio, ratioKey, groupTarget, maxWeightPairs, scoreLayout, planProgrammeAsync, RATIO_CHOICES,
    unknownMakeupText, contraceptionAdvice, ownGeneScore, CONTRA_ADVICE, programmeProblemSig, withFreshYoung,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';

const M = Sex.Male, F = Sex.Female;
// genes: a strand letter per animal makes everyone heterozygous with everyone
const G = (a, b) => ({ F: a.repeat(6) + b.repeat(6), I: a.repeat(6) + b.repeat(6), S: 'AAAAAACCCCCC', L: 'AAAAAACCCCCC' });
const an = (id, sex, hab, par = [], over = {}) => Object.assign({
    id, key: 'animal_' + id, guid: 'g' + id, name: id, species: 'Lion', sex, juv: false, contra: false, infertile: false,
    hab, loc: 'H' + hab, lt: 'habitat', par: par.map(p => 'g' + p), mates: [], genes: G('C', 'D'),
}, over);
const snap = (animals, habitats = ['1', '2', '3']) => ({ v: 1, seq: 1, scope: 'park', mode: 'offline', habitats: habitats.map(h => ({ id: h, name: 'H' + h })), animals, anc: {} });
const DEST = (ids) => ({ bySpecies: { Lion: Object.fromEntries(ids.map(i => [i, { ok: true }])) }, habitats: [] });
const where = (model, plan, id) => {
    const m = plan.moves.find(x => x.id === id);
    return m ? m.to : model.animals.get(id).hab;
};

test('breeders: adults the game marks fertile', () => {
    assert.equal(isBreeder(an('a', M, '1')), true);
    assert.equal(isBreeder(an('a', M, '1', [], { juv: true })), false);
    assert.equal(isBreeder(an('a', M, '1', [], { contra: true })), false);
    assert.equal(isBreeder(an('a', M, '1', [], { infertile: true })), false);
    // the game's own fertility flags decide, not the species' age table: one it marks fertile breeds
    assert.equal(isBreeder(an('a', M, '1', [], { age: 25 }), { fertilityAges: { maturity: 3, infertility: 20 } }), true);
    assert.equal(isBreeder(an('a', M, '1', [], { age: 2 }), { fertilityAges: { maturity: 3, infertility: 999 } }), true);
});

test('pair value: young quality and the game conception table', () => {
    const m = an('m', M, '1', [], { genes: G('A', 'B') });
    const f1 = an('f', F, '1', [], { genes: G('A', 'B') });       // same strands: young less heterozygous
    const f2 = an('g', F, '1', [], { genes: G('E', 'F') });       // different strands: better young
    assert.ok(youngQuality(m, f2) > youngQuality(m, f1));
    const table = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => (i + j) / 20));
    assert.equal(conceptionChance(m, f1, { conception: table }), 12 / 20);   // both fertility grade 6
});

test('polygyny: one breeding male per habitat, relatives separated', () => {
    // habitat 1: male a with his three daughters and an unrelated female; habitat 2: male b alone
    const animals = [
        an('a', M, '1'), an('d1', F, '1', ['a', 'x']), an('d2', F, '1', ['a', 'x']), an('d3', F, '1', ['a', 'x']), an('u', F, '1'),
        an('b', M, '2'),
    ];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 6 } }, DEST(['1', '2']));
    assert.equal(plan.system, 'polygyny');
    assert.equal(plan.after.relatedPairs, 0);
    assert.equal(plan.before.relatedPairs, 3);
    // every female has an unrelated male
    assert.equal(plan.after.breedingPairs, 4);
    for (const h of ['1', '2']) {
        const males = ['a', 'b'].filter(id => where(model, plan, id) === h).length;
        assert.ok(males <= 1, `habitat ${h} has ${males} males`);
    }
    // the daughters are with b, not with their father
    for (const d of ['d1', 'd2', 'd3']) assert.notEqual(where(model, plan, d), where(model, plan, 'a'));
    // applying the moves leaves no inbreeding risk
    const after = simulatePlan(model, plan.moves, DEST(['1', '2']));
    assert.equal(after.pairs.filter(p => p.severity === 'risk').length, 0);
});

test('monogamy: swaps partners for better young', () => {
    // pairs as they are: (m1, f1) and (m2, f2) share strands; crossing them gives better young
    const animals = [
        an('m1', M, '1', [], { genes: G('A', 'B') }), an('f1', F, '1', [], { genes: G('A', 'B') }),
        an('m2', M, '2', [], { genes: G('E', 'F') }), an('f2', F, '2', [], { genes: G('E', 'F') }),
    ];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1', '2']));
    assert.ok(plan.after.youngQuality > plan.before.youngQuality, JSON.stringify([plan.before, plan.after]));
    assert.equal(plan.moves.length, 2);                                  // one swap
    assert.equal(plan.after.breedingPairs, 2);
});

test('small gains do not split bonded mates', () => {
    const animals = [
        an('m1', M, '1', [], { genes: G('A', 'B'), mates: ['f1'] }), an('f1', F, '1', [], { genes: G('A', 'C'), mates: ['m1'] }),
        an('m2', M, '2', [], { genes: G('E', 'F'), mates: ['f2'] }), an('f2', F, '2', [], { genes: G('E', 'G'), mates: ['m2'] }),
    ];
    const model = buildKinModel(snap(animals));
    // the cross gives better young, but not enough to break two bonds
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1', '2']), { options: { bondBreakCost: 0.5 } });
    assert.equal(plan.moves.length, 0);
    // without the bonds the same layout is swapped
    const free = buildKinModel(snap(animals.map(a => Object.assign({}, a, { mates: [] }))));
    assert.equal(planProgramme(free, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1', '2'])).moves.length, 2);
});

test('bonds: mates of a non-monogamous species cost nothing to part', () => {
    const animals = [
        an('m1', M, '1', [], { genes: G('A', 'B'), mates: ['f1'] }), an('f1', F, '1', [], { genes: G('A', 'C'), mates: ['m1'] }),
        an('m2', M, '2', [], { genes: G('E', 'F'), mates: ['f2'] }), an('f2', F, '2', [], { genes: G('E', 'G'), mates: ['m2'] }),
    ];
    const model = buildKinModel(snap(animals));
    const free = buildKinModel(snap(animals.map(a => Object.assign({}, a, { mates: [] }))));
    const opt = { options: { bondBreakCost: 0.5 } };
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 2 } }, DEST(['1', '2']), opt);
    const base = planProgramme(free, 'Lion', { mating: 'polygyny', social: { max: 2 } }, DEST(['1', '2']), opt);
    assert.deepEqual(plan.moves.map(x => [x.id, x.to]), base.moves.map(x => [x.id, x.to]));
    assert.ok(Math.abs(plan.score - base.score) < 1e-9);
    // the bond pass's record makes a bond monogamous whatever the species' rule says
    const seen = buildKinModel(snap(animals.map(a => Object.assign({}, a, { bond: { mate: a.mates[0], ring: true, here: true } }))));
    assert.equal(planProgramme(seen, 'Lion', { mating: 'polygyny', social: { max: 2 } }, DEST(['1', '2']), opt).moves.length, 0);
});

// the game pairs bonded mates only with each other; a bonded mate whose
// young would score well below the best pair's is let go, so the male can
// pair with the better female
test('bonds: a poor bonded mate is let go; a good bonded pair stays together', () => {
    const info = { mating: 'monogamy', social: { max: 3 } };
    const poor = [
        an('m1', M, '1', [], { genes: G('A', 'B'), mates: ['f1'] }), an('f1', F, '1', [], { genes: G('A', 'B'), mates: ['m1'] }),
        an('f3', F, '1', [], { genes: G('E', 'F') }),
    ];
    const plan = planProgramme(buildKinModel(snap(poor, ['1'])), 'Lion', info, DEST(['1']));
    const f1 = plan.moves.find(m => m.id === 'f1');
    assert.ok(f1 && f1.to === TRADE && /well below your best pair/.test(f1.reason), JSON.stringify(plan.moves));
    assert.ok(!plan.moves.some(m => m.id === 'f3'), 'the better female stays');
    const good = poor.map(a => (a.id === 'f1' ? Object.assign({}, a, { genes: G('E', 'F') }) : a.id === 'f3' ? Object.assign({}, a, { genes: G('G', 'H') }) : a));
    const kept = planProgramme(buildKinModel(snap(good, ['1'])), 'Lion', info, DEST(['1']));
    assert.equal(kept.before.breedingPairs, 1);
    assert.equal(kept.before.youngQuality, Math.round(youngQuality(good[0], good[1]) * 100));
    assert.ok(!kept.moves.some(m => m.id === 'f1' || m.id === 'm1'), 'the bonded pair stays together');
});

test('bonds: a breeder bonded to a mate that does not breed pairs with no one beside it', () => {
    // f is bonded to cm (contracepted, so not a breeder); m is free in the same habitat
    const animals = [
        an('cm', M, '1', [], { contra: true, mates: ['f'] }), an('f', F, '1', [], { mates: ['cm'] }),
        an('m', M, '1', [], { genes: G('E', 'F') }),
    ];
    const info = { mating: 'monogamy', social: { max: 4 } };
    const model = buildKinModel(snap(animals, ['1', '2']));
    const plan = planProgramme(model, 'Lion', info, DEST(['1', '2']));
    assert.equal(plan.before.breedingPairs, 0);
    // the pair is worth the parting: she and m breed in the other habitat
    assert.equal(plan.after.breedingPairs, 1);
    assert.notEqual(where(model, plan, 'f'), '1');
    assert.equal(where(model, plan, 'f'), where(model, plan, 'm'));
    // the same with the search alone
    const heur = planProgramme(model, 'Lion', info, DEST(['1', '2']), { options: { exactLimit: 0 } });
    assert.ok(Math.abs(heur.score - plan.score) < 1e-9);
});

test('capacity: no habitat over the social maximum; the surplus goes to the trade centre', () => {
    const animals = [an('m1', M, '1'), an('f1', F, '1'), an('f2', F, '1'), an('f3', F, '1'), an('f4', F, '1')];
    const model = buildKinModel(snap(animals, ['1']));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 3 } }, DEST(['1']));
    const inHab = ['m1', 'f1', 'f2', 'f3', 'f4'].filter(id => where(model, plan, id) === '1').length;
    assert.equal(inHab, 3);
    assert.equal(plan.moves.filter(m => m.to === TRADE).length, 2);
});

test('assignments: only the species own habitats', () => {
    const animals = [an('a', M, '1'), an('d', F, '1', ['a', 'x']), an('b', M, '2')];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 4 } }, DEST(['1', '2', '3']), { assignments: { '1': ['Lion'], '3': ['Lion'], '2': ['Zebra'] } });
    for (const m of plan.moves) assert.ok(['1', '3', TRADE].includes(m.to), JSON.stringify(plan.moves));
    assert.equal(plan.after.relatedPairs, 0);
});

test('juveniles and non-breeders stay; they still use capacity', () => {
    const animals = [
        an('m', M, '1'), an('f', F, '1'), an('kid', F, '1', ['m', 'f'], { juv: true }),
        an('old', F, '1', [], { contra: true }),
    ];
    const model = buildKinModel(snap(animals, ['1']));
    const plan = planProgramme(model, 'Lion', { mating: 'mixed', social: { max: 3 } }, DEST(['1']));
    assert.ok(!plan.moves.some(m => m.id === 'kid' || m.id === 'old'));
    assert.equal(plan.groups.find(g => g.hab === '1').staying, 1);        // the contracepted adult
});

test('make-up: a contracepted second male leaves a 1:1 habitat (Eurasian lynx, 2026-10-19)', () => {
    const animals = [an('m', M, '1'), an('f', F, '1'), an('m2', M, '1', [], { contra: true })];
    const model = buildKinModel(snap(animals, ['1']));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 4 }, sexMax: { male: 1, female: 1 } }, DEST(['1']), { options: { ratio: '1:1' } });
    const out = plan.moves.find(x => x.id === 'm2');
    assert.ok(out && out.to === TRADE && out.spare, JSON.stringify(plan.moves));
    assert.match(out.reason, /make-up/);
    assert.ok(!plan.moves.some(x => x.id === 'm' || x.id === 'f'));
    // off: the old behaviour, it stays
    const keep = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 4 }, sexMax: { male: 1, female: 1 } }, DEST(['1']), { options: { ratio: '1:1', spareOut: false } });
    assert.ok(!keep.moves.some(x => x.id === 'm2'));
});

// an infertile adult never breeds: it leaves, and frees its place for a breeder
test('make-up: infertile adults leave, the breeder stays', () => {
    // 1:1 room 2: the breeding male and an infertile male, an infertile female and no breeding female
    const animals = [an('m', M, '1'), an('mi', M, '1', [], { infertile: true }), an('fi', F, '1', [], { infertile: true })];
    const model = buildKinModel(snap(animals, ['1']));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1']), { options: { ratio: '1:1', useTradeCentre: false } });
    assert.equal(where(model, plan, 'mi'), TRADE);
    assert.equal(where(model, plan, 'fi'), TRADE);
    assert.equal(where(model, plan, 'm'), '1');
});

test('make-up: a breeder from the trade centre replaces the contracepted one; contracepted kept before infertile', () => {
    // 1:1 room 2: female f, contracepted male mc; a breeding male waits at the trade centre
    const animals = [an('f', F, '1'), an('mc', M, '1', [], { contra: true }), an('mt', M, null, [], { lt: 'trade', loc: 'trade' })];
    const model = buildKinModel(snap(animals, ['1']));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1']), { options: { ratio: '1:1' } });
    assert.equal(where(model, plan, 'mt'), '1', JSON.stringify(plan.moves));
    assert.equal(where(model, plan, 'mc'), TRADE);
    // two non-breeding males, one place: the contracepted one stays, the infertile one leaves
    const two = [an('f', F, '1'), an('mc', M, '1', [], { contra: true }), an('mi', M, '1', [], { infertile: true })];
    const m2 = buildKinModel(snap(two, ['1']));
    const p2 = planProgramme(m2, 'Lion', { mating: 'monogamy', social: { max: 4 }, sexMax: { male: 1, female: 1 } }, DEST(['1']), { options: { ratio: '1:1', useTradeCentre: false } });
    assert.equal(where(m2, p2, 'mc'), '1');
    assert.equal(where(m2, p2, 'mi'), TRADE);
});

test('make-up: pregnant, hands-off and mixed make-up non-breeders are never sent out', () => {
    const animals = [an('m', M, '1'), an('f', F, '1'), an('m2', M, '1', [], { contra: true }), an('fp', F, '1', [], { infertile: true, preg: true })];
    const model = buildKinModel(snap(animals, ['1']));
    const pinned = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 4 }, sexMax: { male: 1, female: 1 } }, DEST(['1']), { options: { ratio: '1:1', pinIds: ['m2'] } });
    assert.ok(!pinned.moves.some(x => x.id === 'm2' || x.id === 'fp'), JSON.stringify(pinned.moves));
    const mixed = planProgramme(model, 'Lion', { mating: 'mixed', social: { max: 4 } }, DEST(['1']));
    assert.ok(!mixed.moves.some(x => x.id === 'm2'));
});

test('space: capacity from the game requirement per adult', () => {
    const info = {
        social: { max: 10 },
        habitats: {
            '1': { available: { land: 1000 }, required: { land: 400 }, adults: 4 },   // 100 per adult
            '2': { available: { land: 250 } },
        },
    };
    const per = estimateSpacePerAdult(info);
    assert.equal(per.land, 100);
    assert.equal(habitatCapacity(Object.assign({}, info, { spacePerAdult: per }), '2', 8), 2);
    assert.equal(habitatCapacity(Object.assign({}, info, { spacePerAdult: per }), '1', 8), 10);
    assert.equal(habitatCapacity({}, '9', 8), 8);
});

test('a big species plans in reasonable time', () => {
    const animals = [];
    for (let i = 0; i < 80; i++) {
        const fam = i % 8;
        animals.push(an('a' + i, i % 3 === 0 ? M : F, String(1 + (i % 5)), ['p' + fam, 'q' + fam], { genes: G('ABCDEFGH'[fam], 'ABCDEFGH'[(fam + 3) % 8]) }));
    }
    const model = buildKinModel(snap(animals, ['1', '2', '3', '4', '5', '6']));
    const t = Date.now();
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 16 } }, DEST(['1', '2', '3', '4', '5', '6']));
    const ms = Date.now() - t;
    console.log(`80 animals: ${ms} ms, ${plan.evaluations} evaluations, ${plan.moves.length} moves, related ${plan.before.relatedPairs} -> ${plan.after.relatedPairs}, pairs ${plan.before.breedingPairs} -> ${plan.after.breedingPairs}`);
    assert.ok(ms < 8000);
    assert.ok(plan.after.relatedPairs < plan.before.relatedPairs);
});

test('no needless moves: an equal layout with fewer moves wins', () => {
    // a has his daughter d with him; habitat 2 has an unrelated male b and female u.
    // Moving d alone to b fixes it; nothing else needs to move.
    const animals = [an('a', M, '1'), an('d', F, '1', ['a', 'x']), an('w', F, '1'), an('b', M, '2'), an('u', F, '2')];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 5 } }, DEST(['1', '2', '3']));
    assert.equal(plan.after.relatedPairs, 0);
    assert.equal(plan.moves.length, 1, JSON.stringify(plan.moves));
    assert.equal(plan.moves[0].id, 'd');
});

test('pulls a breeder out of the trade centre into a habitat that needs one', () => {
    // habitat 1: two unrelated females, no male; an unrelated male waits at the trade centre
    const animals = [an('f1', F, '1'), an('f2', F, '1'), an('m', M, '', [], { lt: 'trade' })];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 5 } }, DEST(['1', '2']));
    assert.deepEqual(plan.moves.map(m => [m.id, String(m.to)]), [['m', '1']]);
    assert.equal(plan.fromTrade, 1);
    assert.equal(plan.after.breedingPairs, 2);
});

test('trade centre animals stay put when asked not to use them', () => {
    const animals = [an('f1', F, '1'), an('m', M, '', [], { lt: 'trade' })];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny' }, DEST(['1']), { options: { useTradeCentre: false } });
    assert.equal(plan.moves.length, 0);
});

// ------------------------------------------------------- group make-up

test('make-up: parse, reduce and the sources in order', () => {
    assert.deepEqual(parseRatio('1:3'), { m: 1, f: 3 });
    assert.deepEqual(parseRatio('*:1'), { m: Infinity, f: 1 });
    assert.equal(parseRatio('2:3'), null);           // one side is always 1
    assert.equal(parseRatio('auto'), null);
    assert.equal(parseRatio('mixed'), 'mixed');
    for (const c of RATIO_CHOICES) if (c !== 'auto') assert.ok(parseRatio(c), c);
    assert.deepEqual(reduceRatio(2, 6), { m: 1, f: 3 });
    assert.deepEqual(reduceRatio(3, 1), { m: 3, f: 1 });
    // the mating system alone
    assert.equal(ratioKey(groupRule({ mating: 'polygyny' })), '1:*');
    assert.equal(ratioKey(groupRule({ mating: 'monogamy' })), '1:1');
    assert.equal(ratioKey(groupRule({ mating: 'polyandry' })), '*:1');
    const none = groupRule({});
    assert.equal(ratioKey(none), 'mixed');
    assert.equal(none.source, 'none');
    // the game's social groups beat the mating system (when they agree with it)
    const groups = [{ kind: 'pair', m: 1, f: 1 }, { kind: 'mixed', m: 2, f: 6 }];
    const g = groupRule({ mating: 'polygyny', groups });
    assert.equal(ratioKey(g), '1:3');
    assert.equal(g.source, 'groups');
    // a monogamous species keeps pairs whatever the groups say
    assert.equal(ratioKey(groupRule({ mating: 'monogamy', groups: [{ kind: 'mixed', m: 1, f: 4 }] })), '1:1');
    // the game's most per sex: ratio and caps
    const caps = groupRule({ mating: 'polygyny', sexMax: { male: 1, female: 5 }, groups });
    assert.equal(ratioKey(caps), '1:5');
    assert.equal(caps.source, 'game');
    assert.equal(caps.maxMales, 1);
    // the player's choice wins; the game's caps still hold
    const mine = groupRule({ mating: 'polygyny', sexMax: { male: 1, female: 5 } }, '1:2');
    assert.equal(ratioKey(mine), '1:2');
    assert.equal(mine.source, 'yours');
    assert.equal(mine.maxMales, 1);
    assert.equal(ratioKey(groupRule({ mating: 'polygyny' }, 'mixed')), 'mixed');
});

test('make-up: Polygyandry, solitary species and an unread rule', () => {
    // Polygyandry (the Zoopedia's "Promiscuous": tigers, bears) is a rule the
    // mod read: mixed groups from the mating system, no "unknown" note
    const solo = [{ kind: 'maleSolitary', m: 1, f: 0 }, { kind: 'femaleSolitary', m: 0, f: 1 }];
    const tiger = groupRule({ mating: 'mixed', groups: solo, social: { max: 2 } });
    assert.equal(ratioKey(tiger), 'mixed');
    assert.equal(tiger.source, 'mating');
    assert.equal(tiger.system, 'mixed');
    assert.equal(tiger.solitary, true);
    // a solitary species with a pair rule keeps it
    assert.equal(ratioKey(groupRule({ mating: 'monogamy', groups: solo })), '1:1');
    assert.equal(ratioKey(groupRule({ mating: 'polygyny', groups: solo })), '1:*');
    // Polygyandry with a mixed group: the group's make-up
    assert.equal(ratioKey(groupRule({ mating: 'mixed', groups: [{ kind: 'mixed', m: 1, f: 2 }] })), '1:2');
    // no rule read and one-sex groups: not known, mixed groups assumed
    const unread = groupRule({ matingRaw: '9', groups: solo });
    assert.equal(unread.source, 'none');
    assert.equal(unread.solitary, true);
    assert.equal(groupRule({ groups: [{ kind: 'mixed', m: 1, f: 3 }] }).solitary, false);
    assert.equal(groupRule({}).solitary, false);
    // only male groups, or groups without counts
    assert.equal(groupRule({ groups: [{ kind: 'maleBachelor', m: 3, f: 0 }] }).source, 'none');
    assert.equal(groupRule({ groups: [{ kind: 'maleBachelor', m: 3, f: 0 }] }).solitary, true);
});

test('make-up: the note when the make-up is not known', () => {
    const solo = [{ kind: 'maleSolitary', m: 1, f: 0 }, { kind: 'femaleSolitary', m: 0, f: 1 }];
    const t = unknownMakeupText({ matingRaw: '9', groups: solo, social: { max: 2 } });
    assert.match(t, /mating rule came as "9", which the mod can't read/);
    assert.match(t, /all of one sex \(male alone: 1 ♂ 0 ♀, female alone: 0 ♂ 1 ♀\), as for a solitary species/);
    assert.match(t, /Mixed groups are assumed: each female with her best unrelated male, up to 2 adults per habitat\./);
    assert.match(t, /choose the make-up with the arrows/);
    const bare = unknownMakeupText({});
    assert.match(bare, /^The game gave no mating rule, and no group make-up\. Mixed groups are assumed: each female with her best unrelated male\. /);
    assert.doesNotMatch(bare, /solitary|undefined|null/);
    // a group kind the mod has no words for keeps its name; missing counts read 0
    assert.match(unknownMakeupText({ groups: [{ kind: 'Herd', m: 2 }] }), /\(Herd: 2 ♂ 0 ♀\), as for a solitary species/);
    assert.doesNotMatch(unknownMakeupText({ matingRaw: '' }), /came as/);
});

test('make-up: the target group for the room of a habitat', () => {
    const r = s => groupRule({}, s);
    assert.deepEqual(groupTarget(r('1:3'), 8), { males: 2, females: 6 });
    assert.deepEqual(groupTarget(r('1:3'), 6), { males: 2, females: 4 });   // 4 pairs beat 3
    assert.deepEqual(groupTarget(r('1:3'), 4), { males: 1, females: 3 });
    assert.deepEqual(groupTarget(r('1:*'), 6), { males: 1, females: 5 });
    assert.deepEqual(groupTarget(r('1:1'), 5), { males: 2, females: 2 });
    assert.deepEqual(groupTarget(r('2:1'), 6), { males: 4, females: 2 });
    assert.equal(groupTarget(r('mixed'), 6), null);
    const capped = groupRule({ mating: 'polygyny', sexMax: { male: 1, female: 3 } }, '1:3');
    assert.deepEqual(groupTarget(capped, 10), { males: 1, females: 3 });
});

// a small seeded random source for the generated cases
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('best pairs: exact against every matching', () => {
    const r = rng(7);
    for (let c = 0; c < 300; c++) {
        const nM = 1 + Math.floor(r() * 4), nF = 1 + Math.floor(r() * 5);
        const perMale = [1, 2, 3, Infinity][Math.floor(r() * 4)];
        const perFemale = perMale === 1 && r() < 0.4 ? [2, Infinity][Math.floor(r() * 2)] : 1;
        const w = Array.from({ length: nM }, () => Array.from({ length: nF }, () => (r() < 0.2 ? -1 : Math.round(r() * 100) / 100)));
        const males = Array.from({ length: nM }, (_, i) => i), females = Array.from({ length: nF }, (_, j) => 10 + j);
        const got = maxWeightPairs(males, females, (m, f) => w[m][f - 10], perMale, perFemale).reduce((s, p) => s + p[0], 0);
        // brute force: every set of pairs within the limits
        const pairs = [];
        for (let i = 0; i < nM; i++) for (let j = 0; j < nF; j++) if (w[i][j] > 0) pairs.push([i, j]);
        let best = 0;
        for (let mask = 0; mask < (1 << pairs.length); mask++) {
            const um = new Array(nM).fill(0), uf = new Array(nF).fill(0);
            let v = 0, ok = true;
            for (let k = 0; k < pairs.length && ok; k++) {
                if (!(mask & (1 << k))) continue;
                const [i, j] = pairs[k];
                if (++um[i] > perMale || ++uf[j] > perFemale) ok = false;
                v += w[i][j];
            }
            if (ok && v > best) best = v;
        }
        assert.ok(Math.abs(got - best) < 1e-9, `case ${c}: ${nM}x${nF} per ${perMale}/${perFemale}: got ${got}, best ${best}`);
    }
});

test('1:3: two males share a big habitat; a harem keeps one', () => {
    const animals = [an('m1', M, '1'), an('m2', M, '1'), ...[1, 2, 3, 4, 5, 6].map(i => an('f' + i, F, '1'))];
    const model = buildKinModel(snap(animals, ['1']));
    const three = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 8 } }, DEST(['1']), { options: { ratio: '1:3' } });
    assert.equal(three.moves.length, 0, JSON.stringify(three.moves));
    assert.equal(three.after.breedingPairs, 6);
    assert.deepEqual(three.groups.find(g => g.hab === '1').target, { males: 2, females: 6 });
    const harem = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 8 } }, DEST(['1']));
    assert.equal(harem.rule.source, 'mating');
    assert.deepEqual(harem.moves.map(m => m.to), [TRADE]);             // one male leaves
});

test('1:3: open places fill from the trade centre and from a habitat with surplus', () => {
    // habitat 1: a male with five females (two more than he takes); habitat 2: a male alone;
    // the trade centre: an unrelated female and a spare male
    const animals = [
        an('a', M, '1'), ...[1, 2, 3, 4, 5].map(i => an('f' + i, F, '1')),
        an('b', M, '2'),
        an('t1', F, '', [], { lt: 'trade' }), an('t2', M, '', [], { lt: 'trade' }),
    ];
    const model = buildKinModel(snap(animals, ['1', '2']));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 6 } }, DEST(['1', '2']), { options: { ratio: '1:3' } });
    // every female breeds: the one from the trade centre and one of habitat
    // 1's surplus go to the lone male; the spare male takes the 4th female
    // left in habitat 1 (1:3 lets a habitat of 4 females have 2 males)
    assert.equal(where(model, plan, 't1'), '2', JSON.stringify(plan.moves));
    assert.ok(['f1', 'f2', 'f3', 'f4', 'f5'].some(id => where(model, plan, id) === '2'), JSON.stringify(plan.moves));
    assert.equal(plan.after.breedingPairs, 6);
    assert.equal(plan.after.idle, 0);
    assert.equal(plan.before.idle, 5);                                   // 2 surplus females, the lone male, the 2 at the trade centre
    // without the spare male, habitat 1 keeps 3 and the other 2 go to habitat 2
    const noSpare = buildKinModel(snap(animals.filter(a => a.id !== 't2'), ['1', '2']));
    const p2 = planProgramme(noSpare, 'Lion', { mating: 'polygyny', social: { max: 6 } }, DEST(['1', '2']), { options: { ratio: '1:3' } });
    const fem = ['f1', 'f2', 'f3', 'f4', 'f5', 't1'];
    assert.equal(fem.filter(id => where(noSpare, p2, id) === '1').length, 3, JSON.stringify(p2.moves));
    assert.equal(fem.filter(id => where(noSpare, p2, id) === '2').length, 3, JSON.stringify(p2.moves));
});

test('1:3: extra males leave for a habitat that has none', () => {
    const animals = [an('m1', M, '1'), an('m2', M, '1'), an('m3', M, '1'), an('f1', F, '1'), an('f2', F, '1'), an('f3', F, '1'), an('g1', F, '2'), an('g2', F, '2')];
    const model = buildKinModel(snap(animals, ['1', '2']));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 8 } }, DEST(['1', '2']), { options: { ratio: '1:3' } });
    assert.equal(['m1', 'm2', 'm3'].filter(id => where(model, plan, id) === '1').length, 1);
    assert.equal(['m1', 'm2', 'm3'].filter(id => where(model, plan, id) === '2').length, 1);
    assert.equal(plan.after.breedingPairs, 5);
});

test('a new group: a male and a female from the trade centre together into an empty habitat', () => {
    const animals = [an('m', M, '', [], { lt: 'trade' }), an('f', F, '', [], { lt: 'trade' })];
    const model = buildKinModel(snap(animals, ['1']));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 4 } }, DEST(['1']));
    assert.deepEqual(plan.moves.map(x => [x.id, x.to]).sort(), [['f', '1'], ['m', '1']]);
    // the search alone (no full enumeration) finds it too
    const heur = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 4 } }, DEST(['1']), { options: { exactLimit: 0 } });
    assert.equal(heur.moves.length, 2);
});

// a random small zoo: families, genes, bonds, the trade centre
function smallZoo(seed) {
    const r = rng(seed);
    const L = 'ABCDEFGH';
    const strand = () => Array.from({ length: 6 }, () => L[Math.floor(r() * 8)]).join('');
    const habs = ['1', '2', '3'].slice(0, 2 + Math.floor(r() * 2));
    const n = 5 + Math.floor(r() * 3);
    const animals = [];
    for (let i = 0; i < n; i++) {
        const trade = r() < 0.2;
        const hab = trade ? '' : habs[Math.floor(r() * habs.length)];
        const fam = Math.floor(r() * 3);
        animals.push(an('a' + i, r() < 0.5 ? M : F, hab, r() < 0.6 ? ['p' + fam, 'q' + fam] : [], {
            lt: trade ? 'trade' : 'habitat',
            genes: { F: strand() + strand(), I: strand() + strand(), S: strand() + strand(), L: strand() + strand() },
        }));
    }
    for (const a of animals) {
        if (a.mates.length || !a.hab || r() > 0.3) continue;
        const b = animals.find(x => x !== a && x.hab === a.hab && x.sex !== a.sex && !x.mates.length);
        if (b) {
            a.mates = [b.id];
            b.mates = [a.id];
        }
    }
    const mating = ['polygyny', 'monogamy', 'mixed', 'polyandry'][Math.floor(r() * 4)];
    const ratio = ['auto', 'auto', '1:2', '1:3', '2:1'][Math.floor(r() * 5)];
    const info = { mating, social: { max: 2 + Math.floor(r() * 4) } };
    return { model: buildKinModel(snap(animals, habs)), habs, info, ratio };
}

// the search on its own: the pair-in-every-habitat step after it (pairEvery)
// trades some score for a breeding pair in each habitat, and is tested by itself
test('every layout: the exhaustive answer is the true optimum (each layout scored from scratch)', () => {
    for (let seed = 1; seed <= 12; seed++) {
        const { model, habs, info, ratio } = smallZoo(seed);
        const dest = DEST(habs);
        const plan = planProgramme(model, 'Lion', info, dest, { options: { ratio, pairEvery: false } });
        assert.equal(plan.exact, true);
        const ids = Array.from(model.animals.values()).map(a => a.id);
        const places = habs.concat([TRADE]);
        let best = -Infinity;
        const total = places.length ** ids.length;
        for (let k = 0; k < total; k++) {
            let x = k;
            const moves = [];
            for (const id of ids) {
                const to = places[x % places.length];
                x = Math.floor(x / places.length);
                const a = model.animals.get(id);
                if (to !== (a.hab || TRADE)) moves.push({ id, to });
            }
            const s = scoreLayout(model, 'Lion', info, dest, { options: { ratio, pairEvery: false } }, moves);
            if (s != null && s > best) best = s;
        }
        assert.ok(Math.abs(plan.score - best) < 1e-6, `seed ${seed}: plan ${plan.score}, best ${best}`);
        assert.ok(Math.abs(scoreLayout(model, 'Lion', info, dest, { options: { ratio, pairEvery: false } }, plan.moves) - plan.score) < 1e-6);
    }
});

test('the search alone finds the optimum on small zoos', () => {
    const missed = [];
    for (let seed = 100; seed < 260; seed++) {
        const { model, habs, info, ratio } = smallZoo(seed);
        const exact = planProgramme(model, 'Lion', info, DEST(habs), { options: { ratio, pairEvery: false } });
        const heur = planProgramme(model, 'Lion', info, DEST(habs), { options: { ratio, exactLimit: 0, pairEvery: false } });
        assert.equal(heur.exact, false);
        if (heur.score < exact.score - 1e-6) {
            missed.push(`${seed}: ${heur.score.toFixed(4)} < ${exact.score.toFixed(4)}`);
            // the deep engine (more starts) finds it
            const deep = planProgramme(model, 'Lion', info, DEST(habs), { options: { ratio, exactLimit: 0, engine: 'deep', starts: 8, pairEvery: false } });
            assert.ok(deep.score > exact.score - 1e-6, `seed ${seed}: deep ${deep.score} < ${exact.score}`);
        }
    }
    // since the per-sex caps from the group size (2026-10-18) the guided
    // search alone misses one of these 160 (seed 191); in the game a zoo
    // this small is scored layout by layout anyway
    assert.ok(missed.length <= 2, JSON.stringify(missed));
});

test('the same zoo gives the same plan', () => {
    const animals = [];
    for (let i = 0; i < 40; i++) animals.push(an('a' + i, i % 3 === 0 ? M : F, String(1 + (i % 5)), ['p' + (i % 7), 'q' + (i % 7)], { genes: G('ABCDEFGH'[i % 8], 'ABCDEFGH'[(i + 3) % 8]) }));
    const model = buildKinModel(snap(animals, ['1', '2', '3', '4', '5', '6']));
    const info = { mating: 'polygyny', social: { max: 9 } };
    const dest = DEST(['1', '2', '3', '4', '5', '6']);
    const a = planProgramme(model, 'Lion', info, dest, { options: { ratio: '1:3' } });
    const b = planProgramme(model, 'Lion', info, dest, { options: { ratio: '1:3' } });
    assert.deepEqual(a.moves, b.moves);
    assert.equal(a.score, b.score);
});

test('in slices: the same plan, with progress, and it can be stopped', async () => {
    const animals = [];
    for (let i = 0; i < 30; i++) animals.push(an('a' + i, i % 2 ? M : F, String(1 + (i % 4)), ['p' + (i % 5), 'q' + (i % 5)], { genes: G('ABCDEFGH'[i % 8], 'ABCDEFGH'[(i + 5) % 8]) }));
    const model = buildKinModel(snap(animals, ['1', '2', '3', '4', '5']));
    const info = { mating: 'monogamy', social: { max: 8 } };
    const dest = DEST(['1', '2', '3', '4', '5']);
    const sync = planProgramme(model, 'Lion', info, dest);
    const seen = [];
    const slow = await planProgrammeAsync(model, 'Lion', info, dest, { sliceMs: 2, onProgress: v => seen.push(v) });
    assert.deepEqual(slow.moves, sync.moves);
    assert.ok(seen.length > 1, 'progress reported');
    assert.ok(seen.every(v => v >= 0 && v <= 1));
    let calls = 0;
    const stopped = await planProgrammeAsync(model, 'Lion', info, dest, { sliceMs: 1, isCancelled: () => ++calls > 2 });
    assert.equal(stopped, null);
});

test('unisex: two make one couple, one partner each under 1:1', () => {
    const U = Sex.Unisex;
    const two = buildKinModel(snap([an('u1', U, '1'), an('u2', U, '1')], ['1']));
    for (const mating of ['monogamy', 'mixed']) {
        const plan = planProgramme(two, 'Lion', { mating, social: { max: 4 } }, DEST(['1']));
        assert.equal(plan.after.breedingPairs, 1, mating);
        assert.equal(plan.after.idle, 0, mating);
    }
    const three = buildKinModel(snap([an('u1', U, '1'), an('u2', U, '1'), an('u3', U, '1')], ['1']));
    const pairs = planProgramme(three, 'Lion', { mating: 'monogamy', social: { max: 4 } }, DEST(['1']));
    assert.equal(pairs.after.breedingPairs, 1);
    assert.equal(pairs.after.idle, 1);
});

test('assignments: a breeder outside them may stay where it is', () => {
    // habitat 2 is not assigned to the species; its pair there is fine, so nothing moves
    const animals = [an('m', M, '2'), an('f', F, '2'), an('m1', M, '1'), an('f1', F, '1')];
    const model = buildKinModel(snap(animals, ['1', '2']));
    for (const exactLimit of [20000, 0]) {
        const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1', '2']), { assignments: { '1': ['Lion'] }, options: { exactLimit } });
        assert.equal(plan.moves.length, 0, JSON.stringify(plan.moves));
    }
});

// ------------------------------------------------ pregnant females stay

test('pregnant: the daughter stays, her father moves instead', () => {
    // habitat 1: male a with his daughter d and an unrelated w; habitat 2: male b and u.
    // Without the pregnancy the cheapest fix moves d; pregnant, she is pinned.
    const base = [an('a', M, '1'), an('d', F, '1', ['a', 'x']), an('w', F, '1'), an('b', M, '2'), an('u', F, '2')];
    const free = buildKinModel(snap(base));
    const info = { mating: 'polygyny', social: { max: 5 } };
    const p0 = planProgramme(free, 'Lion', info, DEST(['1', '2', '3']));
    assert.ok(p0.moves.some(m => m.id === 'd'), JSON.stringify(p0.moves));
    const model = buildKinModel(snap(base.map(x => (x.id === 'd' ? Object.assign({}, x, { preg: true }) : x))));
    for (const exactLimit of [20000, 0]) {
        const plan = planProgramme(model, 'Lion', info, DEST(['1', '2', '3']), { options: { exactLimit } });
        assert.ok(!plan.moves.some(m => m.id === 'd'), JSON.stringify(plan.moves));
        assert.deepEqual(plan.pinned, ['d']);
        assert.equal(plan.after.relatedPairs, 0, JSON.stringify(plan.moves));
        // she still counts in her group (a breeder there)
        assert.ok(plan.groups.find(g => g.hab === '1').animals.some(x => x.id === 'd'));
    }
});

test('pregnant: never moved, not even when her habitat is over its room', () => {
    const animals = [an('m1', M, '1'), an('f1', F, '1', [], { preg: true }), an('f2', F, '1', [], { preg: true }), an('f3', F, '1'), an('f4', F, '1')];
    const model = buildKinModel(snap(animals, ['1', '2']));
    const plan = planProgramme(model, 'Lion', { mating: 'polygyny', social: { max: 3 } }, DEST(['1', '2']));
    assert.ok(!plan.moves.some(m => m.id === 'f1' || m.id === 'f2'), JSON.stringify(plan.moves));
});

// a pregnant female gives birth where she is; the one move she gets is out
// of the trade centre into a habitat (she can only give birth there)
const pregnantMoves = (model, plan, preg) => plan.moves.filter(m => preg.has(m.id) && !(model.animals.get(m.id).lt === 'trade' && m.to !== TRADE));
test('pregnant: no search step moves one (exhaustive, search, slices; random small zoos)', async () => {
    for (let seed = 300; seed < 360; seed++) {
        const { model, habs, info, ratio } = smallZoo(seed);
        let k = 0;
        const raw = Array.from(model.animals.values()).map(a => Object.assign({}, a, { preg: a.sex === F && (k++ % 2 === 0) }));
        const m2 = buildKinModel(snap(raw, habs));
        const preg = new Set(raw.filter(a => a.preg).map(a => a.id));
        for (const exactLimit of [20000, 0]) {
            const plan = planProgramme(m2, 'Lion', info, DEST(habs), { options: { ratio, exactLimit } });
            assert.deepEqual(pregnantMoves(m2, plan, preg), [], `seed ${seed} exactLimit ${exactLimit}`);
        }
        if (seed % 10 === 0) {
            const plan = await planProgrammeAsync(m2, 'Lion', info, DEST(habs), { options: { ratio, exactLimit: 0 } });
            assert.deepEqual(pregnantMoves(m2, plan, preg), [], `seed ${seed} async`);
        }
    }
});

// ------------------------------------------------ contraception advice

// genes with a chosen fertility/immunity diversity (0..6 loci differ)
const GD = n => {
    const a = 'AAAAAA', b = 'B'.repeat(n) + 'A'.repeat(6 - n);
    return { F: a + b, I: a + b, S: 'AAAAAACCCCCC', L: 'AAAAAACCCCCC' };
};
const POLY = groupRule({ mating: 'polygyny' });
const MONO = groupRule({ mating: 'monogamy' });
const withFacts = (animals, facts) => buildKinModel(Object.assign(snap(animals), { speciesFacts: { Lion: facts } }));

test('contraception: no mate here, now or after the plan', () => {
    const model = buildKinModel(snap([an('f', F, '1', [], { preg: true }), an('w', F, '1'), an('m', M, '2')]));
    const adv = contraceptionAdvice(model, 'Lion');
    assert.equal(adv.length, 1);
    assert.equal(adv[0].id, 'f');
    assert.equal(adv[0].kind, 'nomate');
    assert.match(adv[0].text, /^Contraception after birth: no male here/);
    // the plan brings a male: no advice
    assert.deepEqual(contraceptionAdvice(model, 'Lion', { moves: [{ id: 'm', to: '1' }] }), []);
    // a contracepted male is no mate; a contracepted pregnant female gets no advice
    const m2 = buildKinModel(snap([an('f', F, '1', [], { preg: true }), an('m', M, '1', [], { contra: true })]));
    assert.equal(contraceptionAdvice(m2, 'Lion')[0].kind, 'nomate');
    const m3 = buildKinModel(snap([an('f', F, '1', [], { preg: true, contra: true })]));
    assert.deepEqual(contraceptionAdvice(m3, 'Lion'), []);
    // not pregnant: no advice
    assert.deepEqual(contraceptionAdvice(buildKinModel(snap([an('f', F, '1')])), 'Lion'), []);
});

test('contraception: only related mates (her father)', () => {
    const model = buildKinModel(snap([an('a', M, '1'), an('d', F, '1', ['a', 'x'], { preg: true })]));
    const adv = contraceptionAdvice(model, 'Lion');
    assert.equal(adv.length, 1);
    assert.equal(adv[0].kind, 'related');
    assert.match(adv[0].text, /only related mates here \(a, her father\)/);
    // an unrelated male too: no advice
    const m2 = buildKinModel(snap([an('a', M, '1'), an('b', M, '1'), an('d', F, '1', ['a', 'x'], { preg: true })]));
    assert.deepEqual(contraceptionAdvice(m2, 'Lion'), []);
});

test('contraception: a young male maturing soon is a future mate', () => {
    const f = () => an('f', F, '1', [], { preg: true });
    // 1 year to go (species maturity 3, he is 2) -> a mate: no advice
    const soon = withFacts([f(), an('k', M, '1', [], { juv: true, age: 2 })], { maturity: 3, infertility: 20 });
    assert.equal(soon.animals.get('k').fert.yearsToMature, 1);
    assert.deepEqual(contraceptionAdvice(soon, 'Lion'), []);
    // 5 years to go -> no mate within the horizon
    const late = withFacts([f(), an('k', M, '1', [], { juv: true, age: 0 })], { maturity: 5, infertility: 20 });
    assert.ok(late.animals.get('k').fert.yearsToMature > CONTRA_ADVICE.futureMateYears);
    assert.equal(contraceptionAdvice(late, 'Lion')[0].kind, 'nomate');
    // unknown maturity: counted as a mate (no advice on a guess)
    const unknown = buildKinModel(snap([f(), an('k', M, '1', [], { juv: true })]));
    assert.deepEqual(contraceptionAdvice(unknown, 'Lion'), []);
    // her own son maturing: related
    const son = withFacts([f(), an('k', M, '1', ['f', 'y'], { juv: true, age: 2 })], { maturity: 3, infertility: 20 });
    assert.equal(contraceptionAdvice(son, 'Lion')[0].kind, 'related');
});

test('contraception: weakest genes against the group median', () => {
    // a male and four females; the pregnant one has far lower genes
    const animals = [an('m', M, '1'), an('f', F, '1', [], { preg: true, genes: GD(1) }),
        an('g1', F, '1', [], { genes: GD(5) }), an('g2', F, '1', [], { genes: GD(6) }), an('g3', F, '1', [], { genes: GD(4) })];
    const model = buildKinModel(snap(animals));
    const s = ownGeneScore(model.animals.get('f'));
    const med = ownGeneScore(model.animals.get('g1'));          // the middle of 4, 5, 6
    const adv = contraceptionAdvice(model, 'Lion', { rule: POLY });
    assert.equal(adv.length, 1);
    assert.equal(adv[0].kind, 'genes');
    assert.equal(adv[0].score, s);
    assert.equal(adv[0].median, med);
    assert.ok(s <= med - CONTRA_ADVICE.geneMargin);
    assert.equal(adv[0].text, `Contraception after birth: weakest genes in the group (${s} vs median ${med})`);
    // within the margin: no gene advice (a harem has room for every female)
    const close = buildKinModel(snap(animals.map(a => (a.id === 'f' ? Object.assign({}, a, { genes: GD(4) }) : a))));
    assert.deepEqual(contraceptionAdvice(close, 'Lion', { rule: POLY }), []);
    // too few others with gene data: no gene advice
    const few = buildKinModel(snap(animals.map(a => (a.id === 'g1' || a.id === 'g2' ? Object.assign({}, a, { genes: null }) : a))));
    assert.deepEqual(contraceptionAdvice(few, 'Lion', { rule: POLY }), []);
    // her gene data missing: no advice
    const none = buildKinModel(snap(animals.map(a => (a.id === 'f' ? Object.assign({}, a, { genes: null }) : a))));
    assert.deepEqual(contraceptionAdvice(none, 'Lion', { rule: POLY }), []);
    // the thresholds are constants
    assert.equal(CONTRA_ADVICE.geneMargin, 10);
    assert.equal(CONTRA_ADVICE.minPeers, 2);
});

test('contraception: more females than the male can breed (1:1), she is the weakest', () => {
    const animals = [an('m', M, '1'), an('f', F, '1', [], { preg: true, genes: GD(4) }), an('g', F, '1', [], { genes: GD(5) })];
    const model = buildKinModel(snap(animals));
    const pairs = contraceptionAdvice(model, 'Lion', { rule: MONO });
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].kind, 'surplus');
    assert.match(pairs[0].text, /weakest genes of 2 females for 1 male/);
    // a harem takes both: no advice
    assert.deepEqual(contraceptionAdvice(model, 'Lion', { rule: POLY }), []);
    // she is not the weakest: no advice
    const strong = buildKinModel(snap(animals.map(a => (a.id === 'f' ? Object.assign({}, a, { genes: GD(6) }) : a))));
    assert.deepEqual(contraceptionAdvice(strong, 'Lion', { rule: MONO }), []);
    // no gene data for the other female: no advice
    const unknown = buildKinModel(snap(animals.map(a => (a.id === 'g' ? Object.assign({}, a, { genes: null }) : a))));
    assert.deepEqual(contraceptionAdvice(unknown, 'Lion', { rule: MONO }), []);
});

test('contraception: the programme result carries the advice', () => {
    const animals = [an('a', M, '1'), an('d', F, '1', ['a', 'x'], { preg: true }), an('b', M, '2'), an('u', F, '2')];
    const model = buildKinModel(snap(animals, ['1', '2']));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1', '2']));
    assert.ok(!plan.moves.some(m => m.id === 'd'));
    assert.ok(Array.isArray(plan.contraception));
    // either the plan brings her an unrelated mate (no advice) or she is advised
    const mateComes = plan.moves.some(m => m.id === 'b' && m.to === '1');
    assert.equal(plan.contraception.some(x => x.id === 'd'), !mateComes, JSON.stringify(plan.moves));
    // alone with her father and nobody to swap: advised (only related mates)
    const alone = buildKinModel(snap([an('a', M, '1'), an('d', F, '1', ['a', 'x'], { preg: true })], ['1']));
    const p2 = planProgramme(alone, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1']), { options: { useTradeCentre: false } });
    assert.deepEqual(p2.contraception.map(x => [x.id, x.kind]), [['d', 'related']]);
});

test('Sumatran tiger: a group of 2 is one male and one female, even with no move cost', () => {
    // mixed groups (Polygyandry), the game's group size 2, no per-sex limit
    // from the game: three tigers in one habitat, a second habitat free
    const animals = [an('m', M, '1', [], { genes: G('A', 'B') }), an('f1', F, '1', [], { genes: G('E', 'F') }), an('f2', F, '1', [], { genes: G('C', 'H') })];
    const model = buildKinModel(snap(animals, ['1', '2']));
    const info = { mating: 'mixed', social: { min: 1, max: 2 } };
    const rule = groupRule(info);
    assert.equal(rule.maxMales, 1);
    assert.equal(rule.maxFemales, 1);
    const plan = planProgramme(model, 'Lion', info, DEST(['1', '2']), { options: { moveCost: 0, outsiderCost: 0 } });
    for (const g of plan.groups.filter(x => x.hab !== TRADE)) {
        assert.ok(g.animals.length <= 2, `${g.hab}: ${g.animals.length} tigers`);
        assert.ok(g.males <= 1 && g.females <= 1, `${g.hab}: ${g.males} ♂ ${g.females} ♀`);
    }
});

test('away (at the vet): counted in its assigned habitat as a breeder, never moved', () => {
    // m at the vet but assigned to 1 with an unrelated female there; a second male in 2
    const animals = [an('m', M, '1', [], { lt: 'vet', away: 'vet', genes: G('A', 'B') }), an('f', F, '1', [], { genes: G('E', 'F') }), an('m2', M, '2', [], { genes: G('C', 'D') })];
    const model = buildKinModel(snap(animals, ['1', '2']));
    const plan = planProgramme(model, 'Lion', { mating: 'monogamy', social: { max: 2 } }, DEST(['1', '2']));
    assert.ok(!plan.moves.some(x => x.id === 'm'), 'the animal at the vet is not moved');
    assert.ok(!plan.moves.some(x => x.id === 'f'), 'its partner stays with it');
    assert.equal(plan.after.breedingPairs, 1);
});

// ------------------------------------------- youth left alone (2026-10-19)

test('young waiting at the trade centre go back: mother, father, else the roomiest habitat', () => {
    const animals = [
        an('m', M, '1', [], { genes: G('E', 'F') }), an('f', F, '1', [], { genes: G('G', 'H') }),
        an('b', M, '2', [], { genes: G('I', 'J') }), an('c', F, '2', [], { genes: G('K', 'L') }),
        // young at the trade centre: f's cub, b's cub (mother unknown), an orphan
        an('y1', F, '', ['m', 'f'], { juv: true, lt: 'trade' }),
        an('y2', M, '', ['b', 'zz'], { juv: true, lt: 'trade' }),
        an('y3', F, '', [], { juv: true, lt: 'trade' }),
    ];
    const model = buildKinModel(snap(animals));
    const plan = planProgramme(model, 'Lion', { social: { min: 2, max: 6 } }, DEST(['1', '2', '3']), { options: { moveCost: 0.5 } });
    const y = id => plan.moves.find(m => m.id === id);
    assert.equal(y('y1').to, '1');
    assert.match(y('y1').reason, /mother/);
    assert.equal(y('y2').to, '2');
    assert.match(y('y2').reason, /father/);
    assert.equal(y('y3').to, '3', 'the empty habitat has the most room');
    assert.ok(plan.moves.filter(m => m.young).every(m => m.to !== TRADE));
    const off = planProgramme(model, 'Lion', { social: { min: 2, max: 6 } }, DEST(['1', '2', '3']), { options: { moveCost: 0.5, youngBack: false } });
    assert.ok(!off.moves.some(m => m.young));
});

test('juveniles never go to the trade centre and do not take adults\' room', () => {
    // the game's requirement covers 2 adults + 2 young: 400 land; 900 available
    const info = { social: { min: 1, max: 20 }, habitats: { 1: { available: { land: 900 }, required: { land: 400 }, adults: 2 } } };
    const animals = [an('m', M, '1'), an('f', F, '1', [], { genes: G('E', 'F') }), an('y1', F, '1', ['m', 'f'], { juv: true }), an('y2', M, '1', ['m', 'f'], { juv: true })];
    const model = buildKinModel(snap(animals, ['1']));
    const young = new Map([['1', 2]]);
    assert.deepEqual(estimateSpacePerAdult(info, young), { land: 100 });
    assert.deepEqual(estimateSpacePerAdult(info), { land: 200 }, 'without the young: as before');
    const plan = planProgramme(model, 'Lion', info, DEST(['1']));
    assert.equal(plan.capacity['1'], 9, '900 / 100 per animal');
    assert.ok(!plan.moves.some(m => m.id === 'y1' || m.id === 'y2'));
});

test('a kept plan is redone (and gains the young moves) when young arrive at the trade centre', () => {
    const base = [an('m', M, '1', [], { genes: G('E', 'F') }), an('f', F, '1', [], { genes: G('G', 'H') })];
    const sig = list => programmeProblemSig(buildKinModel(snap(list)), 'Lion', { social: { min: 2, max: 6 } }, DEST(['1', '2']));
    const before = sig(base);
    // a cub born in the habitat changes nothing (births don't restart a search)
    assert.equal(sig(base.concat([an('c', F, '1', ['m', 'f'], { juv: true })])), before);
    // a cub waiting at the trade centre does
    const withYoung = base.concat([an('y', F, '', ['m', 'f'], { juv: true, lt: 'trade' })]);
    assert.notEqual(sig(withYoung), before);
    const model = buildKinModel(snap(withYoung));
    const fresh = planProgramme(model, 'Lion', { social: { min: 2, max: 6 } }, DEST(['1', '2']));
    const kept = { moves: [{ id: 'm', to: '2' }, { id: 'y', to: '2', young: true }], score: 1 };
    const r = withFreshYoung(kept, fresh);
    assert.deepEqual(r.moves.map(x => `${x.id}>${x.to}`), ['m>2', 'y>1']);
    assert.equal(r.score, 1);
    assert.equal(withFreshYoung(fresh, fresh), fresh);
});
