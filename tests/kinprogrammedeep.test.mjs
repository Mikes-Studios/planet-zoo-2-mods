// node --test tests/kinprogrammedeep.test.mjs
// The breeding programme's deep engine (kinprogramme.js solveDeep).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { buildKinModel, Sex } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kincore.js';
import { TRADE } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinboardcore.js';
import { planProgramme, planProgrammeAsync, programmeProblemSig, scoreLayout } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/kinprogramme.js';

// the job manager imports the game UI's '/js/...' paths
register('./gameface-loader.mjs', import.meta.url);
const { cancelDeep, deepJob, deepResult, onDeep, startDeep, stopDeep, _resetDeepForTests } = await import('/js/mods/pz2qol/kinprogdeep.js');

const M = Sex.Male, F = Sex.Female;

// The default run uses smaller zoos and fewer seeds (~30 s); PZ2_LONG_TESTS=1
// runs the full sweep and the 40-animal benchmark zoos (~90 s). Same asserts.
const LONG = process.env.PZ2_LONG_TESTS === '1';

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

// A random zoo with families (young inherit one strand per stat from each
// parent), bonds and the trade centre: the generator of the 2026-10-18
// exact-solver benchmark (docs/RESEARCH-breeding-optimisation.md), so the
// regression zoos below are the benchmark's own.
const STATS = ['F', 'I', 'S', 'L'];
function makeZoo(n, makeup, seed) {
    const r = rng(seed * 7919 + n * 31 + makeup.length);
    const strand = () => Array.from({ length: 6 }, () => 'ABCDEFGH'[Math.floor(r() * 8)]).join('');
    const H = Math.max(3, Math.min(12, Math.round(n / 8)));
    const habs = Array.from({ length: H + 1 }, (_, i) => String(i + 1));
    const used = habs.slice(0, H);
    const pool = [];
    const nf = Math.max(4, Math.round(n * 0.45));
    for (let i = 0; i < nf; i++) {
        const g = {};
        for (const s of STATS) g[s] = [strand(), strand()];
        pool.push({ id: 'a' + i, sex: r() < 0.5 ? M : F, par: [], g });
    }
    let k = nf;
    while (pool.length < n) {
        const ms = pool.filter(a => a.sex === M), fs = pool.filter(a => a.sex === F);
        if (!ms.length || !fs.length) {
            pool.push({ id: 'a' + k++, sex: ms.length ? F : M, par: [], g: Object.fromEntries(STATS.map(s => [s, [strand(), strand()]])) });
            continue;
        }
        const m = ms[Math.floor(r() * ms.length)], f = fs[Math.floor(r() * fs.length)];
        const litter = 1 + Math.floor(r() * 3);
        for (let t = 0; t < litter && pool.length < n; t++) {
            const g = {};
            for (const s of STATS) g[s] = [m.g[s][Math.floor(r() * 2)], f.g[s][Math.floor(r() * 2)]];
            pool.push({ id: 'a' + k++, sex: r() < 0.5 ? M : F, par: [m.id, f.id], g });
        }
    }
    const animals = pool.map(p => {
        const trade = r() < 0.1;
        const hab = trade ? '' : used[Math.floor(r() * used.length)];
        return {
            id: p.id, key: 'animal_' + p.id, guid: 'g' + p.id, name: p.id, species: 'Lion', sex: p.sex, juv: false, contra: false, infertile: false,
            hab, loc: hab ? 'H' + hab : '', lt: trade ? 'trade' : 'habitat', par: p.par.map(x => 'g' + x), mates: [],
            genes: Object.fromEntries(STATS.map(s => [s, p.g[s][0] + p.g[s][1]])),
            fert: { state: 'fertile', yearsLeft: 1 + Math.floor(r() * 12) },
        };
    });
    const nb = Math.round(n * 0.08);
    for (let i = 0; i < nb; i++) {
        const hab = used[Math.floor(r() * used.length)];
        animals.push({ id: 'x' + i, key: 'animal_x' + i, guid: 'gx' + i, name: 'x' + i, species: 'Lion', sex: r() < 0.5 ? M : F, juv: false, contra: true, infertile: false, hab, loc: 'H' + hab, lt: 'habitat', par: [], mates: [], genes: Object.fromEntries(STATS.map(s => [s, strand() + strand()])) });
    }
    for (const a of animals) {
        if (a.contra || a.mates.length || !a.hab || r() > 0.25) continue;
        const b = animals.find(x => x !== a && !x.contra && x.hab === a.hab && x.sex !== a.sex && !x.mates.length);
        if (b) {
            a.mates = [b.id];
            b.mates = [a.id];
        }
    }
    const snapshot = { v: 1, seq: 1, scope: 'park', mode: 'offline', habitats: habs.map(h => ({ id: h, name: 'H' + h })), animals, anc: {} };
    const socialMax = 4 + Math.floor(r() * 9);
    const habitats = {};
    for (const h of habs) habitats[h] = { available: { nLandArea: Math.round(200 + r() * 1400) } };
    const mating = makeup === 'monogamy' ? 'monogamy' : makeup === 'mixed' ? 'mixed' : 'polygyny';
    return {
        snapshot,
        model: buildKinModel(snapshot),
        info: { mating, social: { max: socialMax }, habitats, spacePerAdult: { nLandArea: 100 } },
        dest: { bySpecies: { Lion: Object.fromEntries(habs.map(h => [h, { ok: true }])) }, habitats: [] },
        ratio: makeup === '1:3' ? '1:3' : 'auto',
    };
}

