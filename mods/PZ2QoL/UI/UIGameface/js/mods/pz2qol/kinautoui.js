// Auto mode on screen: its button and panel on the Species board (per
// species: on/off, how often, the Breeding programme's settings, Thin out,
// the last runs with Undo), its tags and the "hands off" menu item on the
// cards, and its notices (off unless the player turns them on). Design:
// docs/DESIGN-autopilot.md section 16.
import {
    getAutopilotLedger, getAutopilotState, getCleanUp, getSpeciesAuto, installAutopilot, isAutoHeld, isAutoPinned, onAutopilot,
    resumeSpeciesAuto, runSpeciesNow, setAutopilotToastHook, setCleanUp, setSpeciesAuto, speciesChoicesChanged,
    toggleAutoPin, undoEntries,
} from '/js/mods/pz2qol/kinauto.js';
import { EVERY_CHOICES, STANDARD_YEARS, dueText, everyText, everyWords, realTimeText, sexMark } from '/js/mods/pz2qol/kinautocore.js';
import { refusedMoves } from '/js/mods/pz2qol/kinautoledger.js';
import { getAssignments } from '/js/mods/pz2qol/kinassign.js';
import { habitatChoices } from '/js/mods/pz2qol/breedwincore.js';
import { PROGRAMME_STEPS, groupRule } from '/js/mods/pz2qol/kinprogramme.js';
import { makeupShort, ratioChoice, savedProgStep, stepRatioChoice } from '/js/mods/pz2qol/progprefs.js';
import { FILL_STEPS } from '/js/mods/pz2qol/kincull.js';
import { TRADE } from '/js/mods/pz2qol/kinboardcore.js';
import { adviceWhy } from '/js/mods/pz2qol/advicecore.js';
import { getKinModel, locateAnimal, setContraception } from '/js/mods/pz2qol/kin.js';
import { hideUnderGamePopups, kinToast, setElderlyHandled } from '/js/mods/pz2qol/kinalerts.js';
import { LEVELS } from '/js/mods/pz2qol/kinlife.js';
import { Sex } from '/js/mods/pz2qol/kincore.js';
import { bringFromStorage } from '/js/mods/pz2qol/storagefetch.js';
import { getStorageCounts, openTrade, requestStorageCounts } from '/js/mods/pz2qol/tradejump.js';
import { getPref, setPref } from '/js/mods/pz2qol/prefs.js';
import { h, icon, setClass } from '/js/mods/pz2qol/ui.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { makeGuard, speciesName, trunc } from '/js/mods/pz2qol/kinpanel.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';

const TOAST_MS = 14000;
// Notices when Auto mode moved animals (or stopped for a species): off
// unless the player turns them on in the panel (player-wide, prefs.js)
const NOTICE_PREF = 'autoNotices';

const U = { toasts: null, board: null };
const guarded = makeGuard('Auto mode');

// ------------------------------------------------------------ settings

// Auto mode has no species facts from the game: an 'auto' make-up is named, not worked out.
function ratioLabel(species, ratio) {
    return ratio === 'auto' ? "auto (the game's)" : makeupShort(groupRule({ species }, ratio));
}

function noticesOn() {
    return getPref(NOTICE_PREF) === true;
}

// Where it stands in the queue ("next in line", "3rd in line")
function queueText(n) {
    if (n === 1) return 'next in line';
    const suffix = n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th';
    return `${n}${suffix} in line`;
}

// "in 2 months (about 6 min at this speed)", "in 2 months (paused)"
function nextText(sa) {
    if (sa.left == null) return 'once the park\'s date is read';
    const real = realTimeText(sa.left, sa.rate);
    return `${dueText(sa.left)}${real ? ` (${real} at this speed)` : sa.rate === 0 ? ' (the game is paused)' : ''}`;
}

function statusLine(sa) {
    const s = sa.settings;
    if (!s.on) return 'Off: nothing runs by itself';
    const every = everyText(s.every);
    switch (sa.status) {
        case 'acting': return `Running now · ${every}`;
        case 'planning': return `Working out the plan… · ${every}`;
        case 'queued': return `Due: ${queueText(sa.queued)}${sa.why ? ` (${sa.why})` : ''} · ${every}`;
        case 'waiting': return `On · next run ${nextText(sa)} · ${every}`;
        case 'paused': return `Paused for ${Math.max(1, Math.round(sa.pausedMs / 60000))} min: ${sa.why}`;
        case 'stopped': return `Stopped: ${sa.why}`;
        default: return `On · due now${sa.why ? ` (waiting: ${sa.why})` : ''} · ${every}`;
    }
}

function shortStatus(sa) {
    if (!sa.settings.on) return 'Auto mode';
    switch (sa.status) {
        case 'acting': return 'Auto · running';
        case 'planning': return 'Auto · planning';
        case 'queued': return 'Auto · in line';
        case 'waiting': return `Auto · next ${dueText(sa.left).replace(/^in /, '')}`;
        case 'paused': return 'Auto · paused';
        case 'stopped': return 'Auto · stopped';
        default: return 'Auto · due';
    }
}

// --------------------------------------------------------------- panel

function seg(items, current, onPick, attr) {
    return h('div.PZ2QoL_kbSeg.PZ2QoL_apSeg', null, items.map(it => h(`div.PZ2QoL_kbSegItem${it.id === current ? '.on' : ''}`, {
        [`data-${attr}`]: String(it.id),
        title: it.title || '',
        onClick: guarded(attr, () => onPick(it.id)),
    }, h('span', { text: it.label }))));
}

