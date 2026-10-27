import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    calvesToWatch, cleanupRun, finishAutoRun, freshNotices, kinConflicts, locksOf, mergeSellAdvice, movesKeepingKinApart, observeChanges,
    planAutoRun, prepareAutoRun, scheduledDue, speciesToSwitchOn, waitingAtTradeCentre, withoutHabitats,
} from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js';
import { planProgramme } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';
import { normalizeStored } from '../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { HIPPO, HIPPO_FACTS, HIPPO_INFO, Sex, TRADE, animal, endPlaces, juvenile, strands, zoo } from './zoo.js';

test('a juvenile that grows up next to its father is a conflict for its species', () => {
    const family = grown => [
        animal('Bull', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H1'),
        grown ? animal('Calf', Sex.Female, 'H1', { par: ['Mum', 'Bull'], age: 7 }) : juvenile('Calf', Sex.Female, 'H1', { par: ['Mum', 'Bull'] }),
    ];
    assert.equal(kinConflicts(zoo(family(false))).size, 0);
    const after = kinConflicts(zoo(family(true)));
    assert.equal(after.get(HIPPO), 'Bull+Calf');
});

test('relatives of the same sex, or in different habitats, are no conflict', () => {
    const model = zoo([
        animal('Bro1', Sex.Male, 'H1', { par: ['Mum'] }), animal('Bro2', Sex.Male, 'H1', { par: ['Mum'] }),
        animal('Sis', Sex.Female, 'H2', { par: ['Mum'] }),
    ]);
    assert.equal(kinConflicts(model).size, 0);
});

test('a calf is watched while it shares a habitat with a relative of the other sex', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H1'),
        juvenile('Daughter', Sex.Female, 'H1', { par: ['Mum', 'Bull'] }),
        juvenile('Son', Sex.Male, 'H1', { par: ['Mum', 'Bull'] }),
        juvenile('Stranger', Sex.Female, 'H1'),
        juvenile('Away', Sex.Female, 'H2', { par: ['Mum', 'Bull'] }),
    ]);
    assert.deepEqual(calvesToWatch(model).sort(), ['Daughter', 'Son']);
});

test('grown animals and calves with no relative of the other sex nearby are not watched', () => {
    const model = zoo([
        animal('Mum', Sex.Female, 'H1'),
        juvenile('Daughter', Sex.Female, 'H1', { par: ['Mum'] }),
        animal('Grown', Sex.Female, 'H1', { par: ['Mum'], age: 8 }),
    ]);
    assert.deepEqual(calvesToWatch(model), []);
});

test('plan notices: each need, sellable animal and blocker is told once, whatever else changes', () => {
    const told = new Set();
    const first = freshNotices(told, {
        needs: [{ hab: 'H2', sex: Sex.Female }],
        sellable: [{ id: 'Mapalo', score: 48, best: 63 }],
        retiredBlockers: [],
    });
    assert.equal(first.needs.length, 1);
    assert.equal(first.sellable.length, 1);
    const again = freshNotices(told, {
        needs: [{ hab: 'H2', sex: Sex.Female }],
        sellable: [{ id: 'Mapalo', score: 48, best: 63 }, { id: 'Bayode', score: 50, best: 69 }],
        retiredBlockers: [],
    });
    assert.deepEqual(again.needs, []);
    assert.deepEqual(again.sellable.map(x => x.id), ['Bayode']);
    const back = freshNotices(told, { needs: [{ hab: 'H2', sex: Sex.Female }], sellable: [], retiredBlockers: [] });
    assert.equal(back, null);
});

test('a lock from an earlier move never keeps a related pair together', () => {
    const model = zoo([
        animal('Juane', Sex.Female, 'H1'),
        animal('Bayode', Sex.Male, 'H1', { par: ['Juane'], age: 8 }),
        animal('Chibeka', Sex.Female, 'H1'),
        animal('Hands', Sex.Female, 'H1', { par: ['Juane'] }),
    ]);
    const { locked } = locksOf(model, HIPPO, { cooled: ['Juane', 'Bayode', 'Chibeka'], pinned: ['Hands'] });
    assert.ok(!locked.has('Juane') && !locked.has('Bayode'), 'the mother and her adult son stay locked');
    assert.ok(locked.has('Chibeka'), 'an unrelated animal keeps its lock');
    assert.ok(locked.has('Hands'), 'hands off holds even for a relative');
});

test('a lock from an earlier move never keeps an adult with no partner of the other sex in its habitat', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'),
        animal('Solo', Sex.Female, 'H2'), juvenile('Calf', Sex.Male, 'H2'),
        animal('Held', Sex.Female, 'H3'),
    ]);
    const { locked } = locksOf(model, HIPPO, { cooled: ['Cow', 'Solo', 'Bull'], pinned: ['Held'] });
    assert.ok(!locked.has('Solo'), 'a calf is no partner: her lock goes');
    assert.ok(locked.has('Cow') && locked.has('Bull'), 'a pair keeps its locks');
    assert.ok(locked.has('Held'), 'hands off holds even alone');
});

