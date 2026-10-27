// Test stand-in for the game's Engine module: events go to the test's engine.
export function sendEvent(name, ...args) {
    globalThis.engine.trigger(name, ...args);
}
