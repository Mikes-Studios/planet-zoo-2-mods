// The Gameface page around the mod's page modules (load them with
// pageloader.js): engine, window, document (fakedom.js), localStorage,
// location and the page's timers are stand-ins. engine.answer(event, fn)
// replies to a trigger the way the Lua side does.
import { installFakeDocument } from './fakedom.js';

const handlers = new Map();
const answers = new Map();
export const triggered = [];

globalThis.engine = {
    on(event, fn) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(fn);
    },
    off() {},
    trigger(event, ...args) {
        triggered.push([event, ...args]);
        const answer = answers.get(event);
        if (answer) answer(...args);
    },
    call: () => Promise.resolve(null),
    answer(event, fn) { answers.set(event, fn); },
    emit(event, ...args) { for (const fn of handlers.get(event) || []) fn(...args); },
};

const storage = new Map();
globalThis.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
globalThis.location = { pathname: '/PZ2QoLHUD.html', search: '', hash: '' };
installFakeDocument();
globalThis.window = globalThis;
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);

// the page's timers (toasts live a minute, Auto mode ticks forever) end with the test
const pageTimers = new Map();   // handle -> its delay
const nodeSetTimeout = globalThis.setTimeout;
const nodeSetInterval = globalThis.setInterval;
const nodeClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
    const handle = nodeSetTimeout(() => {
        pageTimers.delete(handle);
        fn(...args);
    }, ms);
    pageTimers.set(handle, ms);
    return handle;
};
globalThis.setInterval = (fn, ms, ...args) => {
    const handle = nodeSetInterval(fn, ms, ...args);
    pageTimers.set(handle, ms);
    return handle;
};
globalThis.clearTimeout = handle => {
    pageTimers.delete(handle);
    nodeClearTimeout(handle);
};
globalThis.clearInterval = globalThis.clearTimeout;

// the delays of the page's timers still waiting
export function liveTimers() {
    return Array.from(pageTimers.values());
}

export function stopPageTimers() {
    for (const handle of pageTimers.keys()) nodeClearTimeout(handle);
    pageTimers.clear();
}

export const sleep = ms => new Promise(resolve => nodeSetTimeout(resolve, ms));

// the page's nodes showing exactly this text
export function nodesWithText(text, node = document.body) {
    const out = node.textContent === text && !node.childNodes.length ? [node] : [];
    for (const child of node.childNodes) out.push(...nodesWithText(text, child));
    return out;
}

// A click on the first button (a node with a click handler) showing this text.
export function clickText(text) {
    let node = nodesWithText(text)[0];
    while (node && !(node.listeners.click && node.listeners.click.length)) node = node.parentNode;
    if (!node) throw new Error(`no button "${text}" on the page`);
    for (const fn of node.listeners.click) fn({ stopPropagation() {} });
}
