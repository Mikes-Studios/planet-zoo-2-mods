// Test stand-in for game.js: DataStore rows are plain objects in `screen`, read the way game.js reads them.
export const MARKET_LIST = 'market';
export const HISTORY_LIST = 'history';

export const screen = { market: [], history: [], animalReads: 0 };

export function childrenOf(list) {
    return screen[list].slice();
}

export function get(row, prop) {
    return row[prop];
}

export function isExpired(row) {
    return row.auctionTimerSeconds != undefined && row.auctionTimerSeconds <= 0;
}

export function isLiveAsk(row) {
    return row.isAdopted !== true && !isExpired(row);
}

export function readAnimal(row) {
    screen.animalReads++;
    return {
        species: row.species, name: row.name, gender: row.gender, maturity: row.maturity,
        isShoal: !!row.isShoal, isExhibit: !!row.isExhibit, price: row.auctionPrice, isCC: !!row.auctionIsConservationCredits,
        auctionTimerSeconds: row.auctionTimerSeconds, medal: row.ratings, colormorph: row.colormorphLabel,
        genes: Object.assign({ size: 0.5, longevity: 0.5, fertility: 0.5, immunity: 0.5 }, row.genes),
    };
}
