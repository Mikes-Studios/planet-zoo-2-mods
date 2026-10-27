// Shared kit for the mod's big Kin panels (kinplanner.js, kinboard.js):
// scroll areas, buttons, switches, count pills, and a tiny registry so the
// panels can open each other without importing each other.
//
// Gameface: the game UI never scrolls natively (its ScrollPane keeps the
// content in an overflow:hidden box, sets scrollTop itself and handles the
// wheel), so these scroll areas do the same, with their own thumbs.
import { SEVERITY_INFO } from '/js/mods/pz2qol/kincore.js';
import { COUNTED, countWord } from '/js/mods/pz2qol/kinplannercore.js';
import { crossMark, h, icon, remPx, setClass } from '/js/mods/pz2qol/ui.js';
import { reportError } from '/js/mods/pz2qol/errors.js';

// ------------------------------------------------------------- registry

const panels = new Map();

// api: { open(opts), close(), isOpen() }
export function registerPanel(name, api) {
    panels.set(name, api);
}

export function panelApi(name) {
    return panels.get(name) || null;
}

// Closes every other big panel (one at a time on screen).
export function closeOtherPanels(name) {
    for (const [n, api] of panels) {
        if (n === name) continue;
        try {
            if (api.isOpen()) api.close();
        }
        catch (e) {
            // keep going
        }
    }
}

// --------------------------------------------------------------- helpers

export function makeGuard(prefix) {
    return function guard(label, fn) {
        return (...args) => {
            try {
                return fn(...args);
            }
            catch (e) {
                reportError('ui', `${prefix}: ${label} failed`, e);
                return undefined;
            }
        };
    };
}

export { remPx };

