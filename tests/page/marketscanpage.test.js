import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { nodesWithText, stopPageTimers } from './fakepage.js';
import { LISTER_STUBS, fakeGame, marketAnimal } from './listerpage.js';
import { loadPages } from './pageloader.js';

loadPages({ stubs: LISTER_STUBS });
after(stopPageTimers);

// the Lua side's 3 s between market checks is the game's; the harness skips it
globalThis.__PZ2QOL_TEST_PEEK_GAP_MS = 0;
engine.__harness = true;

const lister = await import('/js/mods/pz2qol/lister.js');
const { BREED_TARGETS } = await import('/js/mods/pz2qol/breedtargets.js');
const { runScan, scanBlock } = await import('/js/mods/pz2qol/marketscan.js');
lister.installLister();

const ELEPHANT = '[Animal_Elephant_Indian]';
const HIPPO = '[Animal_Hippopotamus_Common]';

function market() {
    const out = {};
    // every other target: one ask at 1,000 CC
    for (const t of BREED_TARGETS) out[`[Animal_${t.id}]`] = [[marketAnimal(t.id, 'a_0', 1000)]];
    out[ELEPHANT] = [[marketAnimal('Elephant_Indian', 'a_0', 40000), marketAnimal('Elephant_Indian', 'a_1', 50000)]];
    // a busy market: 10 pages of 20
    out[HIPPO] = Array.from({ length: 10 }, (_, p) => Array.from({ length: 20 }, (_, i) => marketAnimal('Hippopotamus_Common', `a_${i}`, 3000, { name: `Hippo ${p}-${i}` })));
    return out;
}

test('Best to breed reads every target once, three pages at most, and names the one a female earns most with', async () => {
    const game = fakeGame({ market: market() });
    await runScan();
    const peeks = game.eventsNamed('PZ2QoL_MarketPeek');
    assert.equal(peeks.length, BREED_TARGETS.length);
    assert.equal(game.eventsNamed('PZ2QoL_MarketPeekPage').length, 2, 'the hippos past page 3 are counted, not read');
    const block = scanBlock();
    assert.equal(nodesWithText(`Breed ${ELEPHANT}`, block).length, 1);
    assert.equal(nodesWithText('≈200 listed', block).length, 1, 'the hippos on the unread pages are counted at the read pages\' rate');
    assert.equal(nodesWithText('45,000 CC', block).length, 1, 'the elephants\' median ask');
});
