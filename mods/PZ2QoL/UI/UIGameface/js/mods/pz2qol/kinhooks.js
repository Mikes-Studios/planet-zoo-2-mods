// Hooks Kin into the game's own Preact components.
//
// The game runs a Preact 8 fork. Its list rows are decorated classes
// (DataStoreComponent.decorate / Focusable.decorate wrap an anonymous inner
// class whose render builds the row). We patch the inner class's render
// once: call the original, then append a small Kin VNode to a known child.
// The game then renders our badge itself, so it survives row recycling,
// unlike DOM added from outside (Preact drops foreign nodes between its own).
//
// Every patch is guarded: if the VNode is not shaped as expected, or our
// code throws, the original VNode is returned untouched. Three failures in
// a row turn that patch off.
import { Component, h } from '/js/common/lib/preact.js';
import * as DS from '/js/common/core/DataStore.js';
import { getKinModel, getKinSettings, onKin, onKinSettings } from '/js/mods/pz2qol/kin.js';
import { SEVERITY_INFO } from '/js/mods/pz2qol/kincore.js';
import { hideKinCard, showKinCard, isKinCardPinnedTo } from '/js/mods/pz2qol/kinui.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

export { h };

// The class a decorator wraps: render(props) returns h(Inner, props).
export function unwrap(Decorated) {
    if (typeof Decorated !== 'function' || !Decorated.prototype || typeof Decorated.prototype.render !== 'function') return null;
    try {
        const v = Decorated.prototype.render.call({ props: {}, state: {}, context: {} }, {}, {}, {});
        return v && typeof v.nodeName === 'function' ? v.nodeName : null;
    }
    catch (e) {
        return null;
    }
}

// Unwraps until fn(Cls) is true (at most `depth` levels).
export function unwrapUntil(Decorated, fn, depth = 4) {
    let c = Decorated;
    for (let i = 0; i <= depth && c; i++) {
        try {
            if (c.prototype && typeof c.prototype.render === 'function' && fn(c)) return c;
        }
        catch (e) {
            // keep unwrapping
        }
        c = unwrap(c);
    }
    return null;
}

const patched = new Map(); // name -> { failures, off }

export function patchStatus() {
    const out = {};
    for (const [name, st] of patched) out[name] = st.off ? 'off' : 'on';
    return out;
}

// fn(vnode, props, state, context) runs after the original render with
// `this` = the component. It may change the VNode in place or return a
// new one.
export function patchRender(Cls, name, fn) {
    if (!Cls || !Cls.prototype || typeof Cls.prototype.render !== 'function') return false;
    if (Cls.prototype.__pz2qolKin && Cls.prototype.__pz2qolKin[name]) return true;
    const original = Cls.prototype.render;
    const st = { failures: 0, off: false };
    patched.set(name, st);
    Cls.prototype.render = function (props, state, context) {
        const vnode = original.call(this, props, state, context);
        if (st.off || !vnode) return vnode;
        try {
            const out = fn.call(this, vnode, props, state, context);
            st.failures = 0;
            return out || vnode;
        }
        catch (e) {
            if (++st.failures >= 3) {
                st.off = true;
                reportError('mod', `Kin: ${name} turned off`, e, { silent: true });
            }
            return vnode;
        }
    };
    Cls.prototype.__pz2qolKin = Object.assign({}, Cls.prototype.__pz2qolKin, { [name]: true });
    return true;
}

// --------------------------------------------------------- VNode helpers

export function classOf(v) {
    const a = v && v.attributes;
    if (!a) return '';
    const c = a.className != null ? a.className : a.class;
    return typeof c === 'string' ? c : '';
}

export function hasClass(v, cls) {
    return (' ' + classOf(v) + ' ').indexOf(' ' + cls + ' ') >= 0;
}

function childList(v) {
    const out = [];
    const walk = c => {
        if (Array.isArray(c)) c.forEach(walk);
        else if (c && typeof c === 'object' && 'nodeName' in c) out.push(c);
    };
    walk(v && v.children);
    return out;
}

// Depth-first search through children and VNode-valued attributes
// (ListItem's leftInternalChildren / rightInternalChildren ...).
export function findVNode(v, pred, depth = 12) {
    if (!v || typeof v !== 'object' || depth < 0) return null;
    if (pred(v)) return v;
    for (const c of childList(v)) {
        const hit = findVNode(c, pred, depth - 1);
        if (hit) return hit;
    }
    const a = v.attributes;
    if (a) {
        for (const k in a) {
            const x = a[k];
            if (x && typeof x === 'object' && 'nodeName' in x) {
                const hit = findVNode(x, pred, depth - 1);
                if (hit) return hit;
            }
        }
    }
    return null;
}

export function findByClass(v, cls) {
    return findVNode(v, n => hasClass(n, cls));
}

