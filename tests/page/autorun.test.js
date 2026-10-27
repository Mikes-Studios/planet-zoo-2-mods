import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers, triggered } from './fakepage.js';
import { autoPark, gate, moves, sentSince } from './autopark.js';
import { HIPPO, Sex, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();

// a grown son and daughter with their parents: the programme splits the family
// (Son to H3, Cow to H1, Daughter to the trade centre)
let park = [
    animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'),
    animal('Son', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }), animal('Daughter', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
    animal('Bull', Sex.Male, 'H2'), animal('Cow', Sex.Female, 'H3'),
];

function change(id, patch) {
    park = park.map(a => (a.id === id ? Object.assign({}, a, patch) : a));
}

// every move the game takes shows on the next scan; onMove(id) changes the zoo besides
function gameTakesMoves(onMove = () => {}) {
    moves.answer = id => {
        setTimeout(() => {
            change(id, { moving: true });
            onMove(id);
            loadPark(park);
        }, 20);
        return { ok: true, detail: '' };
    };
}

async function runFinished() {
    const deadline = Date.now() + 20000;
    await sleep(200);
    while (Date.now() < deadline) {
        const state = auto.getAutopilotState();
        if (!state.acting && !state.planning) return;
        await sleep(100);
    }
    throw new Error('the run did not finish within 20 s');
}

test('an animal the player moves by hand during a run is not moved by it', async () => {
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true });
    loadPark(park);
    gameTakesMoves(id => {
        if (id === 'Son') change('Cow', { hab: 'H2' });
    });
    const from = triggered.length;
    assert.equal(auto.runSpeciesNow(HIPPO), 'now');
    await runFinished();
    const sent = sentSince(from, 'PZ2QoL_KinMove').map(call => call[2]);
    assert.ok(sent.includes('Son'), 'the run moved Son first');
    assert.ok(!sent.includes('Cow'), 'Cow stays where the player put her');
    const cow = auto.getSpeciesAuto(HIPPO).log.find(e => e.n === 'Cow');
    assert.equal(cow.o, 'skip');
    assert.match(cow.why, /moved it by hand/);
});

test('a move the game refuses because the animal is already on the move is asked again soon, not at the next schedule', async () => {
    const A = auto._autopilotInternals();
    park = [
        animal('Ma', Sex.Female, 'H1'), animal('Pa', Sex.Male, 'H1'),
        animal('Lad', Sex.Male, 'H1', { par: ['Ma', 'Pa'], age: 8 }), animal('Bull2', Sex.Male, 'H2'), animal('Cow2', Sex.Female, 'H3'),
    ];
    loadPark(park);
    moves.answer = () => ({ ok: false, detail: 'This animal is already being moved.' });
    A.retryAt.clear();
    assert.equal(auto.runSpeciesNow(HIPPO), 'now');
    await runFinished();
    const at = A.retryAt.get(HIPPO);
    assert.ok(at > Date.now() && at - Date.now() <= 15000, 'a retry within the quarter minute');
});

test('a run whose moves meet the hub (no park loaded) is asked again soon, not at the next schedule', async () => {
    const A = auto._autopilotInternals();
    park = [
        animal('Ma', Sex.Female, 'H1'), animal('Pa', Sex.Male, 'H1'),
        animal('Lad', Sex.Male, 'H1', { par: ['Ma', 'Pa'], age: 8 }), animal('Bull2', Sex.Male, 'H2'), animal('Cow2', Sex.Female, 'H3'),
    ];
    loadPark(park);
    const atStart = gate.value;
    // the player opens the hub as the first move goes out
    moves.answer = () => {
        gate.value = Object.assign({}, atStart, { park: false });
        return { ok: false, detail: 'No park is loaded.' };
    };
    A.retryAt.clear();
    try {
        assert.equal(auto.runSpeciesNow(HIPPO), 'now');
        await runFinished();
    }
    finally {
        gate.value = atStart;
    }
    const at = A.retryAt.get(HIPPO);
    assert.ok(at > Date.now() && at - Date.now() <= 15000, 'a retry within the quarter minute');
});

