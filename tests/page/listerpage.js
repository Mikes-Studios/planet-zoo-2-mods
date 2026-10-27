// A stand-in Animal Storage and Lua listing engine for the market page
// modules (lister.js, listerlua.js), on the fake page (fakepage.js). Load
// the page modules with LISTER_STUBS; each test starts from fakeGame().
import { triggered } from './fakepage.js';
import { setTestReader } from './stubs/common/core/DataStore.js';
import { setTestChildren } from './stubs/common/data/DataStoreCollection.js';

// the mod modules the lister tests read from the fake game instead (tests/stubs/mods/pz2qol)
export const LISTER_STUBS = ['errors.js', 'debuglog.js', 'speciesnames.js', 'pace.js', 'prefs.js', 'pricebook.js'];

const STORAGE_LIST = 'hubAnimalsData/animalStorageData/list';
const MARKET_DATA = 'hubAnimalsData/animalMarketData';
const MARKET_LIST = `${MARKET_DATA}/list`;
const ROW_FIELDS = { auctionPrice: 'price', auctionIsConservationCredits: 'isCC', ratings: 'medal', colormorphLabel: 'colormorph' };

// One storage row: a fertile adult unless told otherwise.
export function storageAnimal(key, fields = {}) {
    return Object.assign({
        key, id: Number(String(key).replace(/\D/g, '')) || 1, guid: `9${String(key).replace(/\D/g, '')}`,
        species: 'Lion', name: `Lion ${key}`, gender: 1, maturity: 2,
        genes: { size: 0.5, longevity: 0.5, fertility: 0.5, immunity: 0.5 },
    }, fields);
}

function rowValue(game, path, prop) {
    const row = game.rows.find(r => r.key === path[3]);
    if (!row) return undefined;
    if (path[4] === 'genetics') return prop === 'value' ? row.genes[path[5]] : undefined;
    return row[ROW_FIELDS[prop] || prop];
}

// One Market listing for the fake market's pages.
export function marketAnimal(species, key, price, fields = {}) {
    return Object.assign({ key, species, name: `${species} ${key}`, gender: 1, maturity: 2, price, isCC: true, genes: {} }, fields);
}

// The Lua side's default resolve answer, from the storage rows.
export function luaAnswer(game, keys) {
    const ids = {};
    const rows = {};
    for (const key of keys) {
        const row = game.rows.find(r => r.key === key);
        if (!row) continue;
        ids[key] = row.guid;
        rows[key] = { name: row.name, species: row.species, gender: row.gender };
    }
    return { ids, rows };
}

const reply = (event, ...args) => setTimeout(() => engine.emit(event, ...args), 0);

function answerLua(game) {
    engine.answer('PZ2QoL_ListerHello', reqId => {
        const caps = typeof game.lua.caps === 'function' ? game.lua.caps() : game.lua.caps;
        if (caps) reply('PZ2QoL_ListerCaps', reqId, JSON.stringify(caps));
    });
    engine.answer('PZ2QoL_ListerResolve', (reqId, keyList) => {
        const keys = String(keyList).split(',');
        const answer = game.lua.resolve ? game.lua.resolve(keys, game) : luaAnswer(game, keys);
        if (answer) setTimeout(() => engine.emit('PZ2QoL_ListerIds', reqId, JSON.stringify(answer)), answer.delayMs || 0);
    });
    engine.answer('PZ2QoL_ListerStart', (reqId, job) => {
        game.jobs.push(job);
        const results = String(job).split('\n').slice(1).map(line => ({ guid: line.split(' ')[0], status: 'pending' }));
        reply('PZ2QoL_ListerState', JSON.stringify({ run: game.jobs.length, req: reqId, phase: 'running', total: results.length, results }));
    });
}

// The Market as MarketPeek pages through it: one species filtered in, page
// by page, until the page releases it. market: { species: [[row, ...] per page] }
function answerMarket(game) {
    const state = (s, delayMs = 0) => setTimeout(() => engine.emit('PZ2QoL_MarketPeekState', s, ''), delayMs);
    engine.answer('PZ2QoL_MarketPeek', uid => {
        const entry = game.species.find(s => s.speciesUID === uid);
        game.peek = { species: entry && entry.speciesName, page: 0 };
        state('loading');
        state('ready', 5);
    });
    engine.answer('PZ2QoL_MarketPeekPage', page => {
        game.peek.page = page;
        state('loading');
        state('ready', 5);
    });
    engine.answer('PZ2QoL_MarketPeekRelease', () => {
        game.peek = null;
        state('done');
    });
}

function marketPage(game) {
    const pages = (game.peek && game.market[game.peek.species]) || [];
    return pages[game.peek ? game.peek.page : 0] || [];
}

export function fakeGame({ rows = [], selected = [], limits = {}, book = [], market = {} } = {}) {
    const from = triggered.length;
    const game = {
        rows, selected, limits, book, market, peek: null,
        species: [{ speciesName: 'Lion', speciesUID: 7 }].concat(Object.keys(market).map((s, i) => ({ speciesName: s, speciesUID: 100 + i }))),
        prefs: {}, errors: [], jobs: [],
        lua: { caps: { ok: true, storage: true, online: true, rows: rows.length, check: true } },
        value(context, prop) {
            const path = context.join('/').split('/');
            if (path.slice(0, 3).join('/') === STORAGE_LIST && path.length > 3) return rowValue(game, path, prop);
            if (path.slice(0, 3).join('/') === MARKET_LIST && path.length > 3) {
                const row = marketPage(game).find(r => r.key === path[3]);
                return row && path.length === 4 ? row[ROW_FIELDS[prop] || prop] : undefined;
            }
            if (context.join('/') === MARKET_DATA) {
                if (prop === 'pages') return game.peek ? (game.market[game.peek.species] || []).length : undefined;
                if (prop === 'pageIndex') return game.peek ? game.peek.page : undefined;
            }
            if (context.join('/') === 'hubAnimalsData/animalStorageData' && prop === 'selectedAnimalIDs') return game.selected;
            if (path[0] === 'animalTradeListingData') return game.limits[prop];
            if (path[0] === 'hubAnimalsData' && path[1] === 'species' && path.length === 3) return game.species[Number(path[2])]?.[prop];
            return undefined;
        },
        children(context) {
            const key = context.join('/');
            if (key === STORAGE_LIST) return game.rows.map(r => context.concat(r.key));
            if (key === MARKET_LIST) return marketPage(game).map(r => context.concat(r.key));
            if (key === 'hubAnimalsData/species') return game.species.map((s, i) => context.concat(String(i)));
            return [];
        },
        eventsNamed(name) {
            return triggered.slice(from).filter(e => e[0] === name);
        },
    };
    setTestReader(game.value);
    setTestChildren(game.children);
    answerLua(game);
    answerMarket(game);
    globalThis.__PZ2QOL_TEST_FRANCHISE = true;
    globalThis.__game = game;
    return game;
}

// The job lines after the head: { guid, key, price, hours }.
export function jobAnimals(text) {
    return String(text).split('\n').slice(1).map(line => {
        const [guid, key, price, hours] = line.split(' ');
        return { guid, key, price, hours };
    });
}
