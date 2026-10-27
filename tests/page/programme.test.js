import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YOUNG_MARGIN, planProgramme, programmeProblemSig, weakBreeders, youngBackMoves } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import { HIPPO_INFO, Sex, TRADE, animal, endPlaces, juvenile, residents, strands, youngAdult, zoo } from './zoo.js';

const plan = (model, info = HIPPO_INFO, options = {}) => planProgramme(model, info.species, info, null, { options });

const adults = (list, sex) => list.filter(a => !a.juv && a.sex === sex);

function females(n, hab, prefix = 'F') {
    return Array.from({ length: n }, (_, i) => animal(`${prefix}${i + 1}`, Sex.Female, hab));
}

// ------------------------------------------------------------ one male only

test('hippos: one adult male per habitat although the scan guessed a 3-male maximum', () => {
    const model = zoo([animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1'), ...females(12, 'H1')]);
    const info = Object.assign({}, HIPPO_INFO, { sexMax: { male: 3, female: 30 } });
    const r = plan(model, info);
    assert.equal(adults(residents(model, r, 'H1'), Sex.Male).length, 1);
});

test('hippos: one adult male per habitat with the make-up set to mixed groups', () => {
    const model = zoo([animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1'), ...females(6, 'H1')]);
    const r = plan(model, HIPPO_INFO, { ratio: 'mixed' });
    assert.equal(adults(residents(model, r, 'H1'), Sex.Male).length, 1);
});

test('hippos: a contracepted second male counts as a male too', () => {
    const model = zoo([animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1', { contra: true }), ...females(6, 'H1')]);
    const r = plan(model, HIPPO_INFO, { ratio: 'mixed' });
    assert.equal(adults(residents(model, r, 'H1'), Sex.Male).length, 1);
});

test('hippos: two habitats each keep their own male', () => {
    const model = zoo([
        animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1'),
        ...females(5, 'H1', 'A'), ...females(5, 'H2', 'B'),
    ]);
    const r = plan(model, HIPPO_INFO, { ratio: 'mixed' });
    assert.equal(adults(residents(model, r, 'H1'), Sex.Male).length, 1);
    assert.equal(adults(residents(model, r, 'H2'), Sex.Male).length, 1);
});

// ---------------------------------------------------------------- relatives

test('siblings: fertile young adult brother and sister are not left together', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), ...females(3, 'H1'),
        youngAdult('Bro', Sex.Male, 'H1', { par: ['Mum', 'Dad'] }),
        youngAdult('Sis', Sex.Female, 'H1', { par: ['Mum', 'Dad'] }),
    ]);
    const end = endPlaces(model, plan(model, HIPPO_INFO, { ratio: 'mixed' }));
    assert.ok(!(end.get('Bro') === 'H1' && end.get('Sis') === 'H1'), 'Bro and Sis both stay in H1');
});

test('siblings: a breeding male is not brought in next to his juvenile half-sister', () => {
    const model = zoo([
        animal('Bro', Sex.Male, TRADE, { par: ['Mum'] }),
        juvenile('Sis', Sex.Female, 'H1', { par: ['Mum'] }),
        ...females(3, 'H1', 'A'),
        ...females(3, 'H2', 'B'),
    ]);
    const end = endPlaces(model, plan(model));
    assert.equal(end.get('Bro'), 'H2', 'Bro should go to H2, where no relative of his lives');
});

test('siblings: a contracepted sister does not stay with her brother', () => {
    const model = zoo([
        animal('Bro', Sex.Male, 'H1', { par: ['Mum'] }),
        animal('Sis', Sex.Female, 'H1', { par: ['Mum'], contra: true }),
        ...females(3, 'H1'),
    ]);
    const end = endPlaces(model, plan(model));
    assert.ok(!(end.get('Bro') === 'H1' && end.get('Sis') === 'H1'), 'Bro and Sis both stay in H1');
});

test('siblings: a relative that has to leave goes to another habitat before the trade centre', () => {
    const model = zoo([
        animal('Bro', Sex.Male, 'H1', { par: ['Mum'] }),
        animal('Sis', Sex.Female, 'H1', { par: ['Mum'], contra: true }),
        ...females(3, 'H1', 'A'),
        animal('Bull2', Sex.Male, 'H2'), ...females(2, 'H2', 'B'),
    ]);
    const end = endPlaces(model, plan(model, HIPPO_INFO, { spareOut: false }));
    assert.equal(end.get('Sis'), 'H2');
});

test('parents: a contracepted adult daughter does not stay with her father', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H1'), ...females(2, 'H1'),
        youngAdult('Daughter', Sex.Female, 'H1', { par: ['Mum', 'Bull'], contra: true }),
    ]);
    const end = endPlaces(model, plan(model, HIPPO_INFO, { spareOut: false }));
    assert.ok(!(end.get('Daughter') === 'H1' && end.get('Bull') === 'H1'), 'Daughter stays with Bull');
});

