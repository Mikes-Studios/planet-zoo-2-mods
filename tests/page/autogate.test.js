import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers, triggered } from './fakepage.js';
import { autoPark, gate, sentSince } from './autopark.js';
import { HIPPO, Sex, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();

const park = [
    animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'),
    animal('Son', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }), animal('Other', Sex.Female, 'H2'),
];

test('a run whose gate the game never answers moves nothing and stops', async () => {
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true });
    loadPark(park);
    gate.value = 'no answer';
    const from = triggered.length;
    assert.equal(auto.runSpeciesNow(HIPPO), 'now');
    const deadline = Date.now() + 20000;
    await sleep(300);
    while (Date.now() < deadline && (auto.getAutopilotState().acting || auto.getAutopilotState().planning)) await sleep(100);
    assert.deepEqual(sentSince(from, 'PZ2QoL_KinMove'), []);
    const log = auto.getSpeciesAuto(HIPPO).log;
    assert.ok(log.length > 0);
    assert.match(log[0].why, /did not answer/);
    assert.equal(auto.getSpeciesAuto(HIPPO).status === 'paused', false, 'silence is no refusal');
});