// A data age in words: 'just now', '12 s ago', '3 min ago'.
export function ago(ms) {
    const s = Math.round(ms / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s} s ago`;
    return `${Math.round(s / 60)} min ago`;
}

export function trunc(text, n) {
    const s = String(text == null ? '' : text);
    return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;
}

// Species names: the game's name in the player's language (Kin setting
// gameSpeciesNames), else the internal one ("[Animal_RedPanda]" -> "RedPanda").
export { speciesName } from '/js/mods/pz2qol/speciesnames.js';

// Places a big panel: min(96rem, 92vw) wide (or as given), 84% of the view
// high, centred.
export function placePanel(root, { maxRem = 96, maxVw = 0.92 } = {}) {
    if (!root) return;
    const vw = window.innerWidth || 1920;
    const vh = window.innerHeight || 1080;
    const rem = remPx();
    const w = Math.round(Math.min(maxRem * rem, vw * maxVw));
    const ht = Math.round(Math.min(vh * 0.84, vh - 2 * rem));
    root.style.width = `${w}px`;
    root.style.height = `${ht}px`;
    root.style.left = `${Math.round((vw - w) / 2)}px`;
    root.style.top = `${Math.round((vh - ht) / 2)}px`;
}

// ----------------------------------------------------------------- widgets

export function btn(guard, label, iconName, onClick, { cls = '', title = '', tint = 'brown' } = {}) {
    const run = guard(label, onClick);
    const node = h(`div.PZ2QoL_kpBtn${cls ? '.' + cls : ''}`, {
        title: title || undefined,
        // a greyed-out button does nothing (it is still in the DOM)
        onClick: (...args) => (node.classList.contains('disabled') ? undefined : run(...args)),
    },
        iconName ? icon(iconName, tint, 'sm') : null,
        h('span', { text: label }));
    return node;
}

export function switchEl(guard, label, on, onClick, title) {
    return h(`div.PZ2QoL_kpSwitch${on ? '.on' : ''}`, { title: title || undefined, onClick: guard(label, onClick) },
        h('div.PZ2QoL_kpSwitchTrack', null, h('div.PZ2QoL_kpSwitchKnob')),
        h('div.PZ2QoL_kpSwitchLabel', { text: label }));
}

// A round close button.
export function closeButton(guard, title, onClick, small = false) {
    return h(`div.PZ2QoL_kpClose${small ? '.small' : ''}`, { title, onClick: guard('Close', onClick) },
        crossMark());
}

export function countPills(counts, { compact = false } = {}) {
    const out = [];
    for (const s of COUNTED) {
        const n = (counts && counts[s]) || 0;
        if (!n) continue;
        const info = SEVERITY_INFO[s];
        out.push(h(`div.PZ2QoL_kpCount.sev_${s}${compact ? '.compact' : ''}`, { title: `${info.label}: ${info.tip}` },
            h('span.PZ2QoL_kpCountN', { text: String(n) }),
            h('span.PZ2QoL_kpCountL', { text: compact ? info.short.toLowerCase() : countWord(s, n) })));
    }
    return out;
}

// ---------------------------------------------------------------- scrolling

export function maxScroll(box) {
    const r = box.vp.getBoundingClientRect();
    return {
        x: Math.max(0, Math.floor(box.vp.scrollWidth - r.width)),
        y: Math.max(0, Math.floor(box.vp.scrollHeight - r.height)),
        w: r.width,
        h: r.height,
    };
}

export function scrollBoxTo(box, left, top, quiet) {
    const m = maxScroll(box);
    const x = box.x ? Math.max(0, Math.min(m.x, Math.round(left))) : 0;
    const y = box.y ? Math.max(0, Math.min(m.y, Math.round(top))) : 0;
    if (box.vp.scrollLeft !== x) box.vp.scrollLeft = x;
    if (box.vp.scrollTop !== y) box.vp.scrollTop = y;
    if (box.onScroll) box.onScroll(x, y, !!quiet);
    updateBars(box, m);
}

export function updateBars(box, m) {
    m = m || maxScroll(box);
    const min = remPx() * 2;
    if (box.vbar) {
        const show = m.y > 1;
        setClass(box.vbar, 'show', show);
        if (show) {
            const track = box.vbar.getBoundingClientRect().height || m.h;
            const th = Math.max(min, track * m.h / (m.h + m.y));
            box.vthumb.style.height = `${Math.round(th)}px`;
            box.vthumb.style.top = `${Math.round((track - th) * (box.vp.scrollTop / m.y))}px`;
        }
    }
    if (box.hbar) {
        const show = m.x > 1;
        setClass(box.hbar, 'show', show);
        if (show) {
            const track = box.hbar.getBoundingClientRect().width || m.w;
            const tw = Math.max(min, track * m.w / (m.w + m.x));
            box.hthumb.style.width = `${Math.round(tw)}px`;
            box.hthumb.style.left = `${Math.round((track - tw) * (box.vp.scrollLeft / m.x))}px`;
        }
    }
}

// One wheel notch: down/up, or sideways with Shift (or when the box only
// scrolls sideways). Returns true when the box moved.
export function wheelScroll(box, e, preferX) {
    const m = maxScroll(box);
    const step = remPx() * 3.5;
    const ax = Math.abs(e.deltaX || 0), ay = Math.abs(e.deltaY || 0);
    const sideways = box.x && m.x > 0 && (preferX || e.shiftKey || !box.y || m.y <= 0 || ax > ay);
    const d = sideways ? (ax > ay ? e.deltaX : e.deltaY) : e.deltaY;
    const s = d > 0 ? step : d < 0 ? -step : 0;
    const x0 = box.vp.scrollLeft, y0 = box.vp.scrollTop;
    if (sideways) scrollBoxTo(box, x0 + s, y0);
    else scrollBoxTo(box, x0, y0 + s);
    return box.vp.scrollLeft !== x0 || box.vp.scrollTop !== y0;
}

function dragThumb(box, axis) {
    const thumb = axis === 'y' ? box.vthumb : box.hthumb;
    const bar = axis === 'y' ? box.vbar : box.hbar;
    thumb.addEventListener('mousedown', e => {
        try {
            e.preventDefault();
            e.stopPropagation();
            const start = axis === 'y' ? e.clientY : e.clientX;
            const from = axis === 'y' ? box.vp.scrollTop : box.vp.scrollLeft;
            const m = maxScroll(box);
            const br = bar.getBoundingClientRect(), tr = thumb.getBoundingClientRect();
            const track = axis === 'y' ? br.height - tr.height : br.width - tr.width;
            const ratio = (axis === 'y' ? m.y : m.x) / Math.max(1, track);
            setClass(thumb, 'drag', true);
            const move = ev => {
                const d = ((axis === 'y' ? ev.clientY : ev.clientX) - start) * ratio;
                if (axis === 'y') scrollBoxTo(box, box.vp.scrollLeft, from + d);
                else scrollBoxTo(box, from + d, box.vp.scrollTop);
            };
            const up = () => {
                setClass(thumb, 'drag', false);
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        }
        catch (err) {
            reportError('ui', 'Kin: scrolling failed', err, { silent: true });
        }
    });
    // a click on the track pages towards it
    bar.addEventListener('mousedown', e => {
        if (e.target !== bar) return;
        e.preventDefault();
        e.stopPropagation();
        const tr = thumb.getBoundingClientRect();
        const m = maxScroll(box);
        if (axis === 'y') scrollBoxTo(box, box.vp.scrollLeft, box.vp.scrollTop + (e.clientY < tr.top ? -1 : 1) * m.h * 0.85);
        else scrollBoxTo(box, box.vp.scrollLeft + (e.clientX < tr.left ? -1 : 1) * m.w * 0.85, box.vp.scrollTop);
    });
}

// An overflow:hidden viewport with wheel scrolling and its own thumbs.
// onWheel(box, e) may take the wheel over (return true when it did).
export function makeScroll(cls, { x = false, y = true, onScroll = null, onWheel = null } = {}) {
    const content = h('div.PZ2QoL_kpContent');
    const vp = h(`div.PZ2QoL_kpViewport${x ? '.xy' : ''}`, null, content);
    const wrap = h(`div.PZ2QoL_kpScroll${cls ? '.' + cls : ''}`, null, vp);
    const box = { wrap, vp, content, x, y, onScroll };
    if (y) {
        box.vthumb = h('div.PZ2QoL_kpThumb');
        box.vbar = h('div.PZ2QoL_kpBar.v', null, box.vthumb);
        wrap.appendChild(box.vbar);
        dragThumb(box, 'y');
    }
    if (x) {
        box.hthumb = h('div.PZ2QoL_kpThumb');
        box.hbar = h('div.PZ2QoL_kpBar.h', null, box.hthumb);
        wrap.appendChild(box.hbar);
        dragThumb(box, 'x');
    }
    // a click or focus can scroll an overflow:hidden box by itself
    vp.addEventListener('scroll', () => {
        try {
            if (box.onScroll) box.onScroll(vp.scrollLeft, vp.scrollTop, true);
            updateBars(box);
        }
        catch (err) {
            // cosmetic only
        }
    });
    vp.addEventListener('wheel', e => {
        e.preventDefault();
        e.stopPropagation();
        try {
            if (onWheel && onWheel(box, e)) return;
            wheelScroll(box, e, false);
        }
        catch (err) {
            reportError('ui', 'Kin: scrolling failed', err, { silent: true });
        }
    });
    return box;
}

// Restores a scroll position once the content is laid out.
export function restoreScroll(box, x, y) {
    setTimeout(() => {
        try {
            scrollBoxTo(box, x, y, true);
        }
        catch (e) {
            // gone
        }
    }, 0);
}

export function refreshBars(boxes) {
    for (const k in boxes) {
        try {
            if (boxes[k]) updateBars(boxes[k]);
        }
        catch (e) {
            // a box of a past render
        }
    }
}
