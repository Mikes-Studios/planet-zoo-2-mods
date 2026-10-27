// Pauses between automated steps, set by the player with a slider:
//  - 'lister': after each listing the Market lister sends (Animal Storage)
//  - 'moves':  after each confirmed move of a Species board plan
// Only the pause between steps changes. Every step still waits for the game
// to confirm it, the lister still waits for the server to be idle, and the
// long pause after a server refusal stays as it is.
import { h, setClass, setText } from '/js/mods/pz2qol/ui.js';
import { breadcrumb } from '/js/mods/pz2qol/errors.js';
import { getPref, onPrefs, updatePref } from '/js/mods/pz2qol/prefs.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';

export const PACE = {
    lister: {
        label: 'Pause between listings',
        min: 1, max: 10, step: 0.5, def: 3,
        warn: 'Faster than the default (3 s). Every listing is a Franchise server request, and in testing a request sent too soon after a refusal was refused again and once crashed the game. The lister still waits for each listing to be confirmed and pauses the same time after a refusal.',
    },
    moves: {
        label: 'Pause between moves',
        // 0.5 s default and minimum: the developer, 2026-10-18 (was 1.5 s, minimum 1 s)
        min: 0.5, max: 10, step: 0.5, def: 0.5,
        warn: 'Each move still waits for the game to confirm it before the pause starts. In a Franchise zoo every move is also a server request.',
    },
};

const PREF_KEY = 'pace';

export function clampPace(kind, v) {
    const c = PACE[kind];
    const n = Number(v);
    if (!c || !isFinite(n)) return c ? c.def : 0;
    const stepped = Math.round(n / c.step) * c.step;
    return Math.max(c.min, Math.min(c.max, Math.round(stepped * 10) / 10));
}

// Kept in the player's settings (prefs.js, every zoo; Gameface's
// localStorage is lost when the game closes).
function load() {
    const out = {};
    for (const k of Object.keys(PACE)) out[k] = PACE[k].def;
    try {
        const saved = getPref(PREF_KEY);
        if (saved && typeof saved === 'object') for (const k of Object.keys(PACE)) if (saved[k] != null) out[k] = clampPace(k, saved[k]);
    }
    catch (e) {
        // defaults
    }
    return out;
}

let values = load();
const listeners = new Set();

// the kept values arrive (or change on the other page)
onPrefs((status, key) => {
    if (key !== undefined && key !== PREF_KEY) return;
    const next = load();
    for (const k of Object.keys(PACE)) {
        if (next[k] === values[k]) continue;
        values = Object.assign({}, values, { [k]: next[k] });
        callAll(listeners, k, next[k]);
    }
});

export function getPace(kind) {
    return values[kind] != null ? values[kind] : (PACE[kind] ? PACE[kind].def : 0);
}

export function getPaceMs(kind) {
    return Math.round(getPace(kind) * 1000);
}

export function setPace(kind, v) {
    if (!PACE[kind]) return;
    const next = clampPace(kind, v);
    if (next === values[kind]) return;
    values = Object.assign({}, values, { [kind]: next });
    try {
        // only this slider's key: the other page may have saved the other one
        updatePref(PREF_KEY, saved => Object.assign({}, saved && typeof saved === 'object' ? saved : {}, { [kind]: next }));
    }
    catch (e) {
        // this session only
    }
    callAll(listeners, kind, next);
}

export function onPace(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function fmtSeconds(v) {
    return `${Number.isInteger(v) ? v : v.toFixed(1)} s`;
}

// A slider: drag the knob or click the track (snaps to the step), with the
// default marked and a warning below the default. Built once and kept, so a
// re-render of the panel around it never interrupts a drag.
// compact: one short row (for a panel header); the warning still appears
// below it, only while the pause is under the default.
export function paceSlider(kind, { compact = false } = {}) {
    const c = PACE[kind];
    const fill = h('div.PZ2QoL_paceFill');
    const knob = h('div.PZ2QoL_paceKnob');
    const defMark = h('div.PZ2QoL_paceDefault', { title: `Default ${fmtSeconds(c.def)}` });
    const track = h('div.PZ2QoL_paceTrack', { title: `${c.label}: drag or click (${fmtSeconds(c.min)} to ${fmtSeconds(c.max)})` }, h('div.PZ2QoL_paceRail'), fill, defMark, knob);
    const value = h('div.PZ2QoL_paceValue');
    const reset = h('div.PZ2QoL_paceReset', { text: 'Default', title: `Back to ${fmtSeconds(c.def)}`, onClick: () => setPace(kind, c.def) });
    const warn = h('div.PZ2QoL_paceWarn', { text: c.warn });
    const node = compact
        ? h('div.PZ2QoL_pace.compact', { title: `${c.label}, ${fmtSeconds(c.min)} to ${fmtSeconds(c.max)} (default ${fmtSeconds(c.def)})` },
            h('div.PZ2QoL_paceRow', null, h('div.PZ2QoL_paceLabel', { text: c.label }), track, value, reset),
            warn)
        : h('div.PZ2QoL_pace', null,
            h('div.PZ2QoL_paceHead', null, h('div.PZ2QoL_paceLabel', { text: c.label }), h('div.PZ2QoL_flex1'), value, reset),
            h('div.PZ2QoL_paceRow', null, h('div.PZ2QoL_paceEnd', { text: fmtSeconds(c.min) }), track, h('div.PZ2QoL_paceEnd', { text: fmtSeconds(c.max) })),
            warn);
    const pct = v => (v - c.min) / (c.max - c.min) * 100;
    defMark.style.left = `${pct(c.def)}%`;
    const fromX = x => {
        const r = track.getBoundingClientRect();
        if (r.width <= 0) return;
        setPace(kind, c.min + Math.max(0, Math.min(1, (x - r.left) / r.width)) * (c.max - c.min));
    };
    let dragging = false;
    track.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
        dragging = true;
        setClass(node, 'dragging', true);
        fromX(e.clientX);
    });
    document.addEventListener('mousemove', e => {
        if (dragging) fromX(e.clientX);
    });
    document.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        setClass(node, 'dragging', false);
        breadcrumb(`pace_${kind}`);
    });
    // the panels close on outside clicks; a click on the slider is inside
    track.addEventListener('click', e => e.stopPropagation());
    node.__update = () => {
        const v = getPace(kind);
        const p = `${pct(v)}%`;
        fill.style.width = p;
        knob.style.left = p;
        setText(value, fmtSeconds(v));
        const fast = v < c.def;
        setClass(node, 'fast', fast);
        setClass(warn, 'hidden', !fast);
        setClass(reset, 'hidden', v === c.def);
    };
    onPace(k => {
        if (k === kind) node.__update();
    });
    node.__update();
    return node;
}
