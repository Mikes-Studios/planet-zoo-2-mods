// "Find a habitat": Animal Storage -> the zoo -> a habitat for each animal.
//
// Hub page (Animal Storage, storage tab): a button under the game's own
// Send to Zoo, for the current selection (works with select all and the
// mod's Juveniles filter). One click:
//   1. tells Lua how many animals are coming (PZ2QoL_SendArm);
//   2. presses the game's own Send to Zoo for the selection (the panel's own
//      handler, so exactly the game's action: one Send to Zoo, then the game
//      loads the zoo).
// In the park the game would now open its Move screen for all of them with
// one destination. Lua (pz2qol.storagesend.lua) hands the animals to this
// page instead (PZ2QoL_SendArrived), and the HUD page places them ONE at a
// time (storagesendcore.js runPlacement): the game's facts for one animal,
// the best habitat it allows, the game's own Move for that one animal, wait
// for the game's confirmation, pause (the player's 'moves' pace), next.
// Failures are skipped and the run carries on; only Stop ends it. It runs
// in a Franchise zoo too: the player's click on the button is the go-ahead.
// The same hand-over serves "Bring to the trade centre" (storagefetch.js):
// armed for target 'trade', the park page sends each arrival to the trade
// centre instead (storagefetchcore.js runTradeArrivals).
import { loadCSS } from '/js/common/util/CSSUtil.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { findVNode, gameModule, h as vh, isFrontendPage, isHudPage, unwrapUntil } from '/js/mods/pz2qol/kinhooks.js';
import { getPaceMs } from '/js/mods/pz2qol/pace.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { h } from '/js/mods/pz2qol/ui.js';
import { blockedReason, parseIdList, runPlacement, sendButtonLabel, summarize, summaryText } from '/js/mods/pz2qol/storagesendcore.js';
import { runTradeArrivals, SKIP_TEXT, tradeSummary, tradeSummaryText } from '/js/mods/pz2qol/storagefetchcore.js';

const MOD_PANEL = '/js/project/modules/AnimalMarket/Components/AnimalStorageInfoPanel.js';
const SEND_LABEL = '[AnimalExchange_SendToZoo]';
const ANSWER_TIMEOUT_MS = 6000;

// ------------------------------------------------------- hub: the button

let ourSendAt = 0;

function startSend(inst, keys) {
    if (typeof engine === 'undefined' || !keys.length) return;
    breadcrumb('send_start');
    // the count first, so Lua knows these animals before the game sends them
    engine.trigger('PZ2QoL_SendArm', keys.length, 'habitat');
    ourSendAt = Date.now();
    // the game's own Send to Zoo button handler for this selection
    if (inst && typeof inst.onSelectSendToZoo === 'function') inst.onSelectSendToZoo();
    else engine.trigger('AnimalStorage_SendToZoo', keys);
}

// Arms Lua for these animals (target 'habitat' or 'trade'), then the game's
// own Send to Zoo event for exactly these list keys (the selection's own
// selectedAnimalIDs). One game action. Used by storagefetch.js.
export function armAndSend(keys, target) {
    if (typeof engine === 'undefined' || !Array.isArray(keys) || !keys.length) return false;
    breadcrumb(target === 'trade' ? 'fetch_send' : 'send_start');
    engine.trigger('PZ2QoL_SendArm', keys.length, target === 'trade' ? 'trade' : 'habitat');
    ourSendAt = Date.now();
    engine.trigger('AnimalStorage_SendToZoo', keys.slice());
    return true;
}

let Button = null;
let stringLiteral = s => s;

function sendRowVNode(inst, state) {
    const keys = state && Array.isArray(state.selectedAnimalIDs) ? state.selectedAnimalIDs.slice() : [];
    const reason = blockedReason({ count: keys.length, sendAllowed: !state || state.sendToZooAllowed !== false, moving: !!(state && state.isMovingAnAnimal) });
    const label = sendButtonLabel(keys.length);
    const button = Button
        ? vh(Button, { modifiers: 'stretch', icon: 'img/icons/IconHabitatPin.svg', label: stringLiteral(label), disabled: !!reason, tooltip: reason ? stringLiteral(reason) : stringLiteral('Sends the selection to the zoo, then puts each animal in the best habitat the game allows for it, one at a time.'), onSelect: () => startSend(inst, keys) })
        : vh('div', { className: `PZ2QoL_ssBtn${reason ? ' disabled' : ''}`, onClick: () => { if (!reason) startSend(inst, keys); } }, label);
    const kids = [button];
    if (reason && keys.length) kids.push(vh('div', { className: 'PZ2QoL_ssNote' }, reason));
    return vh('div', { className: 'PZ2QoL_ssRow' }, kids);
}

