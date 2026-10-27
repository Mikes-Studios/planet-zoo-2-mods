// Tiny DOM toolkit for the mod's own widgets (kept outside the game's
// preact tree). Gameface makes every element a flex row by default, so
// layout is expressed with explicit classes in pz2qol.css.

// h('div.cls1.cls2', { title, onClick, style }, ...children)
export function h(spec, props, ...children) {
    const [tag, ...classes] = spec.split('.');
    const node = document.createElement(tag || 'div');
    if (classes.length) node.className = classes.join(' ');
    if (props) {
        for (const key in props) {
            const value = props[key];
            if (value == undefined || value === false) continue;
            if (key == 'onClick') {
                node.addEventListener('click', e => {
                    e.stopPropagation();
                    if (node.classList.contains('disabled')) return;
                    value(e);
                });
            }
            else if (key == 'style') Object.assign(node.style, value);
            else if (key == 'text') node.textContent = value;
            else if (key == 'cls') node.className += (node.className ? ' ' : '') + value;
            else node.setAttribute(key, value);
        }
    }
    append(node, children);
    return node;
}

export function append(node, children) {
    for (const child of children) {
        if (child == undefined || child === false) continue;
        if (Array.isArray(child)) append(node, child);
        else node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
    }
    return node;
}

export function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
}

// The game's SVG icons, tinted with the game's own filter variables.
export function icon(name, tint = 'brown', extra = '') {
    return h(`div.PZ2QoL_icon.tint_${tint}${extra ? '.' + extra : ''}`, { style: { backgroundImage: `url(/img/icons/${name}.svg)` } });
}

// A close cross for a round button: the game's icon, never two CSS-rotated
// bars (Gameface can draw the elements after them with their rotation).
export function crossMark() {
    return icon('Icon_Close', 'brown', 'cross');
}

export function setText(node, text) {
    if (node.textContent != text) node.textContent = text;
}

export function setClass(node, cls, on) {
    if (node.classList.contains(cls) != !!on) node.classList.toggle(cls, !!on);
}

// Its box on screen, or null when it is hidden, removed from the page or 0 x 0.
export function visibleBox(node) {
    if (!node) return null;
    for (let n = node; n && n != document.body; n = n.parentNode) {
        if (n.classList && (n.classList.contains('hidden') || n.classList.contains('displayNone') || n.classList.contains('tooltipHidden'))) return null;
    }
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
}

// A game popup (Compare Mates, Genealogy...) is over the screen: our fixed widgets would float on top of it.
export function isGamePopupOpen() {
    return !!document.querySelector('.PopupActionsModule_root.show');
}

// one rem in pixels (the game scales its UI through the root font size)
export function remPx() {
    try {
        return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    }
    catch (e) {
        return 16;
    }
}

// For a page's poller: tick() -> when sel's node came on screen (0 while it
// is not); onShown(at) runs once each time it comes up.
export function visibilityWatch(sel, onShown) {
    let since = 0;
    return () => {
        if (!visibleBox(document.querySelector(sel))) {
            since = 0;
            return since;
        }
        if (!since) {
            since = Date.now();
            onShown(since);
        }
        return since;
    };
}

export const GENES = [
    { id: 'size', label: 'Size', icon: 'IconSize' },
    { id: 'longevity', label: 'Longevity', icon: 'IconLongevity' },
    { id: 'fertility', label: 'Fertility', icon: 'IconFertility' },
    { id: 'immunity', label: 'Immunity', icon: 'IconImmunity' },
];

// Four tiny vertical bars, one per gene; empty slots for genes that don't apply.
export function geneBars(genes, relevant) {
    return h('div.PZ2QoL_geneBars', null, GENES.map(g => {
        const v = genes ? genes[g.id] : undefined;
        const on = relevant.includes(g.id) && typeof v === 'number';
        const pct = on ? Math.max(8, Math.round(v * 100)) : 0;
        return h(`div.PZ2QoL_geneBar${on ? '' : '.off'}`, { title: on ? `${g.label} ${Math.round(v * 100)}%` : `${g.label}: n/a` },
            h('div.PZ2QoL_geneBarFill', { style: { height: `${pct}%` }, cls: on ? tierOf(v * 100) : '' }));
    }));
}

export function tierOf(score) {
    if (score == null) return 'tier_none';
    if (score >= 80) return 'tier_great';
    if (score >= 60) return 'tier_good';
    if (score >= 40) return 'tier_fair';
    return 'tier_poor';
}

export function fmtInt(n) {
    if (n == null || !isFinite(n)) return '–';
    // no toLocaleString: Gameface's Intl support is not guaranteed
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
