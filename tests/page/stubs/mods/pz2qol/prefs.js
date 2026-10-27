// Test stand-in for prefs.js: the player's settings are the fake game's prefs (tests/listerpage.js).
export const getPref = key => globalThis.__game?.prefs[key];
export function setPref(key, value) {
    globalThis.__game.prefs[key] = value;
}
export function updatePref(key, update) {
    setPref(key, update(getPref(key)));
}
export const onPrefs = () => () => {};