function section(title, ...kids) {
    return h('div.PZ2QoL_apSection', null,
        h('div.PZ2QoL_apSectionTitle', { text: title }),
        h('div.PZ2QoL_apSectionBody', null, ...kids));
}

function para(text, cls = '') {
    return h(`div.PZ2QoL_apText${cls ? '.' + cls : ''}`, { text });
}

function entryText(e) {
    const to = e.a === 'trade' ? 'Trade centre' : e.to || 'another habitat';
    return `${e.n} ${sexMark({ sex: e.sex })}: ${e.f || 'elsewhere'} → ${to}`;
}

// The last runs of the species, newest first, each with Undo.
function runsEl(sa, H) {
    const byRun = new Map();
    for (const e of sa.log) {
        if (!byRun.has(e.c)) byRun.set(e.c, []);
        byRun.get(e.c).push(e);
    }
    const runs = Array.from(byRun.entries()).sort((x, y) => y[0] - x[0]).slice(0, 6);
    if (!runs.length) return para(sa.last && sa.last.note ? `Last run: ${sa.last.note}.` : 'Nothing moved yet.', 'soft');
    const box = h('div.PZ2QoL_apRuns');
    if (sa.last && !sa.last.moves && sa.last.note) box.appendChild(para(`Last run: ${sa.last.note}.`, 'soft'));
    for (const [run, list] of runs) {
        const when = list[0].real ? new Date(list[0].real) : null;
        const ok = list.filter(e => e.o === 'ok' && !e.u);
        const head = h('div.PZ2QoL_apRunHead', null,
            h('span', { text: `Run ${run}${when ? ` · ${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}` : ''} · ${list.filter(e => e.o === 'ok').length} moved${list.some(e => e.o === 'skip') ? `, ${list.filter(e => e.o === 'skip').length} skipped` : ''}` }),
            h('div.PZ2QoL_kpFlex'),
            ok.length ? H.btn(`Undo run (${ok.length})`, null, () => doUndo(ok, H), { cls: 'small', title: 'Put these animals back where they came from, one at a time (Auto mode then leaves them there for a while)' }) : null);
        box.appendChild(head);
        for (const e of list) {
            box.appendChild(h(`div.PZ2QoL_apLog.${e.o}${e.u ? '.undone' : ''}`, { 'data-entry': String(e.i) },
                h('div.PZ2QoL_apLogMark', { text: e.u ? '↶' : e.o === 'ok' ? '✓' : e.o === 'skip' ? '✗' : '…' }),
                h('div.PZ2QoL_apLogText', null,
                    h('div.PZ2QoL_apLogMain', { text: entryText(e) }),
                    h('div.PZ2QoL_apLogWhy', { text: e.o === 'skip' ? `skipped: ${e.why || 'refused'}` : e.r || '' })),
                e.o === 'ok' && !e.u ? H.btn('Undo', null, () => doUndo([e], H), { cls: 'small' }) : null));
        }
    }
    return box;
}

function doUndo(entries, H) {
    breadcrumb('auto_undo');
    undoEntries(entries).then(r => {
        if (r && !r.ok) H.notice(r.detail, 'warn');
        else if (r && r.skipped && r.skipped.length) H.notice(`Not undone: ${r.skipped.join('; ')}`, 'warn');
        else H.notice(`Undo: ${r.done} animal${r.done === 1 ? '' : 's'} going back.`, 'ok');
        H.queueRender();
    }, e => reportError('ui', 'Auto mode: Undo failed', e));
}

// Clean up: the first click lists the zoo's habitats to tick (the species'
// own ticked), or the whole zoo; a start asks once more for CLEAN_ARM_MS,
// long enough to read what it does. pick: Set(habitat id) while choosing.
const CLEAN_ARM_MS = 10000;
const CLEAN = { pick: null, armed: '', armedAt: 0 };

const namesText = names => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'the habitats');

function ownHabitats(model, species) {
    const out = new Set();
    for (const a of model ? model.animals.values() : []) if (a.species === species && a.hab && !a.exhibit) out.add(String(a.hab));
    for (const [hab, set] of model ? getAssignments(model) : []) if (set && set.has(species)) out.add(String(hab));
    return out;
}

function cleanUpButton(H, model, species) {
    const running = getCleanUp();
    if (running) {
        return H.btn('Stop clean up', null, () => {
            setCleanUp(null);
            H.notice(running.zoo ? 'Clean up stopped. Breeding stays off until you turn Auto mode on for a species.' : 'Clean up stopped: what is still in its habitats stays there.', 'ok');
            H.renderAll();
        }, { title: `Stop emptying ${running.zoo ? 'the zoo' : namesText(running.names)}. A move already sent finishes.` });
    }
    if (CLEAN.pick) return H.btn('Cancel', null, () => closeCleanPick(H), { title: 'Back to Auto mode without cleaning up' });
    return H.btn('Clean up…', null, () => {
        CLEAN.pick = new Set(ownHabitats(model, species));
        CLEAN.armed = '';
        H.renderAll();
    }, { title: 'Empty habitats for selling, or the whole zoo: the adults go to the trade centre, pregnant and young animals follow when they can' });
}

function closeCleanPick(H) {
    CLEAN.pick = null;
    CLEAN.armed = '';
    H.renderAll();
}

