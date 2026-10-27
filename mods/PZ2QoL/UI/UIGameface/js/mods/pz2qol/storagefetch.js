// "Bring to the trade centre": every stored animal of one species, from the
// hub's Animal Storage to this zoo's trade centre. The developer's idea
// (2026-10-18); design in docs/PLAN-storage-to-trade-centre.md.
//
// Park (HUD page): fetchRow(model, species, opts) is the Species board's
//   button (pinned trade column). One click asks Lua (PZ2QoL_FetchStart) to
//   open Animal Storage the way the game's own buttons do, with the park's
//   own animals of the species (never sent again). The board closes.
// Hub (Frontend page): Lua hands the request over (PZ2QoL_FetchPending,
//   fresh only the first time). With Animal Storage on screen the page
//   narrows it to the species, clears the game's own filters if they hide
//   rows, ticks the species' animals (adults first, up to the trade
//   centre's room) and, after a 3 s countdown (fresh) or the card's Send
//   (any later visit), checks the selection once more and presses the
//   game's own Send to Zoo once, armed for 'trade' (storagesend.js
//   armAndSend). Back in the zoo storagesend.js sends each arrival to the
//   trade centre, one at a time.
// "Bring all" (fetchAllRow, the developer 2026-10-19): the same with every
//   species at once (species ALL_SPECIES): no species chip, every stored
//   animal not already in this zoo is ticked, up to the room.
// Nothing new is sent to Frontier: the game's own Send to Zoo, then the game's
// own Move-screen trade-centre sequence per animal.
import { loadCSS } from '/js/common/util/CSSUtil.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { childrenOf, get, locationName, readAnimal, STORAGE_ACTIONS, STORAGE_DATA, STORAGE_LIST } from '/js/mods/pz2qol/game.js';
import { getStorageKinModel, isBreedingHeatmapOn, setBreedingHeatmap } from '/js/mods/pz2qol/kin.js';
import { isFrontendPage, isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { nativeFiltersOn } from '/js/mods/pz2qol/listercore.js';
import { deskFilters } from '/js/mods/pz2qol/listerlua.js';
import { getStorageFilters, setStorageFilters } from '/js/mods/pz2qol/listfilter.js';
import { DEFAULT_STORAGE_FILTERS } from '/js/mods/pz2qol/scores.js';
import { speciesName } from '/js/mods/pz2qol/speciesnames.js';
import { armAndSend } from '/js/mods/pz2qol/storagesend.js';
import { canOpenTrade, getStorageCounts, getTradeCentreInfo, requestStorageCounts } from '/js/mods/pz2qol/tradejump.js';
import { h, icon, setText, visibilityWatch } from '/js/mods/pz2qol/ui.js';
import {
    ALL_SPECIES, cancelLines, COUNTDOWN_MS, fetchName, fetchRequest, handOverState, isAllSpecies, isListedRow, sameSpecies, fetchBlockReason, fetchNote, leftLines, parseExclude, pickedText, pickRows, sameKeys, START_ERRORS, TICK_WAIT_MS,
} from '/js/mods/pz2qol/storagefetchcore.js';

const ANSWER_TIMEOUT_MS = 6000;
const ROWS_WAIT_MS = 3000;
const GUID_WAIT_MS = 3000;
// picking named animals: how long the list may take to show them all
const NAMED_WAIT_MS = 20000;
// the server takes a listing off the market within this
const CANCEL_WAIT_MS = 10000;
const HUB_TICK_MS = 500;
const ERROR_SHOW_MS = 9000;

const wait = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ park: button

let reqSeq = 0;
const waiting = new Map();
let listening = false;

function listen() {
    if (listening || typeof engine === 'undefined') return;
    listening = true;
    engine.on('PZ2QoL_FetchStartResult', (reqId, ok, detail, room) => {
        const done = waiting.get(String(reqId));
        if (!done) return;
        waiting.delete(String(reqId));
        done({ ok: ok === true, detail: detail ? String(detail) : '', room: Number(room) });
    });
}

function askStart(species, exclude) {
    listen();
    if (typeof engine === 'undefined') return Promise.resolve({ ok: false, detail: 'noanswer' });
    const reqId = 'f' + (++reqSeq);
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            if (waiting.delete(reqId)) resolve({ ok: false, detail: 'noanswer' });
        }, ANSWER_TIMEOUT_MS);
        waiting.set(reqId, v => {
            clearTimeout(timer);
            resolve(v);
        });
        try {
            engine.trigger('PZ2QoL_FetchStart', reqId, String(species), exclude);
        }
        catch (e) {
            waiting.delete(reqId);
            clearTimeout(timer);
            resolve({ ok: false, detail: 'noanswer' });
        }
    });
}