test('parents: a fertile adult daughter does not stay with her father', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H1'), ...females(2, 'H1'),
        youngAdult('Daughter', Sex.Female, 'H1', { par: ['Mum', 'Bull'] }),
    ]);
    const end = endPlaces(model, plan(model));
    assert.ok(!(end.get('Daughter') === 'H1' && end.get('Bull') === 'H1'), 'Daughter stays with Bull');
});

test('siblings: an adult is not left next to a half-brother who grows up soon', () => {
    const bro = juvenile('Bro', Sex.Male, 'H1', { par: ['Dad', 'Mum2'] });
    bro.adultIn = 0.3;
    const model = zoo([
        animal('Sis', Sex.Female, 'H1', { par: ['Dad', 'Mum1'] }),
        animal('Bull1', Sex.Male, 'H1'), ...females(2, 'H1', 'A'),
        animal('Bull2', Sex.Male, 'H2'), ...females(2, 'H2', 'B'),
        bro,
    ]);
    const end = endPlaces(model, plan(model));
    assert.notEqual(end.get('Sis'), 'H1', 'Sis stays next to Bro, who is about to grow up');
    assert.equal(end.get('Bro'), 'H1', 'the juvenile is never moved');
});

test('young back: a calf follows its mother to the habitat the plan moves her to', () => {
    const model = zoo([
        animal('Son', Sex.Male, 'H1', { par: ['Mum'] }), animal('F1', Sex.Female, 'H1'), animal('F2', Sex.Female, 'H1'),
        animal('Mum', Sex.Female, 'H1', { contra: true }),
        animal('M3', Sex.Male, 'H2'), animal('F3', Sex.Female, 'H2'),
        juvenile('Calf', Sex.Female, TRADE, { par: ['Mum'] }),
    ]);
    const end = endPlaces(model, plan(model));
    assert.notEqual(end.get('Mum'), 'H1', 'Mum stays with her adult son');
    assert.equal(end.get('Calf'), end.get('Mum'));
});

test('young back: without a parent in the zoo a calf goes where no adult relative of the other sex lives', () => {
    const model = zoo([
        animal('Bro', Sex.Male, 'H1', { par: ['Mum'] }), animal('F1', Sex.Female, 'H1'),
        animal('M2', Sex.Male, 'H2'), animal('F2', Sex.Female, 'H2'), animal('F3', Sex.Female, 'H2'),
        juvenile('Sis', Sex.Female, TRADE, { par: ['Mum'] }),
    ]);
    const room = { H1: 2, H2: 1 };
    const moves = youngBackMoves(model, [...model.animals.values()], ['H1', 'H2'], a => a.hab || null, hab => room[hab]);
    assert.deepEqual(moves.map(m => `${m.id}>${m.to}`), ['Sis>H2'], 'Sis goes to the roomier habitat with her half-brother');
});

test('spares: a contracepted father is not rehomed next to a daughter who grows up soon', () => {
    const daughter = juvenile('D', Sex.Female, 'H2', { par: ['X', 'M2'], age: 6.5 });
    daughter.adultIn = 0.5;
    const model = zoo([
        animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1', { contra: true }),
        animal('F1', Sex.Female, 'H1'), animal('F2', Sex.Female, 'H1'),
        daughter,
    ]);
    assert.notEqual(endPlaces(model, plan(model, HIPPO_INFO, { ratio: 'mixed' })).get('M2'), 'H2');
});