// Where the Send to Zoo row sits in the panel's actions: { arr, index }.
function findSendRow(arr, depth = 0) {
    if (!Array.isArray(arr) || depth > 4) return null;
    for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (Array.isArray(item)) {
            const hit = findSendRow(item, depth + 1);
            if (hit) return hit;
        }
        else if (item && typeof item === 'object' && findVNode(item, v => v.attributes && v.attributes.label === SEND_LABEL, 4)) {
            return { arr, index: i };
        }
    }
    return null;
}

const panelPatch = { failures: 0, off: false };

function wrapActions(inst) {
    const original = inst.onGetActionsContent;
    if (typeof original !== 'function' || original.__pz2qolSend) return;
    const wrapped = function (state) {
        const out = original.apply(this, arguments);
        if (panelPatch.off) return out;
        try {
            const hit = findSendRow(out);
            if (hit) hit.arr.splice(hit.index + 1, 0, sendRowVNode(inst, state || inst.state));
            panelPatch.failures = 0;
        }
        catch (e) {
            if (++panelPatch.failures >= 3) {
                panelPatch.off = true;
                reportError('mod', '"Find a habitat" turned off', e, { silent: true });
            }
        }
        return out;
    };
    wrapped.__pz2qolSend = true;
    inst.onGetActionsContent = wrapped;
}

function patchPanel(mod) {
    const Panel = mod && mod.AnimalStorageInfoPanel;
    const Inner = unwrapUntil(Panel, c => /onGetActionsContent/.test(Function.prototype.toString.call(c)) && c !== Panel);
    if (!Inner || !Inner.prototype) return false;
    if (Inner.prototype.__pz2qolSendPanel) return true;
    const mount = Inner.prototype.componentWillMount;
    Inner.prototype.componentWillMount = function (...args) {
        const ret = mount ? mount.apply(this, args) : undefined;
        try {
            wrapActions(this);
        }
        catch (e) {
            reportError('mod', '"Find a habitat" panel hook failed', e, { silent: true });
        }
        return ret;
    };
    Inner.prototype.__pz2qolSendPanel = true;
    return true;
}

function installHub() {
    // the game's own Send to Zoo / Return pressed without us: never let an
    // earlier arm take those animals
    engine.on('AnimalStorage_SendToZoo', () => {
        if (Date.now() - ourSendAt > 1000) engine.trigger('PZ2QoL_SendDisarm');
    });
    engine.on('AnimalStorage_ReturnToZoo', () => engine.trigger('PZ2QoL_SendDisarm'));
    (async () => {
        try {
            Button = (await import('/js/project/components/Button.js')).Button || null;
            stringLiteral = (await import('/js/common/util/LocalisationUtil.js')).stringLiteral || stringLiteral;
        }
        catch (e) {
            reportError('mod', '"Find a habitat": game button not found', e, { silent: true });
        }
        if (!patchPanel(await gameModule(MOD_PANEL))) reportError('mod', '"Find a habitat" not installed', 'storage info panel', { silent: true });
    })().catch(e => reportError('mod', '"Find a habitat" failed to start', e, { silent: true }));
}

// ---------------------------------------------------------- park: the run

let reqSeq = 0;
const waiting = new Map();

function ask(event, timeoutValue, ...args) {
    const reqId = 'ss' + (++reqSeq);
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            if (waiting.delete(reqId)) resolve(timeoutValue);
        }, ANSWER_TIMEOUT_MS);
        waiting.set(reqId, v => {
            clearTimeout(timer);
            resolve(v);
        });
        try {
            engine.trigger(event, reqId, ...args);
        }
        catch (e) {
            waiting.delete(reqId);
            clearTimeout(timer);
            resolve(timeoutValue);
        }
    });
}