test('a juvenile the player sent to the trade centre still goes back to a habitat', () => {
    const model = zoo([
        animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'),
        juvenile('Kid', Sex.Female, TRADE, { par: ['Mum', 'Dad'] }),
    ]);
    const run = planAutoRun({ model, species: HIPPO, view: { manual: ['Kid'] }, settings: {} });
    assert.deepEqual(run.moves.map(m => [m.id, m.to]), [['Kid', 'H1']]);
});

test('young and new arrivals at the trade centre ask for a run, animals sent there to leave do not', () => {
    const model = zoo([
        animal('Mum', Sex.Female, 'H1'),
        juvenile('Waiting', Sex.Female, TRADE, { par: ['Mum'] }),
        juvenile('Home', Sex.Male, 'H1', { par: ['Mum'] }),
        animal('Arrived', Sex.Male, TRADE),
        animal('Leaving', Sex.Male, TRADE),
    ]);
    assert.deepEqual([...waitingAtTradeCentre(model, new Set(['Leaving']))], [[HIPPO, 'Arrived Waiting']]);
});

test('a species with a habitat set aside gets Auto mode, unless the player decided before', () => {
    const assignments = new Map([['H1', new Set(['Giraffe', 'Zebra', 'Fish'])], ['H2', new Set(['Giraffe', 'Hippo'])]]);
    const ledgerSpecies = { Zebra: { on: false }, Hippo: { on: true } };
    const shoal = sp => sp === 'Fish';
    assert.deepEqual(speciesToSwitchOn(assignments, ledgerSpecies, shoal), ['Giraffe']);
});

test('sell advice keeps what a plan advises, drops what it no longer does, keeps stored entries while storage is unknown', () => {
    const model = zoo([animal('Weak', Sex.Female, TRADE), animal('Fine', Sex.Female, 'H1'), animal('Mended', Sex.Male, 'H1')]);
    const before = new Map([
        ['g_Mended', { g: 'g_Mended', n: 'Mended', s: HIPPO }],
        ['g_Stored', { g: 'g_Stored', n: 'Stored', s: HIPPO }],
        ['g_Other', { g: 'g_Other', n: 'Other', s: 'Zebra' }],
    ]);
    const after = mergeSellAdvice(before, model, HIPPO, [{ id: 'Weak', score: 20, best: 60 }]);
    assert.deepEqual([...after.keys()].sort(), ['g_Other', 'g_Stored', 'g_Weak']);
    const weak = after.get('g_Weak');
    assert.deepEqual([weak.g, weak.n, weak.s, weak.x, weak.sc, weak.b], ['g_Weak', 'Weak', HIPPO, Sex.Female, 20, 60]);
    assert.equal(weak.p.length, 4);
});

function storedHippos(list) {
    return normalizeStored({
        species: HIPPO,
        animals: list.map(x => ({ guid: `s_${x.name}`, name: x.name, sex: x.sex, maturity: 2, forSale: !!x.forSale, par: [], genes: x.genes })),
    });
}

test('sell advice judges stored adults afresh: the weak ones, not the good, the listed or the ones gone', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    for (const a of model.animals.values()) a.genes = strands(6);
    const before = new Map([['s_Gone', { g: 's_Gone', n: 'Gone', s: HIPPO }]]);
    const stored = storedHippos([
        { name: 'Poor', sex: Sex.Female, genes: strands(1) },
        { name: 'Listed', sex: Sex.Female, genes: strands(1), forSale: true },
        { name: 'Good', sex: Sex.Female, genes: strands(6) },
    ]);
    const after = mergeSellAdvice(before, model, HIPPO, [], { stored });
    assert.deepEqual([...after.keys()], ['s_Poor']);
    assert.deepEqual([after.get('s_Poor').n, after.get('s_Poor').x], ['Poor', Sex.Female]);
    assert.deepEqual([...mergeSellAdvice(before, model, HIPPO, []).keys()], ['s_Gone'], 'storage unknown: the stored entries stay');
    assert.deepEqual([...mergeSellAdvice(before, model, HIPPO, [], { stored, wanted: new Set(['s_Poor']) }).keys()], [], 'one the programme would bring in is still needed');
});

test('a stored animal also in the park is judged by the plan there, not again from storage', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Poor', Sex.Female, TRADE)]);
    for (const a of model.animals.values()) a.genes = strands(a.name === 'Poor' ? 1 : 6);
    const stored = storedHippos([{ name: 'Poor', sex: Sex.Female, genes: strands(1) }]);
    assert.deepEqual([...mergeSellAdvice(new Map(), model, HIPPO, [], { stored }).keys()], []);
});

test('sell advice stays within what the Lua side keeps, dropping the oldest first', () => {
    const advised = Array.from({ length: 300 }, (_, i) => animal(`Weak${i}`, i % 2 ? Sex.Male : Sex.Female, TRADE));
    let advice = new Map();
    for (const a of advised) advice = mergeSellAdvice(advice, zoo([a]), HIPPO, [{ id: a.id, score: 40, best: 80 }], { maxChars: 20000 });
    assert.ok(JSON.stringify([...advice.values()]).length <= 20000);
    assert.ok(advice.has(advised[299].guid), 'the newest stays');
    assert.ok(!advice.has(advised[0].guid), 'the oldest goes');
});

