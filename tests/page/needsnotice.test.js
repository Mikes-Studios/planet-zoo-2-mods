import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { nodesWithText, sleep, stopPageTimers } from './fakepage.js';
import { autoPark } from './autopark.js';
import { HIPPO, Sex, animal, strands } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const { installAutopilotUI } = await import('/js/mods/pz2qol/kinautoui.js');
installAutopilotUI();

// three bulls, two cows: Cow2 goes to H2's bull, and H3's bull still lacks a cow
const herd = cow2 => [
    animal('Bull', Sex.Male, 'H1'), animal('Cow1', Sex.Female, 'H1'), animal('Cow2', Sex.Female, cow2),
    animal('Bull2', Sex.Male, 'H2'), animal('Bull3', Sex.Male, 'H3'),
].map(a => Object.assign(a, { genes: strands(5) }));

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

test('a run that still moves animals raises no needs; the run that moves nothing does', async () => {
    const title = 'Hippopotamus Common: H3 needs a breeding female';
    loadPark(herd('H1'));
    auto.setSpeciesAuto(HIPPO, { on: true });
    loadPark(herd('H1'));
    assert.equal(auto.runSpeciesNow(HIPPO), 'now');
    await runFinished();
    await sleep(100);
    assert.equal(nodesWithText(title).length, 0, 'Cow2 is on her way to H2: H3 is not asked for yet');
    loadPark(herd('H2'));
    auto.runSpeciesNow(HIPPO);
    await runFinished();
    await sleep(100);
    assert.equal(nodesWithText(title).length, 1);
});