let starting = false;
let lastError = null; // { species, text, until }

// opts.match: the stored animals to bring, none else ([{ sex, name, genes }],
// an approved upgrade or a best-fit partner; matchItems)
async function start(model, species, opts) {
    if (starting) return { ok: false, text: START_ERRORS.busy };
    starting = true;
    try {
        // the game won't open the hub while a heat map panel is open
        if (isBreedingHeatmapOn()) {
            try {
                await setBreedingHeatmap(false);
            }
            catch (e) {
                // Lua closes heat maps on the way out anyway
            }
        }
        const animals = model && model.animals ? Array.from(model.animals.values()) : [];
        breadcrumb('fetch_click');
        const req = fetchRequest(animals, species, opts && opts.match);
        if (req.error) return { ok: false, text: START_ERRORS[req.error] };
        const r = await askStart(species, req.exclude);
        if (r.ok) return { ok: true, text: '' };
        breadcrumb('fetch_click_failed');
        return { ok: false, text: START_ERRORS[r.detail] || `The hub did not open (${r.detail}). Try again, or use the Market & Storage button.` };
    }
    finally {
        starting = false;
    }
}

// "Bring <species> to the trade centre" from an Auto mode notice: the same
// flow as the Species board's row; match: the animals to bring, none else.
// Resolves { ok, text }.
export function bringFromStorage(model, species, { match = null } = {}) {
    return start(model, species, { match });
}

// The Species board's "Bring <species> to the trade centre" row (pinned trade
// column). opts: { onOpened(), onError(text) }. null outside the park page.
export function fetchRow(model, species, opts = {}) {
    if (!species || !isHudPage()) return null;
    return buildRow(model, species, opts);
}

// "Bring all stored animals to the trade centre": every species at once, in
// the same place (any species picked on the board asks for the room).
export function fetchAllRow(model, opts = {}) {
    if (!isHudPage()) return null;
    return buildRow(model, ALL_SPECIES, opts);
}

function buildRow(model, species, opts) {
    const { onOpened = () => {}, onError = () => {}, countsFor = null } = opts;
    const all = isAllSpecies(species);
    requestStorageCounts([all ? countsFor : species].filter(Boolean));
    const name = fetchName(species, speciesName);
    const c = all ? null : getStorageCounts(species);
    const tc = getTradeCentreInfo() || {};
    const hasTradeCentre = model && model.tradeCentre ? true : tc.tc === false ? false : undefined;
    const state = { tradeBlock: canOpenTrade(), hasTradeCentre, tcNow: tc.tcNow, tcMax: tc.tcMax, adults: c ? c.m + c.f : null, speciesName: name, mode: model && model.mode, all };
    const why = fetchBlockReason(state);
    const err = lastError && lastError.species === species && Date.now() < lastError.until ? lastError.text : '';
    const note = h(`div.PZ2QoL_kbFetchNote${why || err ? '.warn' : ''}`, { text: why || err || fetchNote(state) });
    const btn = h(`div.PZ2QoL_kbFetchBtn${why ? '.disabled' : ''}${all ? '.all' : ''}`, {
        'data-fetch': species,
        title: all
            ? "Opens Animal Storage, ticks every stored animal of every species that isn't already in this zoo and sends them with the game's own Send to Zoo. Back in the zoo each one goes to the trade centre, one at a time. Adults first; young too if there is room."
            : `Opens Animal Storage, ticks every stored ${name} and sends them with the game's own Send to Zoo. Back in the zoo each one goes to the trade centre, one at a time. Adults first; young too if there is room.`,
        onClick: () => {
            if (btn.classList.contains('disabled')) return;
            btn.classList.add('disabled');
            start(model, species, opts).then(r => {
                btn.classList.remove('disabled');
                if (r.ok) {
                    lastError = null;
                    try {
                        onOpened();
                    }
                    catch (e) {
                        reportError('ui', 'Bring to the trade centre: closing the board failed', e, { silent: true });
                    }
                    return;
                }
                lastError = { species, text: r.text, until: Date.now() + ERROR_SHOW_MS };
                note.textContent = r.text;
                note.classList.add('warn');
                try {
                    onError(r.text);
                }
                catch (e) {
                    // the note shows it anyway
                }
            }, e => reportError('mod', 'Bring to the trade centre failed', e));
        },
    }, icon('Icon_Animal_Trading', all ? 'brown' : 'white', 'sm'), h('span', { text: all ? 'Bring all stored animals to the trade centre' : `Bring ${name} to the trade centre` }));
    return h(`div.PZ2QoL_kbFetch${all ? '.all' : ''}`, null, btn, note);
}

