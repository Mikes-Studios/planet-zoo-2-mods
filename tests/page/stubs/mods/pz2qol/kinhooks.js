// Test stand-in for kinhooks.js: the page is whatever the test says.
export function isFrontendPage() {
    return globalThis.testPage !== 'hud';
}

export function isHudPage() {
    return globalThis.testPage === 'hud';
}
