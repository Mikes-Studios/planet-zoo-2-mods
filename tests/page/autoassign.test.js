import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers } from './fakepage.js';
import { autoPark } from './autopark.js';
import { HIPPO, Sex, animal } from './zoo.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { auto, loadPark } = await autoPark();
const { setKinSettings } = await import('/js/mods/pz2qol/kin.js');
const { toggleAssignment } = await import('/js/mods/pz2qol/kinassign.js');

const park = [animal('Bull', Sex.Male, 'H1'), animal('Cow', Sex.Female, 'H1')];

test('a habitat set aside turns its species\' Auto mode on only with the Kin setting on', async () => {
    setKinSettings({ autoOnAssign: false });
    const model = loadPark(park);
    await sleep(100);
    toggleAssignment(model, 'H1', HIPPO, 'H1');
    loadPark(park);
    await sleep(100);
    assert.equal(auto.getSpeciesAuto(HIPPO).settings.on, false, 'off: Auto mode stays off');
    setKinSettings({ autoOnAssign: true });
    loadPark(park);
    await sleep(100);
    assert.equal(auto.getSpeciesAuto(HIPPO).settings.on, true, 'on: the next scan turns it on');
});
