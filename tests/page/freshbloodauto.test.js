import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { clickText, nodesWithText, sleep, stopPageTimers, triggered } from './fakepage.js';
import { autoPark } from './autopark.js';
import { HIPPO, Sex, animal, juvenile, strands } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const { installAutopilotUI } = await import('/js/mods/pz2qol/kinautoui.js');
installAutopilotUI();

// one bull's herd: his daughter grows up with no unrelated male in the zoo
const park = [
    animal('Bull', Sex.Male, 'H1'), animal('Cow1', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H1'),
    juvenile('Daughter', Sex.Female, 'H1', { par: ['Bull', 'Cow1'] }),
];
for (const a of park) a.genes = strands(5);

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

test('a run on a herd of one bull tells, once, that his daughter will need fresh blood', async () => {
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true });
    loadPark(park);
    assert.equal(auto.runSpeciesNow(HIPPO), 'now');
    await runFinished();
    await sleep(100);
    const title = 'Hippopotamus Common: fresh blood needed for 1 young';
    assert.equal(nodesWithText(title).length, 1);
    assert.equal(nodesWithText('Market').length > 0, true, 'the Market button is there');
    assert.equal(nodesWithText("Daughter (H1): once grown, it has no male in the zoo to breed with. The males here are related, or their juveniles would score well below your best pair's. None in Animal Storage fits: buy an unrelated adult male on the market before it grows up.").length, 1);
    const first = nodesWithText(title)[0];
    auto.runSpeciesNow(HIPPO);
    await runFinished();
    await sleep(100);
    assert.equal(nodesWithText(title).length, 1, 'Run now tells it again in place of the one showing');
    assert.notEqual(nodesWithText(title)[0], first, 'a fresh notice, not the old one left standing');
});

test("the notice's Market asks for a strict hand-over: CC listings with fertility above 0% of the sex wanted", async () => {
    triggered.length = 0;
    clickText('Market');
    await sleep(50);
    const open = triggered.find(t => t[0] === 'PZ2QoL_TradeOpen');
    assert.ok(open, `the hub is asked to open (${triggered.map(t => t[0])})`);
    assert.match(open[4], /sex=m/);
    assert.match(open[4], /strict=1/);
});