function startCleanUp(H, target, names) {
    const ok = setCleanUp(target);
    CLEAN.pick = null;
    CLEAN.armed = '';
    if (!ok) H.notice("Clean up can only start once the game's player profile can keep its settings for this zoo. Try again in a moment.", 'warn');
    else if (target === 'zoo') {
        H.notice(getAutopilotState().settling
            ? 'Clean up is on: breeding is off everywhere. The zoo just loaded, so the first moves come within a minute.'
            : 'Clean up started: breeding is off everywhere and the zoo empties, one move at a time.', 'ok');
    }
    else H.notice(`Clean up started: ${namesText(names)} empt${names.length === 1 ? 'ies' : 'y'}, one move at a time. Auto mode breeds on in the other habitats.`, 'ok');
    H.renderAll();
}

// The habitats to tick, with the two starts.
function cleanPickEl(H, model) {
    const rows = habitatChoices(model, getAssignments(model)).filter(r => r.animals || CLEAN.pick.has(r.hab));
    const ticked = rows.filter(r => CLEAN.pick.has(r.hab));
    const n = ticked.length;
    const armed = what => CLEAN.armed === what && Date.now() - CLEAN.armedAt <= CLEAN_ARM_MS;
    const arm = what => {
        CLEAN.armed = what;
        CLEAN.armedAt = Date.now();
        H.renderAll();
        setTimeout(() => H.queueRender(), CLEAN_ARM_MS + 100);
    };
    const habsTitle = 'Their adults go to the trade centre; Auto mode breeds on in the other habitats';
    const habsBtn = !n ? H.btn('Tick one or more habitats', null, () => {}, { cls: 'disabled', title: habsTitle })
        : armed('habs') ? H.btn(n === 1 ? `Yes, empty ${trunc(ticked[0].name, 24)}` : `Yes, empty these ${n}`, null, () => startCleanUp(H, ticked.map(r => r.hab), ticked.map(r => r.name)), { cls: 'danger', title: habsTitle })
            : H.btn(`Clean up ${n} habitat${n === 1 ? '' : 's'}`, null, () => arm('habs'), { cls: 'primary', title: habsTitle });
    const zooTitle = 'Auto mode turns off for every species and every adult in the zoo goes to the trade centre';
    const zooBtn = armed('zoo') ? H.btn('Yes, empty the zoo', null, () => startCleanUp(H, 'zoo'), { cls: 'danger', title: zooTitle })
        : H.btn('Whole zoo', null, () => arm('zoo'), { title: zooTitle });
    const list = rows.map(r => h(`div.PZ2QoL_apPick${CLEAN.pick.has(r.hab) ? '.on' : ''}`, {
        'data-hab': r.hab,
        onClick: guarded('clean up habitat', () => {
            if (CLEAN.pick.has(r.hab)) CLEAN.pick.delete(r.hab);
            else CLEAN.pick.add(r.hab);
            CLEAN.armed = '';
            H.renderAll();
        }),
    },
        h('div.PZ2QoL_apPickName', { text: trunc(r.name, 30) }),
        h('div.PZ2QoL_apPickMeta', { text: `${r.animals} animal${r.animals === 1 ? '' : 's'}${r.species.length ? ` · ${r.species.slice(0, 2).map(sp => trunc(speciesName(sp), 18)).join(', ')}${r.species.length > 2 ? '…' : ''}` : ''}` })));
    return section('Clean up',
        para("Tick the habitats to empty for selling. Their adults go to the trade centre, the males first; a pregnant one goes after giving birth, a young one once grown. Elderly and hands-off animals stay. Auto mode breeds on in the other habitats; nothing goes into these while they empty. Whole zoo: breeding stops for every species and every habitat empties."),
        h('div.PZ2QoL_apRow', null, habsBtn, zooBtn),
        ...(list.length ? list : [para('No habitat has animals in it.', 'soft')]));
}

