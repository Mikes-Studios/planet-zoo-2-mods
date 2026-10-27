// Missed notices (park HUD): a notice that went by itself (timed out, or
// pushed out by newer ones) waits here, behind a round button in the bottom
// right, with its buttons, until the player uses it or clears it. One
// the player closed or acted on never comes here. A notice told again
// (same title) takes its old copy's place, on screen or here. The HUD page
// starts afresh with every zoo load, and so does this list.
import { GAME_TOOLTIPS, GAME_WINDOWS, stepAside } from '/js/mods/pz2qol/stepaside.js';
import { h, icon, setClass, setText } from '/js/mods/pz2qol/ui.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { LEVELS } from '/js/mods/pz2qol/kinlife.js';

const MAX_MISSED = 30;
const STEP_ASIDE_MS = 500;

// entry: { title, text, level, severity, actions: [{ label, icon, primary, run }], at }
export function createMissedList(now = () => Date.now()) {
    let list = [];
    const listeners = new Set();
    const changed = () => listeners.forEach(fn => fn(list));
    return {
        add(entry) {
            list = [Object.assign({ at: now() }, entry)].concat(list.filter(x => x.title !== entry.title)).slice(0, MAX_MISSED);
            changed();
        },
        drop(title) {
            const next = list.filter(x => x.title !== title);
            if (next.length === list.length) return;
            list = next;
            changed();
        },
        clear() {
            if (!list.length) return;
            list = [];
            changed();
        },
        // a button of an entry: what the notice's own button does, then it goes
        run(entry, action) {
            try {
                action.run();
            }
            catch (e) {
                reportError('ui', `"${action.label}" failed`, e, { silent: true });
            }
            if (action.closes !== false) this.drop(entry.title);
        },
        entries: () => list.slice(),
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
}

export const missed = createMissedList();

function ago(ms) {
    const min = Math.round(ms / 60000);
    return min < 1 ? 'just now' : min === 1 ? '1 min ago' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

function entryNode(entry) {
    const lvl = LEVELS[entry.level];
    return h(`div.PZ2QoL_missedItem.sev_${entry.severity || 'info'}.lvl_${entry.level || 'info'}`, null,
        h('div.PZ2QoL_missedItemHead', null,
            lvl && entry.level !== 'info' ? h('div.PZ2QoL_kinToastKicker', { text: lvl.label }) : null,
            h('div.PZ2QoL_missedTime', { text: ago(Date.now() - entry.at) }),
            h('div.PZ2QoL_flex1'),
            h('div.PZ2QoL_kinToastClose', { title: 'Remove', onClick: () => missed.drop(entry.title) }, icon('Icon_Close', 'brown', 'sm'))),
        h('div.PZ2QoL_kinToastTitle', { text: entry.title }),
        entry.text ? h('div.PZ2QoL_kinToastText', { text: entry.text }) : null,
        entry.actions && entry.actions.length ? h('div.PZ2QoL_kinActions', null, entry.actions.map(a => h(`div.PZ2QoL_kinAction${a.primary ? '.primary' : ''}`, {
            onClick: () => missed.run(entry, a),
        }, a.icon ? icon(a.icon, a.primary ? 'white' : 'brown', 'xs') : null, h('span', { text: a.label })))) : null);
}

export function installMissedNotices() {
    if (!isHudPage()) return true;
    let open = false;
    const count = h('div.PZ2QoL_missedCount');
    const button = h('div.PZ2QoL_missedButton', { title: 'Missed notices', onClick: () => setOpen(!open) }, icon('Icon_Notification', 'white', 'md'), count);
    const list = h('div.PZ2QoL_missedList');
    const panel = h('div.PZ2QoL_missedPanel', null,
        h('div.PZ2QoL_missedHead', null,
            h('div.PZ2QoL_missedTitle', { text: 'Missed notices' }),
            h('div.PZ2QoL_flex1'),
            h('div.PZ2QoL_kinAction', { onClick: () => missed.clear() }, h('span', { text: 'Clear all' })),
            h('div.PZ2QoL_kinToastClose', { title: 'Close', onClick: () => setOpen(false) }, icon('Icon_Close', 'brown', 'sm'))),
        list);
    const root = h('div.PZ2QoL_missed.empty', null, panel, button);
    function render(entries) {
        setClass(root, 'empty', !entries.length);
        setText(count, entries.length > 99 ? '99+' : String(entries.length));
        while (list.firstChild) list.removeChild(list.firstChild);
        for (const e of entries) list.appendChild(entryNode(e));
        if (!entries.length) setOpen(false);
    }
    function setOpen(on) {
        open = on;
        setClass(root, 'open', open);
        if (open) render(missed.entries());
    }
    missed.onChange(render);
    document.body.appendChild(root);
    setInterval(() => stepAside(root, `${GAME_TOOLTIPS}, ${GAME_WINDOWS}`, 'missed notices'), STEP_ASIDE_MS);
    return true;
}