test('spares: a contracepted mother leaves her son before he grows up, not after', () => {
    const son = juvenile('Son', Sex.Male, 'H1', { par: ['Mum', 'Bull'], age: 6.7 });
    son.adultIn = 0.3;
    const model = zoo([
        animal('Mum', Sex.Female, 'H1', { contra: true }), animal('Bull', Sex.Male, 'H1'), animal('F2', Sex.Female, 'H1'), animal('F3', Sex.Female, 'H1'),
        son, animal('F9', Sex.Female, 'H2'), animal('M9', Sex.Male, 'H2'),
    ]);
    const move = plan(model, HIPPO_INFO, { ratio: 'mixed' }).moves.find(m => m.id === 'Mum');
    assert.ok(move && move.to !== 'H1', 'Mum stays with her son');
    assert.match(move.reason, /grows up soon/);
});

test('1:1: a habitat keeps one male per female, whatever the game allows per sex', () => {
    const SP = 'Binturong';
    const facts = { [SP]: { maturity: 2, infertility: 15, life: 20, social: { min: 2, max: 10 } } };
    const info = { species: SP, mating: 'mixed', social: { min: 2, max: 10 }, fertilityAges: { maturity: 2, infertility: 15 } };
    const mk = (name, sex, hab) => animal(name, sex, hab, { species: SP, age: 5 });
    const model = zoo([mk('M1', Sex.Male, 'H1'), mk('M2', Sex.Male, 'H1'), mk('M3', Sex.Male, 'H1'), mk('F1', Sex.Female, 'H1')], { facts });
    const r = planProgramme(model, SP, info, null, { options: { ratio: '1:1' } });
    assert.equal(adults(residents(model, r, 'H1'), Sex.Male).length, 1);
});

test('a juvenile crossing into "grows up soon" is a new problem for a kept Deep plan', () => {
    const sis = adultIn => {
        const a = juvenile('Sis', Sex.Female, 'H1', { par: ['Mum'] });
        a.adultIn = adultIn;
        return zoo([animal('Bro', Sex.Male, TRADE, { par: ['Mum'] }), a, ...females(5, 'H1')]);
    };
    const sig = model => programmeProblemSig(model, HIPPO_INFO.species, HIPPO_INFO, null, {});
    assert.equal(sig(sis(3)), sig(sis(2)), 'a juvenile years away changes nothing');
    assert.notEqual(sig(sis(3)), sig(sis(0.5)));
});

// genes at one level 0..6 for every grade (kincore ownGrades)
function genesAt(level) {
    const hetero = 'AAAAAA' + 'a'.repeat(level) + 'A'.repeat(6 - level);
    const good = 'A'.repeat(level * 2) + 'a'.repeat(12 - level * 2);
    return { F: hetero, I: hetero, S: good, L: good };
}

test('young quality: an animal whose best young would score well below the best pair does not breed', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Good1', Sex.Female, 'H1'), animal('Good2', Sex.Female, 'H1'), animal('Poor', Sex.Female, 'H1')]);
    model.animals.get('Bull').genes = genesAt(5);
    model.animals.get('Good1').genes = genesAt(6);
    model.animals.get('Good2').genes = genesAt(5);
    // poor young, not a 0% fertility gene (that one has its own reason)
    model.animals.get('Poor').genes = Object.assign(genesAt(0), { F: genesAt(1).F });
    const r = plan(model);
    const move = r.moves.find(m => m.id === 'Poor');
    assert.ok(move && move.to === TRADE, 'Poor still breeds');
    assert.match(move.reason, /young/);
    assert.ok(r.sellable.some(x => x.id === 'Poor'), 'Poor is not in the sell advice');
});

test('young quality: the only animal of its sex keeps breeding, however poor', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Good', Sex.Female, 'H1'), animal('PoorBull', Sex.Male, 'H2'), animal('Cow', Sex.Female, 'H2')]);
    model.animals.get('Bull').genes = genesAt(6);
    model.animals.get('Good').genes = genesAt(6);
    model.animals.get('PoorBull').genes = genesAt(0);
    model.animals.get('Cow').genes = genesAt(1);
    const r = plan(model);
    assert.ok(!r.moves.some(m => m.to === TRADE && m.id === 'Good'));
    const end = endPlaces(model, r);
    assert.ok(['Bull', 'PoorBull'].some(id => end.get(id) !== TRADE));
});

// -------------------------------------------------------------- unchanged

test('unrelated animals: a full harem stays as it is', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), ...females(5, 'H1')]);
    // equal genes: no young better than another's
    for (const a of model.animals.values()) a.genes = genesAt(4);
    const r = plan(model);
    assert.deepEqual(r.moves, []);
});