// Appends at the end (never pushes onto Preact's shared empty array).
// child right after ref, in ref's parent under root: a row of its own below
// a row of the game's (a line inside it would push the game's items out)
export function insertAfterVNode(root, ref, child) {
    const parent = findVNode(root, n => childList(n).includes(ref));
    if (!parent || !child) return false;
    // in place, in whichever (nested) children array holds ref: text and empty slots stay
    const insertIn = arr => {
        const i = arr.indexOf(ref);
        if (i >= 0) {
            arr.splice(i + 1, 0, child);
            return true;
        }
        return arr.some(c => Array.isArray(c) && insertIn(c));
    };
    return Array.isArray(parent.children) && insertIn(parent.children);
}

export function appendVNode(parent, child) {
    if (!parent || !child) return false;
    const kids = parent.children;
    parent.children = Array.isArray(kids) ? kids.concat([child]) : kids != null ? [kids, child] : [child];
    return true;
}

export function dsValue(ctx, key) {
    try {
        return Array.isArray(ctx) ? DS.getValue(ctx, key) : undefined;
    }
    catch (e) {
        return undefined;
    }
}

// ------------------------------------------------------------- KinSlot

// Renders props.compute(model) and re-renders whenever the kin data or the
// settings change. Returns nothing while Kin is off or has no data.
export class KinSlot extends Component {
    componentDidMount() {
        this._offKin = onKin(() => this.setState({ tick: (this.state.tick || 0) + 1 }));
        this._offSettings = onKinSettings(() => this.setState({ tick: (this.state.tick || 0) + 1 }));
    }

    componentWillUnmount() {
        if (this._offKin) this._offKin();
        if (this._offSettings) this._offSettings();
        if (this.base && isKinCardPinnedTo(this.base)) hideKinCard();
    }

    render(props) {
        try {
            const model = props.storage ? props.getModel && props.getModel() : getKinModel();
            if (!getKinSettings().enabled || !model) return h('div', { className: 'PZ2QoL_kinSlot empty' });
            const out = props.compute(model);
            return out || h('div', { className: 'PZ2QoL_kinSlot empty' });
        }
        catch (e) {
            return h('div', { className: 'PZ2QoL_kinSlot empty' });
        }
    }
}

export function kinSlot(compute, extra = {}) {
    return h(KinSlot, Object.assign({ compute }, extra));
}

// Hover peeks the card, click pins it (with actions).
// mouseover/mouseout (with a relatedTarget check) rather than
// mouseenter/leave: they bubble, which Gameface and the Preact fork handle
// reliably.
function inside(node, target) {
    for (let n = target; n; n = n.parentNode) if (n === node) return true;
    return false;
}

export function cardHandlers(build) {
    return {
        onMouseOver: e => {
            if (inside(e.currentTarget, e.relatedTarget)) return;
            showKinCard(e.currentTarget, build, false, true);
        },
        onMouseOut: e => {
            const anchor = e.currentTarget;
            if (inside(anchor, e.relatedTarget)) return;
            // a game tooltip popping up under the pointer also sends mouseout:
            // only hide once the pointer has really left the badge
            const r = anchor.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
            if (!isKinCardPinnedTo(null)) hideKinCard(anchor);
        },
        onMouseDown: e => e.stopPropagation(),
        onMouseUp: e => e.stopPropagation(),
        onClick: e => {
            e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            if (isKinCardPinnedTo(e.currentTarget)) return hideKinCard();
            showKinCard(e.currentTarget, build, true);
        },
    };
}

// The DNA badge as a VNode.
export function badgeVNode(severity, count, { compact = false, host = '', title, build } = {}) {
    const info = SEVERITY_INFO[severity] || SEVERITY_INFO.distant;
    const badge = h('div', Object.assign({ className: `PZ2QoL_kin sev_${severity}${compact ? ' compact' : ''}`, title: title || info.label }, build ? cardHandlers(build) : {}),
        h('div', { className: 'PZ2QoL_kinIcon' }),
        compact ? null : h('div', { className: 'PZ2QoL_kinLabel' }, info.short),
        count > 1 ? h('div', { className: 'PZ2QoL_kinCount' }, String(count)) : null);
    return host ? h('div', { className: `PZ2QoL_kinHost ${host}` }, badge) : badge;
}

// A one-line summary ("2 inbreeding risks · 1 close kin") as a VNode.
export function lineVNode(severity, text, { build, extraClass = '' } = {}) {
    return h('div', Object.assign({ className: `PZ2QoL_kinLine sev_${severity || 'none'}${extraClass ? ' ' + extraClass : ''}` }, build ? cardHandlers(build) : {}),
        h('div', { className: 'PZ2QoL_kinIcon' }),
        h('span', null, text));
}

// Lazily imports a game module (only on the page that already uses it, so
// the game's copy is shared and no extra CSS is pulled in).
export async function gameModule(path) {
    try {
        return await import(path);
    }
    catch (e) {
        reportError('mod', `Kin could not load ${path.split('/').pop()}`, e, { silent: true });
        return null;
    }
}

export function isHudPage() {
    return /HUD/i.test(String(location.pathname || ''));
}

export function isFrontendPage() {
    return /Frontend/i.test(String(location.pathname || ''));
}
