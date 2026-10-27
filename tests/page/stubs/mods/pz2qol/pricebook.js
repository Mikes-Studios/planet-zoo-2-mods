// Test stand-in for pricebook.js: the listings seen are the fake game's book (tests/listerpage.js).
export const getPriceBook = () => globalThis.__game.book;
export const countForSpecies = () => 0;
export const onPriceBookChanged = () => () => {};
export const recordVisibleListings = () => 0;