test('Run on a species Auto mode stopped for hands it back and runs', async () => {
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true });
    auto.getAutopilotLedger().stopped[HIPPO] = 'it moved some of them back and forth';
    assert.equal(auto.getSpeciesAuto(HIPPO).status, 'stopped');
    assert.equal(auto.runSpeciesNow(HIPPO), 'now');
    assert.notEqual(auto.getSpeciesAuto(HIPPO).status, 'stopped');
    await runFinished();
});

test('Stop during a run: the animals it sent away to leave are not taken for ones waiting at the trade centre, and the species is not run again', async () => {
    const A = auto._autopilotInternals();
    const { stopPlan } = await import('/js/mods/pz2qol/kinmoves.js');
    // the hub test's retry may have closed the park again after it ended
    gate.value = Object.assign({}, gate.value, { park: true });
    A.retryAt.clear();
    park = [
        animal('Ma', Sex.Female, 'H1'), animal('Pa', Sex.Male, 'H1'),
        ...['Old1', 'Old2', 'Old3', 'Old4'].map((name, i) => animal(name, i % 2 ? Sex.Female : Sex.Male, 'H1', { age: 20, infertile: true })),
    ];
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true, thin: true, fill: 'strict' });
    // each animal sent away is at the trade centre on the next scan
    moves.answer = id => {
        setTimeout(() => {
            change(id, { hab: '', lt: 'trade' });
            loadPark(park);
        }, 20);
        return { ok: true, detail: '' };
    };
    const from = triggered.length;
    assert.match(auto.runSpeciesNow(HIPPO), /^(now|queued)$/);
    const deadline = Date.now() + 10000;
    while (!sentSince(from, 'PZ2QoL_KinMove').length && Date.now() < deadline) await sleep(50);
    assert.ok(sentSince(from, 'PZ2QoL_KinMove').length, `the run moved an animal: ${JSON.stringify(auto.getSpeciesAuto(HIPPO).last)} ${JSON.stringify(auto.getSpeciesAuto(HIPPO).status)}`);
    stopPlan();
    await runFinished();
    const sent = sentSince(from, 'PZ2QoL_KinMove').length;
    assert.ok(sent < 4, 'the run stopped before the last move');
    const cut = auto.getSpeciesAuto(HIPPO).log.filter(e => e.c === auto.getAutopilotLedger().run && e.o === 'skip');
    assert.ok(cut.length && cut.every(e => e.why === 'not run (stopped)'), JSON.stringify(cut));
    await sleep(1500);
    assert.ok(!A.queue.includes(HIPPO), 'not queued again');
    assert.equal(auto.getAutopilotState().acting, null);
    assert.equal(sentSince(from, 'PZ2QoL_KinMove').length, sent, 'no move after Stop');
});

test('another zoo loading during a run gets none of its data', async () => {
    const A = auto._autopilotInternals();
    gate.value = Object.assign({}, gate.value, { park: true });
    A.retryAt.clear();
    park = [
        animal('Mo', Sex.Female, 'H1'), animal('Po', Sex.Male, 'H1'),
        ...['Aged1', 'Aged2', 'Aged3', 'Aged4'].map((name, i) => animal(name, i % 2 ? Sex.Female : Sex.Male, 'H1', { age: 20, infertile: true })),
    ];
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true, thin: true, fill: 'strict' });
    moves.answer = id => {
        setTimeout(() => {
            change(id, { hab: '', lt: 'trade' });
            loadPark(park);
        }, 20);
        return { ok: true, detail: '' };
    };
    const start = triggered.length;
    assert.match(auto.runSpeciesNow(HIPPO), /^(now|queued)$/);
    const deadline = Date.now() + 10000;
    while (!sentSince(start, 'PZ2QoL_KinMove').length && Date.now() < deadline) await sleep(50);
    assert.ok(sentSince(start, 'PZ2QoL_KinMove').length, 'the run started');
    // the player loads another zoo (its store reads empty)
    engine.emit('PZ2QoL_StoreReset');
    await sleep(50);
    const from = triggered.length;
    await runFinished();
    await sleep(1500);
    const written = sentSince(from, 'PZ2QoL_StoreSave').filter(call => 'kinAuto' in JSON.parse(call[2]));
    assert.deepEqual(written, [], 'nothing of Auto mode in the other zoo');
});
