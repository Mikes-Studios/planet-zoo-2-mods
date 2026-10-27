import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers } from './fakepage.js';
import { autoPark } from './autopark.js';
import { HIPPO, Sex, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const A = auto._autopilotInternals();
const told = [];
auto.setAutopilotToastHook((kind, data) => told.push([kind, data]));

const onTheMove = Object.assign(animal('Boxed', Sex.Male, 'H1'), { moving: true });
const park = [onTheMove, animal('Mum', Sex.Female, 'H2')];

test('a move first seen before the park calendar is read is timed in park time, not real time', async () => {
    loadPark(park);
    auto.setSpeciesAuto(HIPPO, { on: true });
    loadPark(park);
    assert.equal(A.cal, null, 'the first scan comes before the calendar');
    await sleep(1300);
    assert.ok(A.cal, 'the tick reads the calendar');
    A.movingSince.get('Boxed').at = Date.now() - 10 * 60 * 1000;
    loadPark(park);
    assert.deepEqual(told.filter(([kind]) => kind === 'stuck'), []);
});

test('what Auto mode watched in a zoo is forgotten when it stops', () => {
    assert.ok(A.movingSince.size > 0);
    auto.setSpeciesAuto(HIPPO, { on: false });
    assert.equal(A.running, false);
    assert.equal(A.movingSince.size, 0);
    assert.equal(A.stuckTold.size, 0);
    assert.equal(A.waitingKeys.size, 0);
});