function panelEl(model, species, H) {
    const sa = Object.assign(getSpeciesAuto(species), { species });
    sa.settings = Object.assign({}, sa.settings);
    const st = getAutopilotState();
    const s = sa.settings;
    const name = speciesName(species);
    const kept = st.storage === 'file';
    // a species not set up yet starts from the player's own programme
    // slider (the board's last position, prefs.js)
    const fresh = !(getAutopilotLedger() && getAutopilotLedger().sp[species]);
    if (fresh) s.step = savedProgStep();
    const set = patch => {
        if (fresh && patch.step == null) patch = Object.assign({ step: s.step }, patch);
        if (!setSpeciesAuto(species, patch)) H.notice('Auto mode can only be changed once the game\'s player profile can keep its settings for this zoo. Try again in a moment.', 'warn');
        H.renderAll();
    };
    const wrap = h(`div.PZ2QoL_kbProg.PZ2QoL_kbAuto.state_${s.on ? 'on' : 'off'}`, { 'data-species': species, 'data-status': sa.status });
    const head = [];
    // a zoo-wide Clean up runs every species: no breeding controls meanwhile
    const running = getCleanUp();
    const cleaning = !!(running && running.zoo);
    if (!cleaning && s.on) {
        head.push(H.btn('Run now', null, () => {
            const r = runSpeciesNow(species);
            if (r === 'now') H.notice(`Auto mode: working out ${name}'s plan, then moving the animals one at a time.`, 'ok');
            else if (r === 'queued') H.notice(`Auto mode: ${name} is next in line; it runs as soon as the run before it is done.`, 'ok');
            else H.notice(`Auto mode can't run now: ${r}.`, 'warn');
            H.renderAll();
        }, { cls: sa.status === 'acting' || sa.status === 'planning' ? 'disabled' : '', title: 'Run it now, without waiting for its turn (first in line if another run is going); the schedule carries on from here' }));
        head.push(H.btn('Turn off', null, () => set({ on: false }), { title: `Stop Auto mode for ${name}. A move already sent finishes; nothing else changes.` }));
    }
    else if (!cleaning) {
        head.push(H.btn('Turn on', null, () => {
            if (!kept) return;
            set({ on: true });
            breadcrumb('kin_board_auto_on');
        }, { cls: kept ? 'primary' : 'primary.disabled', title: `Run ${name}'s Breeding programme ${everyText(s.every)} and move the animals to match` }));
    }
    head.push(cleanUpButton(H, model, species));
    // the Breeding window has its own tabs and close button
    if (!H.compact) head.push(H.btn('Close', null, H.close, { title: 'Back to the board (Esc)' }));
    wrap.appendChild(h('div.PZ2QoL_kbProgHead', null,
        h('div.PZ2QoL_kbProgTitles', null,
            h('div.PZ2QoL_kbProgTitle', { text: `Auto mode · ${trunc(name, 24)}` }),
            h('div.PZ2QoL_kbProgSub', cleaning
                ? { text: st.settling ? 'Clean up starts in a minute: the zoo just loaded, and Auto mode watches it first.' : 'Clean up is emptying the zoo: breeding is off for every species.' }
                : { text: statusLine(sa), title: statusLine(sa) })),
        h('div.PZ2QoL_kpFlex'),
        ...head));
    const box = H.makeScroll('kbAutoBody', { onScroll: (x, y) => H.scroll(y) });
    H.box(box);
    const c = box.content;
    if (CLEAN.pick && !running) {
        c.appendChild(cleanPickEl(H, model));
        wrap.appendChild(box.wrap);
        H.restoreScroll(box, 0, H.scroll());
        return wrap;
    }
    if (running && running.habs) {
        c.appendChild(h('div.PZ2QoL_apBanner', null, h('span', { text: `Clean up is emptying ${namesText(running.names)}: the adults go to the trade centre as they can. Auto mode breeds on in the other habitats.` })));
    }
    if (!kept) c.appendChild(h('div.PZ2QoL_kbProgWarn', { text: st.storage === 'loading' ? 'Reading this zoo\'s data…' : 'Auto mode keeps its settings with this zoo in the game\'s player profile, which can\'t be used right now. Try again in a moment, or after reloading the zoo.' }));
    if (sa.status === 'stopped') {
        c.appendChild(h('div.PZ2QoL_apBanner.warn', null,
            h('span', { text: `Auto mode stopped for ${name}: ${sa.why}. Have a look at the board, then hand it back.` }),
            h('div.PZ2QoL_kpFlex'),
            H.btn('Hand it back', null, () => { resumeSpeciesAuto(species); H.renderAll(); }, { cls: 'small' })));
    }
    // what it does
    const steps = s.thin ? 'thins out full habitats, then moves the animals into the Breeding programme\'s groups' : 'moves the animals into the Breeding programme\'s groups';
    c.appendChild(para(`${everyText(s.every).replace(/^e/, 'E')} of game time, Auto mode ${steps}, by itself (Franchise too), one move at a time. When several species are due they take turns.`));
    // how often
    // the park's calendar: 12 months, 3 a season; how long a month lasts at 1x
    const atOne = st.monthSec ? realTimeText(1, 1 / (st.monthSec * 1000)) : '';
    c.appendChild(section('How often (game time)',
        seg(EVERY_CHOICES.map(m => ({ id: m, label: everyWords(m), title: `A run ${everyText(m)} of the park's calendar: it waits while the game is paused and comes sooner at higher speeds, at most once a minute of real time (a birth or an animal growing up runs it at once)` })), s.every, v => set({ every: v }), 'every'),
        para(`The park's calendar: 12 months a year, 3 a season.${atOne ? ` A month lasts ${atOne.replace(/^about /, 'about ')} at 1x speed.` : ''}`, 'soft')));
    // the programme's settings
    const ratio = ratioChoice(species);
    const cycle = d => {
        stepRatioChoice(species, d);
        speciesChoicesChanged(species);
        H.renderAll();
    };
    c.appendChild(section('Breeding programme',
        h('div.PZ2QoL_apRow', null,
            h('div.PZ2QoL_kbRatio.PZ2QoL_apRatio', { 'data-ratio': ratio, title: 'Group make-up: the same choice as the arrows in the Breeding programme (kept for this species in this zoo)' },
                h('div.PZ2QoL_kbRatioArrow.prev', { onClick: guarded('make-up', () => cycle(-1)) }, h('span', { text: '‹' })),
                h('div.PZ2QoL_kbRatioText', null,
                    h('span.PZ2QoL_kbRatioLabel', { text: 'Make-up' }),
                    h('span.PZ2QoL_kbRatioValue', { text: ratioLabel(species, ratio) })),
                h('div.PZ2QoL_kbRatioArrow.next', { onClick: guarded('make-up', () => cycle(1)) }, h('span', { text: '›' }))),
            H.switchEl('Bring breeders from the trade centre', s.trade, () => set({ trade: !s.trade }), 'Breeders waiting at the trade centre may join a group (never the ones Auto mode sent there)')),
        // the segments name the steps themselves (the programme's dot
        // slider needs its two end labels; these would repeat them)
        h('div.PZ2QoL_apRow', null,
            seg(PROGRAMME_STEPS.map((p, k) => ({ id: k, label: p.label, title: p.cost ? `Each move costs ${p.cost} (in expected-young units)` : 'Moves cost nothing; only the young count' })), s.step, v => set({ step: v }), 'step')),
        para('Classic optimiser, the same plan the Breeding programme shows for these settings. Pregnant females, animals on the move, and the ones you mark "hands off" stay where they are.', 'soft')));
    // thin out
    c.appendChild(section('Thin out',
        h('div.PZ2QoL_apRow', null,
            H.switchEl('First thin out habitats over their room', s.thin, () => set({ thin: !s.thin }), 'Before the programme: adults beyond the fill level (the old and infertile first), and animals with a 0% fertility gene, go to the trade centre'),
            s.thin ? seg(FILL_STEPS.map(f => ({ id: f.id, label: f.label, title: f.fill ? `Keep up to ${Math.round(f.fill * 100)}% of each habitat's room` : 'Keep only the breeding core of each habitat' })), s.fill, v => set({ fill: v }), 'fill') : null),
        para('Young, pregnant females and each habitat\'s breeding core stay. From the trade centre you sell, trade or release them as before: Auto mode never sells.', 'soft')));
    // hands off
    const l = getAutopilotLedger();
    if (model) {
        const mine = Array.from(model.animals.values()).filter(a => a.species === species);
        const pinned = mine.filter(a => isAutoPinned(a.id));
        const held = mine.filter(a => !isAutoPinned(a.id) && isAutoHeld(a.id));
        const refused = l ? refusedMoves(l, model, species) : [];
        const bits = [];
        bits.push(para(pinned.length ? `Hands off (${pinned.length}): ${pinned.slice(0, 8).map(a => `${a.name} ${sexMark(a)}`).join(', ')}${pinned.length > 8 ? '…' : ''}.` : 'No animal is marked "hands off". Use an animal card\'s menu on the board to mark one.'));
        if (held.length) bits.push(para(`Moved by you lately: ${held.slice(0, 8).map(a => `${a.name} ${sexMark(a)}`).join(', ')}${held.length > 8 ? '…' : ''}. One moved during a run stays put for the rest of it; the next run plans it like any other (hands off keeps one).`, 'soft'));
        if (refused.length) bits.push(para(`The game refused ${refused.length} move${refused.length === 1 ? '' : 's'} three times; Auto mode no longer tries ${refused.length === 1 ? 'it' : 'them'}: ${refused.slice(0, 5).map(r => { const a = model.animals.get(r.id); return `${a ? a.name : r.id} → ${r.to === TRADE ? 'trade centre' : H.placeName(model, r.to)}`; }).join(', ')}.`, 'warn'));
        c.appendChild(section('Left alone', ...bits));
    }
    const notes = sa.last && Array.isArray(sa.last.notes) ? sa.last.notes : [];
    c.appendChild(section('Notices',
        h('div.PZ2QoL_apRow', null,
            H.switchEl('Show a notice when Auto mode moves animals', noticesOn(), () => {
                setPref(NOTICE_PREF, noticesOn() ? undefined : true);
                H.renderAll();
            }, 'A small notice after each run that moved animals, and if Auto mode stops for a species. Off: it works quietly; the panel and the log show everything. For all zoos.')),
        para('Off by default. Either way nothing waits for a click.', 'soft')));
    c.appendChild(section('Last runs', ...notes.map(t => para(t, 'warn')), runsEl(sa, H)));
    wrap.appendChild(box.wrap);
    H.restoreScroll(box, 0, H.scroll());
    return wrap;
}

