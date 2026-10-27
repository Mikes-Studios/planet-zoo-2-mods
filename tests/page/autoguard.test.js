import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers, triggered } from './fakepage.js';
import { autoPark, sentSince } from './autopark.js';
import { HIPPO, Sex, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const kin = await import('/js/mods/pz2qol/kin.js');

// a father beside his grown daughter: never inbreed puts her on contraception
const family = [
    animal('Dad', Sex.Male, 'H1'), animal('Mum', Sex.Female, 'H2'),
    animal('Daughter', Sex.Female, 'H1', { par: ['Mum', 'Dad'], age: 8 }),
];
const guardsSince = from => sentSince(from, 'PZ2QoL_KinContracept').filter(call => call.includes(true));

test('the Kin setting Contraception near a relative decides whether Auto mode guards her', async () => {
    kin.setKinSettings({ autoContraception: false });
    auto.setSpeciesAuto(HIPPO, { on: true });
    const off = triggered.length;
    loadPark(family);
    await sleep(1500);
    assert.equal(guardsSince(off).length, 0, 'off: no contraception');
    const on = triggered.length;
    kin.setKinSettings({ autoContraception: true });
    await sleep(1500);
    assert.ok(guardsSince(on).length > 0, 'on: she goes on contraception');
});