// ------------------------------------------------------------------- hub

let pending = null;       // { seq, species, room, exclude, fresh, at }
let job = null;           // the request being worked on
const done = new Set();   // seqs sent or cancelled
let card = null;

function trigger(name, ...args) {
    try {
        engine.trigger(name, ...args);
        return true;
    }
    catch (e) {
        return false;
    }
}

function selected() {
    const v = get(STORAGE_DATA, 'selectedAnimalIDs');
    return Array.isArray(v) ? v.map(String) : [];
}

function storageRows() {
    const model = getStorageKinModel();
    return childrenOf(STORAGE_LIST).map(ctx => {
        const row = readAnimal(ctx);
        const kin = model && row.id != null ? model.animals.get(String(row.id)) : null;
        return {
            id: row.id == null ? null : String(row.id),
            key: row.key,
            name: locationName(row.name) || '',
            species: row.species,
            sex: row.gender,
            maturity: row.maturity,
            isShoal: row.isShoal,
            isMoving: row.isMoving,
            auctionTimerSeconds: row.auctionTimerSeconds,
            location: locationName(get(ctx, 'location')) || '',
            guid: kin && kin.guid ? String(kin.guid) : null,
            genes: row.genes,
        };
    });
}

function closeCard() {
    if (curtain) curtain.remove();
    curtain = null;
    card = null;
}

// The job's filters were only its means: put the player's back (unless
// they have picked something else meanwhile).
function dropChip(j) {
    try {
        const now = (getStorageFilters() || {}).species;
        if (j && j.filters && (j.chip ? sameSpecies(now, j.species) : !now)) setStorageFilters(j.filters);
    }
    catch (e) {
        // the chip stays; one click clears it
    }
}

