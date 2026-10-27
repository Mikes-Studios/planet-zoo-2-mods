// node --test tests/kincull.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKinModel, Sex } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { cullPlan, geneScore } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincull.js';

const M = Sex.Male, F = Sex.Female;
// gene strings: fertility/immunity count differing loci (hetero), size/longevity good alleles
const G = q => {
    const het = 'ABCDEF'.slice(0, q) + 'ABCDEF'.slice(q);   // first q loci differ below
    const f = 'AAAAAA' + 'BBBBBB'.slice(0, q) + 'AAAAAA'.slice(q);
    return { F: f, I: f, S: 'A'.repeat(q) + 'Z'.repeat(6 - q) + 'A'.repeat(q) + 'Z'.repeat(6 - q), L: 'A'.repeat(q) + 'Z'.repeat(6 - q) + 'A'.repeat(q) + 'Z'.repeat(6 - q) };
};
let n = 0;
const an = (sex, hab, q, over = {}) => {
    n++;
    return Object.assign({ id: 'a' + n, key: 'animal_a' + n, guid: 'g' + n, name: 'L' + n, species: 'Lemur', sex, juv: false, contra: false, infertile: false,
        hab, loc: 'H' + hab, lt: 'habitat', par: [], mates: [], genes: G(q), age: 5, ageQ: 2 }, over);
};
const LEMUR = { maturity: 2, infertility: 15, life: 20 };
const model = animals => buildKinModel({ v: 1, seq: 1, scope: 'park', mode: 'offline', habitats: [{ id: '1', name: 'Lemur Woods' }, { id: '2', name: 'Lemur Isle' }], animals, anc: {}, speciesFacts: { Lemur: LEMUR } });
const INFO = { social: { max: 6 }, mating: 'polygyny' };

test('an over-full habitat gives up its old and weak animals first, keeps the best', () => {
    n = 0;
    const animals = [
        an(M, '1', 6), an(M, '1', 2), an(F, '1', 6), an(F, '1', 5), an(F, '1', 4),
        an(F, '1', 3), an(F, '1', 1), an(F, '1', 5, { age: 17, ageQ: 3, infertile: true }), an(M, '1', 4, { age: 16, infertile: true }),
    ];
    const plan = cullPlan(model(animals), 'Lemur', INFO, { options: { fill: 0.85 } });
    const h = plan.habitats[0];
    assert.equal(h.adults, 9);
    assert.equal(h.target, 5);
    assert.equal(plan.moves.length, 4);
    const out = new Set(plan.moves.map(m => m.id));
    assert.ok(out.has('a8') && out.has('a9'), 'the old ones go');
    assert.ok(out.has('a2'), 'the extra, weaker male goes (harem)');
    assert.ok(!out.has('a1') && !out.has('a3'), 'the best male and female stay');
    assert.match(plan.moves.find(m => m.id === 'a8').reason, /too old/);
    assert.match(plan.moves.find(m => m.id === 'a2').reason, /extra male/);
    assert.ok(plan.after.gene > plan.before.gene, 'the kept animals have better genes');
});

test('a habitat within its room is left alone; old animals only with oldAlways', () => {
    n = 0;
    const animals = [an(M, '2', 5), an(F, '2', 5), an(F, '2', 4, { age: 17, infertile: true })];
    assert.equal(cullPlan(model(animals), 'Lemur', INFO).moves.length, 0);
    const p = cullPlan(model(animals), 'Lemur', INFO, { options: { oldAlways: true } });
    assert.deepEqual(p.moves.map(m => m.id), ['a3']);
});

test('pregnant females, the breeding core and the player\'s keeps stay', () => {
    n = 0;
    const animals = [an(M, '1', 1), an(F, '1', 1, { preg: true }), an(F, '1', 1), an(F, '1', 1), an(F, '1', 2), an(F, '1', 2), an(F, '1', 2), an(F, '1', 3)];
    const plan = cullPlan(model(animals), 'Lemur', { social: { max: 4 } }, { options: { fill: 1, keepIds: new Set(['a3']), keepBest: 0 } });
    const out = new Set(plan.moves.map(m => m.id));
    // 8 adults, room 4: but the male, the pregnant one, the kept one and the
    // two best other females (breeding core) stay, so only 3 can go
    assert.equal(out.size, 3);
    assert.ok(!out.has('a1'), 'the only male stays');
    assert.ok(!out.has('a2'), 'pregnant stays');
    assert.ok(!out.has('a3'), 'kept by the player');
});

test('the player can send one away by hand; fill levels change the count', () => {
    n = 0;
    const animals = Array.from({ length: 10 }, (_, i) => an(i < 3 ? M : F, '1', 1 + (i % 6)));
    const m = model(animals);
    const lean = cullPlan(m, 'Lemur', { social: { max: 10 } }, { options: { fill: 0.7 } }).moves.length;
    const full = cullPlan(m, 'Lemur', { social: { max: 10 } }, { options: { fill: 1 } }).moves.length;
    assert.ok(lean > full && full === 0);
    const hand = cullPlan(m, 'Lemur', { social: { max: 10 } }, { options: { fill: 1, cullIds: new Set(['a5']) } });
    assert.deepEqual(hand.moves.map(x => [x.id, x.reason]), [['a5', 'your choice']]);
});

