// Thin layer over the game's UI modules: reading animal rows from the
// DataStore and sending the game's own UI events.
import * as DS from '/js/common/core/DataStore.js';
import { sendEvent } from '/js/common/core/Engine.js';
import { DataStoreCollection } from '/js/common/data/DataStoreCollection.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';

export const MARKET_LIST = ['hubAnimalsData', 'animalMarketData', 'list'];
export const STORAGE_LIST = ['hubAnimalsData', 'animalStorageData', 'list'];
export const HISTORY_LIST = ['hubAnimalsData', 'animalHistoryData', 'list'];
export const STORAGE_DATA = ['hubAnimalsData', 'animalStorageData'];
export const STORAGE_ACTIONS = ['hubAnimalsData', 'animalStorageData', 'actions'];
export const SPECIES_LIST = ['hubAnimalsData', 'species'];
export const TRADE_LISTING = ['animalTradeListingData'];
export const MARKET_EVENT = 'AnimalMarket';
export const STORAGE_EVENT = 'AnimalStorage';

export function contextKey(context) {
    return Array.isArray(context) ? context.join('/') : String(context);
}

export const MARKET_LIST_KEY = contextKey(MARKET_LIST);
export const ZOO_LIST = ['management', 'animals', 'animals', 'list'];
export const ZOO_LIST_KEY = contextKey(ZOO_LIST);
export const STORAGE_LIST_KEY = contextKey(STORAGE_LIST);

export function get(context, prop) {
    try {
        return DS.getValue(context, prop);
    }
    catch (e) {
        return undefined;
    }
}

export function isExpired(ctx) {
    const timer = get(ctx, 'auctionTimerSeconds');
    return timer != undefined && timer <= 0;
}

// A market row still for sale: not expired and not adopted (already bought),
// the two the game labels instead of a price (MarketAnimalListItem).
export function isLiveAsk(ctx) {
    return get(ctx, 'isAdopted') !== true && !isExpired(ctx);
}

function gene(context, id) {
    const v = get(context.concat(['genetics', id]), 'value');
    return typeof v === 'number' ? v : undefined;
}

const ROW_PROPS = ['id', 'species', 'gender', 'maturity', 'age', 'isShoal', 'isExhibit', 'isPregnant', 'isAlpha', 'storageTag',
    'auctionPrice', 'auctionIsConservationCredits', 'auctionTimerSeconds', 'isMoving', 'name', 'ratings', 'colormorphLabel', 'source'];
let refusalLogged = false;

// Every row property in one native call; one by one where the game refuses
// the batch (a row whose context is gone throws there, not in getValue)
function rowValues(context) {
    try {
        return DS.getValues(context, ROW_PROPS) || {};
    }
    catch (e) {
        if (!refusalLogged) dlog('ui', 'row_batch_refused', { error: String(e) });
        refusalLogged = true;
    }
    const out = {};
    for (const prop of ROW_PROPS) out[prop] = get(context, prop);
    return out;
}

// Builds the plain animal object used by scores.js from a row context.
// "[AnimalExchange_Animal_Age:Years=(4.8)]" -> 4.8
function yearsOf(raw) {
    const m = typeof raw === 'string' ? raw.match(/Years=\(([\d.]+)\)/) : null;
    return m ? Number(m[1]) : undefined;
}

export function readAnimal(context) {
    const v = rowValues(context);
    return {
        id: v.id,
        species: v.species,
        gender: v.gender,
        maturity: v.maturity,
        age: yearsOf(v.age),
        isShoal: !!v.isShoal,
        isExhibit: !!v.isExhibit,
        isPregnant: !!v.isPregnant,
        isAlpha: !!v.isAlpha,
        storageTag: v.storageTag,
        price: v.auctionPrice,
        isCC: !!v.auctionIsConservationCredits,
        auctionTimerSeconds: v.auctionTimerSeconds,
        isMoving: !!v.isMoving,
        name: v.name,
        // genetics medal of the Rating column: 'none'|'bronze'|'silver'|'gold'
        medal: v.ratings,
        // what the info panel shows under "Colour morph" (a label or loc
        // token, maybe a "normal" word); see morphOf() in pricing.js
        colormorph: v.colormorphLabel,
        // where it came from ("[AnimalExchange_Source_Description:Value=|Frontier Zoo|]"):
        // a Frontier zoo means the market won't take it (marketdesk Quick trade)
        source: v.source,
        key: childKey(context),
        genes: {
            size: gene(context, 'size'),
            longevity: gene(context, 'longevity'),
            fertility: gene(context, 'fertility'),
            immunity: gene(context, 'immunity'),
        },
    };
}

// The list child key (e.g. "animal_12"): what the game's own info panel
// sends with AddToMarket. Selection events use the row's 'id' property.
export function childKey(context) {
    return Array.isArray(context) && context.length ? context[context.length - 1] : undefined;
}

// Children of a DataStore context, via the game's own collection class.
const collections = new Map();
export function childrenOf(context) {
    const key = contextKey(context);
    let col = collections.get(key);
    if (!col) {
        col = new DataStoreCollection(context);
        collections.set(key, col);
    }
    return col._source.slice();
}

// A row of the zoo management Animals list. Genes live in the row's
// genetics tooltip (Size/Longevity/Fertility/Immunity, 0..1; exhibit
// animals only have Longevity/Fertility). Location is a loc string, e.g.
// "[STRING_LITERAL:Value=|Savannah Habitat|]" for habitats and exhibits.
function zooGene(context, id) {
    const v = get(context.concat(['geneticsTooltip', 'list', id]), 'value');
    return typeof v === 'number' ? v : undefined;
}

export function locationName(raw) {
    if (typeof raw !== 'string') return null;
    const m = raw.match(/^\[STRING_LITERAL:Value=\|(.*)\|\]$/);
    return m ? m[1] : raw;
}

export function readZooAnimal(context) {
    const genes = {
        size: zooGene(context, 'Size'),
        longevity: zooGene(context, 'Longevity'),
        fertility: zooGene(context, 'Fertility'),
        immunity: zooGene(context, 'Immunity'),
    };
    return {
        id: get(context, 'id'),
        key: childKey(context),
        name: get(context, 'name'),
        species: get(context, 'species'),
        gender: get(context, 'gender'),
        maturity: get(context, 'maturity'),
        isPregnant: !!get(context, 'isPregnant'),
        isAlpha: !!get(context, 'isAlpha'),
        contracepted: !!get(context, 'contracepted'),
        welfare: get(context, 'welfareProgress'),
        habitat: locationName(get(context, 'location')),
        isShoal: false,
        isExhibit: genes.size === undefined && genes.longevity !== undefined,
        genes,
    };
}

// The Animals screen's own navigation event (ManagementData: gameEventID
// zoo_animals, sub tab animals): the game opens its Animals tab again.
export function reopenZooAnimals() {
    sendEvent('ManagementScreenChanged', 'zoo_animals', 'animals');
}

export function sendScreenEvent(screenEventId, suffix, value) {
    if (value === undefined) {
        sendEvent(`${screenEventId}_${suffix}`);
    }
    else {
        sendEvent(`${screenEventId}_${suffix}`, value);
    }
}
