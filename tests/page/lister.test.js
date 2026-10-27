import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { LISTER_STUBS, fakeGame, jobAnimals, luaAnswer, storageAnimal } from './listerpage.js';
import { loadPages } from './pageloader.js';

loadPages({ stubs: LISTER_STUBS });

const lister = await import('/js/mods/pz2qol/lister.js');
const luaSide = await import('/js/mods/pz2qol/listerlua.js');
const { verdictOf } = await import('/js/mods/pz2qol/listercore.js');

const FRONTIER = '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]';
const comparables = (n, price) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, species: 'Lion', gender: 1, maturity: 2, isCC: true, price, genes: {} }));

beforeEach(() => luaSide._resetEngineForTests());

test('a listing from the panel asks the price the panel showed, the game value blended in', async () => {
    const limits = { tradePriceDefault: 9000, tradePriceMin: 1000, tradePriceMax: 20000 };
    const game = fakeGame({ rows: [storageAnimal('animal_1')], selected: ['animal_1'], limits, book: comparables(2, 3000) });
    const [row] = lister.storageRows();
    const shown = lister.adviceFor(row, { defaultPrice: 9000, min: 1000, max: 20000 });
    assert.notEqual(shown.basePrice, lister.adviceFor(row, {}).basePrice, 'the test needs a blend that changes the price');
    await lister.sellAtRecommendedPrice(['animal_1']);
    assert.equal(jobAnimals(game.jobs[0])[0].price, String(shown.basePrice));
});

test('a Frontier-zoo animal that Check storage found tradeable goes into the desk\'s job', async () => {
    const lion = storageAnimal('animal_1', { source: FRONTIER });
    const game = fakeGame({ rows: [lion] });
    const verdicts = new Map([[lion.guid, verdictOf({ trade: true, quickTrade: true, quickRelease: true, rehome: false })]]);
    const result = await lister.listAnimals(lister.storageRows(), { verdicts, gameBlocked: new Map() });
    assert.equal(result.ok, true);
    assert.deepEqual(jobAnimals(game.jobs[0]).map(x => x.guid), [lion.guid]);
});

test('without the listing engine nothing is listed and the player is told to reopen Animal Storage', async () => {
    const game = fakeGame({ rows: [storageAnimal('animal_1')], selected: ['animal_1'] });
    game.lua.caps = { ok: false, storage: false };
    const result = await lister.listAnimals(lister.storageRows());
    assert.equal(result.ok, false);
    assert.match(result.message, /reopen Animal Storage and try again/i);
    assert.deepEqual(game.eventsNamed('AnimalStorage_ItemSelected'), []);
    assert.deepEqual(game.eventsNamed('AnimalStorage_AddToMarket'), []);
});

test('a shoal is never listed, and the player is told shoals trade as a group', async () => {
    const game = fakeGame({ rows: [storageAnimal('animal_1', { isShoal: true, species: 'Fish' })], selected: ['animal_1'] });
    const result = await lister.listAnimals(lister.storageRows());
    assert.equal(result.ok, false);
    assert.match(result.message, /shoals are traded as a group/i);
    assert.equal(game.jobs.length, 0);
});

test('an engine answer from moments ago that said no is asked again before a listing is refused', async () => {
    const game = fakeGame({ rows: [storageAnimal('animal_1')] });
    game.lua.caps = { ok: false, storage: false };
    await luaSide.engineCaps({ force: true });
    game.lua.caps = { ok: true, storage: true, rows: 1 };
    const result = await lister.listAnimals(lister.storageRows());
    assert.equal(result.ok, true);
    assert.equal(game.jobs.length, 1);
});

test('a row whose id the game read for another animal is held back and not asked again at once', async () => {
    const game = fakeGame({ rows: [storageAnimal('animal_1'), storageAnimal('animal_2')] });
    game.lua.resolve = (keys, g) => {
        const answer = luaAnswer(g, keys);
        if (answer.rows.animal_2) answer.rows.animal_2.name = 'Another lion';
        return answer;
    };
    const identities = lister.storageRows().map(lister.identityOf);
    const first = await luaSide.resolveGuids(identities);
    assert.deepEqual([...first.failed], ['animal_2']);
    const asked = game.eventsNamed('PZ2QoL_ListerResolve').length;
    const second = await luaSide.resolveGuids(identities);
    assert.equal(game.eventsNamed('PZ2QoL_ListerResolve').length, asked);
    assert.deepEqual([...second.failed], ['animal_2']);
});

test('a resolve batch the game answers late does not stop the later batches, and its rows are told apart', async () => {
    const game = fakeGame({ rows: Array.from({ length: 300 }, (_, i) => storageAnimal(`animal_${i + 1}`)) });
    let batches = 0;
    game.lua.resolve = (keys, g) => Object.assign(luaAnswer(g, keys), { delayMs: ++batches === 1 ? 3000 : 0 });
    const out = await luaSide.resolveGuids(lister.storageRows().map(lister.identityOf), { retry: true });
    assert.equal(batches, 2);
    assert.equal(out.size, 50);
    assert.equal(out.unanswered.size, 250);
    assert.equal(out.failed.size, 0);
});
test('no market check starts while a listing is being set up', async () => {
    const game = fakeGame({ rows: [storageAnimal('animal_1')] });
    const listing = lister.listAnimals(lister.storageRows());
    const check = await lister.checkMarketFor('Lion', { quiet: true });
    await listing;
    assert.equal(check.busy, true);
    assert.deepEqual(game.eventsNamed('PZ2QoL_MarketPeek'), []);
});
test('the price offset and the lister switch are kept in the player\'s settings, which outlive the game session', () => {
    const game = fakeGame();
    lister.setPriceOffset(-0.1);
    lister.setListerEnabled(false);
    assert.equal(game.prefs.priceOffset, -0.1);
    assert.equal(game.prefs.listerEnabled, false);
    lister.setPriceOffset(0);
    lister.setListerEnabled(true);
    assert.equal(game.prefs.priceOffset, undefined);
    assert.equal(game.prefs.listerEnabled, undefined);
});