// The job is over (sent, stopped, cancelled or Storage left): curtain off.
function endJob() {
    const j = job;
    if (!j) return closeCard();
    clearInterval(j.timer);
    job = null;
    closeCard();
    // after a send the selection no longer matters (the game has the ids)
    dropChip(j);
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

// A curtain over Animal Storage while the mod works there (the developer:
// the player shouldn't watch the list being filtered and ticked), with the
// card in the middle. It also stops stray clicks changing the selection.
let curtain = null;
const SENT_SHOW_MS = 8000;

function openCurtain() {
    if (curtain) return;
    card = h('div.PZ2QoL_ssCard.PZ2QoL_sfCard');
    curtain = h('div.PZ2QoL_sfCurtain', null, card);
    document.body.appendChild(curtain);
}

function panel(title, lines, { busy = false, buttons = [] } = {}) {
    openCurtain();
    while (card.firstChild) card.removeChild(card.firstChild);
    card.appendChild(h('div.PZ2QoL_ssHead', null,
        busy ? h('div.PZ2QoL_sfSpinner') : null,
        h('div.PZ2QoL_ssTitle', { text: title })));
    for (const l of lines) if (l) card.appendChild(l);
    if (buttons.length) card.appendChild(h('div.PZ2QoL_ssButtons', null, ...buttons));
}

function renderWaiting(p) {
    panel(`Bringing your ${fetchName(p.species, speciesName)} to the trade centre`, [h('div.PZ2QoL_ssLine', { text: 'Opening your Animal Storage…' })], { busy: true });
}

function countdownText(j) {
    return `Sending in ${Math.max(1, Math.ceil((j.deadline - Date.now()) / 1000))}…`;
}

function render() {
    if (!job) return closeCard();
    const j = job;
    const lines = [];
    if (j.pick) lines.push(h('div.PZ2QoL_ssLine', { text: pickedText(j.pick, j.room) }));
    for (const line of j.notes) lines.push(h('div.PZ2QoL_ssItem.skip', { text: line }));
    const title = `Bringing your ${j.name} to the trade centre`;
    if (j.phase === 'prepare') {
        lines.push(h('div.PZ2QoL_ssLine', { text: 'Finding them in your storage…' }));
        panel(title, lines, { busy: true, buttons: [cardButton('Cancel', () => cancel())] });
    }
    else if (j.phase === 'countdown') {
        j.countdownLine = h('div.PZ2QoL_ssLine.done', { text: countdownText(j) });
        lines.push(j.countdownLine);
        panel(title, lines, { busy: true, buttons: [cardButton('Send now', () => send()), cardButton('Cancel', () => cancel(), 'stop')] });
    }
    else if (j.phase === 'ready') {
        lines.push(h('div.PZ2QoL_ssLine.done', { text: 'Send them to the zoo? Each one then waits in its trade centre.' }));
        panel(`Bring your ${j.name} to the trade centre`, lines, { buttons: [cardButton('Send', () => send()), cardButton('Cancel', () => cancel(), 'stop')] });
    }
    else if (j.phase === 'sent') {
        lines.push(h('div.PZ2QoL_ssLine.done', { text: 'Sent with the game\'s Send to Zoo. Back to your zoo…' }));
        panel(title, lines, { busy: true });
    }
    else {
        lines.push(h('div.PZ2QoL_ssLine.done', { text: j.stop || 'Stopped.' }));
        panel(`Bring your ${j.name} to the trade centre`, lines, { buttons: [cardButton('Close', () => endJob())] });
    }
}

function ack(seq) {
    done.add(seq);
    trigger('PZ2QoL_FetchAck', seq);
}

// The end of a job that sent nothing: ticks cleared, the reason shown.
function stop(text, { keep = false } = {}) {
    if (!job) return;
    if (!keep) ack(job.seq);
    trigger('AnimalStorage_SelectAllToggled', false);
    clearInterval(job.timer);
    job.phase = 'stopped';
    job.stop = text;
    breadcrumb('fetch_hub_stop');
    dlog('fetch', 'stopped', { species: job.species, why: text });
    render();
}

function cancel() {
    if (!job || job.phase === 'sent') return;
    breadcrumb('fetch_hub_cancel');
    ack(job.seq);
    trigger('AnimalStorage_SelectAllToggled', false);
    endJob();
}

function send() {
    const j = job;
    if (!j || (j.phase !== 'countdown' && j.phase !== 'ready')) return;
    clearInterval(j.timer);
    // exactly the animals ticked for this: nothing else, nothing missing
    const now = selected();
    if (!sameKeys(now, j.keys)) return stop('The selection changed; nothing was sent.');
    if (get(STORAGE_ACTIONS, 'sendToZooAllowed') === false) return stop("The game won't send this selection to the zoo right now.");
    ack(j.seq);
    j.phase = 'sent';
    render();
    if (!armAndSend(now, 'trade')) return stop('The game could not be asked; nothing was sent.');
    breadcrumb('fetch_hub_sent');
    dlog('fetch', 'sent', { species: j.species, animals: now.length });
    // the hub page outlives the switch to the zoo and is drawn over it: the
    // curtain must go even if Storage still reads as visible (proven 2026-10-18)
    setTimeout(() => {
        if (job === j && j.phase === 'sent') endJob();
    }, SENT_SHOW_MS);
}

async function waitFor(test, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (test()) return true;
        await wait(150);
    }
    return test();
}