const deep = (z, more = {}) => planProgramme(z.model, 'Lion', z.info, z.dest, { options: Object.assign({ ratio: z.ratio, engine: 'deep', spareOut: false }, more) });
const classic = (z, more = {}) => planProgramme(z.model, 'Lion', z.info, z.dest, { options: Object.assign({ ratio: z.ratio, maxEvaluations: 3000000, timeBudgetMs: 6000, spareOut: false }, more) });
const sigOf = (z, snapshot = z.snapshot, info = z.info) => programmeProblemSig(buildKinModel(snapshot), 'Lion', info, z.dest, { options: { ratio: z.ratio } });
const edit = (snapshot, fn) => {
    const s = JSON.parse(JSON.stringify(snapshot));
    fn(s);
    return s;
};

// ------------------------------------------------------------ problem sig
// Written first: the board's deep cache and Continue rely on it.

test('problem sig: births, juveniles moving and habitats done measuring leave it', () => {
    const z = makeZoo(30, 'monogamy', 1);
    const sig = sigOf(z);
    assert.ok(sig.length > 0);
    // a juvenile is born
    const born = edit(z.snapshot, s => s.animals.push({ id: 'j1', key: 'animal_j1', guid: 'gj1', name: 'j1', species: 'Lion', sex: M, juv: true, hab: '1', lt: 'habitat', par: ['ga0', 'ga1'], mates: [] }));
    assert.equal(sigOf(z, born), sig);
    // a juvenile is carried somewhere
    const carried = edit(born, s => {
        const j = s.animals.find(a => a.id === 'j1');
        j.moving = true;
        j.hab = '2';
    });
    assert.equal(sigOf(z, carried), sig);
    // a habitat finishes measuring with the same room
    const info = JSON.parse(JSON.stringify(z.info));
    info.habitats['1'].calculating = false;
    info.habitats['1'].required = { nLandArea: 333 };
    assert.equal(sigOf(z, z.snapshot, info), sig);
});

test('problem sig: animals ageing (fertile years left) leave it', () => {
    const z = makeZoo(30, 'monogamy', 1);
    const sig = sigOf(z);
    const older = edit(z.snapshot, s => { for (const a of s.animals) if (a.fert) a.fert.yearsLeft -= 0.37; });
    assert.equal(sigOf(z, older), sig);
});

test('problem sig: a pregnancy, a breeder moving, coming of age or a new room change it', () => {
    const z = makeZoo(30, 'monogamy', 1);
    const sig = sigOf(z);
    const female = z.snapshot.animals.find(a => a.sex === F && !a.contra && a.hab);
    const male = z.snapshot.animals.find(a => a.sex === M && !a.contra && a.hab);
    assert.notEqual(sigOf(z, edit(z.snapshot, s => { s.animals.find(a => a.id === female.id).preg = true; })), sig, 'pregnancy');
    const other = ['1', '2', '3'].find(h => h !== male.hab);
    assert.notEqual(sigOf(z, edit(z.snapshot, s => { s.animals.find(a => a.id === male.id).hab = other; })), sig, 'breeder moved');
    const grown = edit(z.snapshot, s => s.animals.push({ id: 'y1', key: 'animal_y1', guid: 'gy1', name: 'y1', species: 'Lion', sex: F, juv: false, contra: false, infertile: false, hab: '1', lt: 'habitat', par: [], mates: [], genes: z.snapshot.animals[0].genes, fert: { state: 'fertile', yearsLeft: 9 } }));
    assert.notEqual(sigOf(z, grown), sig, 'came of age');
    const info = JSON.parse(JSON.stringify(z.info));
    info.habitats['1'].available.nLandArea = 50;
    assert.notEqual(sigOf(z, z.snapshot, info), sig, 'room');
});

// ---------------------------------------------------------------- engine

