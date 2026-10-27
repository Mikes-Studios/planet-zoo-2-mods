import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers, triggered } from './fakepage.js';
import { autoPark, sentSince } from './autopark.js';
import { HIPPO, Sex, animal, juvenile } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const A = auto._autopilotInternals();
// a grown son still with his parents: a kin conflict, so his species asks for a run at once
const family = [animal('Mum', Sex.Female, 'H1'), animal('Dad', Sex.Male, 'H1'), animal('Son', Sex.Male, 'H1', { par: ['Mum', 'Dad'], age: 8 }), animal('Other', Sex.Female, 'H2')];

function watchedLongEnough() {
    A.loadAt = Date.now() - 120000;
    A.scans = 10;
}

test('a species paused after refusals waits out its pause, whatever asks for a run', async () => {
    loadPark(family);
    auto.setSpeciesAuto(HIPPO, { on: true });
    A.pausedUntil.set(HIPPO, Date.now() + 10 * 60 * 1000);
    const from = triggered.length;
    loadPark(family);
    watchedLongEnough();
    assert.ok(A.queue.includes(HIPPO), 'the kin conflict queues it');
    await sleep(1300);
    assert.equal(A.planning, null);
    assert.deepEqual(sentSince(from, 'PZ2QoL_KinDestinations'), []);
    assert.match(auto.getSpeciesAuto(HIPPO).why, /refused several moves/);
});

test('a young animal growing up runs its species at once, a new breeder for the plan', () => {
    A.pausedUntil.delete(HIPPO);
    const calf = juvenile('Calf', Sex.Male, 'H1');
    const herd = [animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1'), animal('Cow2', Sex.Female, 'H2')];
    loadPark(herd.concat(calf));
    A.queue.length = 0;
    loadPark(herd.concat(calf));
    assert.deepEqual(A.queue, [], 'still young: nothing new');
    loadPark(herd.concat(Object.assign({}, calf, { juv: false, age: 8, ageQ: 1 })));
    assert.ok(A.queue.includes(HIPPO));
});

test('Run now skips the settle minute after a zoo loads, never the open game window', () => {
    A.loadAt = Date.now();
    const pageQuery = document.querySelector;
    document.querySelector = selector => (selector === '.PopupActionsModule_root.show' ? {} : null);
    try {
        assert.equal(auto.runSpeciesNow(HIPPO), 'queued');
    }
    finally {
        document.querySelector = pageQuery;
    }
});