function answer(reqId, value) {
    const done = waiting.get(String(reqId));
    if (!done) return;
    waiting.delete(String(reqId));
    done(value);
}

export function askFacts(id) {
    return ask('PZ2QoL_SendFacts', null, String(id), 'full');
}

// The facts without the habitat survey: where it is and whether it moves.
function askStatus(id) {
    return ask('PZ2QoL_SendFacts', null, String(id), 'status');
}

export function askMove(id, habId, seq = '') {
    return ask('PZ2QoL_SendMove', { ok: false, detail: SKIP_TEXT.noanswer }, String(id), String(habId), seq === '' ? '' : Number(seq));
}

// The game's own Move screen for these arrivals (Lua opens it on its next
// SelectMode tick). -> { ok, detail }
function askOpenMove(ids) {
    return ask('PZ2QoL_SendOpenMove', { ok: false, detail: 'noanswer' }, ids.join(','));
}

let run = null; // { seq, state, stopping, target, ids, openMove }
let lastSeq = null;
let card = null;

export function getSendRun() {
    return run ? Object.assign({}, run.state, { stopping: run.stopping, target: run.target }) : null;
}

// Is this animal part of a run that is still going? (kinboxed.js: arrivals
// wait boxed while the run works through them)
export function isInSendRun(id) {
    return !!(run && run.state.running && Array.isArray(run.ids) && run.ids.includes(String(id)));
}

export function stopSendRun() {
    if (run && run.state.running) {
        run.stopping = true;
        breadcrumb('send_stop');
        render();
    }
}

function sleepUnlessStopped(ms) {
    return new Promise(resolve => {
        const end = Date.now() + ms;
        const tick = () => {
            if ((run && run.stopping) || Date.now() >= end) return resolve();
            setTimeout(tick, Math.min(100, Math.max(0, end - Date.now())));
        };
        tick();
    });
}

function cardButton(text, onClick, cls = '') {
    return h(`div.PZ2QoL_ssCardBtn${cls ? '.' + cls : ''}`, { text, onClick: () => {
        try {
            onClick();
        }
        catch (e) {
            reportError('ui', `"${text}" failed`, e);
        }
    } });
}

function closeCard() {
    if (card) card.remove();
    card = null;
    if (run && !run.state.running) run = null;
}

function openBoard() {
    import('/js/mods/pz2qol/kinboard.js')
        .then(m => m.openSpeciesBoard && m.openSpeciesBoard({}))
        .catch(e => reportError('ui', 'Species board could not open', e));
}

// The game's own Move screen for the animals the run could not place.
function openGameMove(ids) {
    if (!run || !ids.length || run.openMove === 'asking') return;
    run.openMove = 'asking';
    breadcrumb('fetch_open_move');
    render();
    askOpenMove(ids).then(r => {
        if (!run) return;
        run.openMove = r && r.ok ? 'done' : 'failed';
        if (r && r.ok) closeCard();
        else render();
    }, e => reportError('mod', 'Opening the Move screen failed', e));
}