// ------------------------------------------------- the Species board

function lastEntry(guid) {
    const l = getAutopilotLedger();
    if (!l || !guid) return null;
    for (let i = l.log.length - 1; i >= 0; i--) if (l.log[i].g === guid) return l.log[i];
    return null;
}

const boardExtension = {
    button(species) {
        const sa = getSpeciesAuto(species);
        return { text: shortStatus(sa), on: sa.settings.on, title: `Auto mode for ${speciesName(species)}: ${statusLine(sa)}. Click for its settings.` };
    },
    panelEl,
    railTag(species) {
        const sa = getSpeciesAuto(species);
        if (!sa.settings.on) return null;
        return sa.status === 'stopped' ? 'auto: stopped' : 'auto';
    },
    cardTag(a) {
        const on = getSpeciesAuto(a.species).settings.on;
        if (isAutoPinned(a.id)) return { text: 'hands off', title: 'Auto mode never moves this animal' };
        if (!on) return null;
        if (isAutoHeld(a.id)) return { text: 'moved by you', title: 'You moved it: during a run Auto mode leaves it for the rest of that run; the next run plans it like any other (hands off keeps it)' };
        const e = lastEntry(a.guid);
        if (e && e.o === 'ok' && !e.u && Date.now() - (e.real || 0) < 2 * 3600 * 1000) return { text: 'auto', title: `Auto mode: ${e.r}` };
        return null;
    },
    menuItems(a) {
        const pinned = isAutoPinned(a.id);
        if (!pinned && !getSpeciesAuto(a.species).settings.on) return [];
        return [{
            label: pinned ? 'Auto mode may move it again' : 'Auto mode: hands off',
            title: pinned ? 'Auto mode may move this animal again' : 'Auto mode never moves this animal or sends it away',
            run: () => toggleAutoPin(a.id),
        }];
    },
};

// The Breeding window (breedwin.js) draws the same panel and button text
// with its own helpers (H: the board's autoHelpers() shape).
export function autoPanelEl(model, species, H) {
    return panelEl(model, species, H);
}

export function autoButtonInfo(species) {
    return boardExtension.button(species);
}

function board() {
    if (U.board) return Promise.resolve(U.board);
    return import('/js/mods/pz2qol/kinboard.js').then(m => (U.board = m));
}

function linkBoard() {
    board().then(m => m.setBoardExtension(boardExtension)).catch(e => reportError('ui', 'Auto mode: Species board link failed', e, { silent: true }));
}