// A swap: the sister leaves A for the trade centre, her brother comes from C.
function swap() {
    const model = zoo([
        animal('Sis', Sex.Female, 'A', { par: ['Mum', 'Dad'] }),
        animal('Bro', Sex.Male, 'C', { par: ['Mum', 'Dad'] }),
        animal('Fx', Sex.Female, 'A'), animal('Mx', Sex.Male, 'B'), animal('Fy', Sex.Female, 'C'),
    ]);
    const input = { model, species: HIPPO, info: HIPPO_INFO, settings: { thin: false } };
    return { input, programme: { moves: [{ id: 'Sis', to: TRADE }, { id: 'Bro', to: 'A' }] } };
}

test('a run that cannot take a sister away does not bring her brother in', () => {
    for (const extra of [{ view: { blocked: [`Sis>${TRADE}`] } }, { tradeFree: 0 }]) {
        const { input, programme } = swap();
        Object.assign(input, extra);
        const run = finishAutoRun(input, prepareAutoRun(input), programme);
        assert.deepEqual(run.moves, []);
        assert.ok(run.held.some(h => h.id === 'Bro'), 'the brother is not told as held');
    }
    const { input, programme } = swap();
    assert.deepEqual(finishAutoRun(input, prepareAutoRun(input), programme).moves.map(m => m.id), ['Sis', 'Bro']);
});

test('what is left of a run never puts relatives together', () => {
    const { input } = swap();
    const left = movesKeepingKinApart(input.model, [{ id: 'Bro', to: 'A' }, { id: 'Mx', to: 'C' }]);
    assert.deepEqual(left.moves, [{ id: 'Mx', to: 'C' }]);
    assert.deepEqual(left.dropped.map(m => m.id), ['Bro']);
});

test('the last breeding male still goes when he would stay with his daughters', () => {
    const model = zoo([
        animal('Dad', Sex.Male, 'H1'),
        animal('D1', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 9 }),
        animal('D2', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 9 }),
    ]);
    const input = { model, species: HIPPO, info: HIPPO_INFO, settings: { thin: false } };
    const run = finishAutoRun(input, prepareAutoRun(input), { moves: [{ id: 'Dad', to: TRADE }] });
    assert.deepEqual(run.moves.map(m => `${m.id}>${m.to}`), [`Dad>${TRADE}`]);
});

test('the last breeding male stays when no relative of his lives there', () => {
    const model = zoo([animal('Dad', Sex.Male, 'H1'), animal('F1', Sex.Female, 'H1')]);
    const input = { model, species: HIPPO, info: HIPPO_INFO, settings: { thin: false } };
    const run = finishAutoRun(input, prepareAutoRun(input), { moves: [{ id: 'Dad', to: TRADE }] });
    assert.deepEqual(run.moves, []);
    assert.deepEqual(run.held, [{ id: 'Dad', why: 'the last breeder of its sex stays' }]);
});

// Small zoos with families, juveniles everywhere (in crowded habitats, next
// to relatives, at the trade centre, with 0% fertility genes) and adults
// that do not breed.
function familyZoo(seed) {
    let x = seed * 7919;
    const pick = n => {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        return (x >>> 16) % n;
    };
    const habs = ['H1', 'H2', 'H3'];
    const list = [];
    for (let i = 0; i < 6; i++) {
        list.push(animal(`A${i}`, i % 2 ? Sex.Female : Sex.Male, habs[pick(3)], { par: pick(2) ? [`Mum${pick(2)}`] : [], contra: pick(5) === 0, age: pick(4) ? 12 : 42 }));
    }
    for (let i = 0; i < 6; i++) {
        const calf = juvenile(`J${i}`, pick(2) ? Sex.Female : Sex.Male, pick(4) ? habs[pick(3)] : TRADE, { par: [`A${1 + 2 * pick(3)}`, `A${2 * pick(3)}`] });
        if (pick(2)) calf.genes = { F: 'AAAAAAAAAAAA', I: 'AAAAAAAAAAAA', S: 'aaaaaaaaaaaa', L: 'aaaaaaaaaaaa' };
        list.push(calf);
    }
    return zoo(list, { habitats: habs, facts: { [HIPPO]: Object.assign({}, HIPPO_FACTS, { social: { min: 1, max: 4 } }) } });
}

