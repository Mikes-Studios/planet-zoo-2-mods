// node --test tests/listercore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cautionOf, isFrontierZoo } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/scores.js';
import {
    activeFilterCount, basisScore, beyondBest, blockOf, DESK_FILTERS, deskRows, encodeJob, filterRows, normalizeFilters, normalizeState,
    PREGNANT_TEXT, RESULT_WORDS, BLOCK_WORDS, NOID_TEXT, partialJobText,
    reasonText, resetFilters, retryGuids, sortRows, speciesCounts, summaryText, tally, tickable, timeLeftText, tradeProblemKeys,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

const A = (key, over = {}) => Object.assign({
    id: key.replace('animal_', ''), key, species: 'Lion', gender: 0, maturity: 2, isPregnant: false, isMoving: false, isShoal: false,
    auctionTimerSeconds: -1, name: 'L' + key, medal: 'silver', genes: { size: 0.5, longevity: 0.5, fertility: 0.5, immunity: 0.5 },
}, over);
const advise = a => { const price = a.name === 'Lnoprice' ? 0 : 1000; return { price, basePrice: price, confidence: 'high', reason: '' }; };

test('blocks: listed, moving, pregnant, juvenile, elderly infertile; caution: infertile', () => {
    assert.equal(blockOf(A('animal_1', { auctionTimerSeconds: 3600 })), 'listed');
    assert.equal(blockOf(A('animal_1', { isMoving: true })), 'moving');
    assert.equal(blockOf(A('animal_1', { maturity: 0 })), 'juvenile');
    assert.equal(blockOf(A('animal_1', { maturity: 6 })), 'elderly');
    assert.equal(blockOf(A('animal_1', { maturity: 4 })), null);
    assert.equal(blockOf(A('animal_1', { auctionTimerSeconds: 0 })), null);    // an expired listing is not on the market
    // pregnant: never listed (the game's own sell flow blocks bPregnant)
    assert.equal(blockOf(A('animal_1', { isPregnant: true })), 'pregnant');
    assert.equal(blockOf(A('animal_1', { isPregnant: true, auctionTimerSeconds: 3600 })), 'listed');   // already on the market says so
    assert.equal(cautionOf(A('animal_1', { isPregnant: true })), null);
    assert.equal(cautionOf(A('animal_1', { maturity: 5 })), 'infertile');
    assert.equal(cautionOf(A('animal_1')), null);
});

test('rows are keyed by GUID once known; shoals and id-less rows left out', () => {
    const rows = deskRows([A('animal_1'), A('animal_2'), A('animal_3', { isShoal: true }), A('animal_4', { id: undefined })], new Map([['animal_1', '900000000000000001']]), advise);
    assert.equal(rows[0].id, 'g900000000000000001');
    assert.ok(rows[1].id.startsWith('kanimal_2|'));                       // no GUID: the key plus what the row holds
    // the same key holding another animal is another row (a tick never moves to it)
    const other = deskRows([A('animal_2', { name: 'Other' })], new Map(), advise);
    assert.notEqual(other[0].id, rows[1].id);
    assert.equal(rows[0].guid, '900000000000000001');
    assert.equal(rows[1].guid, null);
});

test('species counts and filters', () => {
    const rows = deskRows([
        A('animal_1'), A('animal_2', { gender: 1, medal: 'gold' }), A('animal_3', { auctionTimerSeconds: 99 }),
        A('animal_4', { species: 'Zebra', maturity: 0, medal: 'bronze' }), A('animal_5', { species: 'Zebra', gender: 1, maturity: 6 }),
    ], new Map(), advise);
    const c = speciesCounts(rows);
    assert.deepEqual(c.map(x => [x.species, x.total, x.sellable, x.listed]), [['Lion', 3, 2, 1], ['Zebra', 2, 0, 0]]);
    assert.equal(filterRows(rows, { species: 'Lion', sex: 'female', age: 'any', medal: 'any', state: 'any' }).length, 1);
    assert.equal(filterRows(rows, { species: null, sex: 'any', age: 'any', medal: 'gold', state: 'any' }).length, 1);
    assert.equal(filterRows(rows, { species: null, sex: 'any', age: 'any', medal: 'silver', state: 'any' }).length, 4);   // silver or better (the elderly zebra is silver too)
    assert.equal(filterRows(rows, { species: null, sex: 'any', age: 'fertile', medal: 'any', state: 'any' }).length, 3);  // not the juvenile or the elderly-infertile
    assert.equal(filterRows(rows, { species: null, sex: 'any', age: 'any', medal: 'any', state: 'sellable' }).length, 2);
    assert.equal(filterRows(rows, { species: null, sex: 'any', age: 'any', medal: 'any', state: 'listed' }).length, 1);
    assert.equal(filterRows(rows, { species: null, sex: 'any', age: 'any', medal: 'any', state: 'blocked' }).length, 2);
    // sellable first
    assert.equal(sortRows(rows)[0].block, null);
    assert.ok(sortRows(rows).slice(-1)[0].block);
});

test('job text: header, one line per listable animal, no price as "-"', () => {
    const rows = deskRows([
        A('animal_1'), A('animal_2', { name: 'Lnoprice' }), A('animal_3', { auctionTimerSeconds: 9 }), A('animal_4'),
    ], new Map([['animal_1', '11'], ['animal_2', '22'], ['animal_3', '33']]), advise);
    const { text, items } = encodeJob(rows, { paceMs: 2500, hours: 'max' });
    assert.equal(text, 'v1 2500\n11 animal_1 1000 max\n22 animal_2 - max');
    assert.deepEqual(items.map(r => r.guid), ['11', '22']);                    // listed and GUID-less rows left out
    assert.equal(encodeJob(rows, { paceMs: 200, hours: 6.4 }).text.split('\n')[0], 'v1 200');   // the engine keeps the 1 s floor (Lister.nPaceMin)
    assert.ok(encodeJob(rows, { paceMs: 2500, hours: 6.4 }).text.endsWith('22 animal_2 - 6'));
    // odd keys or GUIDs never reach the engine (a space would break the line)
    const odd = deskRows([A('animal 9'), A('animal_8'), A('animal_7')], new Map([['animal 9', '9'], ['animal_8', '8 5'], ['animal_7', 'ab-12']]), advise);
    assert.deepEqual(encodeJob(odd, { paceMs: 2500 }).items.map(r => r.guid), ['ab-12']);
});

test('state: normalised, tallied, summed up, retry list', () => {
    const s = normalizeState({
        run: 3, req: 'R1', phase: 'stopped', index: 4,
        results: [
            { guid: 1, status: 'listed', price: 1200 }, { guid: 2, status: 'listed', price: 800 },
            { guid: 3, status: 'skipped', kind: 'untradeable', detail: '[AnimalList_Problem_Pregnant]' },
            { guid: 4, status: 'refused', kind: 'refused', detail: 'NotAllowed' },
            { guid: 5, status: 'timeout', kind: 'timeout' }, { guid: 6, status: 'pending' }, { status: 'listed' },
        ],
    });
    assert.equal(s.results.length, 6);
    assert.equal(s.results[0].guid, '1');
    const tl = tally(s);
    assert.deepEqual([tl.total, tl.listed, tl.skipped, tl.refused, tl.timeout, tl.pending, tl.earned], [6, 2, 1, 1, 1, 1, 2000]);
    assert.equal(summaryText(s), "Listed 2 of 6 (≈ 2000 CC asked); not listed 3 (1 the game won't trade it, 1 refused by the server, 1 no confirmation in time); 1 not started.");
    assert.deepEqual(retryGuids(s), ['4', '5', '6']);
    assert.equal(normalizeState(null), null);
    assert.equal(summaryText(normalizeState({ results: [] })), 'Nothing to list.');
});

test('time left', () => {
    assert.equal(timeLeftText(-1), '');
    assert.equal(timeLeftText(30), '<1m left');
    assert.equal(timeLeftText(45 * 60), '45m left');
    assert.equal(timeLeftText(7 * 3600 + 20 * 60), '7h 20m left');
    assert.equal(timeLeftText(12 * 3600), '12h left');
});

// genes as fractions: one number for all four, or per gene
const G = (v, o = {}) => Object.assign({ size: v, longevity: v, fertility: v, immunity: v }, o);

test('gene range: keep the best, sell the rest (0-50)', () => {
    const rows = deskRows([
        A('animal_1', { genes: G(0.3) }), A('animal_2', { genes: G(0.5) }), A('animal_3', { genes: G(0.51) }),
        A('animal_4', { genes: G(0.9) }), A('animal_5', { genes: {} }),
    ], new Map(), advise);
    const names = f => filterRows(rows, f).map(r => r.key).sort();
    assert.deepEqual(names({ geneMin: 0, geneMax: 50 }), ['animal_1', 'animal_2']);         // 50 is in; unknown genes out
    assert.deepEqual(names({ geneMin: 51, geneMax: 100 }), ['animal_3', 'animal_4']);
    assert.equal(filterRows(rows, {}).length, 5);                                              // the full range filters nothing, unknown genes too
    // one gene as the basis
    const fert = deskRows([A('animal_1', { genes: G(0.9, { fertility: 0.2 }) }), A('animal_2', { genes: G(0.2, { fertility: 0.9 }) })], new Map(), advise);
    assert.deepEqual(filterRows(fert, { geneBasis: 'fertility', geneMax: 40 }).map(r => r.key), ['animal_1']);
    assert.deepEqual(filterRows(fert, { geneMax: 40 }).map(r => r.key), ['animal_2']);
    // per-gene ranges under "More filters"
    assert.deepEqual(filterRows(fert, { fertilityMin: 50 }).map(r => r.key), ['animal_2']);
    assert.deepEqual(filterRows(fert, { sizeMin: 50, fertilityMax: 50 }).map(r => r.key), ['animal_1']);
    // exhibit animals have no size gene: a size range leaves them out
    const ex = deskRows([A('animal_1', { isExhibit: true, genes: G(0.8) })], new Map(), advise);
    assert.equal(filterRows(ex, { sizeMin: 10 }).length, 0);
    assert.equal(filterRows(ex, { longevityMin: 10 }).length, 1);
    assert.equal(basisScore(ex[0], 'size'), null);
});

test('ages, fertility, ratings, pregnancy, tags, price, name', () => {
    const rows = deskRows([
        A('animal_1', { maturity: 1 }), A('animal_2', { maturity: 2, medal: 'gold' }), A('animal_3', { maturity: 5, medal: 'none' }),
        A('animal_4', { maturity: 3, isPregnant: true, storageTag: 4 }), A('animal_5', { maturity: 0, storageTag: 1, name: 'Simba' }),
    ], new Map(), a => ({ price: a.maturity * 1000, confidence: 'high', reason: '' }));
    const keys = f => filterRows(rows, f).map(r => r.key);
    assert.deepEqual(keys({ ages: ['young', 'elderly'] }), ['animal_1', 'animal_4']);
    assert.deepEqual(keys({ ages: ['adult'] }), ['animal_2', 'animal_3']);            // adult, fertile or not
    assert.deepEqual(keys({ fertile: 'no' }), ['animal_3', 'animal_5']);
    assert.deepEqual(keys({ fertile: 'yes', ages: ['adult'] }), ['animal_2']);
    assert.deepEqual(keys({ medals: ['gold', 'none'] }), ['animal_2', 'animal_3']);
    assert.deepEqual(keys({ pregnant: 'only' }), ['animal_4']);
    assert.equal(keys({ pregnant: 'hide' }).length, 4);
    assert.deepEqual(keys({ tags: [0] }), ['animal_1', 'animal_2', 'animal_3']);   // no tag
    assert.deepEqual(keys({ tags: [1, 4] }), ['animal_4', 'animal_5']);
    assert.deepEqual(keys({ priceMin: 2000, priceMax: 3000 }), ['animal_2', 'animal_4']);
    assert.deepEqual(keys({ priceMax: 1500 }), ['animal_1']);                         // no price (0) is not "at most 1,500"
    assert.deepEqual(keys({ text: 'simB' }), ['animal_5']);
    // Kin: only when Kin knows storage
    assert.deepEqual(filterRows(rows, { kin: 'related' }, { related: a => a.key === 'animal_2' }).map(r => r.key), ['animal_2']);
    assert.equal(filterRows(rows, { kin: 'unrelated' }, { related: a => a.key === 'animal_2' }).length, 4);
    assert.equal(filterRows(rows, { kin: 'related' }).length, 5);
    // Tick all leaves Keep-tagged animals alone unless asked for
    const kept = rows.find(r => r.key === 'animal_4');
    assert.equal(tickable(kept, normalizeFilters({})), false);
    // animal_4 is pregnant too: never ticked, not even with Keep filtered for
    assert.equal(tickable(kept, normalizeFilters({ tags: [4] })), false);
    const keepOnly = deskRows([A('animal_9', { storageTag: 4 })], new Map(), advise)[0];
    assert.equal(tickable(keepOnly, normalizeFilters({})), false);
    assert.equal(tickable(keepOnly, normalizeFilters({ tags: [4] })), true);
    assert.equal(tickable(rows.find(r => r.key === 'animal_5')), false);          // juvenile: blocked
});

test('keep the best N per species and sex: the rest are the cull candidates', () => {
    const rows = deskRows([
        A('animal_1', { genes: G(0.9) }), A('animal_2', { genes: G(0.7) }), A('animal_3', { genes: G(0.4) }), A('animal_4', { genes: G(0.2) }),
        A('animal_5', { gender: 1, genes: G(0.3) }), A('animal_6', { gender: 1, genes: G(0.6) }),
        A('animal_7', { genes: G(0.1), auctionTimerSeconds: 900 }),                     // listed: leaving, not kept, not counted
        A('animal_8', { species: 'Zebra', genes: G(0.1) }),
    ], new Map(), advise);
    assert.deepEqual(Array.from(beyondBest(rows, 2)).map(id => id.split('|')[0]).sort(), ['kanimal_3', 'kanimal_4']);
    assert.deepEqual(filterRows(rows, { keepBest: 1 }).map(r => r.key).sort(), ['animal_2', 'animal_3', 'animal_4', 'animal_5']);
    assert.deepEqual(filterRows(rows, { keepBest: 1, species: 'Lion', sex: 'female' }).map(r => r.key), ['animal_5']);
    // a juvenile (or elderly infertile) never takes a kept place
    const young = deskRows([
        A('animal_1', { gender: 1, genes: G(0.95), maturity: 0 }), A('animal_2', { gender: 1, genes: G(0.8) }), A('animal_3', { gender: 1, genes: G(0.5) }),
        A('animal_4', { gender: 1, genes: G(0.99), maturity: 6 }),
    ], new Map(), advise);
    assert.deepEqual(filterRows(young, { keepBest: 1 }).map(r => r.key), ['animal_3']);
    // by fertility instead
    const fert = deskRows([A('animal_1', { genes: G(0.9, { fertility: 0.1 }) }), A('animal_2', { genes: G(0.1, { fertility: 0.9 }) })], new Map(), advise);
    assert.deepEqual(filterRows(fert, { keepBest: 1, geneBasis: 'fertility' }).map(r => r.key), ['animal_1']);
});

test('sort, normalise, counts, reset', () => {
    const rows = deskRows([
        A('animal_1', { genes: G(0.5), name: 'B' }), A('animal_2', { genes: G(0.9), name: 'C' }), A('animal_3', { genes: G(0.1), name: 'A' }),
        A('animal_4', { genes: G(1), maturity: 0 }),
    ], new Map(), a => ({ price: Math.round(a.genes.size * 1000), confidence: 'high', reason: '' }));
    assert.deepEqual(sortRows(rows, 'best').map(r => r.key), ['animal_2', 'animal_1', 'animal_3', 'animal_4']);   // blocked last
    assert.deepEqual(sortRows(rows, 'worst').map(r => r.key), ['animal_3', 'animal_1', 'animal_2', 'animal_4']);
    assert.deepEqual(sortRows(rows, 'name').map(r => r.key), ['animal_3', 'animal_1', 'animal_2', 'animal_4']);
    assert.deepEqual(sortRows(rows, 'price').map(r => r.key), ['animal_2', 'animal_1', 'animal_3', 'animal_4']);
    const n = normalizeFilters({ geneMin: 80, geneMax: 20, sex: 'x', medals: ['gold', 'shiny', 'gold'], tags: ['4', 9], keepBest: -3, sort: 'zzz', priceMin: 900, priceMax: 100 });
    assert.equal(n.geneMin, 20);
    assert.equal(n.geneMax, 80);
    assert.equal(n.sex, 'any');
    assert.deepEqual(n.medals, ['gold']);
    assert.deepEqual(n.tags, [4]);
    assert.equal(n.keepBest, 0);
    assert.equal(n.sort, 'best');
    assert.equal(n.priceMax, 900);
    assert.deepEqual(normalizeFilters(null), Object.assign({}, DESK_FILTERS, { ages: [], medals: [], tags: [] }));
    assert.deepEqual(activeFilterCount(normalizeFilters({})), { main: 0, more: 0, total: 0 });
    assert.deepEqual(activeFilterCount(normalizeFilters({ geneMax: 50, sex: 'male', sizeMin: 10, sizeMax: 90, pregnant: 'hide', text: '  ' })), { main: 2, more: 2, total: 4 });
    const r = resetFilters(normalizeFilters({ species: 'Lion', sort: 'worst', geneMax: 50, keepBest: 3 }));
    assert.equal(r.species, 'Lion');
    assert.equal(r.sort, 'worst');
    assert.equal(r.geneMax, 100);
    assert.equal(r.keepBest, 0);
});

import { encodeSeen, readSeen, SEEN_FIELDS, SEEN_LIMITS } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

// a field of the page report, by name (pz2qol.lister.lua ParseSeen reads it back)
const seenField = (text, name) => text.split('|')[SEEN_FIELDS.indexOf(name)];

test('page reports for the engine: what the DataStore shows, as plain text', () => {
    const store = {
        'hubAnimalsData/animalStorageData': { selectedAnimalIDs: ['animal_3'] },
        'hubAnimalsData/animalStorageData/actions': { tradeAllowed: true, tradeDisallowedReason: '' },
        animalTradeListingData: { tradePriceMin: 100, tradePriceMax: 5000, tradePriceDefault: 812.5, tradeDurationMin: 1, tradeDurationMax: 12, tradeDurationDefault: 6 },
    };
    const read = (c, p) => (store[c.join('/')] || {})[p];
    const s = readSeen('animal_3', read);
    assert.deepEqual(s.sel, ['animal_3']);
    assert.equal(s.allowed, true);
    assert.equal(SEEN_LIMITS.length, 6);
    assert.ok(encodeSeen(s).startsWith('v2|animal_3|animal_3|1|100,5000,812.5,1,12,6||'));
    // nothing selected, not allowed with a reason that holds pipes, limits missing
    store['hubAnimalsData/animalStorageData'].selectedAnimalIDs = [];
    store['hubAnimalsData/animalStorageData/actions'] = { tradeAllowed: false, tradeDisallowedReason: '[STRING_LITERAL:Value=|Pregnant|]\n' };
    store.animalTradeListingData = { tradePriceMin: NaN, tradePriceMax: '5000' };
    const refused = encodeSeen(readSeen('animal_3', read));
    assert.ok(refused.startsWith('v2|animal_3||0|-,-,-,-,-,-|'));
    assert.equal(decodeURIComponent(seenField(refused, 'reason')), '[STRING_LITERAL:Value=|Pregnant|]\n');
    // unreadable selection and data; a read that throws; odd ids
    assert.ok(encodeSeen(readSeen('animal_3', () => undefined)).startsWith('v2|animal_3|?|-|-,-,-,-,-,-|'));
    assert.ok(encodeSeen(readSeen('animal_3', () => { throw new Error('x'); })).startsWith('v2|animal_3|?|-|-,-,-,-,-,-|'));
    store['hubAnimalsData/animalStorageData'].selectedAnimalIDs = ['animal_3', 7, null, 'a|b,c d'];
    assert.equal(readSeen('animal_3', read).sel.length, 3);
    assert.equal(seenField(encodeSeen(readSeen('animal_3', read)), 'selection'), 'animal_3,7,abcd');
});

// ------------------------------------------- what Animal Storage was scoped to
import { nativeFiltersOn, storageScope } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

test("nativeFiltersOn: the game's storage filters that narrow the list", () => {
    const f = { filterInputText: '', filteredSpecies: [], isMale: false, appealMinValue: 3 };
    assert.deepEqual(nativeFiltersOn(p => f[p]), []);
    assert.deepEqual(nativeFiltersOn(p => ({ filteredSpecies: [17] })[p]), ['filteredSpecies']);
    assert.deepEqual(nativeFiltersOn(p => ({ filterInputText: '  Leo ', isFemale: true, filteredBiomes: { length: 2 } })[p]), ['filterInputText', 'filteredBiomes', 'isFemale']);
    assert.deepEqual(nativeFiltersOn(p => ({ filterInputText: '   ' })[p]), [], 'blank text is no filter');
    assert.deepEqual(nativeFiltersOn(() => { throw new Error('no context'); }), [], 'unreadable: nothing on');
});

test('storageScope: filtered, and the one species it was scoped to', () => {
    const lions = [A('animal_0'), A('animal_1')];
    // the game's species filter: only lions in the list, more in storage
    assert.deepEqual(storageScope({ rows: lions, total: 9, active: ['filteredSpecies'] }), { filtered: true, known: true, species: 'Lion', active: ['filteredSpecies'] });
    // the row count alone (a range slider set, or a count that means something else): try, don't claim
    assert.equal(storageScope({ rows: lions, total: 9 }).filtered, true);
    assert.equal(storageScope({ rows: lions, total: 9 }).known, false);
    assert.equal(storageScope({ rows: lions, total: 9 }).species, 'Lion');
    // everything shown: not filtered, no species to start on
    const mixed = [A('animal_0'), A('animal_1', { species: 'Zebra' })];
    assert.deepEqual(storageScope({ rows: mixed, total: 2 }), { filtered: false, known: false, species: null, active: [] });
    assert.deepEqual(storageScope({ rows: mixed, total: null }), { filtered: false, known: false, species: null, active: [] });
    // filtered to several species: no single one
    assert.deepEqual(storageScope({ rows: mixed, total: 5, active: ['filteredSpecies'] }), { filtered: true, known: true, species: null, active: ['filteredSpecies'] });
    // a name search that found one animal
    assert.equal(storageScope({ rows: [A('animal_3', { species: 'Zebra' })], total: 12, active: ['filterInputText'] }).species, 'Zebra');
    // the mod's own species filter (any spelling) never narrows the list, but the desk starts on it
    const s = storageScope({ rows: mixed, total: 2, modSpecies: '[Animal_Zebra]' });
    assert.deepEqual(s, { filtered: false, known: false, species: 'Zebra', active: [] });
    assert.equal(storageScope({ rows: mixed, total: 2, modSpecies: 'Okapi' }).species, null, 'a species not in storage');
    assert.deepEqual(storageScope(), { filtered: false, known: false, species: null, active: [] });
});

test('pregnant: never sellable, never ticked, never in a job, with a reason', () => {
    const rows = deskRows([
        A('animal_1'), A('animal_2', { gender: 1, isPregnant: true }), A('animal_3', { gender: 1 }),
    ], new Map([['animal_1', '101'], ['animal_2', '102'], ['animal_3', '103']]), advise);
    const preg = rows.find(r => r.key === 'animal_2');
    assert.equal(preg.block, 'pregnant');
    assert.equal(preg.caution, null);
    // not under Sellable, under Not sellable
    assert.deepEqual(filterRows(rows, { state: 'sellable' }).map(r => r.key), ['animal_1', 'animal_3']);
    assert.deepEqual(filterRows(rows, { state: 'blocked' }).map(r => r.key), ['animal_2']);
    // the species rail does not count her as sellable
    assert.equal(speciesCounts(rows)[0].sellable, 2);
    // Tick all shown leaves her alone
    assert.deepEqual(rows.filter(r => tickable(r)).map(r => r.key), ['animal_1', 'animal_3']);
    // forced into a job (a stale tick): left out of the engine's job text
    const job = encodeJob(rows, { paceMs: 3000 });
    assert.equal(job.items.length, 2);
    assert.ok(!/^102 /m.test(job.text), job.text);
    // never a kept place in "keep the best N" (she can't be sold either way)
    assert.ok(!beyondBest(rows, 1).has(preg.id));
    // the words
    assert.equal(PREGNANT_TEXT, "Pregnant: the market won't take it until she gives birth.");
    assert.match(RESULT_WORDS.pregnant, /until she gives birth/);
    assert.match(BLOCK_WORDS.pregnant, /^Pregnant/);
    // an engine skip of kind "pregnant" reads in the summary and is never retried
    const state = { run: 1, phase: 'done', results: [{ guid: '102', status: 'skipped', kind: 'pregnant' }, { guid: '101', status: 'listed', price: 900 }] };
    assert.match(summaryText(state), /1 pregnant: the market won't take it until she gives birth/);
    assert.deepEqual(retryGuids(state), []);
});

test('noid: rows the game gave no id for are blocked, not counted, not in the job; the player is told', () => {
    // 6 animals; Lua answered for 1-5: ids for 1 and 2, nothing for 3-5; 6 not asked yet
    const animals = [1, 2, 3, 4, 5, 6].map(i => A('animal_' + i));
    const guids = new Map([['animal_1', '900000000000000001'], ['animal_2', 'fp7']]);
    const failed = new Set(['animal_3', 'animal_4', 'animal_5']);
    const rows = deskRows(animals, guids, advise, failed);
    assert.deepEqual(rows.map(r => r.block), [null, null, 'noid', 'noid', 'noid', null]);
    assert.equal(BLOCK_WORDS.noid, 'No id from the game');
    assert.match(NOID_TEXT, /gave no id for this animal; it can't be listed from the desk/);
    // another block says more than noid (on the market stays "On the market")
    assert.equal(deskRows([A('animal_3', { auctionTimerSeconds: 99 })], new Map(), advise, failed)[0].block, 'listed');
    // a fingerprint token is a GUID like any other for the job
    const { items, text } = encodeJob(rows, { paceMs: 3000 });
    assert.deepEqual(items.map(r => r.key), ['animal_1', 'animal_2']);
    assert.ok(text.split('\n').includes('fp7 animal_2 1000 max'));
    // what List N counts: tickable rows only
    assert.equal(rows.filter(r => tickable(r)).length, 3);
    assert.deepEqual(speciesCounts(rows).map(c => [c.total, c.sellable]), [[6, 3]]);
    // a filter by state: noid rows are "Not sellable"
    assert.equal(filterRows(rows, normalizeFilters({ state: 'blocked' })).length, 3);
    // without the failed set (engine not usable, or not asked yet): nothing blocked
    assert.ok(deskRows(animals, new Map(), advise).every(r => !r.block));
    assert.ok(deskRows(animals, new Map(), advise, new Set()).every(r => !r.block));
    // an id that arrives later wins over an old failure
    assert.equal(deskRows([A('animal_3')], new Map([['animal_3', '42']]), advise, failed)[0].block, null);
    // the notice and the summary
    assert.equal(partialJobText({ inJob: 3, asked: 39, noid: 36 }), "Listing 3 of 39: 36 couldn't be identified by the game");
    assert.equal(partialJobText({ inJob: 3, asked: 5, noid: 1 }), "Listing 3 of 5: 1 couldn't be identified by the game, 1 can't be listed now");
    assert.equal(partialJobText({ inJob: 3, asked: 3, noid: 0 }), '');
    const st = normalizeState({ run: 1, phase: 'done', results: [{ guid: '1', status: 'listed', price: 100 }, { guid: '2', status: 'listed', price: 100 }, { guid: '3', status: 'listed', price: 100 }] });
    assert.match(summaryText(st, String, { noid: 36, asked: 39 }), /^Listed 3 of 3 .*; 36 of the 39 ticked couldn't be identified by the game \(not in the job\)\.$/);
    assert.doesNotMatch(summaryText(st, String, null), /identified/);
    assert.match(RESULT_WORDS.ambiguous, /looks the same/);
});

test('reasonText: the game\'s trade problems in words, and the server\'s unnamed refusal', () => {
    const d = '[AnimalExchange_Conditions_Concatenate:first=[AnimalExchange_Conditions_Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalExchange_Conditions_NewLine]]:second=[AnimalList_Problem_Infected]]';
    assert.deepEqual(tradeProblemKeys(d), ['Infected']);
    assert.equal(reasonText('untradeable', d), 'infected');
    assert.equal(reasonText('untradeable', d, s => (s === '[AnimalList_Problem_Infected]' ? 'Animal is infected' : s)), 'Animal is infected');
    assert.equal(reasonText('untradeable', d, () => { throw new Error('no translate'); }), 'infected');
    assert.equal(reasonText('untradeable', 'Cannot send to trading as the following issues apply:\n- Animal is injured'), '- Animal is injured');
    assert.match(reasonText('refused', 'Refused by the server (Unknown).'), /no reason/);
    assert.equal(reasonText('refused', 'Refused by the server (NotAllowed).'), 'Refused by the server (NotAllowed).');
});

test('deskRows: animals the game would not trade this session stay blocked, with the reason', () => {
    const rows = [A('animal_1'), A('animal_2')];
    const guids = new Map([['animal_1', 'g1'], ['animal_2', 'g2']]);
    const blocked = new Map([['g2', '[AnimalList_Problem_Infected]']]);
    const out = deskRows(rows, guids, null, null, blocked);
    assert.equal(out[0].block, null);
    assert.equal(out[1].block, 'untradeable');
    assert.equal(out[1].blockDetail, '[AnimalList_Problem_Infected]');
    assert.equal(tickable(out[1]), false);
    assert.equal(BLOCK_WORDS.untradeable, "The game won't trade it");
});

// ------------------------------------- Quick trade categories, Check storage
// docs/PLAN-desk-quick-release.md 3.1-3.3
import {
    categoryOf, checkMinutes, checkPaceMs, checkSummaryText, CHECK_PACE_MS, encodeCheckJob, quickOffers, quickValueText, uncheckedRows, verdictBlock, verdictOf, verdictsOfState,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

const LONG = '[AnimalExchange_Conditions_Concatenate:first=[AnimalExchange_Conditions_Concatenate:first=[AnimalList_SelectionCannotTrade]:second=[AnimalExchange_Conditions_NewLine]]:second=[AnimalList_Problem_NoBirthZoo]]';
// what Lua sends with a result (pz2qol.lister.lua verdictOf)
const V = over => Object.assign({
    trade: false, quickTrade: true, quickRelease: false, rehome: false, tradeWhy: '[AnimalList_Problem_NoBirthZoo]', quickTradeWhy: '', quickReleaseWhy: '[AnimalList_Problem_NoBirthZoo]',
    quickTradeValue: '$1,200', quickReleaseValue: '85', quickTradePrice: 1200, quickReleasePrice: 85, src: 'page', v: 2,
}, over);

test('categoryOf: market, quick, blocked (rehome only, nothing allowed), unknown', () => {
    assert.equal(categoryOf(null), 'unknown');
    assert.equal(categoryOf(verdictOf(V({ trade: true }))), 'market');
    // market wins even when the quick actions are offered too
    assert.equal(categoryOf(verdictOf(V({ trade: true, quickTrade: true, quickRelease: true }))), 'market');
    assert.equal(categoryOf(verdictOf(V())), 'quick');
    assert.equal(categoryOf(verdictOf(V({ quickTrade: false, quickRelease: true }))), 'quick');
    // Rehome offered: vanilla shows neither quick button, so it is not a quick row
    assert.equal(categoryOf(verdictOf(V({ rehome: true }))), 'blocked');
    assert.deepEqual(verdictBlock(verdictOf(V({ rehome: true }))).block, 'rehome');
    assert.equal(categoryOf(verdictOf(V({ quickTrade: false, quickRelease: false }))), 'blocked');
    // quick flags unknown (an older page): blocked as before (untradeable)
    assert.equal(categoryOf(verdictOf(V({ quickTrade: null, quickRelease: null }))), 'blocked');
    assert.equal(verdictBlock(verdictOf(V({ quickTrade: null, quickRelease: null }))).block, 'untradeable');
    // junk is no verdict
    assert.equal(verdictOf(null), null);
    assert.equal(verdictOf({ quickTrade: true }), null);
    const v = verdictOf(V(), 5);
    assert.equal(v.at, 5);
    assert.deepEqual(v.prices, { quickTrade: 1200, quickRelease: 85 });
    assert.equal(v.reasons.trade, '[AnimalList_Problem_NoBirthZoo]');
});

test('deskRows with verdicts: quick rows are their own block, never sellable, never ticked or listed', () => {
    const rows = [A('animal_1'), A('animal_2'), A('animal_3'), A('animal_4'), A('animal_5', { auctionTimerSeconds: 600 })];
    const guids = new Map(rows.map((a, i) => [a.key, String(100 + i)]));
    const verdicts = new Map([
        ['100', verdictOf(V({ trade: true }))],
        ['101', verdictOf(V())],
        ['102', verdictOf(V({ rehome: true, quickTrade: false }))],
    ]);
    // a stale game refusal is replaced by the newer verdict
    const gameBlocked = new Map([['100', '[AnimalList_Problem_Infected]']]);
    const out = deskRows(rows, guids, advise, new Set(), gameBlocked, verdicts);
    assert.deepEqual(out.map(r => r.cat), ['market', 'quick', 'blocked', 'unknown', 'unknown']);
    assert.deepEqual(out.map(r => r.block), [null, 'quick', 'rehome', null, 'listed']);
    assert.equal(out[1].blockDetail, '[AnimalList_Problem_NoBirthZoo]');
    assert.equal(tickable(out[1]), false);
    assert.equal(tickable(out[2]), false);
    assert.equal(tickable(out[3]), true);
    // the counts: quick separately, never as sellable
    const c = speciesCounts(out)[0];
    assert.deepEqual([c.total, c.sellable, c.quick, c.listed], [5, 2, 1, 1]);
    // the segments
    const ids = st => filterRows(out, Object.assign({}, DESK_FILTERS, { state: st })).map(r => r.key);
    assert.deepEqual(ids('sellable'), ['animal_1', 'animal_4']);
    assert.deepEqual(ids('quick'), ['animal_2']);
    assert.deepEqual(ids('listed'), ['animal_5']);
    assert.deepEqual(ids('blocked'), ['animal_3']);
    assert.equal(ids('any').length, 5);
    assert.equal(normalizeFilters({ state: 'quick' }).state, 'quick');
    // sort: listable first; the job never holds a quick row
    assert.deepEqual(sortRows(out, 'name').slice(0, 2).map(r => r.key).sort(), ['animal_1', 'animal_4']);
    const job = encodeJob(out, { paceMs: 3000 });
    assert.deepEqual(job.items.map(r => r.key), ['animal_1', 'animal_4']);
    assert.equal(BLOCK_WORDS.quick, 'Quick trade');
    assert.equal(BLOCK_WORDS.rehome, 'Rehome only');
});

test('quick rows say what they allow and their value', () => {
    const fmt = n => n.toLocaleString('en-US');
    assert.deepEqual(quickOffers(verdictOf(V())), ['Quick trade · $1,200']);
    assert.deepEqual(quickOffers(verdictOf(V({ quickRelease: true })), fmt), ['Quick trade · $1,200', 'Quick release · 85 CC']);
    // a loc token the game can't translate here: the numeric price
    const tokens = verdictOf(V({ quickTradeValue: '[Currency:Value=1200]', quickRelease: true, quickReleaseValue: '' }));
    assert.deepEqual(quickOffers(tokens, fmt, s => s), ['Quick trade · $1,200', 'Quick release · 85 CC']);
    // translated by the game
    assert.equal(quickValueText(tokens, 'quickTrade', fmt, s => (s.startsWith('[Currency') ? '$1,200.00' : s)), '$1,200.00');
    // no value at all
    assert.deepEqual(quickOffers(verdictOf(V({ quickTradeValue: '', quickTradePrice: null }))), ['Quick trade']);
    assert.deepEqual(quickOffers(null), []);
});

test('page report v2: the quick fields encode |, ",", % and long nested tokens', () => {
    const store = {
        'hubAnimalsData/animalStorageData': { selectedAnimalIDs: ['animal_3'] },
        'hubAnimalsData/animalStorageData/actions': {
            tradeAllowed: false, tradeDisallowedReason: LONG + '\n',
            quickTradeAllowed: true, quickTradeValue: '$1,200', quickTradeDisallowedReason: '',
            quickReleaseAllowed: false, quickReleaseDisallowedReason: 'a|b,c%d 100% |x| é', quickReleaseValue: 85, rehomeAllowed: false,
        },
        animalTradeListingData: { tradePriceMin: 100, tradePriceMax: 5000, tradePriceDefault: 812.5, tradeDurationMin: 1, tradeDurationMax: 12, tradeDurationDefault: 6, quickTradePrice: 1200, quickReleasePrice: 85 },
        'hubAnimalsData/network': { connectingAction: true, loadingItems: false },
        'hubAnimalsData/animalStorageData/filters': { isReleaseable: false },
        'hubAnimalsData/animalStorageData/list/animal_3': { source: '[AnimalExchange_Source_Description:Value=|Wild, rescued|]' },
    };
    const read = (c, p) => (store[c.join('/')] || {})[p];
    const s = readSeen('animal_3', read);
    const text = encodeSeen(s);
    assert.ok(text.startsWith('v2|animal_3|animal_3|0|100,5000,812.5,1,12,6|'));
    // 18 fields: no raw "|" left inside one (the last, the page id, empty here)
    assert.equal(text.split('|').length, 18);
    const field = name => decodeURIComponent(seenField(text, name));
    assert.equal(field('reason'), LONG + '\n');
    assert.equal(field('selection'), 'animal_3');
    assert.equal(field('allowed'), '0');
    assert.equal(field('limits'), '100,5000,812.5,1,12,6');
    assert.equal(field('quickTrade'), '1');
    assert.equal(field('quickTradeReason'), '');
    assert.equal(field('quickTradeValue'), '$1,200');
    assert.equal(field('quickRelease'), '0');
    assert.equal(field('quickReleaseReason'), 'a|b,c%d 100% |x| é');
    assert.equal(field('quickReleaseValue'), '85');
    assert.equal(field('rehome'), '0');
    assert.equal(field('quickPrices'), '1200,85');
    assert.equal(field('net'), '1,0');
    assert.equal(field('releaseable'), '0');
    assert.equal(field('source'), '[AnimalExchange_Source_Description:Value=|Wild, rescued|]');
    // nothing readable: every field still there, all unknown
    const empty = encodeSeen(readSeen('animal_3', () => { throw new Error('x'); }));
    assert.equal(empty, 'v2|animal_3|?|-|-,-,-,-,-,-||-|||-|||-|-,-|-,-|-||');
    assert.equal(empty.split('|').length, SEEN_FIELDS.length);
});

test('Check storage: the job, the animals it takes, the estimate, the summary', () => {
    const rows = [A('animal_1'), A('animal_2'), A('animal_3', { species: 'Tiger' }), A('animal_4', { maturity: 0 }), A('animal_5')];
    const guids = new Map([['animal_1', '11'], ['animal_2', '12'], ['animal_3', '13'], ['animal_4', '14']]);
    const verdicts = new Map([['12', verdictOf(V())]]);
    const out = deskRows(rows, guids, advise, new Set(['animal_5']), null, verdicts);
    // of the shown species, with an id, not blocked by its row, not checked yet
    assert.deepEqual(uncheckedRows(out, 'Lion').map(r => r.key), ['animal_1']);
    assert.deepEqual(uncheckedRows(out, null).map(r => r.key), ['animal_1', 'animal_3']);
    const job = encodeCheckJob(uncheckedRows(out, null), { paceMs: 50 });
    assert.equal(job.text, `v1 ${CHECK_PACE_MS} check\n11 animal_1 - default\n13 animal_3 - default`);
    assert.equal(job.items.length, 2);
    assert.equal(checkPaceMs(3000), 150);
    assert.equal(checkMinutes(0), 0);
    assert.equal(checkMinutes(1), 1);
    assert.equal(checkMinutes(60), 2);
    // a run's verdicts and its summary
    const st = normalizeState({ run: 3, mode: 'check', phase: 'stopped', results: [
        { guid: '11', status: 'checked', verdict: V({ trade: true }) },
        { guid: '13', status: 'checked', verdict: V() },
        { guid: '15', status: 'checked', verdict: V({ quickTrade: false, rehome: true }) },
        { guid: '16', status: 'pending' },
    ] });
    assert.deepEqual(verdictsOfState(st, 1).map(([g, v]) => [g, categoryOf(v)]), [['11', 'market'], ['13', 'quick'], ['15', 'blocked']]);
    assert.equal(checkSummaryText(st), 'Checked 3 of 4: 1 sellable, 1 Quick trade, 1 not sellable; 1 not checked.');
    assert.equal(tally(st).checked, 3);
    // a check lists nothing: no Retry
    assert.deepEqual(retryGuids(st), []);
});

// --------------------------------- Quick trade / release from the desk (Phase 2)
// docs/PLAN-desk-quick-release.md 4
import {
    acceptedMode, encodeQuickJob, FIRST_TEXT, quickEligible, QUICK_MODES, QUICK_WARNING, quickRunSummary, quickSheet,
} from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

const FZ = '[AnimalExchange_Source_Description:Value=|Frontier Zoo|]';
// six rows: quick (trade + release), quick (trade only), market, rehome, from the storage list only, on the market
function quickRows() {
    const rows = [A('animal_1'), A('animal_2'), A('animal_3'), A('animal_4'), A('animal_5', { source: FZ }), A('animal_6', { auctionTimerSeconds: 300, source: FZ })];
    const guids = new Map(rows.map((a, i) => [a.key, String(500 + i)]));
    const verdicts = new Map([
        ['500', verdictOf(V({ quickRelease: true }))],
        ['501', verdictOf(V({ quickTradePrice: 800, quickTradeValue: '[COST:Value={800}]' }))],
        ['502', verdictOf(V({ trade: true }))],
        ['503', verdictOf(V({ rehome: true, quickTrade: false }))],
    ]);
    return deskRows(rows, guids, advise, new Set(), null, verdicts);
}

test('the storage list pre-classifies Frontier Zoo animals as Quick trade, labelled as such', () => {
    assert.equal(isFrontierZoo({ source: FZ }), true);
    assert.equal(isFrontierZoo({ source: '[AnimalExchange_Source_Description:Value=|Simmons Zoo|]' }), false);
    assert.equal(isFrontierZoo({}), false);
    const out = quickRows();
    assert.deepEqual(out.map(r => r.block), ['quick', 'quick', null, 'rehome', 'quick', 'listed']);
    assert.deepEqual(out.map(r => !!r.pre), [false, false, false, false, true, false]);
    // never listable; Check storage still checks it
    assert.equal(tickable(out[4]), false);
    assert.deepEqual(uncheckedRows(out).map(r => r.key), ['animal_5']);
    // a verdict replaces the pre-classification
    const v = new Map([['504', verdictOf(V({ trade: true }))]]);
    const again = deskRows([A('animal_5', { source: FZ })], new Map([['animal_5', '504']]), advise, new Set(), null, v);
    assert.deepEqual([again[0].block, again[0].pre], [null, false]);
});

test('quickEligible: every animal the game allows the action for, market ones included', () => {
    const out = quickRows();
    const ok = mode => out.map(r => quickEligible(r, mode).ok);
    // the market animal (animal_3) is allowed Quick trade but not Quick release
    assert.deepEqual(ok('quicktrade'), [true, true, true, false, true, false]);
    assert.deepEqual(ok('release'), [true, false, false, false, true, false]);
    assert.equal(quickEligible(out[2], 'quicktrade').market, true);
    assert.match(quickEligible(out[1], 'release').why, /doesn't allow Quick release for it \(not born in a player zoo\)/);
    assert.match(quickEligible(out[3], 'quicktrade').why, /only Rehome/);
    assert.match(quickEligible(out[5], 'quicktrade').why, /On the market/);
    // not checked yet (sellable or not): tickable, the engine checks each one
    // as it goes (2026-10-19: quick actions for any animal)
    const raw = deskRows([A('animal_7'), A('animal_8', { isPregnant: true })], new Map([['animal_7', '70'], ['animal_8', '80']]), advise, new Set(), null, new Map());
    assert.deepEqual(quickEligible(raw[0], 'quicktrade'), { ok: true, why: '', unchecked: true, market: true });
    assert.deepEqual(quickEligible(raw[1], 'release'), { ok: true, why: '', unchecked: true, market: false });
    assert.equal(quickEligible(Object.assign({}, raw[0], { block: 'noid' }), 'quicktrade').ok, false);
    assert.equal(quickEligible(Object.assign({}, raw[0], { block: 'moving' }), 'release').ok, false);
    assert.equal(quickEligible(out[4], 'quicktrade').pre, true);
    assert.equal(quickEligible(out[0], 'list').ok, false);
});

test('the sheet: go and skip lists, exact totals, the first-run limit, 12 names then "and N more"', () => {
    const out = quickRows();
    const fmt = n => n.toLocaleString('en-US');
    const name = r => r.key;
    let s = quickSheet([out[0], out[1], out[3]], 'quicktrade', { fmt, nameOf: name });
    assert.deepEqual(s.go.map(r => r.key), ['animal_1', 'animal_2']);
    assert.deepEqual(s.skip.map(x => x.r.key), ['animal_4']);
    assert.equal(s.total, 2000);
    assert.equal(s.exact, true);
    assert.equal(s.totalText, '$2,000');
    assert.equal(s.button, 'Quick trade 2 animals ($2,000)…');
    assert.equal(s.title, 'Quick trade 2 animals for $2,000?');
    // a market animal goes too, at its own price
    s = quickSheet([out[0], out[2]], 'quicktrade', { fmt, nameOf: name });
    assert.deepEqual([s.go.length, s.totalText], [2, '$2,400']);
    // release: its own prices, in CC; the trade-only one is skipped with why
    s = quickSheet([out[0], out[1]], 'release', { fmt, nameOf: name });
    assert.deepEqual([s.go.length, s.totalText, s.skip.length], [1, '85 CC', 1]);
    assert.match(s.skip[0].why, /Quick release/);
    // not accepted yet: one animal, the rest skipped with the reason
    s = quickSheet([out[0], out[1]], 'quicktrade', { fmt, nameOf: name, accepted: false });
    assert.deepEqual([s.go.length, s.skip.length, s.skip[0].why], [1, 1, `${FIRST_TEXT.quicktrade}.`]);
    // a pre-classified one has no price yet: "+ 1 priced when checked", not exact
    s = quickSheet([out[0], out[4]], 'quicktrade', { fmt, nameOf: name });
    assert.equal(s.totalText, '$1,200 + 1 priced when checked');
    assert.equal(s.exact, false);
    // the prices not matching the value texts (Phase 0a said they do): ≈
    s = quickSheet([out[0]], 'quicktrade', { fmt, nameOf: name, matched: false });
    assert.deepEqual([s.totalText, s.exact], ['≈ $1,200', false]);
    // 15 animals: 12 names, "and 3 more"
    const many = Array.from({ length: 15 }, () => out[0]);
    s = quickSheet(many, 'quicktrade', { fmt, nameOf: name });
    assert.deepEqual([s.names.length, s.more, s.totalText], [12, 3, '$18,000']);
    assert.match(QUICK_WARNING, /can't be undone/);
    assert.match(QUICK_MODES.quicktrade.header, /^QUICK TRADE · sells for cash at once · can't be undone$/);
});

test('the quick job is frozen to the rows given; summary and acceptance', () => {
    const out = quickRows();
    const job = encodeQuickJob([out[0], out[1]], { mode: 'release', paceMs: 200 });
    assert.equal(job.text, 'v1 200 release\n500 animal_1 - default\n501 animal_2 - default');   // the engine keeps the 1 s floor
    assert.equal(encodeQuickJob([out[0]], { mode: 'list', paceMs: 3000 }).text, '');
    const st = normalizeState({ run: 9, mode: 'quicktrade', phase: 'stopped', message: 'Stopped: page reloaded.', results: [
        { guid: '500', status: 'traded', price: 1200 }, { guid: '501', status: 'traded', price: 800 }, { guid: '502', status: 'unconfirmed', kind: 'unconfirmed' }, { guid: '503', status: 'pending' },
    ] });
    assert.equal(quickRunSummary(st, n => n.toLocaleString('en-US')), 'Quick-traded 2 of 4 · $2,000');
    assert.equal(tally(st).traded, 2);
    assert.deepEqual(retryGuids(st), []);
    assert.equal(acceptedMode(st), null);
    const one = normalizeState({ run: 10, mode: 'release', phase: 'done', results: [{ guid: '500', status: 'released', price: 85 }] });
    assert.equal(acceptedMode(one), 'release');
    assert.equal(quickRunSummary(one), 'Released 1 of 1 · 85 CC');
    assert.equal(acceptedMode(normalizeState({ run: 11, mode: 'release', phase: 'stopped', results: [{ guid: '500', status: 'unconfirmed' }] })), null);
    assert.equal(acceptedMode(normalizeState({ run: 12, mode: 'release', phase: 'running', results: [{ guid: '500', status: 'released' }] })), null);
    assert.equal(RESULT_WORDS.unconfirmed, 'not confirmed: check storage');
    // the page report carries this page's id (a quick run stops on another's)
    assert.equal(seenField(encodeSeen({ key: 'animal_1', sel: ['animal_1'], allowed: false, page: 'ab12c' }), 'page'), 'ab12c');
});

// Quick trade is proven in game (Y: 2026-10-18): no one-animal limit for it;
// Quick release keeps the limit until its own first confirmed run.
import { quickAccepted, QUICK_PROVEN } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

test('the live acceptance: Quick trade proven, Quick release until its first run', () => {
    assert.equal(QUICK_PROVEN.quicktrade, true);
    assert.equal(quickAccepted('quicktrade', null), true);
    assert.equal(quickAccepted('quicktrade', { quicktrade: false }), true);
    assert.equal(quickAccepted('release', null), false);
    assert.equal(quickAccepted('release', { quicktrade: true }), false);
    assert.equal(quickAccepted('release', { release: true }), true);
    assert.equal(QUICK_MODES.quicktrade.confirm, 'Quick trade now');
});

import { refusedGuids } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

test('the animals the server refused in a listing run, for Quick trade', () => {
    const st = normalizeState({ run: 20, mode: 'list', phase: 'done', results: [
        { guid: '500', status: 'listed' }, { guid: '501', status: 'refused', kind: 'refused', detail: 'Refused by the server (Unknown).' },
        { guid: '502', status: 'skipped', kind: 'untradeable' }, { guid: '503', status: 'refused', kind: 'refused' },
    ] });
    assert.deepEqual(refusedGuids(st), ['501', '503']);
    assert.deepEqual(refusedGuids(normalizeState({ run: 21, mode: 'check', results: [{ guid: '1', kind: 'refused' }] })), []);
    assert.deepEqual(refusedGuids(null), []);
});

import { normalizeRefused, refusedNote, REFUSED_OPTIONS } from '../mods/PZ2QoL/UI/UIGameface/js/mods/pz2qol/listercore.js';

test('When the server refuses a listing: the job option, the up-front note, the summary', () => {
    const rows = [{ guid: '11', key: 'animal_1', a: {}, advice: { price: 500 } }];
    assert.equal(encodeJob(rows, { paceMs: 3000 }).text.split('\n')[0].split(' ').length, 2);
    assert.equal(encodeJob(rows, { paceMs: 3000, onRefused: 'leave' }).text.split('\n')[0], 'v1 3000');
    assert.equal(encodeJob(rows, { paceMs: 3000, onRefused: 'quicktrade' }).text.split('\n')[0], 'v1 3000 list onrefused=quicktrade');
    assert.equal(encodeJob(rows, { paceMs: 3000, onRefused: 'release', refusedMax: 1 }).text.split('\n')[0], 'v1 3000 list onrefused=release refusedmax=1');
    assert.equal(normalizeRefused('sell'), 'leave');
    assert.deepEqual(Object.keys(REFUSED_OPTIONS), ['leave', 'quicktrade', 'release']);
    assert.equal(refusedNote('leave'), '');
    assert.equal(refusedNote('quicktrade'), 'Refused ones: quick-traded at once (permanent).');
    assert.equal(refusedNote('release', { limitOne: true }), 'Refused ones: released at once (permanent), the first one only.');
    const st = normalizeState({ run: 30, mode: 'list', onRefused: 'quicktrade', phase: 'done', results: [
        { guid: '1', status: 'listed', price: 500 }, { guid: '2', status: 'traded', afterRefused: true, price: 1200 },
        { guid: '3', status: 'traded', afterRefused: true, price: 800 }, { guid: '4', status: 'refused', kind: 'refused' },
    ] });
    assert.equal(summaryText(st, n => n.toLocaleString('en-US')), 'Listed 1 of 4 (≈ 500 CC asked); quick-traded 2 after refusal ($2,000); not listed 1 (1 refused by the server).');
});