test('juveniles stay where they are until they mature', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H1'), ...females(2, 'H1'),
        juvenile('Calf', Sex.Female, 'H1', { par: ['Mum', 'Bull'] }),
    ]);
    const r = plan(model);
    assert.ok(!r.moves.some(m => m.id === 'Calf'));
    assert.ok(!r.moves.some(m => m.id === 'Bull'), 'Bull is moved away from his juvenile daughter');
});

// ---------------------------------------------------------------- leaders

const MEERKAT = 'Meerkat';
const MEERKAT_INFO = { species: MEERKAT, mating: 'mixed', social: { min: 3, max: 20 }, fertilityAges: { maturity: 1, infertility: 12 } };
const MEERKAT_FACTS = { [MEERKAT]: { maturity: 1, infertility: 12, life: 14, social: { min: 3, max: 20 } } };

test('meerkats: several unrelated adults of each sex live together, only the leader female breeds', () => {
    const mk = (name, sex) => animal(name, sex, 'H1', { species: MEERKAT, age: 4 });
    const model = zoo([mk('Q1', Sex.Female), mk('Q2', Sex.Female), mk('Q3', Sex.Female), mk('K1', Sex.Male), mk('K2', Sex.Male)], { facts: MEERKAT_FACTS });
    const r = plan(model, MEERKAT_INFO);
    assert.deepEqual(r.moves, []);
    assert.equal(r.after.breedingFemales, 1, 'only the leader female breeds');
});

test('a large herd is planned within the time budget', () => {
    const list = [];
    for (let h = 1; h <= 4; h++) {
        list.push(animal(`M${h}`, Sex.Male, `H${h}`, { par: [`Dam${h % 2}`] }));
        for (let k = 1; k <= 10; k++) list.push(animal(`F${h}_${k}`, Sex.Female, `H${h}`, { par: [`Dam${k % 3}`, `Sire${h % 2}`] }));
        for (let k = 1; k <= 3; k++) list.push(juvenile(`J${h}_${k}`, k % 2 ? Sex.Male : Sex.Female, `H${h}`, { par: [`F${h}_${k}`, `M${h}`] }));
    }
    const model = zoo(list);
    const t0 = Date.now();
    const r = plan(model);
    assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
    for (let h = 1; h <= 4; h++) assert.ok(adults(residents(model, r, `H${h}`), Sex.Male).length <= 1);
});

test('fertility: an adult the game calls fertile breeds, even below the species\' breeding age', () => {
    // hippos mature at 7; the game already reports this bull of 6 fertile, as the badges do
    const model = zoo([animal('Bull', Sex.Male, 'H1', { age: 6 }), ...females(3, 'H1')]);
    const r = plan(model);
    assert.deepEqual(r.needs, []);
    assert.ok(r.after.breedingPairs > 0, 'the bull is not counted as a breeder');
});

test('deep: a Stop in the last polish is reported as a stop, and Continue finishes the polish', () => {
    const list = [];
    for (let h = 1; h <= 3; h++) {
        list.push(animal(`M${h}`, Sex.Male, `H${h}`, { par: [`Dam${h % 2}`] }));
        for (let k = 1; k <= 6; k++) list.push(animal(`F${h}_${k}`, Sex.Female, `H${h}`, { par: [`Dam${k % 3}`] }));
    }
    const model = zoo(list);
    let started = 0;
    const options = { engine: 'deep', starts: 4, exactLimit: 1, classic: { maxEvaluations: 20000, timeBudgetMs: 60000 }, onStart: s => { started = s.done; }, stop: () => started >= 4 };
    const r = plan(model, HIPPO_INFO, options);
    assert.equal(started, 4, 'the starts did not all run');
    assert.equal(r.stopped, 'stop');
    const again = plan(model, HIPPO_INFO, Object.assign({}, options, { stop: null, resume: r.resume }));
    assert.equal(again.stopped, null);
    assert.ok(again.score >= r.score - 1e-9);
});

// ---------------------------------------------------------------- elderly

test('elderly: an old bull past breeding stays and is reported as blocking the male place', () => {
    const model = zoo([
        animal('OldBull', Sex.Male, 'H1', { age: 42 }), ...females(4, 'H1'),
        animal('Young', Sex.Male, TRADE),
    ]);
    const r = plan(model);
    assert.ok(!r.moves.some(m => m.id === 'OldBull'), 'the old bull is moved');
    assert.ok(!r.moves.some(m => m.id === 'Young' && m.to === 'H1'), 'a second male joins H1');
    assert.deepEqual(r.retiredBlockers, [{ id: 'OldBull', hab: 'H1', sex: Sex.Male }]);
});

