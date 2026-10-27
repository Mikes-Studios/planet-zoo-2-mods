// Autosave: the page side of PZ2QoL.Autosave (Lua keeps the clock and the
// setting; this shows it and sends the player's choice).
import { AUTOSAVE_CHOICES, autosaveSummary, parseAutosaveState } from '/js/mods/pz2qol/autosavecore.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { safe, segmented } from '/js/mods/pz2qol/bars.js';
import { h, setClass, setText } from '/js/mods/pz2qol/ui.js';

let state = null;
let stateAt = 0;
const listeners = new Set();

export function getAutosaveState() {
    return state;
}

// summary for "now" (counts down between Lua's 10-second updates)
export function getAutosaveSummary() {
    return state ? autosaveSummary(state, (Date.now() - stateAt) / 1000) : null;
}

export function onAutosave(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function send(name, ...args) {
    try {
        engine.trigger(name, ...args);
    }
    catch (e) {
        reportError('ui', 'Autosave: could not reach the game', e, { silent: true });
    }
}

export function setAutosaveMinutes(minutes) {
    breadcrumb('autosave_set');
    send('PZ2QoL_AutosaveSet', minutes);
}

export function autosaveNow() {
    breadcrumb('autosave_now');
    send('PZ2QoL_AutosaveNow');
}

let installed = false;
export function installAutosave() {
    if (installed) return true;
    installed = true;
    engine.on('PZ2QoL_AutosaveState', json => {
        const s = parseAutosaveState(json);
        if (!s) return;
        state = s;
        stateAt = Date.now();
        listeners.forEach(fn => {
            try {
                fn(s);
            }
            catch (e) {
                reportError('ui', 'Autosave display failed', e, { silent: true });
            }
        });
    });
    // the state is pushed when the view attaches; ask too, in case it came first
    engine.on('PZ2QoL_Hello', () => send('PZ2QoL_AutosaveGet'));
    send('PZ2QoL_AutosaveGet');
    return true;
}

// The settings card (opened from the launcher).
export function autosaveCard(onClose) {
    const title = h('div.PZ2QoL_asTitle');
    const detail = h('div.PZ2QoL_asDetail');
    const last = h('div.PZ2QoL_asLast');
    const choice = segmented(null, AUTOSAVE_CHOICES.map(m => ({
        value: m,
        label: m ? `${m} min` : 'Off',
        tooltip: m ? `Autosave after ${m} minutes in the park, counted across trips to the hub` : "The game's own autosave only (every 10 minutes of park time)",
    })), v => setAutosaveMinutes(v));
    const now = h('div.PZ2QoL_btn.PZ2QoL_asNow', { title: "Ask the game for an autosave now (the game's own autosave slots)", onClick: safe('Save now', () => autosaveNow()) }, 'Save now');
    const close = h('div.PZ2QoL_asClose', { title: 'Close', onClick: () => onClose && onClose() }, '×');
    const card = h('div.PZ2QoL_card.PZ2QoL_asCard', { onClick: () => {} },
        h('div.PZ2QoL_asHead', null, h('div.PZ2QoL_asHeading', { text: 'Autosave' }), h('div.PZ2QoL_flex1'), close),
        title, detail, h('div.PZ2QoL_asLabel', { text: 'Save every' }), choice,
        h('div.PZ2QoL_asRow', null, last, h('div.PZ2QoL_flex1'), now),
        h('div.PZ2QoL_asNote', { text: "Uses the game's own autosave slots (3, shared by all parks). The setting lasts until you quit the game." }));
    card.__sync = () => {
        const s = getAutosaveState();
        const sum = getAutosaveSummary();
        if (!s || !sum) {
            setText(title, 'Autosave');
            setText(detail, 'Waiting for the game…');
            setText(last, '');
            return;
        }
        setText(title, sum.title);
        setText(detail, sum.detail);
        setText(last, sum.last);
        choice.__set(s.available ? s.minutes : null);
        setClass(choice, 'disabled', !s.available);
        setClass(now, 'disabled', !s.available || !s.armed || s.pending);
        card.dataset.tone = sum.tone;
    };
    return card;
}