test('no plan ever sends a juvenile to the trade centre', () => {
    const info = Object.assign({}, HIPPO_INFO, { social: { min: 1, max: 4 } });
    const assignments = new Map(['H1', 'H2', 'H3'].map(h => [h, new Set([HIPPO])]));
    const juvenileToTrade = (model, moves) => moves.filter(m => m.to === TRADE && model.animals.get(String(m.id)).juv).map(m => m.id);
    for (let seed = 1; seed <= 25; seed++) {
        const model = familyZoo(seed);
        for (const options of [{}, { spareOut: false }, { youngBack: false }, { ratio: '1:1' }, { ratio: 'mixed', useTradeCentre: false }]) {
            const r = planProgramme(model, HIPPO, info, null, { assignments, options });
            assert.deepEqual(juvenileToTrade(model, r.moves), [], `programme, zoo ${seed}, ${JSON.stringify(options)}`);
        }
        for (const settings of [{ thin: true, fill: 'core' }, { thin: true, fill: 'balanced' }, { thin: false }]) {
            const run = planAutoRun({ model, species: HIPPO, info, assignments, settings });
            assert.deepEqual(juvenileToTrade(model, run.moves), [], `Auto mode, zoo ${seed}, ${JSON.stringify(settings)}`);
        }
    }
});

test('a move Auto mode made is not taken for the player\'s, however long its quarantine lasts', () => {
    const at = (hab, lt, moving = false) => ({ animals: new Map([['7', { id: '7', hab, lt, moving }]]) });
    const expected = new Map([['7', { to: TRADE }]]);
    let { seen } = observeChanges({}, at('H1', 'habitat'), expected);
    ({ seen } = observeChanges(seen, at('H1', 'transit', true), expected));
    ({ seen } = observeChanges(seen, at('H1', 'quarantine'), expected));
    // the expected entry ran out while it waited in quarantine
    expected.clear();
    ({ seen } = observeChanges(seen, at('H1', 'quarantine'), expected));
    ({ seen } = observeChanges(seen, at('', 'transit', true), expected));
    assert.deepEqual(observeChanges(seen, at('', 'trade'), expected).moved, []);
    assert.deepEqual(observeChanges(seen, at('H2', 'habitat'), expected).moved, ['7'], 'a move elsewhere is the player\'s');
});

test('an animal stuck on its way out still counts in the habitat it is stuck in', () => {
    const model = zoo([
        animal('Mum', Sex.Female, 'H1'),
        animal('Son', Sex.Male, 'H1', { par: ['Mum'], age: 8 }),
    ]);
    model.animals.get('Mum').moving = true;
    assert.equal(kinConflicts(model).size, 0, 'a move just started: not a pair yet');
    assert.equal(kinConflicts(model, new Set(['Mum'])).get(HIPPO), 'Mum+Son');
});

// the owner's golden rule: a pregnant or young animal never waits at the trade centre
const pregnant = (name, hab, opts = {}) => Object.assign(animal(name, Sex.Female, hab, opts), { preg: true });

test('a pregnant female at the trade centre goes into a habitat, whatever locks or leaving mark she has', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), pregnant('Due', TRADE)]);
    const view = { pinned: ['Due'], manual: ['Due'], leaving: ['Due'] };
    const run = planAutoRun({ model, species: HIPPO, view, settings: {} });
    assert.deepEqual(run.moves.filter(m => m.id === 'Due').map(m => m.to), ['H1']);
});

test('a pregnant female never goes in beside a relative of the other sex', () => {
    const model = zoo([
        animal('Dad', Sex.Male, 'H1'), animal('Bull', Sex.Male, 'H2'),
        pregnant('Due', TRADE, { par: ['Dad'] }),
    ]);
    const run = planAutoRun({ model, species: HIPPO, settings: {} });
    assert.deepEqual(run.moves.filter(m => m.id === 'Due').map(m => m.to), ['H2']);
});

test('a pregnant female with only relatives in every habitat waits rather than breed with them', () => {
    const model = zoo([animal('Dad', Sex.Male, 'H1'), pregnant('Due', TRADE, { par: ['Dad'] })]);
    const run = planAutoRun({ model, species: HIPPO, settings: {} });
    assert.deepEqual(run.moves.filter(m => m.id === 'Due'), []);
});

test('a young one at the trade centre follows its pregnant mother into her habitat', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Other', Sex.Male, 'H2'),
        pregnant('Mum', TRADE, { par: ['Other'] }), juvenile('Kid', Sex.Male, TRADE, { par: ['Mum'] }),
    ]);
    const run = planAutoRun({ model, species: HIPPO, settings: {} });
    const to = id => run.moves.find(m => m.id === id)?.to;
    assert.equal(to('Mum'), 'H1');
    assert.equal(to('Kid'), 'H1');
});

test("the player's own move holds nothing against Auto mode's plan; hands off does", () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Kept', Sex.Female, 'H1')]);
    const { locked } = locksOf(model, HIPPO, { manual: ['Bull', 'Cow'], pinned: ['Kept'] });
    assert.ok(!locked.has('Bull') && !locked.has('Cow'));
    assert.ok(locked.has('Kept'));
});