function openBoard(species) {
    board().then(m => m.openAutoPanel(species)).catch(e => reportError('ui', 'Auto mode: could not open the board', e));
}

// --------------------------------------------------------------- notices

function toastRoot() {
    if (!U.toasts || !U.toasts.parentNode) {
        U.toasts = h('div.PZ2QoL_kinToasts.PZ2QoL_apToasts');
        document.body.appendChild(U.toasts);
        hideUnderGamePopups(U.toasts);
    }
    return U.toasts;
}

function toastNow({ tone = 'info', title, text, actions = [], ms = TOAST_MS, key = '' }) {
    const root = toastRoot();
    if (key) for (const n of Array.from(root.childNodes)) if (n.__key === key) n.remove();
    while (root.childNodes.length >= 3) root.removeChild(root.firstChild);
    let timer = null;
    const close = () => {
        clearTimeout(timer);
        setClass(node, 'leaving', true);
        setTimeout(() => node.parentNode && node.parentNode.removeChild(node), 250);
    };
    const node = h(`div.PZ2QoL_kinToast.PZ2QoL_apToast.tone_${tone}`, { 'data-key': key },
        h('div.PZ2QoL_kinToastStripe'),
        h('div.PZ2QoL_kinToastBody', null,
            h('div.PZ2QoL_kinToastHead', null, h('div.PZ2QoL_apToastIcon'), h('div.PZ2QoL_kinToastTitle', { text: title }),
                h('div.PZ2QoL_kinToastClose', { title: 'Dismiss', onClick: close }, icon('Icon_Close', 'brown', 'sm'))),
            h('div.PZ2QoL_kinToastText', { text }),
            actions.length ? h('div.PZ2QoL_kinActions', null, actions.map(a => h(`div.PZ2QoL_kinAction${a.primary ? '.primary' : ''}`, {
                onClick: () => {
                    try {
                        a.run();
                    }
                    catch (e) {
                        reportError('ui', `"${a.label}" failed`, e);
                    }
                    close();
                },
            }, h('span', { text: a.label })))) : null));
    node.__key = key;
    node.addEventListener('mouseenter', () => clearTimeout(timer));
    node.addEventListener('mouseleave', () => {
        clearTimeout(timer);
        timer = setTimeout(close, Math.min(ms, TOAST_MS) / 2);
    });
    timer = setTimeout(close, ms);
    root.appendChild(node);
    return node;
}

const sexWord = sex => (sex === Sex.Male ? 'male' : 'female');

// A notice's Market button. The hub can't open now and then (a move plan
// running, arrivals still being placed): the notice stays and says why.
function marketAction(species, extra, { primary = false } = {}) {
    return {
        label: 'Market', icon: 'IconTrade', primary, closes: false,
        run: () => openTrade('market', species, extra).then(r => {
            if (r && !r.ok) toastNow({ tone: 'warn', key: 'market_blocked', title: 'The Market did not open', text: `${r.text}: the Market opens once that is done. Try the notice's Market button again then.` });
        }),
    };
}
const habNameIn = (model, id) => ((model && model.habitats && model.habitats.get(String(id))) || {}).name || 'a habitat';

// What a species needs from the player before Auto mode can go on there:
// a partner from storage or the market, or an elderly animal's place.
function needsNotices(d) {
    const model = getKinModel();
    const habName = id => habNameIn(model, id);
    const name = speciesName(d.species);
    requestStorageCounts([d.species]);
    const stored = getStorageCounts(d.species);
    for (const n of d.needs) {
        const what = n.sex === 'pair' ? 'a breeding pair' : `a breeding ${sexWord(n.sex)}`;
        const buy = n.sex === 'pair' ? 'an unrelated adult male and female'
            : `an adult ${sexWord(n.sex)} not related to the ${n.sex === Sex.Male ? 'females' : 'males'} there`;
        // n.bring: the best fitting stored animals (kinauto noteNeeds), when storage was read
        const picked = Array.isArray(n.bring) ? n.bring : null;
        const have = picked ? picked.length : !stored ? null : n.sex === 'pair' ? Math.min(stored.m, stored.f) : n.sex === Sex.Male ? stored.m : stored.f;
        const how = picked && picked.length ? `Best fit in Animal Storage: ${picked.map(b => b.name).join(' and ')}${picked[0].young != null ? `, juveniles of about ${picked[0].young}%` : ''}. Bring ${picked.length === 1 ? 'it' : 'them'} and Auto mode places ${picked.length === 1 ? 'it' : 'them'}.`
            : have == null ? `Bring one from Animal Storage if you have one, or buy ${buy} on the market.`
                : have > 0 ? `${have} in Animal Storage may do: bring them to the trade centre and the next run places the best one. Else buy ${buy} on the market.`
                    : `None in the zoo, the trade centre or Animal Storage fits: buy ${buy} on the market.`;
        kinToast({
            severity: 'risk', level: 'action', kind: 'need', species: d.species,
            title: `${name}: ${habName(n.hab)} needs ${what}`,
            text: `Auto mode can't breed there until it has one. ${how}`,
            actions: [
                have !== 0 ? { label: 'Bring from storage', icon: 'IconTrade', primary: true, run: () => bringFromStorage(getKinModel(), d.species, { match: picked && picked.length ? picked.map(b => ({ sex: b.sex, name: b.name, genes: b.genes })) : null }) } : null,
                // the sex wanted, and listings dimmed that would be sell advice on arrival
                marketAction(d.species, {
                    sex: n.sex === Sex.Male ? 'm' : n.sex === Sex.Female ? 'f' : '', dimBelow: n.dimBelow,
                    mates: n.market ? n.market.mates : [], floor: n.market ? n.market.floor : null, strict: true,
                }, { primary: have === 0 }),
            ].filter(Boolean),
        });
    }
    const advised = x => {
        const a = model && model.animals ? model.animals.get(String(x.id)) : null;
        return `${a ? a.name : 'an animal'} ${sexMark(a)} ${x.score}%: ${adviceWhy(x.reason, x.young)}`;
    };
    if (d.sellable && d.sellable.length) {
        // one title per species: a newer count takes the older notice's place
        const total = Math.max(d.sellable.length, d.sellTotal || 0);
        kinToast({
            severity: 'future', level: 'action', kind: 'sell', species: d.species,
            title: `${name}: animals you can sell`,
            text: `${total === 1 ? 'One animal is' : `${total} animals are`} no longer needed for the breeding programme and can safely be sold. The Sell advice filter in Storage shows ${total === 1 ? 'it' : 'them'}.`,
        });
    }
    if (d.keep && d.keep.length) {
        kinToast({
            severity: 'future', level: 'heads', kind: 'keep', species: d.species,
            title: `${name}: ${d.keep.length} to keep for later`,
            text: `${d.keep.map(advised).join('. ')}. They wait at the trade centre without ageing; Auto mode brings them back when they are the best choice (tagged Keep for later in Storage).`,
        });
    }
    for (const b of d.blockers) {
        const a = model && model.animals ? model.animals.get(String(b.id)) : null;
        const who = a ? a.name : `An elderly ${sexWord(b.sex)}`;
        kinToast({
            severity: 'future', level: 'heads', kind: 'elderly', species: d.species,
            title: `${name}: ${who} holds ${habName(b.hab)}'s ${sexWord(b.sex)} place`,
            text: `${who} is elderly and can no longer breed, but the game counts ${b.sex === Sex.Male ? 'him' : 'her'} in the habitat's most ${sexWord(b.sex)}s, so no breeding ${sexWord(b.sex)} can join while ${b.sex === Sex.Male ? 'he' : 'she'} lives there. Auto mode leaves elderly animals where they are.`,
            actions: [{ label: 'Locate', icon: 'IconLocation', primary: true, run: () => locateAnimal(b.id) }],
        });
    }
}