test('deep: never below its warm start or Classic (random zoos, with and without warm)', () => {
    // quick: the 20-animal zoos, one per make-up (seed % 4)
    for (const seed of LONG ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [3, 6, 9, 12]) {
        const z = makeZoo(20 + (seed % 3) * 10, ['monogamy', '1:3', 'harem', 'mixed'][seed % 4], seed);
        const c = classic(z, { exactLimit: 0 });
        const own = deep(z, { exactLimit: 0, starts: 2, effort: 0.5 });
        const warm = deep(z, { exactLimit: 0, starts: 2, effort: 0.5, warm: c.moves });
        assert.ok(own.score >= c.score - 1e-6, `seed ${seed}: deep ${own.score} < classic ${c.score}`);
        assert.ok(warm.score >= c.score - 1e-6, `seed ${seed}: warm deep ${warm.score} < classic ${c.score}`);
        assert.equal(own.engine, 'deep');
        assert.ok(Math.abs(scoreLayout(z.model, 'Lion', z.info, z.dest, { options: { ratio: z.ratio } }, own.moves) - own.score) < 1e-6);
    }
});

// The optima the exact solver (HiGHS) proved for these zoos belong to the
// earlier objective: the breeding standard and the young's calves score a
// plan differently now. Prove them again with the solver before pinning one
// here (never what Deep finds); until then Deep is held to Classic on them.
test('deep: never below Classic on the benchmark zoos', () => {
    for (const [n, makeup, seed] of [[20, 'monogamy', 1], [40, '1:3', 4]].slice(0, LONG ? 2 : 1)) {
        const z = makeZoo(n, makeup, seed);
        const c = classic(z);
        const d = deep(z, { starts: 12, warm: c.moves });
        assert.ok(d.score >= c.score - 1e-6, `${n} ${makeup}: deep ${d.score} < classic ${c.score}`);
        assert.equal(d.starts, 12);
        assert.equal(d.stopped, null);
    }
});

test('deep: the same zoo and settings give the same plan', () => {
    const z = makeZoo(30, 'mixed', 3);
    const a = deep(z, { starts: LONG ? 4 : 2 });
    const b = deep(z, { starts: LONG ? 4 : 2 });
    assert.deepEqual(a.moves, b.moves);
    assert.equal(a.bestStart, b.bestStart);
});

test('deep: Stop keeps the best so far, Continue gives the uninterrupted plan', () => {
    // quick: 20 animals (~15 000 stop polls in all, so 2500 still stops partway)
    const z = makeZoo(LONG ? 40 : 20, 'monogamy', 1);
    const c = classic(z);
    const full = deep(z, { starts: 8, warm: c.moves });
    // stop at different points: in the first start, partway through round 1, in round 2
    for (const polls of [50, 2500]) {
        let calls = 0;
        const part = deep(z, { starts: 8, warm: c.moves, stop: () => ++calls > polls });
        assert.equal(part.stopped, 'stop', `${polls}`);
        assert.ok(part.resume && part.resume.round >= 0);
        assert.ok(part.score >= c.score - 1e-6, `${polls}: stopped below Classic`);
        const cont = deep(z, { starts: 8, resume: part.resume });
        assert.deepEqual(cont.moves, full.moves, `${polls}: continued plan differs`);
        assert.equal(cont.resume, null);
    }
});

test('deep: a wall-clock limit stops it, patience ends it early', () => {
    const z = makeZoo(LONG ? 40 : 20, '1:3', 2);
    const timed = deep(z, { starts: 50, wallLimitMs: 1 });
    assert.equal(timed.stopped, 'time');
    assert.ok(timed.starts < 50 && timed.resume);
    const patient = deep(z, { starts: 400, patience: 1 });
    assert.ok(patient.starts < 400, `patience: ${patient.starts} starts`);
    assert.equal(patient.starts % 4, 0, 'patience counts whole rounds');
});

test('deep: a stale warm plan is cleaned up, pinned breeders never move', () => {
    const z = makeZoo(LONG ? 30 : 20, 'monogamy', 2);
    const pregnant =z.snapshot.animals.filter(a => a.sex === F && !a.contra && a.hab).slice(0, 3).map(a => a.id);
    const snapshot = edit(z.snapshot, s => { for (const a of s.animals) if (pregnant.includes(a.id)) a.preg = true; });
    const zp = Object.assign({}, z, { model: buildKinModel(snapshot) });
    const stale = [{ id: 'nobody', to: '1' }, { id: pregnant[0], to: TRADE }, { id: 'a1', to: 'no-such-place' }];
    for (const repair of ['off', 'light', 'strong']) {
        const d = deep(zp, { starts: 2, effort: 0.5, repair, warm: stale, exactLimit: 0 });
        for (const id of pregnant) assert.ok(!d.moves.some(m => m.id === id), `${repair}: pregnant ${id} moved`);
    }
});