// ------------------------------------------------------------------- needs

test('needs: females without a male, and no male anywhere, ask for one', () => {
    const model = zoo([...females(4, 'H1')]);
    assert.deepEqual(plan(model).needs, [{ hab: 'H1', sex: Sex.Male }]);
});

test('needs: a male waiting at the trade centre is brought in instead', () => {
    const model = zoo([...females(4, 'H1'), animal('Bull', Sex.Male, TRADE)]);
    const r = plan(model);
    assert.deepEqual(r.needs, []);
    assert.equal(endPlaces(model, r).get('Bull'), 'H1');
});

// a bull whose calves beat the other bull's with every cow
function twoBulls() {
    const best = { F: 'AAAAAABBBBBB', I: 'AAAAAABBBBBB', S: 'AAAAAAAAAAAA', L: 'AAAAAAAAAAAA' };
    const fair = { F: 'AAAAAABBBBBB', I: 'AAAAAABBBBBB', S: 'AAAAAAAAAaaa', L: 'AAAAAAAAAaaa' };
    const herd = [animal('Best', Sex.Male, 'H1'), animal('Other', Sex.Male, 'H2'), ...females(3, 'H1')];
    herd.forEach((a, i) => { a.genes = i === 0 ? best : fair; });
    return zoo(herd);
}

test('every habitat keeps a breeding pair: the second bull gets one cow, the rest stay with the best bull', () => {
    const model = twoBulls();
    const r = plan(model);
    const end = endPlaces(model, r);
    assert.equal(end.get('Other'), 'H2');
    assert.equal(adults(residents(model, r, 'H2'), Sex.Female).length, 1);
    assert.equal(adults(residents(model, r, 'H1'), Sex.Female).length, 2);
    assert.match(r.moves.find(m => m.to === 'H2').reason, /breeding pair for every habitat/);
    assert.deepEqual(r.needs, []);
});

test('a pair is never split to give another habitat one: one cow stays with her bull', () => {
    const model = zoo([animal('Best', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Other', Sex.Male, 'H2')]);
    const r = plan(model);
    assert.ok(!r.moves.some(m => m.id === 'Cow'));
    assert.deepEqual(r.needs, [{ hab: 'H2', sex: Sex.Female }]);
});

test('a male and a female alone together stay a pair though her calves would score better with the other bull', () => {
    const list = [
        animal('Second', Sex.Male, 'H1'), animal('Mate', Sex.Female, 'H1'),
        animal('Top', Sex.Male, 'H2'), ...females(9, 'H2', 'T'),
    ];
    const lv = { Second: 5, Mate: 4, Top: 6 };
    for (const a of list) a.genes = strands(lv[a.name] ?? 5);
    const model = zoo(list);
    const r = plan(model);
    assert.deepEqual(r.moves, []);
});

test('needs: an empty habitat asks only for the sex no group can spare', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), ...females(3, 'H1')]);
    const both = new Map([['H1', new Set([HIPPO_INFO.species])], ['H2', new Set([HIPPO_INFO.species])]]);
    const r = planProgramme(model, HIPPO_INFO.species, HIPPO_INFO, null, { assignments: both });
    assert.deepEqual(r.needs, [{ hab: 'H2', sex: Sex.Male }]);
});

test('every adult at the trade centre: each habitat set aside for the species gets a pair, a weak bull included', () => {
    const habs = ['H1', 'H2', 'H3', 'H4'];
    const list = [
        ...['M1', 'M2', 'M3'].map(n => animal(n, Sex.Male, TRADE)), animal('Weak', Sex.Male, TRADE),
        ...Array.from({ length: 6 }, (_, i) => animal(`F${i + 1}`, Sex.Female, TRADE)),
    ];
    for (const a of list) a.genes = strands(a.name === 'Weak' ? 1 : 6);
    const model = zoo(list, { habitats: habs });
    assert.ok(weakBreeders(model, list, YOUNG_MARGIN).has('Weak'), 'the bull is weak against the others');
    const assigned = Object.fromEntries(habs.map(h => [h, [HIPPO_INFO.species]]));
    const r = planProgramme(model, HIPPO_INFO.species, HIPPO_INFO, null, { assignments: assigned });
    for (const hab of habs) {
        assert.equal(adults(residents(model, r, hab), Sex.Male).length, 1, `${hab} has one bull`);
        assert.ok(adults(residents(model, r, hab), Sex.Female).length >= 1, `${hab} has a cow`);
    }
});

