import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers, triggered } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages();

after(stopPageTimers);

const { openBreedingWindow } = await import('/js/mods/pz2qol/breedwin.js');
const { HABITAT_SPECIES } = await import('/js/mods/pz2qol/speciesrules.js');

test('the Breeding window opens on the habitat list and asks storage about every species the game knows', async () => {
    const from = triggered.length;
    assert.equal(openBreedingWindow(), true);
    await sleep(1500);
    const asked = new Set(triggered.slice(from).filter(call => call[0] === 'PZ2QoL_TradeCounts').flatMap(call => String(call[2]).split(',')));
    // an empty zoo: every species asked comes from the game's list (a chunk a tick)
    assert.ok(asked.has(HABITAT_SPECIES[0]) && asked.size >= 40, `asked: ${[...asked].slice(0, 5).join(', ')} (${asked.size})`);
});