async function runJob(p) {
    // a sent job still on screen hands its chip back first: what this job
    // keeps as the player's filters must not be that job's chip
    if (job) endJob();
    const all = isAllSpecies(p.species);
    const j = job = { seq: p.seq, species: p.species, name: fetchName(p.species, speciesName), room: p.room, fresh: p.fresh, phase: 'prepare', notes: [], keys: [], pick: null, timer: null };
    render();
    breadcrumb(p.fresh ? 'fetch_hub_start' : 'fetch_hub_again');
    const alive = () => job === j && j.phase === 'prepare';
    // the mod's own chips hide rows, and a hidden row never stays ticked:
    // the job shows every animal of its species (all species: no chip)
    j.filters = getStorageFilters();
    j.chip = !all;
    setStorageFilters(Object.assign({}, DEFAULT_STORAGE_FILTERS, { species: all ? '' : p.species }));
    // the game's own filters may hide some of them: clear them as the Market
    // desk does (put back when Storage closes)
    const active = nativeFiltersOn(k => get(STORAGE_DATA.concat('filters'), k));
    if (active.length) {
        const a = await deskFilters('clear');
        if (!alive()) return;
        if (!a || !a.ok) j.notes.push('Your storage filters hide some animals; only the ones shown can be sent.');
        await wait(700);
    }
    await waitFor(() => storageRows().some(r => all || sameSpecies(r.species, p.species)), ROWS_WAIT_MS);
    if (!alive()) return;
    const exclude = parseExclude(p.exclude);
    // the park's animals are matched by GUID when the storage lineage is in
    if (exclude.match.length) {
        // named animals: the list loads in steps, so wait until every one
        // of them is on screen
        await waitFor(() => {
            const named = pickRows(storageRows(), { species: p.species, room: -1, exclude });
            return named.picked.length + named.cancel.length >= exclude.match.length;
        }, NAMED_WAIT_MS);
    }
    else if (exclude.guids.size) await waitFor(() => !!getStorageKinModel(), GUID_WAIT_MS);
    if (!alive()) return;
    let pick = pickRows(storageRows(), { species: p.species, room: p.room, exclude });
    if (pick.cancel.length) {
        const listed = pick.cancel;
        const still = await cancelListings(listed, alive);
        if (!still) return;
        pick = pickRows(storageRows(), { species: p.species, room: p.room, exclude });
        j.notes.push(...cancelLines(listed, still));
    }
    j.pick = pick;
    j.notes.push(...leftLines(pick));
    dlog('fetch', 'pick', {
        species: p.species, room: p.room, picked: pick.picked.length, left: pick.left.length, listed: pick.listed.length,
        moving: pick.moving.length, here: pick.here.length, shoals: pick.shoals.length,
        named: exclude.match.map(m => `${m.name}/${m.sex}/${m.genes.join('.')}`).join(' '),
    });
    for (const r of pick.picked) dlog('fetch', 'picked', { name: r.name, species: r.species, sex: r.sex, maturity: r.maturity, location: r.location });
    if (!pick.picked.length && pick.cancel.length) return stop(j.notes.join(' '));
    if (!pick.picked.length && exclude.match.length) return stop(`The ${j.name} the notice named ${exclude.match.length === 1 ? 'is' : 'are'} not in Storage any more (moved, listed or sold since). Nothing was sent.`);
    if (!pick.picked.length) return stop(all ? 'Nothing in storage to bring.' : `No ${j.name} in storage to bring.`);
    j.keys = pick.picked.map(r => String(r.key));
    trigger('AnimalStorage_SelectAllToggled', false);
    for (const r of pick.picked) trigger('AnimalStorage_ItemCheckboxToggled', r.id, true);
    const ticked = await waitFor(() => sameKeys(selected(), j.keys), TICK_WAIT_MS);
    if (!alive()) return;
    if (!ticked) return stop('The game did not tick the animals; nothing was sent.');
    // the panel's own Send to Zoo state follows the selection a moment later
    await waitFor(() => get(STORAGE_ACTIONS, 'sendToZooAllowed') !== false, 1000);
    if (!alive()) return;
    if (get(STORAGE_ACTIONS, 'sendToZooAllowed') === false) return stop("The game won't send this selection to the zoo right now.");
    if (p.fresh) {
        j.phase = 'countdown';
        j.deadline = Date.now() + COUNTDOWN_MS;
        // only the number changes: rebuilding the card would drop a click on Cancel mid-press
        j.timer = setInterval(() => {
            if (job !== j || j.phase !== 'countdown') return clearInterval(j.timer);
            if (Date.now() >= j.deadline) send();
            else setText(j.countdownLine, countdownText(j));
        }, 250);
    }
    else {
        j.phase = 'ready';
    }
    render();
}