test('the best male or a good female the player sends to the trade centre by mistake comes back', () => {
    const model = zoo([
        animal('Best', Sex.Male, TRADE), animal('Stand', Sex.Male, 'H1'),
        animal('Good', Sex.Female, TRADE), animal('Cow', Sex.Female, 'H1'),
    ], { habitats: ['H1'] });
    model.animals.get('Best').genes = strands(6);
    model.animals.get('Stand').genes = strands(2);
    model.animals.get('Good').genes = strands(6);
    model.animals.get('Cow').genes = strands(5);
    const run = planAutoRun({ model, species: HIPPO, view: { manual: ['Best', 'Good'] }, settings: {}, assignments: new Map([['H1', new Set([HIPPO])]]) });
    const to = id => run.moves.find(m => m.id === id)?.to;
    assert.equal(to('Best'), 'H1');
    assert.equal(to('Good'), 'H1');
    assert.equal(to('Stand'), TRADE);
});

// Clean up: the zoo emptied for selling
const cleanMoves = run => run.moves.map(m => [m.id, m.to]);

test('clean up sends the adults to the trade centre, the males first, to leave', () => {
    const model = zoo([animal('Cow', Sex.Female, 'H1'), animal('Bull', Sex.Male, 'H1'), animal('Cow2', Sex.Female, 'H2')]);
    const run = cleanupRun({ model, species: HIPPO });
    assert.deepEqual(cleanMoves(run), [['Bull', TRADE], ['Cow', TRADE], ['Cow2', TRADE]]);
    assert.ok(run.moves.every(m => m.leave));
    assert.equal(run.clean.done, false);
});

test('clean up waits for a birth and for the young to grow up, then takes them too', () => {
    const due = Object.assign(animal('Due', Sex.Female, 'H1'), { preg: true });
    let run = cleanupRun({ model: zoo([due, juvenile('Calf', Sex.Male, 'H1', { par: ['Due'] })]), species: HIPPO });
    assert.deepEqual(cleanMoves(run), []);
    assert.deepEqual([run.clean.pregnant, run.clean.young, run.clean.done], [1, 1, false]);
    run = cleanupRun({ model: zoo([animal('Due', Sex.Female, 'H1'), juvenile('Calf', Sex.Male, 'H1', { par: ['Due'] })]), species: HIPPO });
    assert.deepEqual(cleanMoves(run), [['Due', TRADE]], 'the mother goes right after the birth');
    run = cleanupRun({ model: zoo([animal('Due', Sex.Female, TRADE), animal('Calf', Sex.Male, 'H1', { par: ['Due'], age: 6 })], { habitats: ['H1'] }), species: HIPPO });
    assert.deepEqual(cleanMoves(run), [['Calf', TRADE]], 'the young one once grown');
    run = cleanupRun({ model: zoo([animal('Due', Sex.Female, TRADE), animal('Calf', Sex.Male, TRADE)], { habitats: ['H1'] }), species: HIPPO });
    assert.equal(run.clean.done, true);
});

test('clean up leaves an adult past selling in its habitat to age out, and houses one waiting at the trade centre', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Old', Sex.Female, 'H1', { age: 38 }), animal('Older', Sex.Female, TRADE, { age: 38.5 })]);
    const run = cleanupRun({ model, species: HIPPO, view: {} });
    assert.ok(!run.moves.some(m => m.id === 'Old'), 'she stays where she is');
    assert.ok(run.clean.elderly.includes('Old'));
    const back = run.moves.find(m => m.id === 'Older');
    assert.ok(back && back.to === 'H1', 'the one at the trade centre goes into a habitat');
});

test('clean up leaves elderly and hands-off animals and names them; done with only them left', () => {
    const old = Object.assign(animal('Gran', Sex.Female, 'H1', { age: 40 }), { fert: { state: 'old' } });
    const model = zoo([old, animal('Kept', Sex.Male, 'H1')]);
    model.animals.get('Gran').fert = { state: 'old' };
    const run = cleanupRun({ model, species: HIPPO, view: { pinned: ['Kept'] } });
    assert.deepEqual(cleanMoves(run), []);
    assert.deepEqual([run.clean.elderly, run.clean.kept, run.clean.done], [['Gran'], ['Kept'], true]);
});

test('clean up takes a pregnant or young animal waiting at the trade centre into a habitat first', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), Object.assign(animal('Due', Sex.Female, TRADE), { preg: true })]);
    const run = cleanupRun({ model, species: HIPPO, view: { leaving: ['Due'], pinned: ['Due'] } });
    assert.deepEqual(cleanMoves(run), [['Due', 'H1'], ['Bull', TRADE]]);
    assert.equal(run.clean.done, false);
});

test('clean up of chosen habitats empties only them: the rest of the species is left to Auto mode', () => {
    const model = zoo([
        animal('Cow', Sex.Female, 'H1'), animal('Bull', Sex.Male, 'H1'), animal('Cow2', Sex.Female, 'H2'), animal('Bull2', Sex.Male, 'H2'),
        Object.assign(animal('Due', Sex.Female, TRADE), { preg: true }),
    ]);
    const run = cleanupRun({ model, species: HIPPO, habs: new Set(['H1']) });
    assert.deepEqual(cleanMoves(run), [['Bull', TRADE], ['Cow', TRADE]], 'the male first, and nothing of H2 or the trade centre');
    const done = cleanupRun({ model: zoo([animal('Cow', Sex.Female, TRADE), animal('Bull2', Sex.Male, 'H2')], { habitats: ['H1'] }), species: HIPPO, habs: new Set(['H1']) });
    assert.equal(done.clean.done, true, 'done once H1 is empty, whatever lives elsewhere');
});