function renderTrade(s) {
    const sum = tradeSummary(s, run.ids);
    card.appendChild(h('div.PZ2QoL_ssHead', null,
        h('div.PZ2QoL_ssTitle', { text: 'Bring to trade centre' }),
        h('div.PZ2QoL_ssSub', { text: `${s.total} animal${s.total === 1 ? '' : 's'} from storage` })));
    const pct = s.total ? Math.round((s.log.length / s.total) * 100) : 0;
    const fill = h('div.PZ2QoL_ssFill');
    fill.style.width = `${pct}%`;
    card.appendChild(h('div.PZ2QoL_ssBar', null, fill));
    card.appendChild(h('div.PZ2QoL_ssCounts', null,
        h('div.PZ2QoL_ssCount.ok', { text: `In trade centre ${sum.already + sum.sent}` }),
        h('div.PZ2QoL_ssCount.skip', { text: `Skipped ${sum.skipped}` }),
        h('div.PZ2QoL_ssCount', { text: `${s.log.length} / ${s.total}` })));
    if (s.running) {
        const c = s.current;
        const text = run.stopping ? 'Stopping after this animal…'
            : c && c.name ? `${c.name} → the trade centre` : `Checking animal ${s.index} of ${s.total}…`;
        card.appendChild(h('div.PZ2QoL_ssLine', { text }));
        card.appendChild(h('div.PZ2QoL_ssButtons', null, cardButton(run.stopping ? 'Stopping…' : 'Stop', stopSendRun, 'stop')));
        return;
    }
    card.appendChild(h('div.PZ2QoL_ssLine.done', { text: tradeSummaryText(sum) + '.' }));
    const list = h('div.PZ2QoL_ssList');
    if (sum.already) list.appendChild(h('div.PZ2QoL_ssItem.ok', { text: `${sum.already} already waiting in the trade centre` }));
    if (sum.sent) list.appendChild(h('div.PZ2QoL_ssItem.ok', { text: `${sum.sent} sent to the trade centre` }));
    sum.reasons.slice(0, 5).forEach(x => list.appendChild(h('div.PZ2QoL_ssItem.skip', { text: `${x.n} skipped: ${x.text}` })));
    if (run.openMove === 'failed') list.appendChild(h('div.PZ2QoL_ssItem.skip', { text: "The game's Move screen did not open; use Move on each animal." }));
    if (list.firstChild) card.appendChild(list);
    const buttons = [];
    if (sum.leftIds.length && run.openMove !== 'done') {
        const n = sum.leftIds.length;
        buttons.push(cardButton(run.openMove === 'asking' ? 'Opening…' : `Open the game's Move screen for ${n}`, () => openGameMove(sum.leftIds)));
    }
    buttons.push(cardButton('Species board', openBoard), cardButton('Close', closeCard));
    card.appendChild(h('div.PZ2QoL_ssButtons', null, ...buttons));
}

function render() {
    if (!run) return;
    if (!card) {
        card = h('div.PZ2QoL_ssCard');
        document.body.appendChild(card);
    }
    const s = run.state;
    while (card.firstChild) card.removeChild(card.firstChild);
    if (run.target === 'trade') {
        renderTrade(s);
        return;
    }
    const sum = summarize(s.log, s.total);
    card.appendChild(h('div.PZ2QoL_ssHead', null,
        h('div.PZ2QoL_ssTitle', { text: 'Find a habitat' }),
        h('div.PZ2QoL_ssSub', { text: `${s.total} animal${s.total === 1 ? '' : 's'} from storage` })));
    const pct = s.total ? Math.round(((sum.sent + sum.skipped) / s.total) * 100) : 0;
    const fill = h('div.PZ2QoL_ssFill');
    fill.style.width = `${pct}%`;
    card.appendChild(h('div.PZ2QoL_ssBar', null, fill));
    card.appendChild(h('div.PZ2QoL_ssCounts', null,
        h('div.PZ2QoL_ssCount.ok', { text: `Sent ${sum.sent}` }),
        h('div.PZ2QoL_ssCount.skip', { text: `Skipped ${sum.skipped}` }),
        h('div.PZ2QoL_ssCount', { text: `${sum.sent + sum.skipped} / ${s.total}` })));
    if (s.running) {
        const c = s.current;
        const text = run.stopping ? 'Stopping after this animal…'
            : c && c.habitat ? `${c.name || 'Animal ' + c.id}${c.species ? ' (' + speciesName(c.species) + ')' : ''} → ${c.habitat}, ${c.why}`
                : `Checking animal ${s.index} of ${s.total}…`;
        card.appendChild(h('div.PZ2QoL_ssLine', { text }));
        card.appendChild(h('div.PZ2QoL_ssButtons', null, cardButton(run.stopping ? 'Stopping…' : 'Stop', stopSendRun, 'stop')));
        return;
    }
    card.appendChild(h('div.PZ2QoL_ssLine.done', { text: summaryText(sum) + '.' }));
    const list = h('div.PZ2QoL_ssList');
    sum.habitats.slice(0, 5).forEach(x => list.appendChild(h('div.PZ2QoL_ssItem.ok', { text: `${x.n} → ${x.name}` })));
    sum.reasons.slice(0, 5).forEach(x => list.appendChild(h('div.PZ2QoL_ssItem.skip', { text: `${x.n} skipped: ${x.text}` })));
    if (list.firstChild) card.appendChild(list);
    card.appendChild(h('div.PZ2QoL_ssButtons', null, cardButton('Species board', openBoard), cardButton('Close', closeCard)));
}