test('deep: edge cases give a valid plan', () => {
    // no breeders
    const none = buildKinModel({ v: 1, seq: 1, scope: 'park', mode: 'offline', habitats: [{ id: '1', name: 'H1' }], animals: [], anc: {} });
    const p0 = planProgramme(none, 'Lion', {}, { bySpecies: { Lion: { 1: { ok: true } } }, habitats: [] }, { options: { engine: 'deep' } });
    assert.ok(!p0 || p0.moves.length === 0);
    // unisex, everyone at the trade centre, one habitat
    const U = Sex.Unisex;
    const animals = [];
    for (let i = 0; i < 12; i++) animals.push({ id: 'u' + i, key: 'animal_u' + i, guid: 'gu' + i, name: 'u' + i, species: 'Lion', sex: U, juv: false, contra: false, infertile: false, hab: '', lt: 'trade', par: [], mates: [], genes: { F: 'ABCDEFGHABCD', I: 'ABCDEFGHABCD', S: 'AAAAAACCCCCC', L: 'AAAAAACCCCCC' } });
    const m = buildKinModel({ v: 1, seq: 1, scope: 'park', mode: 'offline', habitats: [{ id: '1', name: 'H1' }], animals, anc: {} });
    const p = planProgramme(m, 'Lion', { mating: 'mixed', social: { max: 6 } }, { bySpecies: { Lion: { 1: { ok: true } } }, habitats: [] }, { options: { engine: 'deep', starts: 4, exactLimit: 0 } });
    assert.ok(p && Array.isArray(p.moves));
    assert.ok(p.moves.filter(x => x.to === '1').length <= 6);
});

test('deep in slices: the same plan as in one go, rest between slices, Stop', async () => {
    const z = makeZoo(30, 'harem', 4);
    const starts = LONG ? 4 : 2;
    const sync = deep(z, { starts });
    const seen = [];
    const slow = await planProgrammeAsync(z.model, 'Lion', z.info, z.dest, { options: { ratio: z.ratio, engine: 'deep', starts, spareOut: false }, sliceMs: 5, restMs: 1, onProgress: v => seen.push(v) });
    assert.deepEqual(slow.moves, sync.moves);
    assert.ok(seen.length > 3);
    let n = 0;
    const stopped = await planProgrammeAsync(z.model, 'Lion', z.info, z.dest, { options: { ratio: z.ratio, engine: 'deep', starts: 40, stop: () => ++n > 300 }, sliceMs: 5 });
    assert.equal(stopped.stopped, 'stop');
    assert.ok(stopped.resume);
});

// ------------------------------------------------------------ review fixes

test('deep: a continued run that is stopped at once keeps the better plan it continued', () => {
    const z = makeZoo(40, 'monogamy', 1);
    const c = classic(z);
    let calls = 0;
    // 2026-10-19 (monogamous bonds modelled): first better than Classic after ~5000 polls
    const part = deep(z, { starts: 8, warm: c.moves, stop: () => ++calls > 5000 });
    assert.ok(part.score > c.score + 1e-6, 'the stopped run beat Classic');
    let n = 0;
    const again = deep(z, { starts: 8, resume: part.resume, stop: () => ++n > 3 });
    assert.ok(again.score >= part.score - 1e-9, `continued ${again.score} < stopped ${part.score}`);
});

const settle = () => new Promise(res => {
    const off = onDeep(kind => {
        if (kind === 'done' || kind === 'stopped') {
            off();
            setTimeout(res, 0);
        }
    });
});

test('job manager: Stop keeps a result, Recompute (cancel) keeps none', async () => {
    _resetDeepForTests();
    const z = makeZoo(30, 'monogamy', 2);
    const args = { species: 'Lion', key: 'k', dkey: 'd', psig: 's', model: z.model, info: z.info, dest: z.dest, options: { ratio: z.ratio }, settings: { starts: 40, effort: 1, repair: 'light', limitMin: 0, patience: 0, auto: false } };
    let done = settle();
    startDeep(args);
    setTimeout(() => stopDeep('Lion'), 50);
    await done;
    assert.ok(deepResult('Lion', 'k', 'd', 's'), 'Stop keeps the best so far');
    _resetDeepForTests();
    startDeep(args);
    await new Promise(res => setTimeout(res, 50));
    assert.ok(cancelDeep('Lion'));
    assert.equal(deepJob(), null);
    await new Promise(res => setTimeout(res, 300));
    assert.equal(deepResult('Lion', 'k', 'd', 's'), null, 'a cancelled job leaves no result');
    _resetDeepForTests();
});