function listedMark(x) {
    return x.listed ? ' (listed)' : '';
}

function listedNote(list) {
    const n = list.filter(x => x.listed).length;
    return !n ? '' : ` Bring from storage takes ${n === list.length && n === 1 ? 'it' : n === list.length ? 'them' : `the ${n} marked listed`} off the market first.`;
}

// What to bring from storage for a species (kinauto noteRunNotices): one
// list, each animal once with where it goes, and one Bring for all of them.
function storageNotice(d) {
    const model = getKinModel();
    const sexOf = sex => sexMark({ sex });
    const calves = x => (x.young != null ? ` (juveniles about ${x.young}%)` : '');
    const line = x => {
        const who = `${x.name}${listedMark(x)} ${sexOf(x.sex)} \u2192 ${habNameIn(model, x.hab)}`;
        if (x.role === 'fill') return `${who}, which has no breeding ${sexWord(x.sex)}${calves(x)}`;
        if (x.role === 'replace') return `${who} in place of ${x.replacesName} (juveniles about ${x.young}%, against ${x.replacesYoung}%)`;
        return `${who}${calves(x)}`;
    };
    const n = d.items.length;
    const replaces = d.items.some(x => x.role === 'replace');
    kinToast({
        severity: 'future', level: 'action', kind: 'storage', species: d.species,
        title: `${speciesName(d.species)}: ${n === 1 ? 'one' : n} to bring from storage`,
        text: `${d.items.map(line).join('; ')}. Bring ${n === 1 ? 'it' : 'them'} and Auto mode places ${n === 1 ? 'it' : 'them'}${replaces ? '; one replaced waits at the trade centre for you to sell' : ''}.${listedNote(d.items)}`,
        actions: [{
            label: n === 1 ? 'Bring it' : `Bring all ${n}`, icon: 'IconTrade', primary: true,
            run: () => bringFromStorage(getKinModel(), d.species, { match: d.items.map(x => ({ sex: x.sex, name: x.name, genes: x.genes })) }),
        }],
    });
}

// Calves that will grow up with no unrelated partner (kinauto noteFreshBlood):
// told while they are young, with the best stored partner or the Market.
function freshBloodNotices(d) {
    const model = getKinModel();
    const name = speciesName(d.species);
    for (const n of d.needs) {
        const want = sexWord(n.sex);
        const many = n.calves.length > 1;
        const habs = Array.from(new Set(n.calves.map(c => habNameIn(model, c.hab)))).join(', ');
        const grows = many ? 'they grow' : 'it grows';
        const how = n.bring ? `Best fit in Animal Storage: ${n.bring.name}, juveniles with ${many ? 'them' : 'it'} about ${n.bring.young}%. Bring it now and Auto mode places it.`
            : n.bring === null ? `None in Animal Storage fits: buy an unrelated adult ${want} on the market before ${grows} up.`
                : `Bring an unrelated ${want} from Animal Storage, or buy one on the market, before ${grows} up.`;
        kinToast({
            severity: 'future', level: 'action', kind: 'fresh', species: d.species,
            title: `${name}: fresh blood needed for ${n.calves.length} young`,
            text: `${n.calves.map(c => c.name).join(', ')} (${habs}): once grown, ${many ? 'they have' : 'it has'} no ${want} in the zoo to breed with. The ${want}s here are related, or their juveniles would score well below your best pair's. ${how}`,
            actions: [
                n.bring !== null ? { label: 'Bring from storage', icon: 'IconTrade', primary: true, run: () => bringFromStorage(getKinModel(), d.species, { match: n.bring ? [{ sex: n.bring.sex, name: n.bring.name, genes: n.bring.genes }] : null }) } : null,
                marketAction(d.species, { sex: n.sex === Sex.Male ? 'm' : 'f', dimBelow: n.dimBelow, mates: n.mates, floor: null, strict: true }, { primary: n.bring === null }),
            ].filter(Boolean),
        });
    }
}

