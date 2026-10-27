// The little DOM the mod's own widgets use (ui.js h()), for tests: elements
// keep classes, styles, attributes, children and listeners; boxes are what
// the test sets; fire() sends an event to an element's listeners.
export function fakeElement(tag) {
    const classes = new Set();
    const node = {
        tagName: String(tag).toUpperCase(),
        childNodes: [], parentNode: null, style: {}, dataset: {}, attributes: {}, listeners: {},
        textContent: '',
        box: { left: 0, top: 0, width: 0, height: 0 },
        get className() {
            return Array.from(classes).join(' ');
        },
        set className(value) {
            classes.clear();
            String(value).split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
        },
        classList: {
            add: (...names) => names.forEach(c => classes.add(c)),
            remove: (...names) => names.forEach(c => classes.delete(c)),
            contains: c => classes.has(c),
            toggle: (c, on) => {
                const want = on === undefined ? !classes.has(c) : !!on;
                if (want) classes.add(c);
                else classes.delete(c);
                return want;
            },
        },
        get firstChild() {
            return node.childNodes[0] || null;
        },
        appendChild(child) {
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = node;
            node.childNodes.push(child);
            return child;
        },
        removeChild(child) {
            node.childNodes = node.childNodes.filter(c => c !== child);
            child.parentNode = null;
            return child;
        },
        remove() {
            if (node.parentNode) node.parentNode.removeChild(node);
        },
        setAttribute(name, value) {
            node.attributes[name] = String(value);
        },
        getAttribute(name) {
            return node.attributes[name] ?? null;
        },
        addEventListener(type, fn) {
            (node.listeners[type] ||= []).push(fn);
        },
        removeEventListener() {},
        fire(type, event = {}) {
            for (const fn of node.listeners[type] || []) fn(Object.assign({ stopPropagation() {}, preventDefault() {} }, event));
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => Object.assign({ right: node.box.left + node.box.width, bottom: node.box.top + node.box.height }, node.box),
    };
    return node;
}

// Puts a document of these elements on globalThis; returns it (fire() sends a document event).
export function installFakeDocument() {
    const doc = fakeElement('document');
    doc.createElement = fakeElement;
    doc.createTextNode = text => Object.assign(fakeElement('#text'), { textContent: String(text) });
    doc.getElementById = () => null;
    doc.body = fakeElement('body');
    doc.head = fakeElement('head');
    globalThis.document = doc;
    return doc;
}