test('a breeding plan beside a habitat Clean up neither sees those animals nor goes into those habitats', () => {
    const model = zoo([animal('Cow', Sex.Female, 'H1'), animal('Bull', Sex.Male, 'H1'), animal('Cow2', Sex.Female, 'H2')]);
    const dest = { bySpecies: { [HIPPO]: { H1: { ok: true }, H2: { ok: true } } } };
    const assigned = new Map([['H1', new Set([HIPPO])], ['H2', new Set([HIPPO])]]);
    const out = withoutHabitats(model, dest, assigned, new Set(['H1']));
    assert.deepEqual(Array.from(out.model.animals.keys()), ['Cow2']);
    assert.equal(out.destinations.bySpecies[HIPPO].H1.ok, false);
    assert.equal(out.destinations.bySpecies[HIPPO].H2.ok, true);
    assert.deepEqual(Array.from(out.assignments.keys()), ['H2']);
    assert.equal(dest.bySpecies[HIPPO].H1.ok, true, 'the destinations given stay as they are');
    // two unrelated pairs in H2 and an empty H1 set aside: a plan fills H1, unless Clean up empties it
    const herd = zoo(['Cow2', 'Bull2', 'Cow3', 'Bull3'].map((n, i) => animal(n, n.startsWith('Cow') ? Sex.Female : Sex.Male, 'H2', { par: [`P${i}`, `Q${i}`] })), { habitats: ['H1', 'H2'] });
    const plan = o => planAutoRun({ model: o.model, species: HIPPO, info: HIPPO_INFO, destinations: o.destinations, assignments: o.assignments, settings: { thin: false }, view: {} });
    assert.ok(plan({ model: herd, destinations: dest, assignments: assigned }).moves.some(m => m.to === 'H1'));
    assert.ok(!plan(withoutHabitats(herd, dest, assigned, new Set(['H1']))).moves.some(m => m.to === 'H1'));
});

test('clean up waits when the trade centre is full', () => {
    const run = cleanupRun({ model: zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]), species: HIPPO, tradeFree: 1 });
    assert.deepEqual(cleanMoves(run), [['Bull', TRADE]]);
    assert.ok(run.held.some(x => x.why === 'the trade centre is full'));
});

test('a related pair whose planned mover is held back gets the other of the pair moved instead', () => {
    // a brother and sister grown up together; the sister's move to the trade centre was refused lately
    const model = zoo([
        animal('Bull', Sex.Male, 'H2'), animal('Cow', Sex.Female, 'H2'),
        animal('Brother', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }), animal('Sister', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
    ]);
    const blockedAll = ['Sister>H2', 'Sister>' + TRADE, 'Sister>H1'];
    const run = planAutoRun({ model, species: HIPPO, view: { blocked: blockedAll }, settings: {} });
    const moved = run.moves.map(m => m.id);
    assert.ok(moved.includes('Brother'), `the brother moves when the sister can't (moves: ${moved.join(', ')})`);
    assert.ok(!moved.includes('Sister'));
});

test('a breeder four years from elderly goes to the trade centre to be sold, past its cooldown; hands off or a pregnancy keeps one', async () => {
    const { withAgeingAdvice } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    // hippos turn elderly at 40 (speciesrules.js)
    const old = (name, sex, opts = {}) => animal(name, sex, 'H1', Object.assign({ age: 36.5 }, opts));
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1'),
        old('Greying', Sex.Female), old('Kept', Sex.Female), Object.assign(old('Due', Sex.Female), { preg: true }),
    ]);
    const view = { pinned: ['Kept'], cooled: ['Greying'] };
    const run = planAutoRun({ model, species: HIPPO, view, settings: {} });
    const out = run.moves.filter(m => m.stage === 'ageing');
    assert.deepEqual(out.map(m => [m.id, m.to, m.leave]), [['Greying', TRADE, true]]);
    const advised = withAgeingAdvice({ sellable: [], keep: [{ id: 'Greying' }] }, model, HIPPO);
    assert.deepEqual(advised.sellable.filter(x => x.reason === 'elderly').map(x => x.id).sort(), ['Greying', 'Kept'], 'sell advice for each one near elderly, not pregnant');
    assert.deepEqual(advised.keep, [], 'never keep advice for one about to turn');
});