test('a weak bull still waits while the habitats set aside have a better one each', () => {
    const list = [animal('M1', Sex.Male, TRADE), animal('M2', Sex.Male, TRADE), animal('Weak', Sex.Male, TRADE), ...females(4, TRADE)];
    for (const a of list) a.genes = strands(a.name === 'Weak' ? 1 : 6);
    const model = zoo(list, { habitats: ['H1', 'H2'] });
    const r = planProgramme(model, HIPPO_INFO.species, HIPPO_INFO, null, { assignments: { H1: [HIPPO_INFO.species], H2: [HIPPO_INFO.species] } });
    assert.equal(endPlaces(model, r).get('Weak'), TRADE);
});

test('a bull beside a pregnant cow stays: she can not move, so they are the pair there', () => {
    const model = twoBulls();
    model.animals.get('F3').hab = 'H2';
    model.animals.get('F3').preg = true;
    assert.equal(endPlaces(model, plan(model)).get('Other'), 'H2');
});

test('needs: an elderly bull blocking the male place is reported as blocking, not as a need', () => {
    const model = zoo([animal('OldBull', Sex.Male, 'H1', { age: 42 }), ...females(4, 'H1')]);
    const r = plan(model);
    assert.deepEqual(r.needs, []);
    assert.equal(r.retiredBlockers.length, 1);
});

// ------------------------------------------------------- breeding habitats

test('hippos: an empty second habitat is never filled with males as a bachelor group', () => {
    const model = zoo([
        animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1'), animal('M3', Sex.Male, 'H1'), animal('M4', Sex.Male, 'H1'),
        ...females(6, 'H1'),
    ], { habitats: ['H1', 'H2'] });
    const r = planProgramme(model, HIPPO_INFO.species, HIPPO_INFO, null, { assignments: { H1: [HIPPO_INFO.species], H2: [HIPPO_INFO.species] } });
    for (const hab of ['H1', 'H2']) assert.ok(adults(residents(model, r, hab), Sex.Male).length <= 1, `${hab} has more than one male`);
});

test('hippos: the game\'s limits hold when the species info did not arrive', () => {
    const model = zoo([animal('M1', Sex.Male, 'H1'), animal('M2', Sex.Male, 'H1'), ...females(6, 'H1')]);
    const r = planProgramme(model, HIPPO_INFO.species, {}, null, {});
    assert.equal(adults(residents(model, r, 'H1'), Sex.Male).length, 1);
});

// -------------------------------------------------------------------- sell

// A genome whose own grades are all `good` of 12 good alleles, with fertility and immunity strands differing at `diff` of 6 loci.
function genes(good, diff) {
    const strand = (n, other) => Array.from({ length: 6 }, (_, i) => (i < n ? 'A' : 'a')).join('') + (other || '');
    const sized = strand(Math.ceil(good / 2)) + strand(Math.floor(good / 2));
    const het = 'AAAAAA' + Array.from({ length: 6 }, (_, i) => (i < diff ? 'B' : 'A')).join('');
    return { F: het, I: het, S: sized, L: sized };
}

function withGenes(a, good, diff) {
    return Object.assign(a, { genes: genes(good, diff) });
}

test('sell: a weak female in a habitat full of better ones is worth selling', () => {
    const model = zoo([
        withGenes(animal('Bull', Sex.Male, 'H1'), 12, 6),
        ...females(4, 'H1').map(f => withGenes(f, 11, 5)),
        withGenes(animal('Weak', Sex.Female, 'H1'), 3, 1),
    ]);
    const r = plan(model);
    assert.deepEqual(r.sellable.map(s => s.id), ['Weak']);
});

test('sell: the only female is never listed, however weak', () => {
    const model = zoo([withGenes(animal('Bull', Sex.Male, 'H1'), 12, 6), withGenes(animal('Weak', Sex.Female, 'H1'), 3, 1)]);
    assert.deepEqual(plan(model).sellable, []);
});