// Run notices only when the player turned them on; what Auto mode needs from
// the player always shows. Nothing ever waits for a click.
function onToast(kind, d) {
    if (kind === 'needs') {
        needsNotices(d);
        return;
    }
    if (kind === 'storage') {
        storageNotice(d);
        return;
    }
    if (kind === 'fresh') {
        freshBloodNotices(d);
        return;
    }
    if (kind === 'guardFailed') {
        kinToast({
            severity: 'risk', level: 'action', kind: 'guardFailed', species: d.species,
            title: `${speciesName(d.species)}: ${d.name} could conceive with a relative`,
            text: `${d.name} lives beside a relative who can breed, and the game did not take the contraception Auto mode asked for (three tries). Put her on contraception by hand, or move her or her relative now.`,
            actions: [{ label: `Contraception for ${d.name}`, icon: 'Icon_Contracepted', primary: true, run: () => setContraception(d.id, true) }, { label: 'Locate', icon: 'IconLocation', run: () => locateAnimal(d.id) }],
        });
        return;
    }
    if (kind === 'replace') {
        kinToast({
            severity: 'future', level: 'action', kind: 'replace', species: d.species,
            title: `${speciesName(d.species)}: replace ${d.name}`,
            text: `${d.name} breeds as your last option: his young average ${d.avg}, well under the ${d.std} of your best sire in the last ${STANDARD_YEARS} park years. Auto mode keeps him breeding until a better male comes; buy one, and he goes to the trade centre to sell.`,
            actions: [marketAction(d.species, { sex: 'm', mates: d.mates, floor: d.floor, strict: true }, { primary: true }), { label: 'Locate', icon: 'IconLocation', run: () => locateAnimal(d.id) }],
        });
        return;
    }
    if (kind === 'stuck') {
        kinToast({
            severity: 'risk', level: 'action', kind: 'stuck', species: d.species,
            title: `${speciesName(d.species)}: ${d.name} is stuck on the way`,
            text: `${d.name} has waited a month of park time for a keeper to finish moving it (often in a transport box in its old habitat). Auto mode plans around it, but only you can free it: unbox it or move it by hand.`,
            actions: [{ label: 'Locate', icon: 'IconLocation', primary: true, run: () => locateAnimal(d.id) }],
        });
        return;
    }
    // the end of the Clean up the player started: told even with notices off
    if (kind === 'cleaned') {
        const names = (x, key) => `${speciesName(x.species)}: ${x[key].join(', ')}`;
        const old = d.left.filter(x => x.elderly.length).map(x => names(x, 'elderly'));
        const kept = d.left.filter(x => x.kept.length).map(x => names(x, 'kept'));
        const parts = [];
        if (old.length) parts.push(`Elderly, which the trade centre won't take (release them if you want them gone): ${old.join('; ')}.`);
        if (kept.length) parts.push(`Hands off, so left where they are: ${kept.join('; ')}.`);
        const where = d.habs && d.habs.length ? namesText(d.habs) : '';
        if (where && d.unset) parts.push(`${d.habs.length === 1 ? 'It is' : 'They are'} set aside for no species now, so Auto mode leaves ${d.habs.length === 1 ? 'it' : 'them'} empty.`);
        const empty = where ? `${where} ${d.habs.length === 1 ? 'is' : 'are'} empty` : 'The zoo is empty';
        toastNow({ key: 'cleaned', tone: 'ok', title: 'Clean up done', text: parts.length ? `${where ? `${where}: every` : 'Every'} other animal is at the trade centre, ready to sell. ${parts.join(' ')}` : `${empty}: every animal is at the trade centre, ready to sell.` });
        return;
    }
    if (!noticesOn()) return;
    if (kind === 'done') {
        const parts = [`${d.moves} moved`];
        if (d.skipped) parts.push(`${d.skipped} skipped`);
        toastNow({ key: `done_${d.species}`, tone: d.skipped ? 'warn' : 'ok', title: `Auto mode · ${speciesName(d.species)}`, text: `${parts.join(', ')}.`, actions: [{ label: 'Show', run: () => openBoard(d.species) }] });
    }
    else if (kind === 'stopped') {
        toastNow({ key: `stopped_${d.species}`, tone: 'warn', ms: LEVELS.heads.toastMs, title: `Auto mode stopped for ${speciesName(d.species)}`, text: 'It was about to move some of them back where they just came from. Have a look; you can hand it back in its panel.', actions: [{ label: 'Show', run: () => openBoard(d.species) }] });
    }
}

// --------------------------------------------------------------- install

let installed = false;
export function installAutopilotUI() {
    if (installed) return true;
    if (!isHudPage()) return true;
    installed = true;
    setAutopilotToastHook(onToast);
    // Auto mode sends its species' animals near elderly to be sold itself
    setElderlyHandled(species => {
        const st = getSpeciesAuto(species);
        return st.settings.on && st.status !== 'stopped';
    });
    onAutopilot(() => {
        if (U.board) U.board.refreshAutoPanel();
    });
    installAutopilot();
    linkBoard();
    return true;
}
