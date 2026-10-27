import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers } from './fakepage.js';
import { autoPark } from './autopark.js';
import { HIPPO, Sex, TRADE, animal, strands } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();
after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const A = auto._autopilotInternals();
const { requestStoredAdults } = await import('/js/mods/pz2qol/kinmoves.js');

const storedCow = name => ({ guid: `g_${name}`, name, sex: Sex.Female, maturity: 2, forSale: false, par: [], genes: strands(6) });
let storedNow = [];
engine.answer('PZ2QoL_KinStored', reqId => engine.emit('PZ2QoL_KinStoredChunk', reqId, 1, 1, JSON.stringify({ species: HIPPO, animals: storedNow })));

const added = [];
auto.setAutopilotToastHook((kind, d) => {
    if (kind === 'storage') added.push(...d.items.map(x => x.name));
});

function herd(extra = [], level = 5) {
    const list = [animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')].concat(extra);
    for (const a of list) a.genes = strands(level);
    return list;
}

// storage as the game shows it now, read afresh
async function storage(list) {
    storedNow = list;
    await requestStoredAdults(HIPPO, { force: true });
}

// a run the zoo asks for (not Run now, which tells everything again)
async function zooRun() {
    A.loadAt = Date.now() - 120000;
    A.scans = 10;
    if (!A.queue.includes(HIPPO)) A.queue.push(HIPPO);
    await sleep(2500);
    await runFinished();
    await sleep(300);
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

test("a habitat's storage suggestion of one sex is told once a zoo load, however many runs follow", async () => {
    loadPark(herd());
    auto.setSpeciesAuto(HIPPO, { on: true });
    loadPark(herd());
    storedNow = [storedCow('Good'), storedCow('Better')];
    auto.runSpeciesNow(HIPPO);
    await runFinished();
    await sleep(300);
    const first = added.slice();
    assert.ok(first.length > 0, 'the stored cows are told');
    await storage([storedCow('Third')]);
    await zooRun();
    assert.deepEqual(added, first, 'the next best for the same place is not told again');
});

test('no storage suggestion while an arrival of the species waits at the trade centre to be placed', async () => {
    added.length = 0;
    A.needKeys.clear();
    // the bull is the player's to move: the newcomer waits at the trade centre for his place
    A.ledger.manual.g_Bull = 99;
    await storage([storedCow('Good'), Object.assign(storedCow('Stud'), { sex: Sex.Male })]);
    loadPark(herd([animal('Newcomer', Sex.Male, TRADE)], 2));
    assert.ok(A.waitingKeys.has(HIPPO), 'the newcomer waits to be placed');
    await zooRun();
    assert.deepEqual(added, []);
});