test('sell: infertile, elderly and pregnant animals are not listed (the game will not sell them)', () => {
    const model = zoo([
        withGenes(animal('Bull', Sex.Male, 'H1'), 12, 6),
        ...females(3, 'H1').map(f => withGenes(f, 11, 5)),
        withGenes(animal('Old', Sex.Female, 'H1', { age: 42 }), 2, 0),
        withGenes(animal('Sterile', Sex.Female, 'H1', { infertile: true }), 2, 0),
    ]);
    assert.deepEqual(plan(model).sellable, []);
});

test('social groups off: one breeding male per habitat, whatever the game allows', async () => {
    const { HIPPO_FACTS } = await import('./zoo.js');
    const SP = 'Giraffe_Masai';
    const info = { species: SP, mating: 'polygyny', social: { min: 3, max: 12 }, fertilityAges: { maturity: 4, infertility: 32 } };
    const herd = () => zoo([animal('M1', Sex.Male, 'H1', { species: SP }), animal('M2', Sex.Male, 'H1', { species: SP }),
        ...Array.from({ length: 6 }, (_, i) => animal(`F${i + 1}`, Sex.Female, 'H1', { species: SP }))], { facts: { [SP]: HIPPO_FACTS } });
    const withGroups = herd();
    assert.equal(adults(residents(withGroups, plan(withGroups, info), 'H1'), Sex.Male).length, 2, 'the game lets two males share six females');
    const sandbox = herd();
    sandbox.rules = { socialGroups: false, overcrowding: false };
    const r = plan(sandbox, info);
    assert.equal(adults(residents(sandbox, r, 'H1'), Sex.Male).length, 1);
    assert.equal(adults(residents(sandbox, r, 'H1'), Sex.Female).length, 6, 'every female stays with him');
    assert.equal(r.rule.source, 'sandbox');
});

// ------------------------------------------------------------ never solo

function soloWeak() {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), ...females(3, 'H1'),
        animal('Weak', Sex.Female, 'H2'), juvenile('Calf', Sex.Female, 'H2', { par: ['Weak'] }),
    ]);
    for (const a of model.animals.values()) a.genes = strands(a.id === 'Weak' ? 1 : 6);
    return model;
}

// a good adult not breeding yet (not mature), alone in H2
function soloGood() {
    const model = soloWeak();
    const a = model.animals.get('Weak');
    a.genes = strands(6);
    a.fert = { state: 'young' };
    return model;
}

test('an adult whose young would meet the standard, with no partner here, joins a group where it fits', () => {
    const model = soloGood();
    const r = plan(model, HIPPO_INFO, { spareOut: false });
    const move = r.moves.find(m => m.id === 'Weak');
    assert.equal(move && move.to, 'H1');
    assert.match(move.reason, /no partner/);
    assert.ok(!r.moves.some(m => m.id === 'Calf'), 'the calf is never moved');
});

test('a weak adult with no partner stays while spares are kept: no match would give young at the standard', () => {
    const model = soloWeak();
    assert.ok(!plan(model, HIPPO_INFO, { spareOut: false }).moves.some(m => m.id === 'Weak'));
});

test('a weak adult with no partner goes to the trade centre when spares go out', () => {
    const model = soloWeak();
    assert.equal(endPlaces(model, plan(model)).get('Weak'), TRADE);
});

test("a contracepted adult alone stays: not breeding is the player's choice", () => {
    const model = soloGood();
    model.animals.get('Weak').contra = true;
    assert.equal(endPlaces(model, plan(model, HIPPO_INFO, { spareOut: false })).get('Weak'), 'H2');
});

test('an adult with no partner anywhere stays put while spares are kept', () => {
    const model = soloGood();
    model.animals.delete('Bull');
    assert.ok(!plan(model, HIPPO_INFO, { spareOut: false }).moves.some(m => m.id === 'Weak'));
});

test('a 0% fertility gene never breeds: the bull is no partner, sell advice names him, the cows ask for a male', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), ...females(2, 'H1')]);
    for (const a of model.animals.values()) a.genes = strands(a.id === 'Bull' ? 0 : 5);
    const r = plan(model);
    assert.ok(!r.groups.some(g => g.animals.some(a => a.id === 'Bull')), 'the bull is in a breeding group');
    assert.ok(r.sellable.some(x => x.id === 'Bull'));
    assert.deepEqual(r.needs, [{ hab: 'H1', sex: Sex.Male }]);
});
