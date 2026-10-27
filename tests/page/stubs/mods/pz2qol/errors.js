// Test stand-in for errors.js: reports land in the fake game's errors (tests/listerpage.js).
export function breadcrumb() {}
export function reportError(...args) {
    globalThis.__game.errors.push(args);
}
export function onErrorReported() {
    return () => {};
}