async function startRun(seq, csv, target) {
    const ids = parseIdList(csv);
    if (!ids.length) return;
    if (run && run.state.running) return; // one run at a time
    if (card) closeCard();
    run = { seq, stopping: false, target: target === 'trade' ? 'trade' : 'habitat', ids, state: { running: true, total: ids.length, index: 0, current: null, log: [], finished: false } };
    render();
    breadcrumb(run.target === 'trade' ? 'fetch_run_start' : 'send_run_start');
    const first = await askStatus(ids[0]);
    const online = !first || first.mode !== 'offline';
    if (run.target === 'trade') {
        await tradeRun(ids, seq, online);
        return;
    }
    finishRun(await runPlacement(ids, runDeps(online, { facts: askFacts, status: askStatus, move: askMove })), 'send_run_end');
}

// What both runs share: the player's pace and Stop, and the card on every
// step. calls: the run's own asks of the game (facts, move, status).
function runDeps(online, calls) {
    return Object.assign({
        online,
        sleep: sleepUnlessStopped,
        paceMs: () => getPaceMs('moves'),
        isStopped: () => !!(run && run.stopping),
        onUpdate: st => {
            if (!run) return;
            run.state = st;
            render();
        },
    }, calls);
}

function finishRun(final, endCrumb) {
    if (run) {
        run.state = final;
        run.stopping = false;
    }
    render();
    breadcrumb(endCrumb);
    // the Species board and kin surfaces: read the zoo again
    import('/js/mods/pz2qol/kin.js').then(m => m.requestKinScan && m.requestKinScan('move', { force: true, delay: 500 })).catch(() => {});
}

// "Bring to the trade centre": each arrival to the trade centre, one at a
// time (the board click was the opt-in; Lua took the Move-screen request
// only for that zoo).
async function tradeRun(ids, seq, online) {
    dlog('fetch', 'arrivals', { ids: ids.join(' '), online });
    // a trade run reads no habitats: where each one is is enough
    const facts = async id => {
        const f = await askStatus(id);
        dlog('fetch', 'arrival_facts', { id, name: f && f.name, lt: f && f.lt, moving: f && f.moving, busy: f && f.busy, error: f && f.error, gone: f && f.gone });
        return f;
    };
    const move = async id => {
        const r = await askMove(id, 'trade:arrival', seq);
        dlog('fetch', 'arrival_move', { id, ok: r && r.ok, detail: r && r.detail });
        return r;
    };
    finishRun(await runTradeArrivals(ids, runDeps(online, { facts, move })), 'fetch_run_end');
}

function installPark() {
    engine.on('PZ2QoL_SendFactsResult', (reqId, json) => {
        let v = null;
        try {
            v = JSON.parse(json);
            // the game's name, for the skip reason ("no habitat accepts …")
            if (v && v.species) v.speciesName = speciesName(v.species);
        }
        catch (e) {
            v = v || null;
        }
        answer(reqId, v);
    });
    engine.on('PZ2QoL_SendMoveResult', (reqId, ok, detail) => answer(reqId, { ok: ok === true, detail: detail ? String(detail) : '' }));
    engine.on('PZ2QoL_SendOpenMoveResult', (reqId, ok, detail) => answer(reqId, { ok: ok === true, detail: detail ? String(detail) : '' }));
    engine.on('PZ2QoL_SendArrived', (seq, csv, target) => {
        try {
            engine.trigger('PZ2QoL_SendAck', seq);
        }
        catch (e) {
            // Lua re-sends on the next hello
        }
        if (seq === lastSeq) return;
        lastSeq = seq;
        startRun(seq, csv, target).catch(e => reportError('mod', target === 'trade' ? '"Bring to the trade centre" run failed' : '"Find a habitat" run failed', e));
    });
    // a reloaded page picks up animals that arrived meanwhile
    try {
        engine.trigger('PZ2QoL_SendHello');
    }
    catch (e) {
        // no Lua (harness)
    }
}

// ------------------------------------------------------------------ install

let installed = false;

export function installStorageSend() {
    if (installed) return true;
    if (typeof engine === 'undefined') return false;
    installed = true;
    loadCSS('mods/pz2qol_storagesend');
    if (isFrontendPage()) installHub();
    if (isHudPage()) installPark();
    return true;
}