test('with Bring waiting animals into a habitat off, a pregnant female waits at the trade centre; a young one still goes back', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), Object.assign(animal('Mum', Sex.Female, TRADE), { preg: true }),
        juvenile('Calf', Sex.Female, TRADE, { par: ['Bull', 'Cow'] })]);
    const on = planAutoRun({ model, species: HIPPO, view: {}, settings: {} });
    assert.ok(on.moves.some(m => m.id === 'Mum' && m.to !== TRADE), 'on: she goes to a habitat');
    const off = planAutoRun({ model, species: HIPPO, view: {}, settings: {}, houseWaiting: false });
    assert.ok(!off.moves.some(m => m.id === 'Mum'), 'off: she waits');
    assert.ok(off.moves.some(m => m.id === 'Calf' && m.to !== TRADE), `off: the young one goes back: ${JSON.stringify(off.moves)}`);
});

test('with Breeders to storage before elderly off, a hippo four years from elderly keeps breeding with no sell advice', async () => {
    const { withAgeingAdvice } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Greying', Sex.Female, 'H1', { age: 36.5 })]);
    const on = planAutoRun({ model, species: HIPPO, view: {}, settings: {} });
    assert.ok(on.moves.some(m => m.id === 'Greying' && m.to === TRADE), 'on: she goes to be sold');
    const off = planAutoRun({ model, species: HIPPO, view: {}, settings: {}, earlySale: false });
    assert.ok(!off.moves.some(m => m.id === 'Greying'), 'off: she stays');
    assert.deepEqual(withAgeingAdvice({ sellable: [] }, model, HIPPO, false).sellable, []);
});

test('a short-lived species is not sold early: a springbok two years from elderly keeps breeding', async () => {
    const { sellsBeforeElderly } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinageing.js');
    const SPRINGBOK = 'Antelope_Springbok';
    assert.equal(sellsBeforeElderly(SPRINGBOK), false, 'springbok turn elderly at 6');
    assert.equal(sellsBeforeElderly(HIPPO), true);
    const model = zoo([
        animal('Ram', Sex.Male, 'H1', { species: SPRINGBOK, age: 3 }), animal('Ewe', Sex.Female, 'H1', { species: SPRINGBOK, age: 4.5 }),
        animal('Ewe2', Sex.Female, 'H1', { species: SPRINGBOK, age: 3 }),
    ]);
    const run = planAutoRun({ model, species: SPRINGBOK, view: {}, settings: {} });
    assert.ok(!run.moves.some(m => m.id === 'Ewe' && m.to === TRADE), 'she breeds to the end');
});

test('past selling, within three years of elderly, an animal stays in its habitat to live out its life, unless a relative of the other sex lives there', () => {
    const model = zoo([
        animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1'),
        animal('Old', Sex.Female, 'H1', { age: 39.5 }),
    ]);
    const run = planAutoRun({ model, species: HIPPO, view: {}, settings: {} });
    assert.ok(!run.moves.some(m => m.id === 'Old' && m.to === TRADE), 'never sent where it can not be sold');
    assert.ok(run.held.some(h => h.id === 'Old' && /lives out its life/.test(h.why)));
    const kin = zoo([
        animal('Bull', Sex.Male, 'H1', { age: 39.5 }), animal('Mum', Sex.Female, 'H2'), animal('Dad', Sex.Male, 'H2'),
        animal('Daughter', Sex.Female, 'H1', { par: ['Mum', 'Bull'] }),
    ]);
    const apart = planAutoRun({ model: kin, species: HIPPO, view: { pinned: ['Daughter'] }, settings: {} });
    const end = endPlaces(kin, apart);
    assert.notEqual(end.get('Bull'), end.get('Daughter'), 'never inbreed: the old father still leaves his daughter');
});

test('one past selling at the trade centre goes into a habitat to live out its life, past its lock', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Bull2', Sex.Male, 'H2'), animal('Old', Sex.Female, TRADE, { age: 39.5 })]);
    const run = planAutoRun({ model, species: HIPPO, info: HIPPO_INFO, view: { cooled: ['Old'], leaving: ['Old'] }, settings: {} });
    const move = run.moves.find(m => m.id === 'Old');
    assert.ok(move && move.to !== TRADE, 'housed though Auto mode sent it to leave');
    assert.match(move.reason, /live out its life/);
});