test('relatives in the same habitat lower the keep value', () => {
    n = 0;
    const dad = an(M, '1', 5);
    const kids = [an(F, '1', 5, { par: [dad.guid, 'gm'] }), an(F, '1', 5, { par: [dad.guid, 'gm'] })];
    const other = an(F, '1', 5);
    const extra = [an(F, '1', 5), an(F, '1', 5)];
    const plan = cullPlan(model([dad, ...kids, other, ...extra]), 'Lemur', { social: { max: 5 }, mating: 'polygyny' }, { options: { fill: 0.8, keepBest: 0 } });
    const out = plan.moves.map(m => m.id);
    assert.equal(out.length, 2);
    assert.ok(out.every(id => kids.some(k => k.id === id)), `the daughters living with their father go first: ${out}`);
});

test('gene score from the game grades', () => {
    n = 0;
    assert.ok(geneScore(an(M, '1', 6)) > geneScore(an(M, '1', 1)));
});

test('sending one by hand adds to the plan, it does not swap another back', () => {
    n = 0;
    const animals = Array.from({ length: 10 }, (_, i) => an(i < 3 ? M : F, '1', 1 + (i % 6)));
    const m = model(animals);
    const base = cullPlan(m, 'Lemur', { social: { max: 10 } }, { options: { fill: 0.8 } });
    const kept = base.habitats[0].keep.find(k => !k.why);
    const more = cullPlan(m, 'Lemur', { social: { max: 10 } }, { options: { fill: 0.8, cullIds: new Set([kept.id]) } });
    assert.equal(more.moves.length, base.moves.length + 1);
    for (const mv of base.moves) assert.ok(more.moves.some(x => x.id === mv.id));
});

// a juvenile grows only in a habitat: neither the gene rules nor a pick send one away
test('juveniles are never picked, automatically or by hand', () => {
    n = 0;
    const animals = [an(M, '1', 5), an(F, '1', 5), an(F, '1', 4), an(F, '1', 2), an(F, '1', 1),
        an(F, '1', 1, { juv: true, infertile: true, age: 1 }), an(M, '1', 1, { juv: true, infertile: true, age: 1 })];
    const plan = cullPlan(model(animals), 'Lemur', { social: { max: 4 } }, { options: { fill: 1 } });
    assert.deepEqual(plan.moves.map(m => m.id), ['a5']);
    const hand = cullPlan(model(animals), 'Lemur', { social: { max: 4 } }, { options: { fill: 1, cullIds: new Set(['a6']) } });
    assert.ok(!hand.moves.some(m => m.id === 'a6'));
});

// fertility gene 0%: both strands the same at every fertility locus
const ZF = q => Object.assign(G(q), { F: 'AAAAAAAAAAAA' });

test('a 0% fertility gene goes from every habitat, even one with room and from the breeding core', () => {
    n = 0;
    const animals = [an(M, '2', 6, { genes: ZF(6) }), an(M, '2', 3), an(F, '2', 5), an(F, '2', 6, { genes: ZF(6) }), an(F, '2', 4, { preg: true, genes: ZF(4) })];
    const plan = cullPlan(model(animals), 'Lemur', INFO, { options: { fill: 1 } });
    const out = new Map(plan.moves.map(m => [m.id, m.reason]));
    assert.deepEqual([...out.keys()].sort(), ['a1', 'a4']);
    assert.match(out.get('a1'), /0% fertility/);
    assert.ok(!out.has('a5'), 'pregnant stays');
    assert.equal(plan.before.zeroFert, 3);
    assert.equal(plan.after.zeroFert, 1);
    assert.equal(plan.poorKept, 1);
    // the switch turns it off
    assert.equal(cullPlan(model(animals), 'Lemur', INFO, { options: { fill: 1, zeroFertility: false } }).moves.length, 0);
});

test('when every breeder of a sex has poor genes, the best of them stays', () => {
    n = 0;
    const animals = [an(M, '2', 4, { genes: ZF(4) }), an(M, '2', 6, { genes: ZF(6) }), an(F, '2', 5), an(F, '2', 3)];
    const plan = cullPlan(model(animals), 'Lemur', INFO, { options: { fill: 1 } });
    assert.deepEqual(plan.moves.map(m => m.id), ['a1']);
    assert.equal(plan.habitats[0].keep.find(k => k.id === 'a2').why, 'last breeder of its sex');
});