// The named animals on the market: each listing is cancelled as the game's
// own Cancel trade button does: the row clicked (AnimalStorage_ItemSelected,
// the storage's selected item, which a ticked box is not), then
// AnimalStorage_Cancel 'Trade'; then waited for until its row shows it off
// the market.
// -> the rows still listed, or null when the job ended meanwhile
async function cancelListings(rows, alive) {
    const still = [];
    for (const r of rows) {
        trigger('AnimalStorage_SelectAllToggled', false);
        trigger('AnimalStorage_ItemSelected', r.id);
        const only = () => sameKeys(selected(), [String(r.key)]);
        let one = await waitFor(only, TICK_WAIT_MS);
        if (!alive()) return null;
        // the selected item need not show as ticked: its box as well
        if (!one) {
            trigger('AnimalStorage_ItemCheckboxToggled', r.id, true);
            one = await waitFor(only, TICK_WAIT_MS);
            if (!alive()) return null;
        }
        if (one) trigger('AnimalStorage_Cancel', 'Trade');
        const off = one && await waitFor(() => {
            const now = storageRows().find(x => x.key === r.key);
            return !!now && !isListedRow(now);
        }, CANCEL_WAIT_MS);
        if (!alive()) return null;
        dlog('fetch', 'cancel_listing', { name: r.name, species: r.species, ticked: one, off });
        if (!off) still.push(r);
    }
    trigger('AnimalStorage_SelectAllToggled', false);
    return still;
}

function hello() {
    trigger('PZ2QoL_FetchHello');
}

// Animal Storage comes up: only Lua knows whether an older request still
// holds (same zoo, not acked), and it hands it over again in answer to the hello
const storageShown = visibilityWatch('.AnimalMarketStorage_header', at => {
    if (handOverState(pending, at) !== 'fresh') pending = null;
    hello();
});

function hubTick() {
    try {
        const vis = storageShown() > 0;
        if (!vis) {
            if (job) {
                // Storage left (or the zoo loaded after the send): the curtain
                // goes. Left before sending: nothing is sent; Lua keeps the
                // request, and the next visit asks for a click
                if (job.phase !== 'sent' && job.phase !== 'stopped') breadcrumb('fetch_hub_left');
                endJob();
            }
            const state = handOverState(pending, Date.now());
            if (state === 'expired') pending = null;
            // the click just opened Storage: cover it from the first frame.
            // Any other hand-over leaves the hub alone until Storage shows
            if (state === 'fresh') renderWaiting(pending);
            else if (curtain) closeCard();
            return;
        }
        // a finished job never blocks the next request
        if (pending && job && (job.phase === 'sent' || job.phase === 'stopped')) endJob();
        if (!pending || job) return;
        const p = pending;
        pending = null;
        const state = handOverState(p, Date.now());
        if (state === 'expired') return;
        runJob(Object.assign({}, p, { fresh: state === 'fresh' })).catch(e => {
            reportError('mod', 'Bring to the trade centre (storage) failed', e);
            if (job) stop(`Something went wrong (${(e && e.message) || e}), so nothing was sent. Open Animal Storage again to retry, or tick the animals and use Send to Zoo yourself.`, { keep: true });
        });
    }
    catch (e) {
        reportError('ui', 'Bring to the trade centre: the storage step failed', e, { silent: true });
    }
}

function installHub() {
    engine.on('PZ2QoL_FetchPending', (seq, species, room, exclude, fresh) => {
        if (!species || done.has(seq)) {
            if (done.has(seq)) trigger('PZ2QoL_FetchAck', seq);
            return;
        }
        // a repeat of the request in hand keeps its first hand-over's age
        if ((job && job.seq === seq) || (pending && pending.seq === seq)) return;
        pending = { seq, species: String(species), room: Number.isFinite(Number(room)) ? Number(room) : -1, exclude: String(exclude || ''), fresh: fresh === true, at: Date.now() };
        breadcrumb(fresh === true ? 'fetch_pending_fresh' : 'fetch_pending_again');
    });
    setInterval(hubTick, HUB_TICK_MS);
    hello();
}

// --------------------------------------------------------------- install

let installed = false;

export function installStorageFetch() {
    if (installed) return true;
    if (typeof engine === 'undefined') return false;
    installed = true;
    loadCSS('mods/pz2qol_storagefetch');
    listen();
    if (isFrontendPage()) installHub();
    return true;
}

// Harness only.
export function _resetFetch() {
    endJob();
    pending = null;
}

export function _fetchState() {
    return { pending, job: job ? { seq: job.seq, phase: job.phase, keys: job.keys.slice(), notes: job.notes.slice(), stop: job.stop || '' } : null, done: Array.from(done) };
}