test('a nearly elderly breeder at the trade centre stays there, even with a habitat short of its sex, while another of its sex breeds', () => {
    const model = zoo([animal('Cow', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1'), animal('Bull2', Sex.Male, 'H2'), animal('Cow3', Sex.Female, 'H2'), animal('Greybull', Sex.Male, TRADE, { age: 36.5 })]);
    const run = planAutoRun({ model, species: HIPPO, view: {}, settings: {} });
    assert.ok(!run.moves.some(m => m.id === 'Greybull'), 'never brought back into a group');
});

test('a nearly elderly female back from the trade centre to give birth leaves again without counting as back and forth', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Greying', Sex.Female, 'H1', { age: 36.5 })]);
    const run = planAutoRun({ model, species: HIPPO, view: { cooled: ['Greying'], recentFrom: { Greying: [TRADE] } }, settings: {} });
    const out = run.moves.find(m => m.id === 'Greying');
    assert.equal(out && out.to, TRADE);
    assert.equal(out.reversal, false);
});

test('a breeder last seen at the trade centre near elderly is never suggested from storage, and gets sell advice there', async () => {
    const { ageingInStorage, withoutAgeing } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const { emptyLedger, noteTradeAges } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautoledger.js');
    const old = animal('Greybull', Sex.Male, TRADE, { age: 39.5 });
    const young = animal('Youngbull', Sex.Male, TRADE, { age: 20 });
    const model = zoo([animal('Cow', Sex.Female, 'H1'), old, young]);
    const l = emptyLedger();
    assert.equal(noteTradeAges(l, model, new Set([HIPPO]), 3), true);
    // the zoo reloads: both are storage records, with no age of their own
    const stored = normalizeStored({
        species: HIPPO,
        animals: [old, young].map(a => ({ guid: `s_${a.name}`, name: a.name, sex: a.sex, maturity: 2, par: [], genes: a.genes })),
    });
    const park = zoo([animal('Cow', Sex.Female, 'H1')]);
    assert.deepEqual(stored.animals.map(s => ageingInStorage(s, l.ages)), [true, false]);
    assert.deepEqual(withoutAgeing(stored, l.ages).animals.map(s => s.name), ['Youngbull']);
    const advice = mergeSellAdvice(new Map(), park, HIPPO, [], { stored, ages: l.ages });
    assert.equal(advice.get('s_Greybull').r, 'elderly');
    // back in a habitat, the remembered age goes
    noteTradeAges(l, zoo([animal('Greybull', Sex.Male, 'H1', { age: 39.5 })]), new Set([HIPPO]), 4);
    assert.equal(Object.keys(l.ages).length, 1);
});

test('a stored animal the Storage window shows near elderly is never suggested, whatever Auto mode remembers', async () => {
    const { ageingInStorage, genePercents } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinautocore.js');
    const { storedAgeEntries } = await import('../../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinageing.js');
    const old = animal('Rahma', Sex.Female, TRADE, { age: 39.5 });
    const stored = normalizeStored({ species: HIPPO, animals: [{ guid: 's_Rahma', name: 'Rahma', sex: Sex.Female, maturity: 2, par: [], genes: old.genes }] });
    const [F, I, S, L] = genePercents(old);
    const row = { species: `[Animal_${HIPPO}]`, gender: Sex.Female, name: 'Rahma', age: 39.6, genes: { fertility: F + 1, immunity: I, size: S, longevity: L - 1 } };
    const rowAges = storedAgeEntries([row, Object.assign({}, row, { name: 'Other', age: 5 })]);
    assert.equal(rowAges.length, 2);
    assert.equal(ageingInStorage(stored.animals[0], {}, rowAges), true);
    assert.equal(ageingInStorage(stored.animals[0], {}, [Object.assign({}, rowAges[0], { a: 20 })]), false);
});

test('clean up asks no second time for an animal already on its way to the trade centre', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')]);
    const run = cleanupRun({ model, species: HIPPO, view: { leaving: ['Bull'] } });
    assert.deepEqual(run.moves.map(m => m.id), ['Cow']);
});

test('the species\' last female, a year from elderly, stays and a lone male joins her for her last fertile year', () => {
    const model = zoo([animal('Bull', Sex.Male, 'H2', { age: 24 }), animal('Greying', Sex.Female, 'H1', { age: 39 })]);
    const run = planAutoRun({ model, species: HIPPO, info: HIPPO_INFO, view: {}, settings: {} });
    assert.ok(!run.moves.some(m => m.id === 'Greying' && m.to === TRADE), 'not sent away');
    assert.ok(run.moves.some(m => m.id === 'Greying' || m.id === 'Bull'), 'the two are put together');
});

test('a breeder at the trade centre within the early sale window stays there, unless it is the only one of its sex', () => {
    const plan = animals => planAutoRun({ model: zoo(animals), species: HIPPO, info: HIPPO_INFO, view: {}, settings: {} });
    const late = () => animal('Late', Sex.Female, TRADE, { age: 36.5 });
    const withCow = plan([animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Bull2', Sex.Male, 'H2'), late()]);
    assert.ok(!withCow.moves.some(m => m.id === 'Late'), 'another female breeds: Late would leave again within the cooldown');
    const alone = plan([animal('Bull', Sex.Male, 'H1'), late()]);
    assert.ok(alone.moves.some(m => m.id === 'Late' && m.to === 'H1'), 'the only female: her last fertile year is worth it');
});

test('a scheduled run waits for its month and for a real minute since the last, whatever the game speed', () => {
    const now = 1_000_000;
    assert.equal(scheduledDue({ next: 12 }, 11, now), false, 'its month has not come');
    assert.equal(scheduledDue({ next: 12 }, 12, now), true, 'never run: due');
    assert.equal(scheduledDue({ next: 12, last: { real: now - 20000 } }, 30, now), false, 'at 20x the months fly; a minute has not passed');
    assert.equal(scheduledDue({ next: 12, last: { real: now - 61000 } }, 30, now), true);
});