test('poor gene levels send more away, from habitats with room too', () => {
    n = 0;
    const animals = [an(M, '1', 6), an(M, '1', 4), an(M, '1', 1), an(F, '1', 6), an(F, '1', 5), an(F, '1', 4), an(F, '1', 3), an(F, '1', 2), an(F, '1', 1)];
    const m = model(animals);
    const big = { social: { max: 20 }, mating: 'polygyny' };
    const count = genes => cullPlan(m, 'Lemur', big, { options: { fill: 1, genes } }).moves.length;
    const c = { off: count('off'), weak: count('weak'), below: count('below'), best: count('best') };
    assert.equal(c.off, 0, 'room for everyone');
    assert.ok(c.weak > 0 && c.below > c.weak && c.best > c.below, JSON.stringify(c));
    const best = cullPlan(m, 'Lemur', big, { options: { fill: 1, genes: 'best' } });
    const stay = best.habitats[0].keep.map(k => k.id).sort();
    assert.deepEqual(stay, ['a1', 'a4', 'a5'], 'the best male and the best quarter of the females');
    assert.match(best.moves.find(x => x.id === 'a9').reason, /poor genes/);
});

test('the gene rules read adults only: a poor juvenile stays', () => {
    n = 0;
    const animals = [an(M, '2', 5), an(F, '2', 5), an(F, '2', 4, { juv: true, infertile: true, age: 1, genes: ZF(4) })];
    assert.equal(cullPlan(model(animals), 'Lemur', INFO).moves.length, 0);
    assert.equal(cullPlan(model(animals), 'Lemur', INFO, { options: { young: true } }).moves.length, 0);
});

test('core only keeps just the breeding core', () => {
    n = 0;
    const animals = [an(M, '1', 6), an(M, '1', 4), an(F, '1', 6), an(F, '1', 5), an(F, '1', 4), an(F, '1', 3)];
    const plan = cullPlan(model(animals), 'Lemur', INFO, { options: { fill: 0 } });
    assert.equal(plan.habitats[0].target, 3);
    assert.equal(plan.after.adults, 3);
});

test('the group make-up decides how many breeding males a habitat keeps', () => {
    n = 0;
    // 2 fertile males, 6 fertile females, room for 7: one must go
    const big = [an(M, '1', 6), an(M, '1', 5), an(F, '1', 6), an(F, '1', 5), an(F, '1', 5), an(F, '1', 4), an(F, '1', 4), an(F, '1', 3)];
    const room = { social: { max: 7 }, mating: 'polygyny' };
    // a harem (the mating system alone) keeps one breeding male: the second goes
    const harem = cullPlan(model(big), 'Lemur', room, { options: { fill: 1, keepBest: 0 } });
    assert.deepEqual(harem.moves.map(m => m.id), ['a2']);
    assert.match(harem.moves[0].reason, /harem: one breeding male per habitat/);
    // 1:3 (the player's choice, or the game's social groups) needs both males
    // for six females: the weakest female goes instead
    for (const plan of [
        cullPlan(model(big), 'Lemur', room, { options: { fill: 1, keepBest: 0, ratio: '1:3' } }),
        cullPlan(model(big), 'Lemur', Object.assign({ groups: [{ kind: 'mixed', m: 1, f: 3 }] }, room), { options: { fill: 1, keepBest: 0 } }),
    ]) {
        assert.equal(plan.moves.length, 1);
        assert.equal(model(big).animals.get(plan.moves[0].id).sex, F, JSON.stringify(plan.moves));
    }
    // with three females 1:3 needs one male: the weaker male is the extra one
    n = 0;
    const small = [an(M, '1', 6), an(M, '1', 5), an(F, '1', 6), an(F, '1', 5), an(F, '1', 4)];
    const plan = cullPlan(model(small), 'Lemur', { social: { max: 4 }, mating: 'polygyny' }, { options: { fill: 1, keepBest: 0, ratio: '1:3' } });
    assert.deepEqual(plan.moves.map(m => m.id), ['a2']);
    assert.match(plan.moves[0].reason, /extra male \(1 ♂ : 3 ♀: room for 1 breeding male here\)/);
});

test('a pregnant female is never sent away, not even by the player\'s choice', () => {
    n = 0;
    // over-full habitat (6 adults, room 3) with a pregnant poor-gene female
    const animals = [an(M, '1', 5), an(F, '1', 1, { preg: true }), an(F, '1', 2), an(F, '1', 3), an(F, '1', 4), an(F, '1', 5)];
    const m = model(animals);
    for (const opts of [{ fill: 0.5 }, { fill: 0.5, genes: 'strict' }, { fill: 1, cullIds: new Set(['a2']) }, { fill: 0.5, oldAlways: true, zeroFertility: true }]) {
        const plan = cullPlan(m, 'Lemur', { social: { max: 3 } }, { options: opts });
        assert.ok(!plan.moves.some(x => x.id === 'a2'), JSON.stringify([opts, plan.moves]));
        const keep = plan.habitats[0].keep.find(x => x.id === 'a2');
        assert.equal(keep.why, 'pregnant');
    }
});
