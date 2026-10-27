import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, stopPageTimers, triggered } from './fakepage.js';
import { loadPages } from './pageloader.js';

loadPages({ stubs: ['errors.js', 'debuglog.js'] });
globalThis.location.pathname = '/PZ2QoLFrontend.html';
after(stopPageTimers);

const { installTradeJump } = await import('/js/mods/pz2qol/tradejump.js');
const { formatTradeExtra } = await import('/js/mods/pz2qol/tradejumpcore.js');

const marketHeader = {
    classList: { contains: () => false },
    parentNode: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 40, right: 800, bottom: 40 }),
};

test("a notice's strict Market sets the game's CC-only, fertility above 0% and sex filters once the Market is up", async () => {
    document.querySelector = s => (s === '.AnimalMarketMarket_header' ? marketHeader : null);
    installTradeJump();
    engine.emit('PZ2QoL_TradeFilter', 7, 'market', 'Rhinoceros_Black', formatTradeExtra({ sex: 'm', floor: 60, strict: true }));
    triggered.length = 0;
    await sleep(2200);
    const sent = triggered.filter(t => String(t[0]).startsWith('AnimalMarket_')).map(t => [t[0].slice('AnimalMarket_'.length), t[1]]);
    assert.deepEqual(sent, [
        ['FilterCash', false], ['FilterCredits', true], ['FilterFertilityMin', 5],
        ['FilterIsMale', true], ['FilterIsFemale', false], ['FilterMenuConfirm', undefined],
    ]);
    assert.ok(triggered.some(t => t[0] === 'PZ2QoL_TradeAck' && t[1] === 7), 'and tells Lua it is done');
});
