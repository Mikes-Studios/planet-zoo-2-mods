// Species board: pick a species, see its animals habitat by habitat, spot
// the problems, and plan moves right there.
//
//   header   title, Kin planner, Rescan, Close
//   left     every species, problems first
//   middle   the species' habitats as columns of animal cards (plus
//            "Elsewhere"), scrolling sideways, and the trade centre pinned
//            on the right so it is always in view; drag cards between
//            columns, or select them and press "Move N here", to stage
//            moves in a plan
//   bottom   the plan: its moves, what it fixes and creates (simulated on
//            the kin model), Suggest fixes, Clear, Execute
//
// Nothing moves until the player runs the plan (one move at a time, each
// confirmed by the game, kinmoves.js) or presses "Move now" on one animal.
// Gameface: own DOM under <body>, explicit display:flex, no CSS grid, no
// native scrolling (kinpanel.js), pointer drag with mouse events (no HTML5
// drag and drop).
import { Sex, relationWord, severityRank, fertilityTag, holdReason, withStored } from '/js/mods/pz2qol/kincore.js';
import {
    STORED_SHOW, TRADE, boardColumns, canMove, homeOf, moveText, noOtherHabitat, placeName, planImpact, planProblems, prunePlan, setMove, simulatePlan, speciesList, suggestPlan,
    isPinned, mustHouse, PREGNANT_STAYS,
} from '/js/mods/pz2qol/kinboardcore.js';
import { countWord, visibleCounts, worstOf } from '/js/mods/pz2qol/kinplannercore.js';
import {
    getKinModel, getKinSettings, getKinState, locatePlace, markKinActive, onKin, onKinSettings, requestKinScan, setKinSettings,
    setContraception,
} from '/js/mods/pz2qol/kin.js';
import {
    cachedDestinations, getPlanRun, isAskingStored, moveAnimal, onPlanRun, planBlockedReason, requestDestinations, requestSpeciesInfo, requestStoredAdults, runPlan, stopPlan,
} from '/js/mods/pz2qol/kinmoves.js';
import {
    PROGRAMME_DEFAULTS, PROGRAMME_STEPS, conceptionChance, groupRule, planProgrammeAsync, programmeLogData, isHousingMove, programmeProblemSig, ratioKey, unknownMakeupText, withFreshYoung, youngQuality,
} from '/js/mods/pz2qol/kinprogramme.js';
import {
    RATIO_SOURCE_WORDS, makeupFixed, makeupShort, makeupWords, programmeHabitats, programmeKey, programmeOptions, ratioChoice, saveProgStep, savedProgStep, stepRatioChoice,
} from '/js/mods/pz2qol/progprefs.js';
import { programmeSignature, staleDeepText } from '/js/mods/pz2qol/breedwincore.js';
import {
    AUTO_CPU, CPU_ORDER, CPU_STEPS, CUSTOM_STEPS, DEEP_PRESETS, PRESET_ORDER, PRESET_WORDS, cpuOf, deepJob, deepKey, deepResult, deepSettings,
    cancelDeep, dropDeepResults, durationText, estimateSeconds, getOptimiser, installDeep, latestDeepResult, msPerStartFor, onDeep, onOptimiser,
    setOptimiser, startDeep, stopDeep,
} from '/js/mods/pz2qol/kinprogdeep.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { FILL_STEPS, GENE_STEPS, cullPlan } from '/js/mods/pz2qol/kincull.js';
import { hideKinCard, kinBadge, sexClass, sexSymbol } from '/js/mods/pz2qol/kinui.js';
import { clear, crossMark, h, icon, setClass, setText } from '/js/mods/pz2qol/ui.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { paceSlider } from '/js/mods/pz2qol/pace.js';
import { getAssignments, onAssignments, toggleAssignment, assignmentStorage, assignmentStorageReason } from '/js/mods/pz2qol/kinassign.js';
import { isMuted, mutedSpecies, onMuted, setMuted } from '/js/mods/pz2qol/kinmute.js';
import { canOpenTrade, onStorageCounts, openTrade, requestStorageCounts, tradeRow } from '/js/mods/pz2qol/tradejump.js';
import { fetchAllRow, fetchRow } from '/js/mods/pz2qol/storagefetch.js';
import {
    ago, btn as kitBtn, closeButton, closeOtherPanels, countPills, makeGuard, makeScroll, panelApi, placePanel, refreshBars, registerPanel,
    remPx, restoreScroll, scrollBoxTo, speciesName, switchEl as kitSwitch, trunc, wheelScroll,
} from '/js/mods/pz2qol/kinpanel.js';

const TICK_MS = 2000;
const NOTICE_MS = 9000;
const DRAG_START_PX = 6;
// wider than the other big panels by about one column: room for the pinned
// trade centre without taking any from the habitats
const BOARD_SIZE = { maxRem: 112, maxVw: 0.96 };

const guard = makeGuard('Species board');
const btn = (...args) => kitBtn(guard, ...args);
const switchEl = (...args) => kitSwitch(guard, ...args);

const LT_WORDS = { transit: 'in transit', quarantine: 'quarantine', vet: 'at the vet', escaped: 'escaped', other: 'elsewhere', trade: 'trade centre' };

// --------------------------------------------------------------- state

const S = {
    root: null,
    el: {},
    open: false,
    species: null,
    plan: [],                 // [{ id, to }]
    reasons: new Map(),       // id -> why Suggest fixes moved it
    selected: new Set(),
    dest: null,
    destLoading: false,
    notice: null,             // { text, tone, until }
    boxes: {},
    scroll: { rail: 0, board: 0, list: 0, impact: 0, cols: {} },
    columns: [],
    colEls: new Map(),        // column id -> { el, col, rel, drop }
    cards: new Map(),         // animal id -> card element (where it is after the plan)
    menu: null,
    menuFor: null,
    drag: null,
    suppressClick: false,
    hoverId: null,
    deferred: false,
    queued: false,
    planTab: 'plan',
    sent: new Set(),          // ids we sent a move for (their leaving the plan is expected)
    pendingMove: new Map(),   // id -> to (a "Move now" in flight)
    lastModel: undefined,
    modelTime: 0,
    model: null,
    after: null,
    afterMemo: null,          // { model, plan, dest, after }: simulatedPlan's last answer
    impactMemo: null,         // { model, after, species, sp, zoo }: planImpacts' last answer
    unsub: [],
    timer: 0,
    prog: null,               // the breeding programme preview: { species, state, step, info, results, ... }
    auto: null,               // the species whose Auto mode panel is open (kinautoui.js draws it)
    storedBy: new Map(),      // species -> the player's stored adults (Franchise; kinmoves requestStoredAdults), null: no answer
    storedTried: new Set(),   // species asked since the board opened
    storedFresh: false,       // the next ask skips the 60 s cache (board just opened)
    storedAll: false,         // the trade column lists every stored adult, not the first few
    storedView: null,         // withStored(model, answer): the merged pedigree (hover relatives)
};

// Thin out: the last known "over the room" count per species (for the rail)
const overBySpecies = new Map();
// Thin out: the player's last choices (this session), for the next species
const cullPrefs = { fill: 'balanced', genes: 'off', zeroFertility: true, oldAlways: false };
// Thin out's keep marks, by kincull's whyCode
const CULL_MARKS = {
    core: { cls: 'core', text: 'core', title: 'The breeding core of this habitat: kept' },
    pregnant: { cls: 'preg', text: 'pregnant', title: 'Pregnant: never sent away' },
    best: { cls: 'best', text: 'best', title: 'The best genes of the species: kept' },
    lastBreeder: { cls: 'best', text: 'last breeder', title: 'Every breeder of this sex has poor genes; the best of them stays so the species can still breed' },
    mine: { cls: 'mine', text: 'your choice', title: 'You chose this' },
    moving: { cls: 'moving', text: 'on the move', title: 'Already on the move' },
    away: { cls: 'moving', text: 'away', title: 'At the vet, in a quarantine or being carried: it comes back to this habitat and is kept' },
};

// ------------------------------------------------------------ Auto mode

// Auto mode's part of the board (kinautoui.js): the Auto button and its
// panel per species, its tags on the cards and in the rail, "hands off" in
// the card menu. null if Auto mode failed to load: the board then draws and
// does exactly what it did before.
let ext = null;

export function setBoardExtension(e) {
    ext = e || null;
    if (!ext) S.auto = null;
    if (S.open) queueRender();
}

function extCall(name, ...args) {
    if (!ext || typeof ext[name] !== 'function') return null;
    try {
        return ext[name](...args);
    }
    catch (e) {
        reportError('ui', `Species board: Auto mode ${name} failed`, e, { silent: true });
        return null;
    }
}

// The player is working on this species on the board: a staged plan with
// its animals, its Breeding programme or Thin out open, a drag, a Move now
// in flight. Auto mode waits.
export function isBoardBusy(species) {
    if (S.pendingMove.size > 0 || S.drag) return true;
    if (!S.open) return false;
    if ((S.prog && S.prog.species === species) || (S.cull && S.cull.species === species)) return true;
    const model = S.model;
    return S.plan.some(m => {
        const a = model && model.animals.get(String(m.id));
        return !a || a.species === species;
    });
}

// What the Auto panel can use of the board.
function autoHelpers() {
    return {
        btn, switchEl, guard, notice, renderAll, queueRender, makeScroll, restoreScroll, statTile, placeName: whereName,
        close: closeAuto,
        scroll: y => {
            if (y != null) S.scroll.auto = y;
            return S.scroll.auto || 0;
        },
        box: b => {
            S.boxes.auto = b;
        },
    };
}

function openAuto() {
    if (!S.species || !ext) return;
    if (S.auto === S.species) return closeAuto();
    S.prog = null;
    S.cull = null;
    S.auto = S.species;
    S.scroll.auto = 0;
    closeMenu();
    S.selected.clear();
    breadcrumb('kin_board_auto');
    renderAll();
}

function closeAuto() {
    S.auto = null;
    renderAll();
}

// Auto mode's notices: open the board on a species with its Auto panel.
export function openAutoPanel(species) {
    openSpeciesBoard({ species });
    if (!ext || S.species !== String(species)) return;
    S.prog = null;
    S.cull = null;
    S.auto = S.species;
    renderAll();
}

// Auto mode's state changed (a run, the countdown): draw again if open.
export function refreshAutoPanel() {
    if (S.open) queueRender();
}

function notice(text, tone = 'info') {
    S.notice = { text, tone, until: Date.now() + NOTICE_MS };
    renderNotice();
}

function destFor(model) {
    const d = S.dest;
    const tc = (d && d.tradeCentre) || (model && model.tradeCentre) || null;
    if (!d) return tc ? { bySpecies: {}, habitats: [], tradeCentre: tc } : null;
    return d.tradeCentre || !tc ? d : Object.assign({}, d, { tradeCentre: tc });
}

function destKnown() {
    return !!(S.dest && S.dest.bySpecies && S.species && S.dest.bySpecies[S.species]);
}

function whereName(model, to) {
    return placeName(model, to, destFor(model));
}

// --------------------------------------------------------------- skeleton

function ensureRoot() {
    if (S.root && S.root.parentNode) return S.root;
    const el = S.el;
    el.sub = h('div.PZ2QoL_kbSub');
    const head = h('div.PZ2QoL_kpHead', null,
        h('div.PZ2QoL_kpLogo.board'),
        h('div.PZ2QoL_kpTitles', null,
            h('div.PZ2QoL_kpTitle', { text: 'Species board' }),
            el.sub),
        h('div.PZ2QoL_kpFlex'),
        btn('Kin planner', 'IconGenetics', openPlanner, { title: 'The relatedness matrix and mate finder' }),
        btn('Rescan', 'Icon_CircleWithArrows', () => {
            if (S.prog || S.cull) return recomputePanel();
            requestKinScan('board', { force: true });
            loadDestinations(true);
            if (S.species) requestStorageCounts([S.species], { force: true });
            if (S.species) loadStored(true);
            notice('Reading the animals and the habitats again…');
        }, { title: 'Read the animals and the habitat checks again now' }),
        closeButton(guard, 'Close (Esc)', () => closeSpeciesBoard()));
    el.rail = h('div.PZ2QoL_kbRail');
    el.board = h('div.PZ2QoL_kbBoard');
    el.plan = h('div.PZ2QoL_kbPlan');
    el.legend = h('div.PZ2QoL_kpLegend');
    el.status = h('div.PZ2QoL_kpStatus');
    const root = h('div.PZ2QoL_kb.hidden', null,
        head,
        h('div.PZ2QoL_kbBody', null, el.rail, el.board),
        el.plan,
        h('div.PZ2QoL_kpFoot', null, el.legend, h('div.PZ2QoL_kpFlex'), el.status));
    root.addEventListener('mousedown', e => {
        e.stopPropagation();
        try {
            if (S.menu && !S.menu.contains(e.target)) closeMenu();
        }
        catch (err) {
            reportError('ui', 'Species board: menu failed', err, { silent: true });
        }
    });
    root.addEventListener('click', e => e.stopPropagation());
    root.addEventListener('dragstart', e => e.preventDefault());
    root.addEventListener('wheel', e => {
        e.preventDefault();
        e.stopPropagation();
    });
    document.body.appendChild(root);
    S.root = root;
    buildLegend();
    return root;
}

function buildLegend() {
    const l = S.el.legend;
    clear(l);
    const item = (cls, label) => h('div.PZ2QoL_kpLegendItem', null, h(`div.PZ2QoL_kbSwatch.${cls}`), h('span', { text: label }));
    l.appendChild(item('sev_risk', 'Inbreeding risk'));
    l.appendChild(item('sev_kin', 'Close kin'));
    l.appendChild(item('sev_future', 'Future risk'));
    l.appendChild(item('sev_held', 'Bonded elsewhere'));
    l.appendChild(item('sev_covered', 'Covered'));
    l.appendChild(item('planned', 'Planned move'));
    l.appendChild(item('ghost', 'Leaving'));
    l.appendChild(h('div.PZ2QoL_kpLegendItem.hint', { text: 'Drag cards between habitats · Shift+click selects several · Shift+wheel scrolls sideways' }));
}

// ---------------------------------------------------------------- render

function queueRender() {
    if (!S.open) return;
    if (S.drag || S.menu) {
        S.deferred = true;
        return;
    }
    if (S.queued) return;
    S.queued = true;
    setTimeout(() => {
        S.queued = false;
        renderAll();
    }, 0);
}

function onModel(model) {
    if (model === S.lastModel) return;
    S.lastModel = model;
    if (!model) return;
    S.modelTime = Date.now();
    // keep the plan, without the moves that cannot happen any more
    const kept = prunePlan(model, S.plan);
    const dropped = S.plan.filter(m => !kept.includes(m));
    S.plan = kept;
    const said = [];
    for (const m of dropped) {
        S.reasons.delete(m.id);
        // we moved it: expected, and settled
        if (S.sent.delete(m.id)) continue;
        const a = model.animals.get(String(m.id));
        if (!a) said.push(`${m.id} (no longer in the zoo)`);
        else if (a.moving) said.push(`${a.name} ${sexSymbol(a.sex)} (already on the move)`);
        else if (homeOf(a) === String(m.to)) said.push(`${a.name} ${sexSymbol(a.sex)} (already there)`);
        else said.push(`${a.name} ${sexSymbol(a.sex)} (cannot move now)`);
    }
    if (said.length) notice(`Removed from the plan: ${said.join(', ')}.`, 'warn');
    for (const id of Array.from(S.selected)) {
        const a = model.animals.get(id);
        if (!a || !canMove(a) || a.species !== S.species) S.selected.delete(id);
    }
}

// The plan simulated on the model, and what it changes, again only when the
// model, the plan or the habitat checks change (most clicks change none of them).
function simulatedPlan(model, dest) {
    const memo = S.afterMemo;
    if (memo && memo.model === model && memo.plan === S.plan && memo.dest === S.dest) return memo.after;
    const after = simulatePlan(model, S.plan, dest);
    S.afterMemo = { model, plan: S.plan, dest: S.dest, after };
    return after;
}

function planImpacts(model, after, species) {
    const memo = S.impactMemo;
    if (memo && memo.model === model && memo.after === after && memo.species === species) return memo;
    S.impactMemo = { model, after, species, sp: planImpact(model, after, species), zoo: planImpact(model, after) };
    return S.impactMemo;
}

function renderAll() {
    if (!S.root || !S.open) return;
    try {
        S.deferred = false;
        const model = getKinModel();
        onModel(model);
        S.model = model;
        if (model) {
            const list = speciesList(model, { muted: mutedSpecies() });
            if (!S.species || !list.some(s => s.species === S.species)) {
                S.species = list.length ? list[0].species : null;
                closeSpeciesPanels();
                S.selected.clear();
                if (S.species) loadDestinations(false);
            }
        }
        const dest = destFor(model);
        S.after = model ? simulatedPlan(model, dest) : null;
        S.boxes = {};
        renderHead(model);
        renderRail(model);
        renderBoard(model, dest);
        fitColumns();
        fitProgramme();
        fitCull();
        fitAuto();
        renderPlan(model, dest);
        renderFoot();
        if (S.hoverId) highlightRelatives(S.hoverId);
        setTimeout(() => refreshBars(S.boxes), 0);
    }
    catch (e) {
        reportError('ui', 'Species board could not draw', e);
    }
}

function renderHead(model) {
    const el = S.el.sub;
    clear(el);
    if (!model) {
        el.appendChild(h('span', { text: getKinSettings().enabled ? 'Waiting for animal data' : 'Kin is turned off' }));
        return;
    }
    el.appendChild(h('span', { text: 'Drag animals between habitats to plan moves. Nothing moves until you run the plan or press Move now.' }));
}

// ------------------------------------------------------------------ rail

function assignedCount(model, species) {
    let n = 0;
    for (const set of getAssignments(model).values()) if (set.has(species)) n++;
    return n;
}

// The column's assignment: whose habitat it is, one click to change it.
function assignEl(model, c) {
    if (c.kind !== 'habitat') return null;
    const sp = speciesName(S.species);
    const others = c.assigned.filter(x => x !== S.species).map(speciesName);
    const toggle = () => {
        toggleAssignment(model, c.id, S.species, c.name);
        // once per session: assignments that only last until the game closes
        // (not while the store is still being found: 'wait' keeps the change
        // and saves it once the store answers)
        if (assignmentStorage() === 'memory' && assignmentStorageReason() !== 'wait' && !S.memoryNoted) {
            S.memoryNoted = true;
            notice('Habitat assignments last until you close the game: the game\'s player profile could not be used to keep them on this PC.', 'info');
        }
        renderAll();
    };
    const kids = [];
    if (c.mine) {
        kids.push(h('div.PZ2QoL_kbAssign.mine', {
            title: `Assigned to ${sp}${others.length ? ' (and ' + others.join(', ') + ')' : ''}: Suggest fixes moves ${sp} only into its assigned habitats and puts no other species here. Click to remove.`,
            onClick: guard('Assign', toggle),
        }, h('span', { text: `★ ${trunc(sp, 16)} habitat` })));
    }
    else if (c.reservedOther) {
        kids.push(h('div.PZ2QoL_kbAssign.other', {
            title: `Assigned to ${others.join(', ')}. Click to allow ${sp} here too.`,
            onClick: guard('Assign', toggle),
        }, h('span', { text: `Assigned to ${trunc(others.join(', '), 18)}` })));
    }
    else {
        kids.push(h('div.PZ2QoL_kbAssign', {
            title: `Set this habitat aside for ${sp}: Suggest fixes will then use only ${sp}'s assigned habitats, and never put other species here`,
            onClick: guard('Assign', toggle),
        }, h('span', { text: `☆ Assign to ${trunc(sp, 16)}` })));
    }
    if (c.mine && c.intruders && c.intruders.length) {
        const list = c.intruders.map(o => `${o.count} ${speciesName(o.species)}`).join(', ');
        kids.push(h('div.PZ2QoL_kbIntruders', { text: `+ ${list}`, title: `Also living here: ${list}` }));
    }
    return h('div.PZ2QoL_kbAssignRow', null, kids);
}

function renderRail(model) {
    const el = S.el.rail;
    clear(el);
    const box = makeScroll('rail', { onScroll: (x, y) => { S.scroll.rail = y; } });
    S.boxes.rail = box;
    el.appendChild(box.wrap);
    if (!model) return;
    if (S.cull) cullResult();          // its "N over" shows in the rail
    const list = speciesList(model, { muted: mutedSpecies() });
    const showCovered = getKinSettings().showCovered;
    box.content.appendChild(h('div.PZ2QoL_kpSideHead', { text: `Species (${list.length})` }));
    if (!list.length) box.content.appendChild(h('div.PZ2QoL_kbRailEmpty', { text: 'No animals in the zoo yet.' }));
    for (const s of list) {
        const on = s.species === S.species;
        const counts = visibleCounts(s.counts, showCovered);
        const pills = countPills(counts, { compact: true });
        const worst = worstOf(counts) || 'none';
        const meta = [`${s.males}♂ ${s.females}♀`];
        if (s.juveniles) meta.push(`${s.juveniles} young`);
        meta.push(`${s.habitats.length} habitat${s.habitats.length === 1 ? '' : 's'}`);
        if (s.away) meta.push(`${s.away} away`);
        const own = assignedCount(model, s.species);
        if (own) meta.push(`★ ${own} assigned`);
        const over = overBySpecies.get(s.species);
        if (over) meta.push(`${over} over`);
        if (s.muted) meta.push('muted');
        const autoTag = ext ? extCall('railTag', s.species) : null;
        if (autoTag) meta.push(autoTag);
        box.content.appendChild(h(`div.PZ2QoL_kbSpecies.sev_${worst}${on ? '.on' : ''}${s.muted ? '.muted' : ''}`, {
            'data-species': s.species,
            title: speciesName(s.species),
            onClick: guard('Species', () => focusSpecies(s.species)),
        },
        h('div.PZ2QoL_kpHabTop', null,
            h('div.PZ2QoL_kpHabName', { text: trunc(speciesName(s.species), 20) }),
            h('div.PZ2QoL_kpHabCount', { text: String(s.animals), title: `${s.animals} animals` })),
        h('div.PZ2QoL_kbSpeciesMeta', { text: meta.join(' · ') }),
        h('div.PZ2QoL_kbSpeciesPills', null, pills.length ? pills : h('div.PZ2QoL_kpHabOk', { text: 'No related pairs' }))));
    }
    restoreScroll(box, 0, S.scroll.rail);
}

// ----------------------------------------------------------------- board

function renderBoard(model, dest) {
    const el = S.el.board;
    clear(el);
    S.colEls = new Map();
    S.cards = new Map();
    if (!model) {
        el.appendChild(waitingState());
        return;
    }
    if (!S.species) {
        el.appendChild(h('div.PZ2QoL_kpEmpty', null,
            h('div.PZ2QoL_kpEmptyTitle', { text: 'No animals yet' }),
            h('div.PZ2QoL_kpEmptyText', { text: 'Once your zoo has animals in habitats, pick a species on the left to see them here.' })));
        return;
    }
    const assignments = getAssignments(model);
    const base = boardColumns(model, S.species, [], dest, { assignments, after: model });
    // S.after: this render's simulation of S.plan (renderAll), not built twice
    // the player's stored adults (Franchise) for the pinned trade column: read-only
    const stored = storedFor(model);
    const cols = boardColumns(model, S.species, S.plan, dest, { assignments, after: S.after && S.model === model ? S.after : null, stored });
    // a stable order: the order before the plan (a drop must not reshuffle the board)
    const order = new Map(base.map((c, i) => [c.id, i]));
    cols.sort((x, y) => (order.has(x.id) ? order.get(x.id) : 999) - (order.has(y.id) ? order.get(y.id) : 999));
    S.columns = cols;
    const animals = Array.from(model.animals.values()).filter(a => a.species === S.species && !a.exhibit);
    const habs = new Set(animals.filter(a => a.hab).map(a => a.hab));
    const away = animals.filter(a => !a.hab && a.lt !== 'trade').length;
    const now = speciesList(model).find(s => s.species === S.species);
    const run = getPlanRun();
    // header line
    const right = [];
    if (S.selected.size) {
        right.push(h('div.PZ2QoL_kbSel', null,
            h('span', { text: `${S.selected.size} selected` }),
            h('div.PZ2QoL_kbLink', { onClick: guard('Clear selection', () => { S.selected.clear(); renderAll(); }) }, h('span', { text: 'Clear' }))));
    }
    if (run.running) right.push(h('div.PZ2QoL_kbLock', { text: 'A plan is running: the board is locked' }));
    else if (S.destLoading && !destKnown()) right.push(h('div.PZ2QoL_kbDestState', { text: 'Asking the game which habitats suit them…' }));
    else if (!destKnown()) right.push(h('div.PZ2QoL_kbDestState.unknown', { text: 'Habitats not checked yet: any habitat accepts a planned move' }));
    el.appendChild(h('div.PZ2QoL_kpMainHead.kb', null,
        h('div.PZ2QoL_kpMainTitles', null,
            h('div.PZ2QoL_kpMainTitle', { text: trunc(speciesName(S.species), 30) }),
            h('div.PZ2QoL_kpMainSub', { text: `${animals.length} animal${animals.length === 1 ? '' : 's'} · ${habs.size} habitat${habs.size === 1 ? '' : 's'}${away ? ` · ${away} elsewhere` : ''}` })),
        h('div.PZ2QoL_kbHeadPills', null, now ? countPills(visibleCounts(now.counts, getKinSettings().showCovered)) : null),
        muteSwitch(),
        h('div.PZ2QoL_kpFlex'),
        tradeHead(),
        right));
    if (destKnown() && noOtherHabitat(S.dest.bySpecies[S.species], habs)) {
        el.appendChild(h('div.PZ2QoL_kbHint.warn', { text: `No other habitat suits ${speciesName(S.species)} right now. Build or extend one, or use the trade centre to make room.` }));
    }
    if (S.prog && S.prog.species === S.species) {
        el.appendChild(programmeEl(model));
        return;
    }
    if (S.cull && S.cull.species === S.species) {
        el.appendChild(cullEl(model));
        return;
    }
    if (S.auto && S.auto === S.species && ext) {
        const panel = extCall('panelEl', model, S.species, autoHelpers());
        if (panel) {
            el.appendChild(panel);
            return;
        }
    }
    const box = makeScroll('kbCols', {
        x: true,
        y: false,
        onScroll: (x) => { S.scroll.board = x; },
    });
    S.boxes.board = box;
    // the trade centre stays pinned on the right, outside the sideways scroll
    const pinned = cols.find(c => c.kind === 'trade') || null;
    const row = h('div.PZ2QoL_kbColRow');
    for (const c of cols) if (c !== pinned) row.appendChild(columnEl(model, c));
    box.content.appendChild(row);
    el.appendChild(h('div.PZ2QoL_kbStage', null,
        box.wrap,
        pinned ? h('div.PZ2QoL_kbPinned', null, columnEl(model, pinned, { pinned: true })) : null));
    restoreScroll(box, S.scroll.board, 0);
}

// Trade shortcuts (tradejump.js): this species' adults in Animal Storage,
// and Storage / Market buttons that open the hub filtered to it. The board
// closes when the hub opens.
function tradeHead() {
    const sp = S.species;
    if (!sp) return null;
    return tradeRow(sp, {
        rowCls: 'PZ2QoL_kbTrade',
        btnCls: 'PZ2QoL_kpBtn',
        showCounts: true,
        onOpened: () => closeSpeciesBoard(),
        onError: text => notice(text, 'warn'),
    });
}

// No kin alerts for this species in this zoo (kinmute.js); badges stay.
function muteSwitch() {
    const sp = S.species;
    if (!sp) return null;
    const el = switchEl('Mute alerts', isMuted(sp), () => setMuted(sp, !isMuted(sp)),
        `No alert messages about ${speciesName(sp)} in this zoo. Its badges, the planner and this board still show every related pair.`);
    el.classList.add('kbMute');
    return el;
}

// Columns as tall as the board strip, cards scrolling inside. Sized in
// pixels after layout rather than left to flex shrinking: with many animals
// in one habitat the column grew to fit every card, its own scroll area had
// nothing to scroll, and the strip cut the rest off (seen in game).
function fitColumns() {
    const board = S.boxes.board;
    if (!board) return;
    const vpH = Math.floor(board.vp.getBoundingClientRect().height);
    if (!(vpH > 0)) return;
    const rem = remPx();
    const colH = Math.max(rem * 8, vpH - Math.ceil(rem * 0.75));
    // all writes, then all reads, then all writes: one layout, not one per column
    board.content.style.height = `${vpH}px`;
    const cols = [];
    for (const { el } of S.colEls.values()) {
        if (!el || !el.parentNode) continue;
        el.style.height = `${colH}px`;
        const head = el.querySelector('.PZ2QoL_kbColHead');
        const body = el.querySelector('.PZ2QoL_kpScroll.kbColBody');
        if (head && body) cols.push({ el, head, body });
    }
    const heights = cols.map(({ el, head }) => {
        const inner = el.getBoundingClientRect().height - (el.offsetHeight - el.clientHeight);
        return Math.max(rem * 3, Math.floor((inner || colH) - head.getBoundingClientRect().height));
    });
    cols.forEach(({ body }, i) => {
        body.style.flex = '0 0 auto';
        body.style.height = `${heights[i]}px`;
    });
}

function waitingState() {
    const off = !getKinSettings().enabled;
    const st = getKinState();
    return h('div.PZ2QoL_kpEmpty', null,
        h(`div.PZ2QoL_kpEmptyIcon.${off ? 'off' : 'wait'}`),
        h('div.PZ2QoL_kpEmptyTitle', { text: off ? 'Kin is off' : 'Waiting for animal data' }),
        h('div.PZ2QoL_kpEmptyText', {
            text: off ? 'Kin is turned off, so the board has nothing to show.'
                : st.state === 'nopark' ? 'No park is loaded. Open a zoo and the board fills in by itself.'
                    : 'Kin reads your zoo\'s animals and their parents. This takes a moment after a park loads.',
        }),
        h('div.PZ2QoL_kpEmptyActions', null,
            off ? btn('Turn Kin on', 'IconGenetics', () => setKinSettings({ enabled: true }), { cls: 'primary', tint: 'white' })
                : btn('Rescan', 'Icon_CircleWithArrows', () => requestKinScan('board', { force: true }), { cls: 'primary', tint: 'white' })));
}

// Juveniles stay in a habitat until they are grown (the trade centre is no place to grow up).
function youngStayText(list) {
    const names = list.map(a => a.name).join(', ');
    return `${names} ${list.length === 1 ? 'is' : 'are'} young: a juvenile stays in a habitat until it is grown, so Kin never sends one to the trade centre. Move ${list.length === 1 ? 'it' : 'them'} to another habitat instead.`;
}

// Can these animals be planned into this column? { ok, reason, unknown, noop }
function dropCheck(model, c, ids) {
    if (!c) return { ok: false, reason: '' };
    if (c.kind === 'away') return { ok: false, reason: 'Animals on their way, in quarantine or at the vet are listed here; nothing can be sent here.' };
    if (c.kind === 'habitat' && c.dest && c.dest.ok === false) return { ok: false, reason: `${c.name}: ${c.dest.reason || 'not suitable for this species'}` };
    const movable = ids.map(id => model.animals.get(String(id))).filter(a => a && canMove(a));
    if (!movable.length) return { ok: false, reason: 'These animals cannot move right now.' };
    const young = c.kind === 'trade' ? movable.filter(a => a.juv) : [];
    if (young.length) return { ok: false, reason: youngStayText(young) };
    const planned = new Map(S.plan.map(m => [m.id, m.to]));
    const noop = movable.every(a => (planned.get(a.id) || homeOf(a)) === c.id);
    return { ok: true, reason: '', unknown: c.kind === 'habitat' && !c.dest, noop };
}

// "Show in park" on a habitat column: the camera to the habitat and its info
// panel (the game's Habitats list's own locate); the board closes.
function showInParkEl(model, c) {
    if (c.kind !== 'habitat' || c.id == null) return null;
    const sample = c.animals.find(x => !x.planned) || c.animals[0] || null;
    return h('div.PZ2QoL_kbColShow', {
        title: `Show ${c.name} in the park: the camera moves there and opens its info panel. The board closes.`,
        onClick: guard('Show in park', () => {
            if (locatePlace(c.id, sample && sample.a ? sample.a.id : '')) closeSpeciesBoard();
        }),
    }, icon('IconLocation', 'brown', 'xs'), h('span', { text: 'Show' }));
}

function columnEl(model, c, { pinned = false } = {}) {
    const empty = !c.animals.length;
    const unsuitable = c.kind === 'habitat' && c.dest && c.dest.ok === false;
    const unknown = c.kind === 'habitat' && !c.dest;
    const worst = c.risk.risk ? 'risk' : c.risk.kin ? 'kin' : c.risk.future ? 'future' : 'none';
    const cls = [`kind_${c.kind}`, `sev_${worst}`];
    if (empty) cls.push('empty');
    if (unsuitable) cls.push('unsuitable');
    if (unknown) cls.push('unknown');
    if (pinned) cls.push('pinned');
    const node = h(`div.PZ2QoL_kbCol.${cls.join('.')}`, { 'data-col': c.id, 'data-kind': c.kind });
    // head
    const counts = [];
    if (c.counts.males) counts.push(`${c.counts.males}♂`);
    if (c.counts.females) counts.push(`${c.counts.females}♀`);
    if (c.counts.juveniles) counts.push(`${c.counts.juveniles} young`);
    const storedN = c.kind === 'trade' && c.stored ? c.stored.length : 0;
    const iconName = c.kind === 'trade' ? 'IconTradeCentre' : c.kind === 'away' ? 'IconTransport' : 'IconHabitat';
    const rel = h('div.PZ2QoL_kbColRel');
    const drop = h('div.PZ2QoL_kbColDrop');
    let status;
    const ids = Array.from(S.selected);
    const sel = ids.length ? dropCheck(model, c, ids) : null;
    if (sel && sel.ok && !sel.noop && !getPlanRun().running) {
        status = h('div.PZ2QoL_kbMoveHere', {
            title: sel.unknown ? 'Not checked by the game yet' : `Plan moving the selected animals to ${c.name}`,
            onClick: guard('Move here', () => applyMoves(Array.from(S.selected), c.id)),
        }, h('div.PZ2QoL_kbArrow'), h('span', { text: `Move ${ids.length} here` }));
    }
    else if (unsuitable) status = h('div.PZ2QoL_kbColStatus.bad', { text: `Not suitable: ${c.dest.reason || 'the game says no'}`, title: c.dest.reason || '' });
    else if (c.kind === 'away') status = h('div.PZ2QoL_kbColStatus', { text: 'On the move, quarantine, vet: cannot move' });
    else if (c.kind === 'trade') status = h('div.PZ2QoL_kbColStatus', { text: 'Always here: drag to or from a habitat', title: 'The trade centre: the holding area for trading or release. Pinned on the right so you can drag its animals into any habitat and see who is related.' });
    else if (unknown) status = h('div.PZ2QoL_kbColStatus.faint', { text: S.destLoading ? 'Checking…' : 'Not checked yet' });
    else if (empty) status = h('div.PZ2QoL_kbColStatus.ok', { text: 'Empty · suitable' });
    else status = h('div.PZ2QoL_kbColStatus.ok', { text: 'Suitable' });
    const other = c.other.slice(0, 2).map(o => h('div.PZ2QoL_kbOther', { text: `${trunc(speciesName(o.species), 10)} ${o.count}`, title: `${o.count} ${speciesName(o.species)} share this habitat` }));
    if (c.other.length > 2) other.push(h('div.PZ2QoL_kbOther', { text: `+${c.other.length - 2}`, title: c.other.slice(2).map(o => speciesName(o.species)).join(', ') }));
    const riskPills = countPills(visibleCounts(c.risk, getKinSettings().showCovered), { compact: true });
    const head = h('div.PZ2QoL_kbColHead', null,
        h('div.PZ2QoL_kbColTop', null,
            icon(iconName, 'brown', 'sm'),
            h('div.PZ2QoL_kbColName', { text: trunc(c.name, 22), title: c.name }),
            h('div.PZ2QoL_kpFlex'),
            showInParkEl(model, c),
            h('div.PZ2QoL_kpHabCount', { text: String(c.animals.length) })),
        h('div.PZ2QoL_kbColMeta', null,
            storedN ? h('div.PZ2QoL_kbColCounts.stored', {
                text: `${c.animals.length} here · +${storedN} in storage`,
                title: `${counts.join(' · ') || 'None'} here; ${storedN} adult${storedN === 1 ? '' : 's'} in your Animal Storage (stored young are not shown)`,
            }) : h('div.PZ2QoL_kbColCounts', { text: counts.join(' · ') || (empty ? 'no animals' : '') }),
            h('div.PZ2QoL_kpFlex'),
            other),
        h('div.PZ2QoL_kbColPills', null, riskPills.length ? riskPills
            : h('div.PZ2QoL_kbColAlone', { text: c.kind !== 'habitat' || empty ? '' : 'No related pairs' })),
        status,
        assignEl(model, c),
        rel,
        drop);
    head.addEventListener('wheel', e => {
        e.preventDefault();
        e.stopPropagation();
        if (S.boxes.board && !pinned) wheelScroll(S.boxes.board, e, true);
    });
    node.appendChild(head);
    // body: the cards
    const body = makeScroll('kbColBody', {
        onScroll: (x, y) => { S.scroll.cols[c.id] = y; },
        onWheel: (box, e) => {
            // sideways with Shift, or when this column does not scroll (the
            // pinned trade centre only ever scrolls its own cards)
            if (!S.boxes.board || pinned) return false;
            if (e.shiftKey || box.vp.scrollHeight <= box.vp.getBoundingClientRect().height + 1) {
                wheelScroll(S.boxes.board, e, true);
                return true;
            }
            return false;
        },
    });
    S.boxes['col_' + c.id] = body;
    for (const x of c.animals) body.content.appendChild(cardEl(model, c, x));
    if (c.leaving.length) {
        body.content.appendChild(h('div.PZ2QoL_kbLeavingHead', { text: `Leaving (${c.leaving.length})` }));
        for (const l of c.leaving) body.content.appendChild(ghostEl(model, l));
    }
    if (!c.animals.length && !c.leaving.length) {
        body.content.appendChild(h(`div.PZ2QoL_kbDropHint${unsuitable || c.kind === 'away' ? '.no' : ''}`, {
            text: unsuitable ? 'Not suitable for this species' : c.kind === 'away' ? 'Nobody away' : 'Drop animals here',
        }));
    }
    if (c.kind === 'trade') storedGroup(model, c, body.content);
    node.appendChild(body.wrap);
    restoreScroll(body, 0, S.scroll.cols[c.id] || 0);
    S.colEls.set(c.id, { el: node, col: c, rel, drop });
    return node;
}

// ------------------------------------------------- stored adults (trade)

// The player's stored adults of the board's species (Franchise only: the
// game shows the park only its stored adults, and only there; most of them
// have no entity, so the park scan misses them). Asked once per species
// after the board opens (past the cache), on a new species, and on Rescan;
// never on a timer. -> the answer (normalizeStored) or null.
function storedFor(model) {
    S.storedView = null;
    const sp = S.species;
    if (!model || !sp || model.mode !== 'franchise') return null;
    if (!S.storedTried.has(sp) && !isAskingStored(sp)) loadStored(S.storedFresh);
    const v = S.storedBy.get(sp);
    if (!v || v.error || !v.animals || !v.animals.length) return null;
    S.storedView = withStored(model, v);
    return v;
}

function loadStored(force) {
    const sp = S.species;
    const model = getKinModel();
    if (!sp || !model || model.mode !== 'franchise') return;
    S.storedTried.add(sp);
    S.storedFresh = false;
    requestStoredAdults(sp, { force: !!force }).then(v => {
        S.storedBy.set(sp, v || null);
        if (S.open && S.species === sp) queueRender();
    }, e => reportError('mod', 'Species board: stored animals failed', e, { silent: true }));
}

// Under the trade column's own cards: the stored adults, read-only, the
// first few then "N more". Nothing when there are none or the game did not
// answer; a faint note outside Franchise.
function storedGroup(model, c, content) {
    const sp = S.species;
    if (!model || !sp) return;
    const fetch = fetchRow(model, sp, { onOpened: () => closeSpeciesBoard(), onError: text => notice(text, 'warn') });
    if (fetch) content.appendChild(fetch);
    // every species at once, right under it (the developer, 2026-10-19)
    const fetchAll = fetchAllRow(model, { countsFor: sp, onOpened: () => closeSpeciesBoard(), onError: text => notice(text, 'warn') });
    if (fetchAll) content.appendChild(fetchAll);
    if (model.mode !== 'franchise') {
        content.appendChild(h('div.PZ2QoL_kbStoredNote.faint', { text: 'Your Animal Storage adults show here in Franchise zoos.' }));
        return;
    }
    const list = c.stored || [];
    if (!list.length) {
        if (isAskingStored(sp) && !S.storedBy.has(sp)) content.appendChild(h('div.PZ2QoL_kbStoredNote.faint', { text: 'Checking your Animal Storage…' }));
        return;
    }
    const info = S.storedBy.get(sp);
    const group = h('div.PZ2QoL_kbStored');
    group.appendChild(h('div.PZ2QoL_kbStoredHead', null,
        h('span', { text: 'In Animal Storage (adults)' }),
        h('div.PZ2QoL_kpFlex'),
        h('span', { text: String(list.length) })));
    group.appendChild(h('div.PZ2QoL_kbStoredNote', {
        text: `Stored young aren't listed${info && info.capped ? `; the first ${list.length} adults shown` : ''}. Bring them with the button above, or from Animal Storage.`,
    }));
    const shown = S.storedAll ? list : list.slice(0, STORED_SHOW);
    for (const x of shown) group.appendChild(storedCardEl(model, x));
    if (list.length > STORED_SHOW) {
        group.appendChild(h('div.PZ2QoL_kbStoredMore', {
            onClick: guard('Stored more', () => {
                S.storedAll = !S.storedAll;
                renderAll();
            }),
        }, h('span', { text: S.storedAll ? 'Show fewer' : `${list.length - STORED_SHOW} more` })));
    }
    content.appendChild(group);
}

// Opens Animal Storage on this species (tradejump.js); the board closes.
function openStorage() {
    const why = canOpenTrade();
    if (why) {
        notice(why, 'warn');
        return;
    }
    openTrade('storage', S.species).then(r => {
        if (r.ok) closeSpeciesBoard();
        else notice(r.text, 'warn');
    }, e => reportError('mod', 'Species board: opening Animal Storage failed', e));
}

// A stored adult: read-only (no drag, no select: a move needs an animal in
// the park), Storage shortcut. No inbreeding badge or stripe: a stored animal
// can't breed (developer, 2026-10-18); its relatives in the park show only as
// a plain line and on hover, for planning.
function storedCardEl(model, x) {
    const a = x.a;
    const sev = 'none';
    const cls = ['stored', 'locked', sexClass(a.sex), `sev_${sev}`];
    const p0 = x.pairs[0];
    const kinLine = p0 ? h('span.PZ2QoL_kbKinLine', {
        text: `${relationWord(p0.rel, p0.other.sex)} ${trunc(p0.other.name, 10)}${x.pairs.length > 1 ? ` +${x.pairs.length - 1}` : ''}`,
        title: x.pairs.map(p => `${relationWord(p.rel, p.other.sex)} ${p.other.name} (${whereName(model, homeOf(p.other)) || 'in the zoo'})`).join(', '),
    }) : null;
    const ft = fertilityTag(a);
    const why = canOpenTrade();
    const relLabel = h('span.PZ2QoL_kbRelLabel');
    const card = h(`div.PZ2QoL_kbCard.${cls.join('.')}`, { 'data-id': a.id, 'data-sev': sev, 'data-stored': '1' },
        h('div.PZ2QoL_kbStripe'),
        h('div.PZ2QoL_kbCardMain', null,
            h('div.PZ2QoL_kbCardTop', null,
                h('div.PZ2QoL_kbCardName', { text: `${sexSymbol(a.sex)} ${trunc(a.name, 13)}`, title: a.name }),
                h('div.PZ2QoL_kpFlex'),
                h(`div.PZ2QoL_kbStoredBtn${why ? '.blocked' : ''}`, {
                    'data-trade': 'storage',
                    title: why || `Open your Animal Storage in the hub, showing only ${speciesName(S.species)}. The board closes.`,
                    onClick: guard('Storage', () => openStorage()),
                }, h('span', { text: 'Storage' }))),
            h('div.PZ2QoL_kbCardTags', null,
                h('span.PZ2QoL_kbTag.storage', { text: 'in storage', title: 'In your Animal Storage (hub): not in the park' }),
                a.forSale ? h('span.PZ2QoL_kbTag.listed', { text: 'listed', title: 'On the market now' }) : null,
                ft ? h(`span.PZ2QoL_kbTag.${ft.cls}`, { text: ft.text, title: ft.title }) : null,
                kinLine, h('div.PZ2QoL_kpFlex'), relLabel)));
    card.__id = a.id;
    card.__rel = relLabel;
    card.__col = TRADE;
    card.addEventListener('mouseenter', () => {
        if (S.drag) return;
        S.hoverId = a.id;
        highlightRelatives(a.id);
    });
    card.addEventListener('mouseleave', () => {
        if (S.drag || S.hoverId !== a.id) return;
        S.hoverId = null;
        clearHighlight();
    });
    card.addEventListener('click', guard('Stored card', () => {
        notice(`${a.name} is in your Animal Storage, not in the park. Send it to the zoo from Animal Storage (Storage), then plan its moves here.`);
    }));
    S.cards.set(a.id, card);
    return card;
}

function tagsFor(a, x, model) {
    const out = [];
    if (a.moving) out.push(h('span.PZ2QoL_kbTag.moving', { text: 'on the move' }));
    else if (a.away) out.push(h('span.PZ2QoL_kbTag.away', { text: LT_WORDS[a.away] || a.away, title: 'Assigned to this habitat; away for now. It counts here and comes back.' }));
    else if (!a.hab && a.lt && a.lt !== 'trade' && a.lt !== 'habitat') out.push(h('span.PZ2QoL_kbTag.away', { text: LT_WORDS[a.lt] || a.lt }));
    if (x && x.planned) {
        const before = model.animals.get(a.id);
        out.push(h('span.PZ2QoL_kbTag.from', { text: `from ${trunc(whereName(model, before ? homeOf(before) : ''), 16)}` }));
    }
    const ft = fertilityTag(a);
    if (ft) out.push(h(`span.PZ2QoL_kbTag.${ft.cls}`, { text: ft.text, title: ft.title }));
    if (a.contra) out.push(h('span.PZ2QoL_kbTag.contra', { text: 'contra' }));
    if (a.preg) out.push(h('span.PZ2QoL_kbTag.preg', { text: 'pregnant', title: `Pregnant: Kin's plans never move her; she stays until she gives birth (she can't be sold). The game still lets you move her yourself.` }));
    if (S.pendingMove.has(a.id)) out.push(h('span.PZ2QoL_kbTag.moving', { text: 'moving…' }));
    const t = ext ? extCall('cardTag', a) : null;
    if (t) out.push(h('span.PZ2QoL_kbTag.auto', { text: t.text, title: t.title || '' }));
    return out;
}

// The animal's worst counted severity now (before the plan).
function baseSeverity(model, id) {
    const list = (model.byAnimal.get(String(id)) || []).filter(p => p.severity !== 'distant');
    return list.length ? list[0].severity : null;
}

function cardEl(model, c, x) {
    const a = x.a;
    const movable = canMove(model.animals.get(a.id)) && !S.pendingMove.has(a.id);
    const sev = x.severity || 'none';
    const cls = [sexClass(a.sex), `sev_${sev}`];
    if (a.juv) cls.push('juv');
    if (x.planned) cls.push('planned');
    if (!movable) cls.push('locked');
    if (a.moving) cls.push('moving');
    if (S.selected.has(a.id)) cls.push('selected');
    // what the plan does to this animal
    let change = null;
    if (S.plan.length) {
        const was = baseSeverity(model, a.id);
        // kept apart (covered, or held by a pair bond) is not a problem now
        const problem = s => (s && s !== 'covered' && s !== 'held' ? s : null);
        const now = problem(x.severity);
        const wasC = problem(was);
        if (severityRank(now) < severityRank(wasC)) change = h('span.PZ2QoL_kbTag.fixed', { text: 'fixed' });
        else if (severityRank(now) > severityRank(wasC)) change = h('span.PZ2QoL_kbTag.worse', { text: now === 'risk' ? 'new risk' : 'new kin' });
    }
    const mates = (model.animals.get(a.id) || a).mates || [];
    // the worst relative it shares a habitat with (after the plan)
    let kinLine = null;
    const worstPair = x.pairs[0];
    if (worstPair) {
        const wordFor = o => {
            const r = a.guid && o.guid ? model.ped.relation(a.guid, o.guid) : null;
            return r ? relationWord(r, o.sex) : 'relative';
        };
        const partner = worstPair.a.id === a.id ? worstPair.b : worstPair.a;
        kinLine = h(`span.PZ2QoL_kbKinLine.sev_${worstPair.severity}`, {
            text: `${wordFor(partner)} ${trunc(partner.name, 10)}${x.pairs.length > 1 ? ` +${x.pairs.length - 1}` : ''}`,
            title: x.pairs.map(p => {
                const o = p.a.id === a.id ? p.b : p.a;
                return `${wordFor(o)} ${o.name}${p.held ? ` (${holdReason(p)})` : ''}`;
            }).join(', '),
        });
    }
    const relLabel = h('span.PZ2QoL_kbRelLabel');
    const menuBtn = x.planned ? null : h('div.PZ2QoL_kbCardMenu', { title: 'Actions', onClick: guard('Menu', e => openMenu(a.id, e.currentTarget || e.target)) }, h('div.PZ2QoL_kbDot'), h('div.PZ2QoL_kbDot'), h('div.PZ2QoL_kbDot'));
    // the panel's mousedown closes an open menu; its own button's click toggles it instead
    if (menuBtn) menuBtn.addEventListener('mousedown', e => e.stopPropagation());
    const top = h('div.PZ2QoL_kbCardTop', null,
        h('div.PZ2QoL_kbCardName', { text: `${sexSymbol(a.sex)} ${trunc(a.name, 15)}`, title: a.name }),
        mates.length ? h('div.PZ2QoL_kpMated.inline', { title: 'Has a mate now' }, icon('Icon_Heart', 'white', 'xs')) : null,
        h('div.PZ2QoL_kpFlex'),
        x.severity ? kinBadge(x.severity, x.pairs.length, { compact: true }) : null,
        x.planned
            ? h('div.PZ2QoL_kbCardX', { title: 'Remove this move from the plan', onClick: guard('Remove move', () => removeMove(a.id)) }, crossMark())
            : menuBtn);
    const card = h(`div.PZ2QoL_kbCard.${cls.join('.')}`, { 'data-id': a.id, 'data-sev': sev, 'data-planned': x.planned ? '1' : '0' },
        h('div.PZ2QoL_kbStripe'),
        h('div.PZ2QoL_kbCardMain', null,
            top,
            h('div.PZ2QoL_kbCardTags', null, tagsFor(a, x, model), change, kinLine, h('div.PZ2QoL_kpFlex'), relLabel)));
    card.__id = a.id;
    card.__rel = relLabel;
    card.addEventListener('mouseenter', () => {
        if (S.drag) return;
        S.hoverId = a.id;
        highlightRelatives(a.id);
    });
    card.addEventListener('mouseleave', () => {
        if (S.drag || S.hoverId !== a.id) return;
        S.hoverId = null;
        clearHighlight();
    });
    card.addEventListener('mousedown', e => {
        if (e.button !== 0 || !movable || getPlanRun().running) return;
        for (let n = e.target; n && n !== card; n = n.parentNode) {
            if (n.classList && (n.classList.contains('PZ2QoL_kbCardMenu') || n.classList.contains('PZ2QoL_kbCardX') || n.classList.contains('PZ2QoL_kin'))) return;
        }
        e.preventDefault();          // no text selection, no native drag
        startPointer(e, a.id, card);
    });
    card.addEventListener('click', guard('Select', e => {
        if (S.suppressClick) {
            S.suppressClick = false;
            return;
        }
        if (!movable) {
            notice(a.moving ? `${a.name} is already on the move.` : `${a.name} cannot be moved from here.`, 'warn');
            return;
        }
        if (getPlanRun().running) return;
        const multi = e.shiftKey || e.ctrlKey || e.metaKey;
        if (multi) {
            if (S.selected.has(a.id)) S.selected.delete(a.id);
            else S.selected.add(a.id);
        }
        else if (S.selected.has(a.id) && S.selected.size === 1) S.selected.clear();
        else {
            S.selected.clear();
            S.selected.add(a.id);
        }
        renderAll();
    }));
    S.cards.set(a.id, card);
    return card;
}

function ghostEl(model, l) {
    const a = l.a;
    const node = h(`div.PZ2QoL_kbCard.ghost.${sexClass(a.sex)}`, { 'data-ghost': a.id, title: `${a.name} is planned to move to ${l.toName}` },
        h('div.PZ2QoL_kbStripe'),
        h('div.PZ2QoL_kbCardMain', null,
            h('div.PZ2QoL_kbCardTop', null,
                h('div.PZ2QoL_kbCardName', { text: `${sexSymbol(a.sex)} ${trunc(a.name, 17)}` }),
                h('div.PZ2QoL_kpFlex'),
                h('div.PZ2QoL_kbCardX', { title: 'Keep it here (remove the move)', onClick: guard('Remove move', () => removeMove(a.id)) }, crossMark())),
            h('div.PZ2QoL_kbCardTags', null, h('div.PZ2QoL_kbArrow.small'), h('span.PZ2QoL_kbGoing', { text: trunc(l.toName, 24) }))));
    return node;
}

// ------------------------------------------------------- relatives on hover

function clearHighlight() {
    if (S.root) setClass(S.root, 'hovering', false);
    for (const card of S.cards.values()) {
        setClass(card, 'relHot', false);
        setClass(card, 'dim', false);
        setClass(card, 'focus', false);
        for (const s of ['risk', 'kin', 'future', 'held', 'covered', 'distant', 'apart']) setClass(card, 'rel_' + s, false);
        setText(card.__rel, '');
    }
    for (const c of S.colEls.values()) {
        setText(c.rel, '');
        c.rel.className = 'PZ2QoL_kbColRel';
    }
}

// Every relative of `id` on the board lights up with how it is related;
// the rest fades. Column heads count the relatives in them.
function highlightRelatives(id) {
    const model = S.model;
    const after = S.after;
    if (!model || !after) return;
    clearHighlight();
    // stored adults (trade column) take part through the merged pedigree
    const view = S.storedView && S.storedView.ped ? S.storedView : model;
    const find = oid => model.animals.get(String(oid)) || (view.stored ? view.stored.get(String(oid)) : undefined);
    const self = find(id);
    if (!self || !self.guid) return;
    const pairs = new Map();
    for (const p of after.byAnimal.get(self.id) || []) pairs.set(p.a.id === self.id ? p.b.id : p.a.id, p);
    const perCol = new Map();
    let any = false;
    for (const [oid, card] of S.cards) {
        if (oid === self.id) {
            setClass(card, 'focus', true);
            continue;
        }
        const other = find(oid);
        const rel = other && other.guid ? view.ped.relation(self.guid, other.guid) : null;
        if (!rel) {
            setClass(card, 'dim', true);
            continue;
        }
        any = true;
        const p = pairs.get(oid);
        const tone = p ? p.severity : 'apart';
        setClass(card, 'relHot', true);
        setClass(card, 'rel_' + tone, true);
        setText(card.__rel, relationWord(rel, other.sex));
        const col = card.__col || findCol(oid);
        if (col) {
            const e = perCol.get(col) || { n: 0, worst: null };
            e.n++;
            if (severityRank(tone) > severityRank(e.worst)) e.worst = tone;
            perCol.set(col, e);
        }
    }
    if (S.root) setClass(S.root, 'hovering', true);
    if (!any) {
        for (const card of S.cards.values()) setClass(card, 'dim', false);
    }
    for (const [colId, e] of perCol) {
        const c = S.colEls.get(colId);
        if (!c) continue;
        setText(c.rel, `${e.n} relative${e.n > 1 ? 's' : ''}`);
        c.rel.className = `PZ2QoL_kbColRel show rel_${e.worst || 'apart'}`;
    }
}

function findCol(id) {
    for (const [colId, c] of S.colEls) {
        if (c.col.animals.some(x => x.a.id === id)) return colId;
    }
    return null;
}

// ------------------------------------------------------------- dragging

function startPointer(e, id, card) {
    const start = { x: e.clientX, y: e.clientY };
    const move = ev => {
        try {
            if (!S.drag) {
                if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) < DRAG_START_PX) return;
                beginDrag(id, card, ev);
            }
            dragMove(ev);
        }
        catch (err) {
            reportError('ui', 'Species board: dragging failed', err, { silent: true });
            cancelDrag();
        }
    };
    const up = ev => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!S.drag) return;
        try {
            endDrag(ev);
        }
        catch (err) {
            reportError('ui', 'Species board: dropping failed', err);
            cancelDrag();
        }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    S.pointerOff = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
    };
}

function beginDrag(id, card, ev) {
    const model = S.model;
    const ids = S.selected.has(id) && S.selected.size > 1 ? Array.from(S.selected) : [id];
    const a = model.animals.get(id);
    const label = ids.length > 1 ? `${a.name} and ${ids.length - 1} more` : `${sexSymbol(a.sex)} ${a.name}`;
    const ghost = h(`div.PZ2QoL_kbDrag.${sexClass(a.sex)}`, null, h('div.PZ2QoL_kbDragName', { text: trunc(label, 30) }), h('div.PZ2QoL_kbDragHint', { text: 'Drop on a habitat' }));
    document.body.appendChild(ghost);
    S.drag = { ids, ghost, over: null, check: null, origin: card };
    S.suppressClick = true;
    setClass(card, 'dragSource', true);
    setClass(S.root, 'dragging', true);
    closeMenu();
}

// The column under the pointer. Strip columns count only inside the strip's
// viewport: one scrolled out of view may lie under the pinned trade centre.
function columnAt(x, y) {
    const board = S.boxes.board;
    const vr = board ? board.vp.getBoundingClientRect() : null;
    for (const [colId, c] of S.colEls) {
        const r = c.el.getBoundingClientRect();
        if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue;
        if (vr && !c.el.classList.contains('pinned') && !(x >= vr.left && x <= vr.right)) continue;
        return colId;
    }
    return null;
}

function dragMove(ev) {
    const d = S.drag;
    if (!d) return;
    const rem = remPx();
    d.ghost.style.left = `${Math.round(ev.clientX + rem * 0.8)}px`;
    d.ghost.style.top = `${Math.round(ev.clientY + rem * 0.5)}px`;
    // near the board's edges: scroll it
    const board = S.boxes.board;
    if (board) {
        const r = board.vp.getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
            if (ev.clientX < r.left + rem * 3) scrollBoxTo(board, board.vp.scrollLeft - rem * 1.2, 0);
            else if (ev.clientX > r.right - rem * 3) scrollBoxTo(board, board.vp.scrollLeft + rem * 1.2, 0);
        }
    }
    const over = columnAt(ev.clientX, ev.clientY);
    if (over === d.over) return;
    if (d.over && S.colEls.get(d.over)) {
        const old = S.colEls.get(d.over);
        setClass(old.el, 'dropOk', false);
        setClass(old.el, 'dropNo', false);
        setText(old.drop, '');
        setClass(old.drop, 'show', false);
    }
    d.over = over;
    d.check = null;
    if (!over) return;
    const c = S.colEls.get(over);
    const check = dropCheck(S.model, c.col, d.ids);
    d.check = check;
    setClass(c.el, check.ok ? 'dropOk' : 'dropNo', true);
    let text = check.reason;
    let tone = 'bad';
    if (check.ok) {
        if (check.noop) {
            text = 'Already here';
            tone = 'info';
        }
        else {
            // what this drop would change for the species
            let trial = S.plan;
            for (const id of d.ids) trial = setMove(S.model, trial, id, over);
            const dest = destFor(S.model);
            // one simulation per column for this drag (hovering back and forth)
            if (!d.impacts) d.impacts = new Map();
            let imp = d.impacts.get(over);
            if (!imp) {
                imp = planImpact(S.after, simulatePlan(S.model, trial, dest), S.species);
                d.impacts.set(over, imp);
            }
            const made = imp.created.filter(p => p.severity === 'risk' || p.severity === 'kin');
            const gone = imp.fixed.filter(p => p.severity === 'risk' || p.severity === 'kin');
            if (made.length) {
                text = `Creates ${made.length} related pair${made.length > 1 ? 's' : ''} here`;
                tone = 'bad';
            }
            else if (gone.length) {
                text = `Fixes ${gone.length} related pair${gone.length > 1 ? 's' : ''}`;
                tone = 'ok';
            }
            else {
                text = 'No new related pairs';
                tone = 'ok';
            }
            if (check.unknown) text += ' · not checked by the game yet';
            if (d.ids.some(id => isPinned(S.model && S.model.animals.get(String(id))))) text += " · pregnant: allowed, but she can't be sold until she gives birth";
        }
    }
    setText(c.drop, text);
    c.drop.className = `PZ2QoL_kbColDrop show ${tone}`;
}

function endDrag(ev) {
    const d = S.drag;
    dragMove(ev);
    const over = d.over;
    const check = d.check;
    cancelDrag(true);
    // the click that may follow this mouseup belongs to the drag; later ones do not
    setTimeout(() => { S.suppressClick = false; }, 0);
    if (!over) return renderAll();
    if (!check || !check.ok) {
        if (check && check.reason) notice(check.reason, 'bad');
        return renderAll();
    }
    if (check.noop) return renderAll();
    applyMoves(d.ids, over);
}

function cancelDrag(keepSuppress) {
    const d = S.drag;
    if (S.pointerOff) S.pointerOff();
    S.pointerOff = null;
    if (!d) return;
    if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
    S.drag = null;
    if (!keepSuppress) S.suppressClick = false;
    setClass(S.root, 'dragging', false);
    if (S.deferred || !keepSuppress) renderAll();
}

// ----------------------------------------------------------- plan editing

function applyMoves(ids, to) {
    const model = getKinModel();
    if (!model) return;
    let plan = S.plan;
    const names = [];
    const pregnant = [];
    for (const id of ids) {
        const a = model.animals.get(String(id));
        if (!a || !canMove(a)) continue;
        // planned by hand: the run moves her even when pregnant (the game allows it)
        plan = setMove(model, plan, a.id, to, { byPlayer: true });
        S.reasons.delete(a.id);
        names.push(`${a.name} ${sexSymbol(a.sex)}`);
        if (isPinned(a) && String(to) !== String(homeOf(a))) pregnant.push(a.name);
    }
    S.plan = plan;
    S.selected.clear();
    if (names.length) {
        notice(pregnant.length
            ? `${names.join(', ')} → ${whereName(model, to)}: planned. ${pregnant.join(', ')} ${pregnant.length === 1 ? 'is' : 'are'} pregnant: the game allows the move, but she can't be sold and has to give birth first. Nothing moves until you run the plan.`
            : `${names.join(', ')} → ${whereName(model, to)}: planned. Nothing moves until you run the plan.`, pregnant.length ? 'warn' : undefined);
        breadcrumb(pregnant.length ? 'kin_board_plan_pregnant' : 'kin_board_plan');
    }
    S.planTab = 'plan';
    renderAll();
}

function removeMove(id) {
    const model = getKinModel();
    const a = model && model.animals.get(String(id));
    S.plan = a ? setMove(model, S.plan, a.id, homeOf(a)) : S.plan.filter(m => m.id !== String(id));
    S.reasons.delete(String(id));
    renderAll();
}

function suggest() {
    const model = getKinModel();
    if (!model || !S.species) return;
    if (!destKnown()) {
        notice('Kin needs the game\'s habitat checks before it can suggest moves. Press Rescan or wait a moment.', 'warn');
        loadDestinations(true);
        return;
    }
    const assignments = getAssignments(model);
    const own = assignedCount(model, S.species);
    const moves = suggestPlan(model, S.species, destFor(model), { allowTrade: false, includeKin: true, assignments });
    if (!moves.length) {
        const list = speciesList(model).find(s => s.species === S.species);
        notice(list && (list.counts.risk || list.counts.kin)
            ? (own
                ? `No move into ${speciesName(S.species)}'s ${own} assigned habitat${own > 1 ? 's' : ''} fixes its related pairs without creating new ones. Assign another habitat, use contraception, or the trade centre.`
                : `No move fixes ${speciesName(S.species)}'s related pairs without creating new ones. Try another habitat, contraception, or the trade centre.`)
            : `${speciesName(S.species)} has no related pairs to fix.`, list && (list.counts.risk || list.counts.kin) ? 'warn' : 'ok');
        return;
    }
    let plan = S.plan;
    for (const m of moves) {
        if (isPinned(model.animals.get(String(m.id)))) continue;
        plan = setMove(model, plan, m.id, m.to);
        S.reasons.set(String(m.id), m.reason || '');
    }
    S.plan = plan;
    S.planTab = 'plan';
    notice(`Kin suggests ${moves.length} move${moves.length > 1 ? 's' : ''}${own ? `, only into ${speciesName(S.species)}'s ${own} assigned habitat${own > 1 ? 's' : ''}` : ''}. Check them below; nothing moves until you run the plan.`, 'ok');
    breadcrumb('kin_board_suggest');
    renderAll();
}

function clearPlan() {
    S.plan = [];
    S.reasons.clear();
    renderAll();
}

function execute() {
    const model = getKinModel();
    const blocked = planBlockedReason(model);
    if (blocked) {
        notice(blocked, 'warn');
        return;
    }
    if (!S.plan.length) return;
    if (S.pendingMove.size) {
        notice('One move at a time: wait for the game to answer the last Move now, then run the plan.', 'warn');
        return;
    }
    const plan = S.plan.map(m => (m.byPlayer ? { id: m.id, to: m.to, byPlayer: true } : { id: m.id, to: m.to }));
    for (const m of plan) S.sent.add(m.id);
    // a deep search of a species about to change stops (its best is kept)
    const dj = deepJob();
    if (dj && plan.some(m => { const a = model.animals.get(String(m.id)); return a && a.species === dj.species; })) stopDeep(dj.species);
    S.planTab = 'run';
    S.selected.clear();
    closeMenu();
    breadcrumb('kin_board_execute');
    runPlan(plan, { destinations: destFor(model) }).then(r => {
        settleSent(plan);
        if (r && r.ok === false && r.detail && !getPlanRun().finished) notice(r.detail, 'bad');
        queueRender();
    }, e => {
        settleSent(plan);
        reportError('mod', 'Species board: the plan could not run', e);
        queueRender();
    });
    renderAll();
}

// After a run: the moves the game made leave the plan quietly; the ones it
// skipped or refused stay, and a later drop of them is news again.
function settleSent(plan) {
    const ids = new Set(plan.map(m => m.id));
    const mine = S.plan.filter(m => ids.has(m.id));
    const kept = prunePlan(getKinModel(), mine);
    S.plan = S.plan.filter(m => !ids.has(m.id) || kept.includes(m));
    for (const m of mine) if (!kept.includes(m)) S.reasons.delete(m.id);
    for (const id of ids) S.sent.delete(id);
}

// One move now, one click (like the game's own Move).
function moveNow(id, to) {
    const model = getKinModel();
    const a = model && model.animals.get(String(id));
    if (!a) return;
    if (getPlanRun().running) {
        notice('A plan is running. Wait for it to finish (or stop it) before moving animals.', 'warn');
        return;
    }
    if (S.pendingMove.size) {
        notice('One move at a time: wait for the game to answer the last one.', 'warn');
        return;
    }
    if (!canMove(a)) {
        notice(`${a.name} cannot be moved right now.`, 'warn');
        return;
    }
    if (a.juv && to === TRADE) {
        notice(youngStayText([a]), 'warn');
        return;
    }
    const where = whereName(model, to);
    S.pendingMove.set(a.id, to);
    S.sent.add(a.id);
    closeMenu();
    notice(isPinned(a)
        ? `Moving ${a.name} ${sexSymbol(a.sex)} to ${where}… She is pregnant: the game allows it, but she can't be sold until she gives birth.`
        : `Moving ${a.name} ${sexSymbol(a.sex)} to ${where}…`, isPinned(a) ? 'warn' : undefined);
    breadcrumb('kin_board_move_now');
    moveAnimal(a.id, to).then(r => {
        S.pendingMove.delete(a.id);
        if (r && r.ok) {
            notice(`${a.name} ${sexSymbol(a.sex)} is on the way to ${where}.`, 'ok');
            // out of the plan here, so no later scan has to explain it
            S.plan = S.plan.filter(x => x.id !== a.id);
            S.sent.delete(a.id);
        }
        else {
            S.sent.delete(a.id);
            notice(`The game did not move ${a.name}: ${(r && r.detail) || 'no answer'}.`, 'bad');
        }
        queueRender();
    }, e => {
        S.pendingMove.delete(a.id);
        S.sent.delete(a.id);
        reportError('mod', 'Species board: the move failed', e);
        queueRender();
    });
    renderAll();
}

// ------------------------------------------------------------------ menu

function closeMenu() {
    if (S.menu && S.menu.parentNode) S.menu.parentNode.removeChild(S.menu);
    const had = !!S.menu;
    S.menu = null;
    S.menuFor = null;
    if (had && S.deferred) queueRender();
}

function openMenu(id, anchor) {
    const model = getKinModel();
    const a = model && model.animals.get(String(id));
    if (!a || !S.root) return;
    if (S.menuFor === a.id) return closeMenu();
    closeMenu();
    const planned = S.plan.find(m => m.id === a.id);
    const kids = [h('div.PZ2QoL_kbMenuTitle', { text: `${sexSymbol(a.sex)} ${a.name}` }),
        h('div.PZ2QoL_kbMenuSub', { text: whereName(model, homeOf(a)) })];
    const running = getPlanRun().running;
    if (!canMove(a)) kids.push(h('div.PZ2QoL_kbMenuNote', { text: a.moving ? 'Already on the move.' : 'Cannot be moved from here.' }));
    else if (planned) {
        kids.push(h(`div.PZ2QoL_kbMenuItem.primary${running ? '.disabled' : ''}`, { onClick: guard('Move now', () => moveNow(a.id, planned.to)) },
            h('span', { text: `Move now to ${trunc(whereName(model, planned.to), 22)}` })));
        kids.push(h('div.PZ2QoL_kbMenuItem', { onClick: guard('Remove move', () => { closeMenu(); removeMove(a.id); }) }, h('span', { text: 'Remove from the plan' })));
    }
    else {
        const targets = S.columns.filter(c => c.kind !== 'trade' && c.id !== homeOf(a) && dropCheck(model, c, [a.id]).ok);
        // the trade centre first: the usual place to send surplus animals
        if (homeOf(a) !== TRADE) {
            kids.push(h(`div.PZ2QoL_kbMenuItem.trade${running || a.juv ? '.disabled' : ''}`, {
                title: a.juv ? youngStayText([a]) : 'One move: a keeper takes it to the trade centre, where you can sell, trade or release it',
                onClick: guard('Move now', () => moveNow(a.id, TRADE)),
            }, h('span', { text: `Send to ${trunc(whereName(model, TRADE), 22)}` })));
        }
        kids.push(h('div.PZ2QoL_kbMenuHead', { text: targets.length ? 'Move now to a habitat (one move)' : 'No other suitable habitat' }));
        for (const c of targets.slice(0, 8)) {
            kids.push(h(`div.PZ2QoL_kbMenuItem${running ? '.disabled' : ''}`, { onClick: guard('Move now', () => moveNow(a.id, c.id)) },
                h('span', { text: trunc(c.name, 26) }), c.dest || c.kind !== 'habitat' ? null : h('span.PZ2QoL_kbMenuFaint', { text: 'not checked' })));
        }
    }
    for (const it of (ext && extCall('menuItems', a)) || []) {
        kids.push(h('div.PZ2QoL_kbMenuItem.auto', { title: it.title || '', onClick: guard(it.label, () => { closeMenu(); it.run(); renderAll(); }) }, h('span', { text: it.label })));
    }
    kids.push(h('div.PZ2QoL_kbMenuItem.ghost', { onClick: guard('Kin planner', () => openPlanner({ animalId: a.id })) }, h('span', { text: 'Relatives and mates in the kin planner' })));
    const menu = h('div.PZ2QoL_kbMenu', null, kids);
    menu.addEventListener('mousedown', e => e.stopPropagation());
    S.root.appendChild(menu);
    S.menu = menu;
    S.menuFor = a.id;
    // next to the card, inside the panel
    const rr = S.root.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    let left = ar.right - rr.left + 4;
    if (left + mr.width > rr.width - 8) left = ar.left - rr.left - mr.width - 4;
    let top = ar.top - rr.top - 4;
    if (top + mr.height > rr.height - 8) top = rr.height - mr.height - 8;
    menu.style.left = `${Math.round(Math.max(8, left))}px`;
    menu.style.top = `${Math.round(Math.max(8, top))}px`;
}

// ------------------------------------------------------------------ plan

function renderNotice() {
    const el = S.el.notice;
    if (!el) return;
    const n = S.notice && Date.now() < S.notice.until ? S.notice : null;
    setText(el, n ? n.text : '');
    el.className = `PZ2QoL_kbNotice${n ? ' show ' + n.tone : ''}`;
}

function impactLine(label, n, tone) {
    return h(`div.PZ2QoL_kbImpactNum.${tone}`, null, h('span.PZ2QoL_kbImpactN', { text: String(n) }), h('span', { text: label }));
}

function pairText(p) {
    const word = relationWord(p.rel, p.b.sex);
    return `${p.a.name} ${sexSymbol(p.a.sex)} – ${p.b.name} ${sexSymbol(p.b.sex)}${word ? ` (${p.a.sex === Sex.Male ? 'his ' : ''}${word})` : ''}`;
}

function renderPlan(model, dest) {
    const el = S.el.plan;
    clear(el);
    const run = getPlanRun();
    // left: the moves (or the last run's log)
    const list = h('div.PZ2QoL_kbPlanList');
    const hasRun = run.running || run.finished;
    const tab = hasRun && S.planTab === 'run' ? 'run' : 'plan';
    list.appendChild(h('div.PZ2QoL_kbTabs', null,
        h(`div.PZ2QoL_kbTab${tab === 'plan' ? '.on' : ''}`, { onClick: guard('Plan', () => { S.planTab = 'plan'; renderAll(); }) }, h('span', { text: `Plan · ${S.plan.length} move${S.plan.length === 1 ? '' : 's'}` })),
        hasRun ? h(`div.PZ2QoL_kbTab${tab === 'run' ? '.on' : ''}`, { onClick: guard('Run', () => { S.planTab = 'run'; renderAll(); }) }, h('span', { text: run.running ? 'Running' : 'Last run' })) : null,
        h('div.PZ2QoL_kpFlex'),
        h(`div.PZ2QoL_kpBtn.small.PZ2QoL_kbClearPlan${S.plan.length && !run.running ? '' : '.disabled'}`, { title: 'Remove every planned move', onClick: guard('Clear plan', clearPlan) }, h('span', { text: 'Clear plan' }))));
    const box = makeScroll('kbPlanBox', { onScroll: (x, y) => { S.scroll.list = y; } });
    S.boxes.list = box;
    if (tab === 'run') {
        if (!run.log.length) box.content.appendChild(h('div.PZ2QoL_kbPlanEmpty', { text: run.current ? `Sending: ${run.current}` : 'Starting…' }));
        run.log.forEach((l, i) => box.content.appendChild(h(`div.PZ2QoL_kbLogRow.${l.ok ? 'ok' : 'bad'}`, null,
            h('div.PZ2QoL_kbLogMark', { text: l.ok ? '✓' : '✗' }),
            h('div.PZ2QoL_kbLogText', null, h('span', { text: `${i + 1}. ${l.text}` }), l.detail ? h('span.PZ2QoL_kbLogDetail', { text: l.detail }) : null))));
        if (run.running && run.current) box.content.appendChild(h('div.PZ2QoL_kbLogRow.now', null, h('div.PZ2QoL_kbLogMark', { text: '…' }), h('div.PZ2QoL_kbLogText', null, h('span', { text: run.current }))));
    }
    else if (!S.plan.length) {
        box.content.appendChild(h('div.PZ2QoL_kbPlanEmpty', { text: 'No moves yet. Drag animals between habitats, select them and press "Move N here", or let Kin suggest fixes.' }));
    }
    else {
        S.plan.forEach((m, i) => {
            const a = model && model.animals.get(m.id);
            const reason = S.reasons.get(m.id);
            box.content.appendChild(h(`div.PZ2QoL_kbMove${a && a.species === S.species ? '' : '.other'}`, { 'data-move': m.id },
                h('div.PZ2QoL_kbMoveN', { text: String(i + 1) }),
                h('div.PZ2QoL_kbMoveText', { title: moveText(model, m, dest) },
                    h('div.PZ2QoL_kbMoveMain', null,
                        a ? h(`span.PZ2QoL_kbMoveName.${sexClass(a.sex)}`, { text: `${sexSymbol(a.sex)} ${trunc(a.name, 16)}` }) : h('span', { text: m.id }),
                        h('span.PZ2QoL_kbMoveWhere', { text: `${trunc(whereName(model, a ? homeOf(a) : ''), 18)} → ${trunc(whereName(model, m.to), 20)}` })),
                    reason ? h('span.PZ2QoL_kbMoveWhy', { text: `Suggested: ${reason}` }) : null),
                h(`div.PZ2QoL_kbMini${run.running || S.pendingMove.size ? '.disabled' : ''}`, {
                    title: 'Send just this move to the game now (one move)',
                    onClick: guard('Move now', () => moveNow(m.id, m.to)),
                }, h('span', { text: 'Move now' })),
                h('div.PZ2QoL_kbCardX', { title: 'Remove this move', onClick: guard('Remove move', () => removeMove(m.id)) }, crossMark())));
        });
    }
    list.appendChild(box.wrap);
    restoreScroll(box, 0, S.scroll.list);
    el.appendChild(list);
    // middle: what the plan does
    el.appendChild(impactEl(model, dest));
    // right: actions
    el.appendChild(actionsEl(model));
}

function impactEl(model, dest) {
    const wrap = h('div.PZ2QoL_kbImpact');
    const box = makeScroll('kbImpactBox', { onScroll: (x, y) => { S.scroll.impact = y; } });
    S.boxes.impact = box;
    const c = box.content;
    S.el.notice = h('div.PZ2QoL_kbNotice');
    if (!model || !S.species) {
        c.appendChild(h('div.PZ2QoL_kbPlanEmpty', { text: 'Pick a species to plan moves.' }));
        wrap.appendChild(box.wrap);
        wrap.appendChild(S.el.notice);
        renderNotice();
        return wrap;
    }
    const { sp, zoo } = planImpacts(model, S.after || model, S.species);
    const name = speciesName(S.species);
    wrap.setAttribute('data-fixed', String(sp.risksFixed));
    wrap.setAttribute('data-created', String(sp.risksCreated));
    wrap.setAttribute('data-after-risk', String(sp.after.risk));
    wrap.setAttribute('data-after-kin', String(sp.after.kin));
    wrap.setAttribute('data-moves', String(S.plan.length));
    if (!S.plan.length) {
        c.appendChild(h('div.PZ2QoL_kbImpactTitle', { text: `${name} now` }));
        c.appendChild(h('div.PZ2QoL_kbImpactRow', null, countPills(sp.before).length ? countPills(sp.before) : h('div.PZ2QoL_kpCount.sev_none', null, h('span.PZ2QoL_kpCountL', { text: 'No related pairs' }))));
        c.appendChild(h('div.PZ2QoL_kbImpactNote', { text: sp.before.risk || sp.before.kin
            ? 'Move animals to see what changes. "Suggest fixes" moves as few animals as possible, each to a habitat where it has no relatives.'
            : 'Nothing to fix for this species. You can still plan moves to balance the habitats.' }));
    }
    else {
        const fixedKin = sp.fixed.filter(p => p.severity === 'kin').length;
        const createdKin = sp.created.filter(p => p.severity === 'kin').length;
        c.appendChild(h('div.PZ2QoL_kbImpactTitle', { text: `What the plan does for ${name}` }));
        c.appendChild(h('div.PZ2QoL_kbImpactNums', null,
            impactLine(countWord('risk', sp.risksFixed) + ' fixed', sp.risksFixed, sp.risksFixed ? 'good' : 'flat'),
            impactLine(sp.risksCreated === 1 ? 'new risk' : 'new risks', sp.risksCreated, sp.risksCreated ? 'bad' : 'flat'),
            fixedKin ? impactLine('close kin fixed', fixedKin, 'good') : null,
            createdKin ? impactLine('new close kin', createdKin, 'bad') : null));
        const left = countPills(sp.after);
        c.appendChild(h('div.PZ2QoL_kbImpactRow', null, h('span.PZ2QoL_kbImpactLabel', { text: 'Left after the plan:' }),
            left.length ? left : h('div.PZ2QoL_kpCount.sev_none', null, h('span.PZ2QoL_kpCountL', { text: 'No related pairs' }))));
        c.appendChild(h('div.PZ2QoL_kbImpactRow.faint', null, h('span', { text: `Zoo-wide inbreeding risks: ${zoo.before.risk} → ${zoo.after.risk}${zoo.risksCreated ? ` (${zoo.risksCreated} new)` : ''}` })));
        for (const p of sp.created.filter(q => q.severity === 'risk' || q.severity === 'kin')) {
            c.appendChild(h(`div.PZ2QoL_kbCreated.sev_${p.severity}`, null, h('span', { text: `New ${p.severity === 'risk' ? 'inbreeding risk' : 'close kin'}: ${pairText(p)} in ${whereName(model, p.hab)}` })));
        }
    }
    for (const pr of planProblems(model, S.plan, dest, { assignments: getAssignments(model) })) {
        c.appendChild(h(`div.PZ2QoL_kbProblem${pr.warn ? '.warn' : ''}`, null, h('span', { text: pr.text })));
    }
    restoreScroll(box, 0, S.scroll.impact);
    wrap.appendChild(box.wrap);
    wrap.appendChild(S.el.notice);
    renderNotice();
    return wrap;
}

function actionsEl(model) {
    const run = getPlanRun();
    const el = h('div.PZ2QoL_kbActions');
    // the buttons stay put; messages scroll below them
    const box = makeScroll('kbActBox', { onScroll: (x, y) => { S.scroll.actions = y; } });
    S.boxes.actions = box;
    const msg = box.content;
    const finish = () => {
        el.appendChild(box.wrap);
        restoreScroll(box, 0, S.scroll.actions || 0);
        return el;
    };
    // the pause between moves: one slider kept across renders (a drag survives them)
    if (!S.paceEl) S.paceEl = paceSlider('moves');
    if (run.running) {
        // moved and skipped both count as handled
        const handled = run.log.length;
        const pct = run.total ? Math.round(handled / run.total * 100) : 0;
        el.appendChild(h('div.PZ2QoL_kbRunTitle', { text: `Moving ${Math.min(handled + 1, run.total)} of ${run.total}` }));
        const last = run.log.length ? run.log[run.log.length - 1] : null;
        const between = !run.current || (last && last.text === run.current);
        el.appendChild(h('div.PZ2QoL_kbRunNow', { text: between ? (run.done ? 'Done one; a short pause before the next…' : 'Starting…') : run.current }));
        el.appendChild(h('div.PZ2QoL_kbProgress', null, h('div.PZ2QoL_kbProgressFill', { style: { width: `${pct}%` } })));
        el.appendChild(btn(run.stopping ? 'Stopping after this move…' : 'Stop', null, () => stopPlan(), { cls: run.stopping ? 'disabled.wide' : 'stop.wide' }));
        msg.appendChild(S.paceEl);
        msg.appendChild(h('div.PZ2QoL_kbRunNote', { text: 'One move at a time; each waits for the game to confirm it before the next. A move the game refuses is skipped.' }));
        return finish();
    }
    const blocked = model ? planBlockedReason(model) : 'No kin data yet.';
    const row = h('div.PZ2QoL_kbActRow', null,
        btn('Suggest fixes', 'IconGenetics', suggest, { title: 'Moves that remove this species\' related pairs without creating new ones' }),
        btn(programmeButtonText(), 'IconFertility', openProgramme, {
            cls: `${S.prog && S.prog.species === S.species ? 'on.' : ''}PZ2QoL_kbProgBtn`,
            title: 'Plan the best breeding groups for this species: unrelated partners, the best expected young, the game\'s own group sizes and space',
        }),
        btn('Thin out', 'IconTradeCentre', openCull, {
            cls: S.cull && S.cull.species === S.species ? 'on' : '',
            title: 'Full habitats: pick the animals to send to the trade centre (too old, extra males, weaker genes) and keep the best breeders',
        }));
    el.appendChild(row);
    // in the same wrapping row (beside Thin out): a row of its own pushed the
    // pause slider under Execute out of the actions area
    const auto = ext && S.species ? extCall('button', S.species) : null;
    if (auto) {
        row.appendChild(btn(auto.text, 'IconTime', openAuto, {
            cls: `${S.auto === S.species ? 'on.' : ''}${auto.on ? 'autoOn.' : ''}PZ2QoL_kbAutoBtn`,
            title: auto.title || '',
        }));
    }
    const waiting = S.pendingMove.size > 0;
    const exec = btn(`Execute plan (${S.plan.length} move${S.plan.length === 1 ? '' : 's'})`, null, execute, {
        cls: `primary.wide${!S.plan.length || blocked || waiting ? '.disabled' : ''}`,
        title: waiting ? 'A Move now is waiting for the game; the plan can run once it answers'
            : 'Run the plan: one move at a time, each confirmed by the game; a move the game refuses is skipped',
    });
    el.appendChild(exec);
    // first in the scrolling area, right under Execute
    msg.appendChild(S.paceEl);
    if (run.finished) {
        msg.appendChild(h(`div.PZ2QoL_kbRunResult.${run.error ? 'bad' : 'ok'}`, {
            text: run.error ? `Last run: ${run.done} of ${run.total} moved. ${run.error}` : `Last run: ${run.done} move${run.done === 1 ? '' : 's'} sent to the game.`,
        }));
    }
    // Franchise runs like any zoo: the Execute click is the opt-in (2026-10-16)
    if (blocked && S.plan.length && model) {
        msg.appendChild(h('div.PZ2QoL_kbBlocked', { text: blocked, title: blocked }));
    }
    return finish();
}

// ------------------------------------------------------ breeding programme

function habitatsToDescribe(model, species) {
    return programmeHabitats(model, species, S.dest, getAssignments(model));
}

function openProgramme() {
    const model = getKinModel();
    if (!model || !S.species) return;
    if (getPlanRun().running) {
        notice('A plan is running. Wait for it to finish before planning a new one.', 'warn');
        return;
    }
    if (S.prog && S.prog.species === S.species) return closeProgramme();
    S.cull = null;
    S.auto = null;
    const species = S.species;
    S.prog = { species, state: 'loading', step: savedProgStep(), info: null, infoError: '', results: new Map(), modelRef: null, error: null };
    closeMenu();
    S.selected.clear();
    S.scroll.prog = 0;
    breadcrumb('kin_board_programme');
    renderAll();
    const done = info => {
        if (!S.prog || S.prog.species !== species) return;
        S.prog.info = info && typeof info === 'object' && !info.error ? info : null;
        S.prog.infoError = info && info.error ? String(info.error) : '';
        S.prog.state = 'ready';
        S.prog.results = new Map();
        queueRender();
    };
    // the habitat checks first: suitable empty habitats are part of the programme
    const ids = [];
    for (const a of model.animals.values()) if (a.species === species && !a.exhibit) ids.push(a.id);
    const ready = destKnown() ? Promise.resolve() : requestDestinations(ids).then(d => {
        if (d) S.dest = d;
    }, () => {});
    ready.then(() => requestSpeciesInfo(species, habitatsToDescribe(getKinModel() || model, species))).then(done, e => {
        reportError('mod', 'Species board: species facts failed', e, { silent: true });
        done(null);
    });
}

function closeProgramme() {
    S.prog = null;
    renderAll();
}

// Recompute (Breeding programme, Thin out): the animals, the habitat checks
// and the game's facts (room, group sizes, fertile ages) are read again and
// the panel worked out afresh. The animals are re-read every few seconds
// anyway; the game's facts are otherwise asked once, when the panel opens.
// The player's choices in the panel stay.
function recomputePanel() {
    const p = S.prog || S.cull;
    const model = getKinModel();
    if (!p || !model || p.state === 'loading') return;
    const isProg = p === S.prog;
    const species = p.species;
    p.state = 'loading';
    if (isProg) {
        // a search still running uses the old facts
        cancelDeep(species);
        dropDeepResults(species);
        p.problem = null;
        if (p.job) p.job.cancelled = true;
        p.job = null;
        p.sig = null;
        p.stale = null;
    }
    breadcrumb(isProg ? 'kin_board_programme_recompute' : 'kin_board_thin_out_recompute');
    requestKinScan('board', { force: true });
    renderAll();
    const ids = [];
    for (const a of model.animals.values()) if (a.species === species && !a.exhibit) ids.push(a.id);
    const done = info => {
        if ((isProg ? S.prog : S.cull) !== p) return;
        p.info = info && typeof info === 'object' && !info.error ? info : null;
        p.infoError = info && info.error ? String(info.error) : '';
        p.state = 'ready';
        p.results = new Map();
        p.modelRef = null;
        p.key = '';
        notice(`${isProg ? 'Breeding programme' : 'Thin out'} recomputed with the zoo as it is now.`, 'ok');
        queueRender();
    };
    requestDestinations(ids, { force: true }).then(d => {
        if (d) S.dest = d;
    }, () => {})
        .then(() => requestSpeciesInfo(species, habitatsToDescribe(getKinModel() || model, species), { force: true }))
        .then(done, e => {
            reportError('mod', 'Species board: species facts failed', e, { silent: true });
            done(null);
        });
}

function cycleRatio(dir) {
    const p = S.prog;
    if (!p) return;
    stepRatioChoice(p.species, dir);
    breadcrumb('kin_board_programme_ratio');
    renderAll();
}

// The optimiser's result for the current choices, cached per choices and
// model. It is worked out in slices in the background (the page stays
// responsive); meanwhile the last result for the same choices is shown, or
// nothing (the panel shows the progress).
function programmeResult() {
    const p = S.prog;
    const model = getKinModel();
    if (!p || !model || p.state !== 'ready') return null;
    if (p.modelRef !== model) {
        p.modelRef = model;
        const sig = programmeSignature(model, p.species, getAssignments(model));
        if (sig !== p.sig) {
            p.sig = sig;
            p.results = new Map();
        }
    }
    const key = programmeKey(p);
    if (p.results.has(key)) {
        // a search for another setting is no longer wanted
        if (p.job && p.job.key !== key) {
            p.job.cancelled = true;
            p.job = null;
        }
        return p.results.get(key);
    }
    startProgramme(p, model, key);
    return p.stale && p.stale.key === key ? p.stale.r : null;
}

// Is the optimiser working on the panel's current setting?
function programmeBusy(p) {
    return !!(p && p.job && p.job.key === programmeKey(p));
}

function startProgramme(p, model, key) {
    if (p.job && p.job.key === key && p.job.sig === p.sig) return;
    if (p.job) p.job.cancelled = true;
    const job = { key, sig: p.sig, progress: 0, cancelled: false };
    p.job = job;
    const live = () => !job.cancelled && S.prog === p;
    breadcrumb('kin_board_programme_search');
    // it starts by itself as the zoo changes: the gentle pace, the player plays meanwhile
    const cpu = AUTO_CPU;
    planProgrammeAsync(model, p.species, p.info || {}, destFor(model), {
        assignments: getAssignments(model),
        options: programmeOptions(p),
        sliceMs: cpu.sliceMs,
        restMs: cpu.restMs,
        onProgress: v => {
            job.progress = v;
            if (live()) renderProgrammeProgress(v);
        },
        isCancelled: () => !live(),
    }).then(r => {
        if (!live()) return;
        p.job = null;
        p.error = null;
        if (r) {
            const info = p.info || {};
            dlog('kin', 'prog_classic_done', Object.assign({ species: p.species, step: p.step, social: info.social ? info.social.max : 'none', exact: r.exact ? 1 : 0, ms: r.searchMs }, programmeLogData(r)));
        }
        if (p.sig === job.sig) p.results.set(key, r);
        p.stale = { key, r };
        queueRender();
    }, e => {
        if (!live()) return;
        p.job = null;
        p.error = e;
        if (p.sig === job.sig) p.results.set(key, null);
        reportError('ui', 'Species board: the breeding programme failed', e);
        queueRender();
    });
}

// ----------------------------------------------------------- deep search
// The Deep optimiser (kinprogdeep.js owns the job and the results). The
// panel shows Classic's plan at once; a deep result for the same settings
// and breeders replaces it. Deep starts by itself, with the player's saved
// Standard, never over a running job (docs/PLAN-deep-optimiser.md).

// The problem signature (what the search reads) for the panel's settings,
// worked out once per kin model.
function problemSigFor(p, model) {
    const key = programmeKey(p);
    if (p.problem && p.problem.model === model && p.problem.key === key) return p.problem.sig;
    let sig = '';
    try {
        sig = programmeProblemSig(model, p.species, p.info || {}, destFor(model), { assignments: getAssignments(model), options: programmeOptions(p) });
    }
    catch (e) {
        reportError('mod', 'Species board: deep search signature failed', e, { silent: true });
    }
    p.problem = { model, key, sig };
    return sig;
}

// What the panel shows: { r, kind: 'classic' | 'deep', entry (the deep
// result), stale (the breeders changed since it), classic (Classic's r) }.
function programmeView(model) {
    const p = S.prog;
    if (!p || !model || p.state !== 'ready') return null;
    const classic = programmeResult();
    const opt = getOptimiser();
    if (opt.engine !== 'deep') return { r: classic, kind: 'classic', entry: null, stale: false, classic };
    const key = programmeKey(p), dkey = deepKey(opt);
    const sig = problemSigFor(p, model);
    const exact = deepResult(p.species, key, dkey, sig);
    const entry = exact || latestDeepResult(p.species, key, dkey);
    if (entry && entry.r) return { r: withFreshYoung(entry.r, classic), kind: 'deep', entry, stale: !exact, classic };
    return { r: classic, kind: 'classic', entry: null, stale: false, classic };
}

// Start (or continue) the deep search for the panel's species and settings.
// -> true if it started.
function runDeep(p, model, { resume = null, auto = false } = {}) {
    const classic = programmeResult();
    if (!classic || programmeBusy(p)) return false;
    const opt = getOptimiser();
    const key = programmeKey(p);
    const sig = problemSigFor(p, model);
    const settings = deepSettings(opt);
    breadcrumb(auto ? 'kin_board_programme_deep_auto' : 'kin_board_programme_deep_run');
    startDeep({
        species: p.species, key, dkey: deepKey(opt), psig: sig, breeders: breedersOf(classic),
        model, info: p.info || {}, dest: destFor(model), assignments: getAssignments(model), options: programmeOptions(p),
        // Classic's plan for the same setting and zoo is start 0
        warm: classic.moves, warmTotal: classic.score, resume, settings, cpu: auto ? AUTO_CPU : cpuOf(opt),
    });
    renderAll();
    return true;
}

const breedersOf = r => (r && r.before ? r.before.breedingPairs * 2 + r.before.idle : 0);

// Deep starts by itself with the saved settings, every preset (developer,
// 2026-10-18: no staring at a Run button): once per setting and zoo, 1 s
// after the last change, unless a job is running (never taken over), a
// result is kept, or Classic already scored every layout.
function maybeAutoDeep(p, model, view) {
    const opt = getOptimiser();
    if (opt.engine !== 'deep' || !deepSettings(opt).auto) return;
    if (!view || view.kind === 'deep' || !view.classic || view.classic.exact || programmeBusy(p) || deepJob()) return;
    const want = `${programmeKey(p)}|${deepKey(opt)}|${problemSigFor(p, model)}`;
    if (p.autoDone === want || p.autoWant === want) return;
    if (p.autoTimer) clearTimeout(p.autoTimer);
    p.autoWant = want;
    p.autoTimer = setTimeout(guard('Programme deep auto', () => {
        p.autoTimer = 0;
        p.autoWant = '';
        const m = getKinModel();
        if (S.prog !== p || !m || deepJob()) return;
        const v = programmeView(m);
        if (!v || v.kind === 'deep') return;
        if (`${programmeKey(p)}|${deepKey(getOptimiser())}|${problemSigFor(p, m)}` !== want) return;
        // Classic still working (a scan changed the species): the next render tries again
        if (runDeep(p, m, { auto: true })) p.autoDone = want;
        else queueRender();
    }), 1000);
}

// The board's button: the running deep search's progress.
function programmeButtonText() {
    const j = deepJob();
    if (!j) return 'Breeding programme';
    const pct = `${Math.round(Math.max(0, Math.min(1, j.progress || 0)) * 100)} %`;
    return j.species === S.species ? `Breeding programme · deep ${pct}` : `Breeding programme · ${trunc(speciesName(j.species), 14)} deep ${pct}`;
}

// The gain over Classic in words ('+1.4 % over Classic'), or ''.
function gainText(total, classicTotal, suffix = '') {
    if (total == null || classicTotal == null || !(total > classicTotal + 1e-9)) return '';
    if (classicTotal > 0) return `+${(Math.round((total - classicTotal) / classicTotal * 1000) / 10).toFixed(1)} % over Classic${suffix}`;
    return `better than Classic${suffix}`;
}

// The running job in words: start 5 of 32 · best at start 3 · ~2 min left
function deepProgressText(j) {
    const bits = [`start ${Math.min(j.planned, j.done + 1)} of ${j.planned}`];
    if (j.bestStart) bits.push(`best at start ${j.bestStart}`);
    const gain = gainText(j.total, j.warmTotal, ' so far');
    if (gain) bits.push(gain);
    if (j.msPerStart != null) {
        let left = (j.planned - j.done) * j.msPerStart / 1000;
        const lim = j.settings.limitMin > 0 ? j.settings.limitMin * 60 - (Date.now() - j.startedAt) / 1000 : Infinity;
        left = Math.max(0, Math.min(left, lim));
        bits.push(`~${durationText(left)} left`);
    }
    return j.stopRequested ? `Stopping: finishing the current step… (${bits[0]})` : `Deep search · ${bits.join(' · ')}`;
}

// Only the deep progress texts and bar, between full renders.
function renderDeepProgress() {
    const root = S.root;
    const j = deepJob();
    if (!root || !S.open || !j) return;
    const pct = `${Math.round(Math.max(0, Math.min(1, j.progress || 0)) * 100)}%`;
    for (const n of root.querySelectorAll('.PZ2QoL_kbDeepFill')) n.style.width = pct;
    for (const n of root.querySelectorAll('.PZ2QoL_kbDeepText')) setText(n, deepProgressText(j));
    for (const n of root.querySelectorAll('.PZ2QoL_kbProgBtn > span')) setText(n, programmeButtonText());
}

// The deep search's row under the panel head: running, stopped, done,
// stale, or the Run button.
function deepStatusEl(p, model, view) {
    const opt = getOptimiser();
    if (opt.engine !== 'deep') return null;
    const j = deepJob();
    const settings = deepSettings(opt);
    const key = programmeKey(p), dkey = deepKey(opt);
    const mine = !!j && j.species === p.species && j.key === key && j.dkey === dkey;
    const row = (cls, ...kids) => h(`div.PZ2QoL_kbDeep.${cls}`, null, ...kids);
    if (mine) {
        const pct = `${Math.round(Math.max(0, Math.min(1, j.progress || 0)) * 100)}%`;
        return row('running',
            h('span.PZ2QoL_kbDeepText', { text: deepProgressText(j) }),
            h('div.PZ2QoL_kbDeepBar', null, h('div.PZ2QoL_kbDeepFill', { style: { width: pct } })),
            btn(j.stopRequested ? 'Stopping…' : 'Stop', null, () => {
                stopDeep(p.species);
                renderAll();
            }, { cls: j.stopRequested ? 'disabled' : 'stop', title: 'End the deep search now and show the best plan it found (you can continue it later)' }));
    }
    const classic = view && view.classic;
    // few enough layouts that Classic scored every one: nothing to search
    if (classic && classic.exact && !mine && !(view && view.kind === 'deep')) {
        return row('exact', h('span', { text: 'Classic already scored every possible layout for this species: this is the best plan there is, so Deep has nothing to add. Deep helps on species with more breeders or habitats.' }));
    }
    const est = durationText(estimateSeconds(breedersOf(classic), settings, msPerStartFor(p.species)));
    const ready = !!classic && !programmeBusy(p);
    const runBtn = (label, resume = null) => btn(label, null, () => runDeep(p, model, { resume }), {
        cls: ready ? 'primary' : 'disabled',
        title: `${settings.starts} starts after the Classic plan${settings.limitMin > 0 ? `, at most ${durationText(settings.limitMin * 60)}` : ', no time limit'}. It runs in the background: you can close this panel or the board.`,
    });
    const otherName = j && !mine ? (j.species === p.species ? 'other' : trunc(speciesName(j.species), 16)) : '';
    const other = j && !mine ? `${j.species === p.species ? 'Another deep search for this species' : `The deep search for ${speciesName(j.species)}`} is running (${Math.round((j.progress || 0) * 100)} %). ` : '';
    const withStop = label => (j && !mine ? `${label} (stops the ${otherName} search)` : label);
    const e = view && view.kind === 'deep' ? view.entry : null;
    if (e) {
        const gain = gainText(e.r.score, e.warmTotal) || 'the same as Classic';
        if (view.stale) {
            return row('stale',
                h('span', { text: `${other}${staleDeepText(view)} Recompute, or run it again.` }),
                runBtn(withStop('Run deep search')));
        }
        if (e.stopped && e.resume) {
            const why = e.stopped === 'time' ? 'the time limit' : 'Stop';
            return row('stopped',
                h('span', { text: `${other}Deep: stopped by ${why} after ${e.done} of ${e.planned} starts · ${gain}.` }),
                runBtn(withStop('Continue'), e.resume));
        }
        return row('done', h('span', { text: `${other}Deep · ${e.done} start${e.done === 1 ? '' : 's'}${e.r.bestStart ? ` · best at start ${e.r.bestStart}` : ''} · ${gain}` }));
    }
    const wait = settings.auto && !j ? 'The deep search starts in a moment. ' : '';
    return row('idle', h('span', { text: `${other || wait}This plan is Classic's.` }), runBtn(withStop(`Run deep search (est. ~${est})`)));
}

// The Optimiser chip in the panel head: opens the options row.
function optimiserChip(p) {
    const opt = getOptimiser();
    const text = opt.engine === 'deep' ? `Optimiser: Deep · ${opt.preset === 'custom' ? 'Custom' : DEEP_PRESETS[opt.preset].label}` : 'Optimiser: Classic';
    return h(`div.PZ2QoL_kbOptChip${p.optOpen ? '.on' : ''}${opt.engine === 'deep' ? '.deep' : ''}`, {
        title: 'Choose the optimiser: Classic (a few seconds) or Deep (many starts, minutes; the better plan on big species). Your choice is kept for every zoo.',
        onClick: guard('Programme optimiser', () => {
            p.optOpen = !p.optOpen;
            breadcrumb('kin_board_programme_optimiser');
            renderAll();
        }),
    }, h('span', { text }));
}

function optPick(label, on, onClick, title) {
    return h(`div.PZ2QoL_kbOptPick${on ? '.on' : ''}`, { title: title || '', onClick: guard('Programme option', onClick) }, h('span', { text: label }));
}

// A custom number with arrows (stepping through CUSTOM_STEPS).
function optStepper(label, k, value, words) {
    const list = CUSTOM_STEPS[k];
    const i = Math.max(0, list.indexOf(value));
    const step = d => {
        const v = list[Math.max(0, Math.min(list.length - 1, i + d))];
        setOptimiser({ preset: 'custom', custom: { [k]: v } });
        renderAll();
    };
    return h('div.PZ2QoL_kbOptStep', { 'data-k': k },
        h('span.PZ2QoL_kbOptLabel', { text: label }),
        h('div.PZ2QoL_kbRatioArrow.prev', { onClick: guard('Programme option', () => step(-1)) }, h('span', { text: '‹' })),
        h('span.PZ2QoL_kbOptValue', { text: words(value) }),
        h('div.PZ2QoL_kbRatioArrow.next', { onClick: guard('Programme option', () => step(1)) }, h('span', { text: '›' })));
}

// The options row: engine, deep presets (or custom numbers), CPU use.
// Every change is the player's default at once (prefs.js, all zoos).
function optimiserRow() {
    const opt = getOptimiser();
    const set = patch => {
        setOptimiser(patch);
        renderAll();
    };
    const kids = [
        h('div.PZ2QoL_kbOptGroup', null,
            h('span.PZ2QoL_kbOptLabel', { text: 'Optimiser' }),
            optPick('Classic', opt.engine === 'classic', () => set({ engine: 'classic' }), "Today's optimiser: one guided search, a few seconds (up to ~25 s on Gentle)"),
            optPick('Deep', opt.engine === 'deep', () => set({ engine: 'deep' }), 'Many starts after the Classic plan, with exact repairs: never worse than Classic, often better on big species. Runs in the background.')),
    ];
    if (opt.engine === 'deep') {
        kids.push(h('div.PZ2QoL_kbOptGroup', null,
            h('span.PZ2QoL_kbOptLabel', { text: 'Search' }),
            PRESET_ORDER.map(k => {
                const d = DEEP_PRESETS[k];
                const title = d
                    ? `${PRESET_WORDS[k]}. ${d.starts} starts, ${d.limitMin > 0 ? `at most ${durationText(d.limitMin * 60)}` : 'no time limit'}${d.auto ? '; starts by itself when you open the programme' : '; starts when you click Run'}.`
                    : PRESET_WORDS[k];
                return optPick(d ? d.label : 'Custom', opt.preset === k, () => set({ preset: k }), title);
            })));
        if (opt.preset === 'custom') {
            const c = opt.custom;
            kids.push(h('div.PZ2QoL_kbOptGroup.custom', null,
                optStepper('Starts', 'starts', c.starts, v => String(v)),
                optStepper('Effort', 'effort', c.effort, v => `${v}×`),
                optStepper('Repair', 'repair', c.repair, v => ({ off: 'off', light: 'light', strong: 'strong (slower)' })[v] || v),
                optStepper('Time limit', 'limitMin', c.limitMin, v => (v > 0 ? durationText(v * 60) : 'none')),
                optStepper('Stop early', 'patience', c.patience, v => (v > 0 ? `after ${v} quiet round${v === 1 ? '' : 's'}` : 'off'))));
        }
    }
    kids.push(h('div.PZ2QoL_kbOptGroup', null,
        h('span.PZ2QoL_kbOptLabel', { text: 'CPU use' }),
        CPU_ORDER.map(k => optPick(CPU_STEPS[k].label, opt.cpu === k, () => set({ cpu: k }),
            `${CPU_STEPS[k].sliceMs} ms of search, then ${CPU_STEPS[k].restMs} ms for the game. Gentler is smoother on slower PCs, and slower to finish.`))));
    kids.push(h('div.PZ2QoL_kbOptNote', { text: 'Kept as your default in every zoo. Deep runs in the background; Stop keeps the best plan it found, and Continue picks it up again.' }));
    return h('div.PZ2QoL_kbOptRow', null, ...kids);
}

// Only the progress bar and its text, between full renders.
function renderProgrammeProgress(v) {
    const root = S.root;
    if (!root) return;
    const pct = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
    for (const n of root.querySelectorAll('.PZ2QoL_kbProgBusyFill')) n.style.width = pct;
    for (const n of root.querySelectorAll('.PZ2QoL_kbProgBusyPct')) setText(n, pct);
}

// Who it would breed with in its new group, for the plan's reason line.
function programmeReason(model, a, to, groups, info) {
    if (to === TRADE) return 'no place in a breeding group (to trade or release)';
    const fromTrade = a.lt === 'trade' && !a.hab;
    const why = programmeReasonIn(model, a, to, groups, info);
    return fromTrade ? `from the trade centre: ${why}` : why;
}

function programmeReasonIn(model, a, to, groups, info) {
    const g = groups.find(x => x.hab === to);
    let best = null;
    for (const b of g ? g.animals : []) {
        if (b.id === a.id || (a.sex !== Sex.Unisex && b.sex === a.sex)) continue;
        const rel = a.guid && b.guid ? model.ped.relation(a.guid, b.guid) : null;
        if (rel) continue;
        const [m, f] = a.sex === Sex.Female ? [b, a] : [a, b];
        const v = youngQuality(m, f) * conceptionChance(m, f, info || {});
        if (!best || v > best.v) best = { v, b, q: Math.round(youngQuality(m, f) * 100) };
    }
    return best ? `breeds with ${best.b.name} ${sexSymbol(best.b.sex)} (expected young ${best.q})` : 'breeding programme';
}

function useProgramme() {
    const model = getKinModel();
    const view = programmeView(model);
    const r = view && view.r;
    if (!model || !r || (view.kind === 'classic' && programmeBusy(S.prog))) return;
    let plan = [];
    S.reasons.clear();
    for (const m of r.moves) {
        const a = model.animals.get(String(m.id));
        if (!a || !canMove(a) || (isPinned(a) && !mustHouse(a))) continue;
        plan = setMove(model, plan, a.id, m.to);
        // a young or pregnant one into a habitat and a non-breeder over the make-up (kinprogramme.js keepSpares) keep their own reason
        S.reasons.set(a.id, isHousingMove(m) ? m.reason : m.spare ? `${m.reason} (to trade or release)` : programmeReason(model, a, m.to, r.groups, S.prog && S.prog.info));
    }
    S.plan = plan;
    S.prog = null;
    S.planTab = 'plan';
    notice(plan.length
        ? `Breeding programme: ${plan.length} move${plan.length === 1 ? '' : 's'} in the plan. Check the board; nothing moves until you run the plan or press Move now.`
        : 'The breeding programme needs no moves: the groups are already the best the optimiser found.', 'ok');
    breadcrumb('kin_board_programme_use');
    renderAll();
}

function programmeWarnings(model, p, r) {
    const out = [];
    const info = p.info;
    if (!info) {
        out.push(p.infoError
            ? `The game could not describe ${speciesName(p.species)} (${p.infoError}), so this plan uses estimates: up to ${PROGRAMME_DEFAULTS.defaultCapacity} adults per habitat, mixed groups, conception from the fertility genes.`
            : `The game did not answer, so this plan uses estimates: up to ${PROGRAMME_DEFAULTS.defaultCapacity} adults per habitat, mixed groups, conception from the fertility genes.`);
        return out;
    }
    if (!Array.isArray(info.conception) || !info.conception.length) out.push('No conception table from the game: the chance of young is estimated from the fertility genes.');
    if (r && r.rule && r.rule.source === 'none') out.push(noMakeupText(info));
    if (r) {
        const hs = info.habitats || {};
        const noSpace = r.habitats.filter(hb => !(hs[hb] && hs[hb].available));
        const busy = r.habitats.filter(hb => hs[hb] && hs[hb].calculating);
        const fall = info.social && info.social.max > 0 ? `the group size (up to ${info.social.max})` : `a default of ${PROGRAMME_DEFAULTS.defaultCapacity} adults`;
        if (noSpace.length) out.push(`No space data for ${noSpace.map(hb => whereName(model, hb)).join(', ')}: room there comes from ${fall}.`);
        if (busy.length) out.push(`The game is still measuring ${busy.map(hb => whereName(model, hb)).join(', ')}: its space may change.`);
    }
    return out;
}

// Why there is no make-up, with what the game did give (a solitary species
// has only one-sex groups; an unread mating rule is shown as it came).
// Only for source 'none': a mating rule the mod read (Polygyandry included)
// is a make-up of its own. Text: kinprogramme.js unknownMakeupText (tested).
function noMakeupText(info) {
    return unknownMakeupText(info || {});
}

function statTile(key, label, before, after, better, fmt = v => String(v)) {
    const b = before == null ? null : before, a = after == null ? null : after;
    let tone = 'flat';
    if (b != null && a != null && a !== b) tone = (better === 'up' ? a > b : a < b) ? 'good' : 'bad';
    return h(`div.PZ2QoL_kbStat.${tone}`, { 'data-key': key, 'data-before': b == null ? '' : String(b), 'data-after': a == null ? '' : String(a) },
        h('div.PZ2QoL_kbStatLabel', { text: label }),
        h('div.PZ2QoL_kbStatValue', null,
            h('span.PZ2QoL_kbStatBefore', { text: b == null ? '–' : fmt(b) }),
            h('div.PZ2QoL_kbArrow.small'),
            h('span.PZ2QoL_kbStatAfter', { text: a == null ? '–' : fmt(a) })));
}

function programmeEl(model) {
    const p = S.prog;
    const name = speciesName(p.species);
    const cancel = btn('Cancel', null, closeProgramme, { title: 'Back to the board (Esc)' });
    if (p.state === 'loading') {
        const wrap = h(`div.PZ2QoL_kbProg.state_${p.state}`);
        wrap.appendChild(h('div.PZ2QoL_kpEmpty', null,
            h('div.PZ2QoL_kpEmptyIcon.wait'),
            h('div.PZ2QoL_kpEmptyTitle', { text: 'Asking the game…' }),
            h('div.PZ2QoL_kpEmptyText', { text: `${name}: group size, mating system, group make-up, fertility ages, the chance of young and the space in each habitat.` }),
            h('div.PZ2QoL_kpEmptyActions', null, cancel)));
        return wrap;
    }
    const view = programmeView(model);
    const r = view ? view.r : programmeResult();
    const busy = programmeBusy(p) && !(view && view.kind === 'deep');
    const wrap = h(`div.PZ2QoL_kbProg.state_${p.state}${busy ? '.busy' : ''}`);
    if (!r && !busy) {
        wrap.appendChild(h('div.PZ2QoL_kpEmpty', null,
            h('div.PZ2QoL_kpEmptyTitle', { text: 'No programme' }),
            h('div.PZ2QoL_kpEmptyText', { text: p.error ? 'The optimiser failed for this species. The board is unchanged.' : `${name} has no animals that can breed and move.` }),
            h('div.PZ2QoL_kpEmptyActions', null, cancel)));
        return wrap;
    }
    const choice = ratioChoice(p.species);
    const rule = r && r.rule ? r.rule : groupRule(p.info || {}, choice);
    const nMoves = r ? r.moves.length : 0;
    const toTrade = r ? r.moves.filter(m => m.to === TRADE).length : 0;
    const fromTrade = r ? r.fromTrade || 0 : 0;
    const tradeBits = [fromTrade ? `${fromTrade} from the trade centre` : '', toTrade ? `${toTrade} to the trade centre` : ''].filter(Boolean).join(', ');
    // breeders waiting at the trade centre: use them or not
    const tradeToggle = r && r.tradeWaiting > 0 ? h(`div.PZ2QoL_kbTradeUse${p.useTrade !== false ? '.on' : ''}`, {
        'data-waiting': String(r.tradeWaiting),
        title: p.useTrade !== false
            ? `${r.tradeWaiting} breeder${r.tradeWaiting === 1 ? '' : 's'} of this species wait at the trade centre; the programme may bring them into a group. Click to leave them there.`
            : `Click to let the programme bring the ${r.tradeWaiting} breeder${r.tradeWaiting === 1 ? '' : 's'} waiting at the trade centre into a group.`,
        onClick: guard('Programme trade centre', () => {
            p.useTrade = p.useTrade === false;
            renderAll();
        }),
    }, h('span', { text: `${p.useTrade !== false ? '☑' : '☐'} Use the trade centre (${r.tradeWaiting} waiting)` })) : null;
    // the group make-up: the game's (auto, or fixed by the species) or the player's choice
    const fixed = makeupFixed(rule);
    const auto = fixed || choice === 'auto';
    const makeup = h(`div.PZ2QoL_kbRatio${auto ? '' : '.mine'}${fixed ? '.fixed' : ''}`, {
        'data-ratio': fixed ? 'auto' : choice,
        'data-rule': ratioKey(rule),
        'data-source': rule.source,
        title: fixed
            ? `Only the leader breeds in this species (the game's rule): the programme plans around the leader, so there is no make-up to choose.`
            : `Group make-up: how many females one breeding male breeds with (or the reverse). ${auto ? `Auto: from ${RATIO_SOURCE_WORDS[rule.source] || 'the game'}.` : 'Your choice for this species, kept for this zoo.'} `
                + 'The arrows step through: auto, pairs (1:1), one male with 2 to 5 females, one male with any number (harem), 2 or 3 males with one female, any males with one female, mixed groups. '
                + 'The programme fills each habitat towards this make-up from the trade centre and from other habitats, and moves the surplus on.',
    },
        fixed ? null : h('div.PZ2QoL_kbRatioArrow.prev', { title: 'Previous make-up', onClick: guard('Programme make-up', () => cycleRatio(-1)) }, h('span', { text: '‹' })),
        h('div.PZ2QoL_kbRatioText', null,
            h('span.PZ2QoL_kbRatioLabel', { text: fixed ? 'Make-up (the game)' : auto ? 'Make-up (auto)' : 'Make-up' }),
            h('span.PZ2QoL_kbRatioValue', { text: makeupShort(rule) })),
        fixed ? null : h('div.PZ2QoL_kbRatioArrow.next', { title: 'Next make-up', onClick: guard('Programme make-up', () => cycleRatio(1)) }, h('span', { text: '›' })));
    // head: title, the slider, the buttons
    const steps = h('div.PZ2QoL_kbSteps', null,
        h('span.PZ2QoL_kbStepEnd', { text: 'Fewer moves' }),
        PROGRAMME_STEPS.map((st, i) => h(`div.PZ2QoL_kbStep${i === p.step ? '.on' : ''}`, {
            'data-step': String(i),
            title: st.cost ? `${st.label}: each move costs ${st.cost} (in expected-young units)` : `${st.label}: moves cost nothing; only the young count (a move that gains nothing is still left out)`,
            onClick: guard('Programme step', () => {
                p.step = i;
                saveProgStep(i);
                renderAll();
            }),
        }, h('div.PZ2QoL_kbStepDot'))),
        h('span.PZ2QoL_kbStepEnd', { text: 'Best genetics' }));
    const subText = busy && !r ? `${makeupWords(rule)} · optimising…` : `${makeupWords(rule)} · ${nMoves} move${nMoves === 1 ? '' : 's'}${tradeBits ? ` (${tradeBits})` : ''}`;
    wrap.appendChild(h('div.PZ2QoL_kbProgHead', null,
        h('div.PZ2QoL_kbProgTitles', null,
            h('div.PZ2QoL_kbProgTitle', { text: `Breeding programme · ${trunc(name, 24)}` }),
            h('div.PZ2QoL_kbProgSub', { text: subText, title: subText })),
        h('div.PZ2QoL_kpFlex'),
        recomputeBtn(),
        btn(`Use this plan (${nMoves})`, null, useProgramme, { cls: `primary${nMoves && !busy ? '' : '.disabled'}`, title: busy ? 'The optimiser is still working' : 'Put these moves in the plan (it replaces the current plan)' }),
        cancel));
    // the choices on a row of their own (it wraps): the head's buttons stay in view
    wrap.appendChild(h('div.PZ2QoL_kbProgControls', null, makeup, tradeToggle, steps, optimiserChip(p)));
    if (p.optOpen) wrap.appendChild(optimiserRow());
    const deepRow = deepStatusEl(p, model, view);
    if (deepRow) wrap.appendChild(deepRow);
    maybeAutoDeep(p, model, view);
    if (busy) {
        const pct = `${Math.round(Math.max(0, Math.min(1, p.job.progress || 0)) * 100)}%`;
        wrap.appendChild(h('div.PZ2QoL_kbProgBusy', { title: 'The optimiser tries many layouts: every one for a few breeders, a guided search for more. The game keeps running meanwhile.' },
            h('span.PZ2QoL_kbProgBusyText', { text: r ? 'Optimising again with the zoo as it is now…' : 'Optimising the groups…' }),
            h('div.PZ2QoL_kbProgBusyBar', null, h('div.PZ2QoL_kbProgBusyFill', { style: { width: pct } })),
            h('span.PZ2QoL_kbProgBusyPct', { text: pct })));
    }
    if (!r) return wrap;
    for (const w of programmeWarnings(model, p, r)) wrap.appendChild(h('div.PZ2QoL_kbProgWarn', { text: w }));
    // the numbers, before -> after
    const b = r.before, a = r.after;
    wrap.appendChild(h('div.PZ2QoL_kbStats', { 'data-moves': String(r.moves.length), 'data-system': r.system, 'data-rule': ratioKey(rule), 'data-exact': r.exact ? '1' : '0' },
        statTile('pairs', 'Breeding pairs', b.breedingPairs, a.breedingPairs, 'up'),
        statTile('related', 'Related pairs together', b.relatedPairs, a.relatedPairs, 'down'),
        statTile('quality', 'Expected young', b.youngQuality, a.youngQuality, 'up'),
        statTile('conception', 'Chance of young', b.conception, a.conception, 'up', v => `${v}%`),
        statTile('idle', 'Without a partner', b.idle, a.idle, 'down'),
        h('div.PZ2QoL_kbStat.moves', { 'data-key': 'moves' }, h('div.PZ2QoL_kbStatLabel', { text: 'Moves' }), h('div.PZ2QoL_kbStatValue', null, h('span.PZ2QoL_kbStatAfter', { text: String(r.moves.length) })))));
    // the target groups, habitat by habitat
    const box = makeScroll('kbProgGroups', { x: true, y: true, onScroll: (x, y) => { S.scroll.progX = x; S.scroll.prog = y; } });
    S.boxes.prog = box;
    const row = h('div.PZ2QoL_kbGroupRow');
    const groups = new Map(r.groups.map(g => [g.hab, g]));
    const order = r.habitats.slice();
    for (const g of r.groups) if (!order.includes(g.hab) && g.hab !== TRADE) order.push(g.hab);
    if (groups.has(TRADE)) order.push(TRADE);
    const moved = new Map(r.moves.map(m => [m.id, m.to]));
    for (const hab of order) row.appendChild(groupEl(model, hab, groups.get(hab), r, moved));
    box.content.appendChild(row);
    wrap.appendChild(box.wrap);
    restoreScroll(box, S.scroll.progX || 0, S.scroll.prog || 0);
    return wrap;
}

function groupEl(model, hab, g, r, moved) {
    const animals = g ? g.animals : [];
    const trade = hab === TRADE;
    const cap = r.capacity[hab];
    const staying = g ? g.staying : (r.staying && r.staying[hab]) || 0;
    const adults = animals.length + staying;
    const over = !trade && cap != null && adults > cap;
    const node = h(`div.PZ2QoL_kbGroup${trade ? '.trade' : ''}${over ? '.over' : ''}${animals.length ? '' : '.none'}`, { 'data-hab': hab });
    node.appendChild(h('div.PZ2QoL_kbGroupHead', null,
        icon(trade ? 'IconTradeCentre' : 'IconHabitat', 'brown', 'sm'),
        h('div.PZ2QoL_kbGroupName', { text: trunc(whereName(model, hab), 22), title: whereName(model, hab) })));
    node.appendChild(h('div.PZ2QoL_kbGroupCap', {
        text: trade ? 'Leftovers: no place in a breeding group'
            : `${adults} adult${adults === 1 ? '' : 's'}${cap != null ? ` · room for ${cap}` : ''}${over ? ' · over' : ''}`,
    }));
    // the make-up this habitat's room asks for, and the places still open
    const target = !trade && r.targets ? r.targets[hab] : null;
    if (target) {
        const males = animals.filter(a => a.sex === Sex.Male).length, females = animals.filter(a => a.sex === Sex.Female).length;
        const open = Math.max(0, target.males - males) + Math.max(0, target.females - females);
        node.appendChild(h(`div.PZ2QoL_kbGroupTarget${open ? '.open' : ''}`, {
            'data-open': String(open),
            text: `Make-up ${target.males} ♂ ${target.females} ♀ · ${open ? `${open} open` : 'full'}`,
            title: open
                ? `With its room this habitat could hold ${target.males} breeding ♂ and ${target.females} breeding ♀ under the make-up; ${open} place${open === 1 ? ' is' : 's are'} still open after this plan (no unrelated breeder of that sex was spare, or moving one was not worth it).`
                : `Its breeders fill the make-up for its room (${target.males} ♂, ${target.females} ♀).`,
        }));
    }
    const line = a => {
        const from = model.animals.get(a.id);
        const home = from ? homeOf(from) : '';
        const incoming = moved.has(a.id) && home !== hab;
        return h(`div.PZ2QoL_kbGroupAnimal.${sexClass(a.sex)}${incoming ? '.in' : ''}`, { 'data-id': a.id },
            h('span.PZ2QoL_kbGroupWho', { text: `${sexSymbol(a.sex)} ${trunc(a.name, 15)}`, title: a.name }),
            incoming ? h('span.PZ2QoL_kbGroupFrom', null, h('div.PZ2QoL_kbArrow.small'), h('span', { text: `from ${trunc(whereName(model, home), 12)}` })) : null,
            a.preg ? h('span.PZ2QoL_kbTag.preg', { text: 'pregnant · stays', title: `Pregnant: ${PREGNANT_STAYS}. The programme never moves her; it can still bring partners to her.` }) : null);
    };
    const males = animals.filter(a => a.sex === Sex.Male);
    const females = animals.filter(a => a.sex !== Sex.Male);
    if (!animals.length) node.appendChild(h('div.PZ2QoL_kbGroupEmpty', { text: 'No breeders' }));
    for (const a of males) node.appendChild(line(a));
    if (males.length && females.length) node.appendChild(h('div.PZ2QoL_kbGroupGap'));
    for (const a of females) node.appendChild(line(a));
    if (staying) node.appendChild(h('div.PZ2QoL_kbGroupStay', { text: `+${staying} staying (young or not breeding)` }));
    // pregnant females here who should get contraception once they give birth
    for (const adv of (r.contraception || []).filter(x => x.hab === hab)) node.appendChild(contraAdviceEl(model, adv));
    // who leaves this habitat
    const leaving = [];
    for (const [id, to] of moved) {
        const a0 = model.animals.get(id);
        if (a0 && homeOf(a0) === hab && to !== hab) leaving.push({ a: a0, to });
    }
    if (leaving.length) {
        node.appendChild(h('div.PZ2QoL_kbGroupLeaveHead', { text: `Leaving (${leaving.length})` }));
        for (const l of leaving) {
            node.appendChild(h(`div.PZ2QoL_kbGroupAnimal.out.${sexClass(l.a.sex)}`, null,
                h('span.PZ2QoL_kbGroupWho', { text: `${sexSymbol(l.a.sex)} ${trunc(l.a.name, 12)}` }),
                h('span.PZ2QoL_kbGroupFrom', null, h('div.PZ2QoL_kbArrow.small'), h('span', { text: trunc(whereName(model, l.to), 14) }))));
        }
    }
    return node;
}

// One contraception suggestion (kinprogramme.js contraceptionAdvice): the
// reason and a one-click Contraception (the game's own setter, this animal
// only, never applied by itself).
function contraAdviceEl(model, adv) {
    const a = model.animals.get(String(adv.id));
    const pending = S.contraAsk && S.contraAsk.until > Date.now() ? S.contraAsk : null;
    const mine = pending && pending.id === adv.id;
    const done = !!(a && a.contra);
    const title = `${adv.name} is pregnant and stays here. ${adv.text}. The game lets you set contraception during a pregnancy; it is meant to stop her next one. Kin never sets it by itself.`;
    return h(`div.PZ2QoL_kbContra.kind_${adv.kind}`, { 'data-id': String(adv.id), 'data-kind': adv.kind, title },
        h('div.PZ2QoL_kbContraText', null,
            h('span.PZ2QoL_kbContraWho', { text: `♀ ${trunc(adv.name, 14)}` }),
            h('span.PZ2QoL_kbContraWhy', { text: adv.text })),
        h(`div.PZ2QoL_kbContraBtn${done || pending ? '.disabled' : ''}`, {
            title: done ? `${adv.name} is on contraception` : pending ? 'Waiting for the game' : `Give ${adv.name} contraception (the game's own toggle, this animal only)`,
            onClick: guard('Contraception', () => adviseContraception(adv.id)),
        }, icon('Icon_Contracepted', 'white', 'xs'), h('span', { text: done ? 'On contraception' : mine ? 'Asking…' : 'Contraception' })));
}

// One click, one animal, one game action (Franchise: the click is the opt-in).
function adviseContraception(id) {
    const model = getKinModel();
    const a = model && model.animals.get(String(id));
    if (!a || a.contra) return;
    if (S.contraAsk && S.contraAsk.until > Date.now()) {
        notice('One action at a time: wait for the game to answer the last contraception click.', 'warn');
        return;
    }
    if (!setContraception(a.id, true)) {
        notice(`The contraception for ${a.name} could not be sent.`, 'bad');
        return;
    }
    S.contraAsk = { id: a.id, until: Date.now() + 6000 };
    breadcrumb('kin_board_contra_advice');
    notice(`Contraception for ${a.name} ♀: asked. She stays where she is.`, 'ok');
    setTimeout(queueRender, 6100);
    renderAll();
}

// How far a side panel's scroll box (programme, thin out, Auto mode) may
// reach: the board's bottom, never past the plan bar under it. An unsized
// panel stretches the board first, so the board alone overstates it.
function panelBottom() {
    const board = S.el.board.getBoundingClientRect().bottom;
    const plan = S.el.plan ? S.el.plan.getBoundingClientRect() : null;
    return plan && plan.height > 0 ? Math.min(board, plan.top) : board;
}

// Like the columns: the group strip gets its height in pixels after layout.
function fitProgramme() {
    const box = S.boxes.prog;
    if (!box || !S.el.board) return;
    try {
        const top = box.wrap.getBoundingClientRect().top;
        const pad = Math.ceil(remPx() * 0.45);
        const hgt = Math.max(remPx() * 6, Math.floor(panelBottom() - top - pad));
        box.wrap.style.flex = '0 0 auto';
        box.wrap.style.height = `${hgt}px`;
        setTimeout(() => refreshBars({ prog: box }), 0);
    }
    catch (e) {
        // cosmetic
    }
}

// --------------------------------------------------------------- thin out

function openCull() {
    const model = getKinModel();
    if (!model || !S.species) return;
    if (getPlanRun().running) {
        notice('A plan is running. Wait for it to finish before planning a new one.', 'warn');
        return;
    }
    if (S.cull && S.cull.species === S.species) return closeCull();
    S.prog = null;
    S.auto = null;
    const species = S.species;
    S.cull = Object.assign({ species, state: 'loading', info: null, infoError: '', keepIds: new Set(), cullIds: new Set(), result: null, key: '' }, cullPrefs);
    closeMenu();
    S.selected.clear();
    S.scroll.cull = 0;
    S.scroll.cullX = 0;
    breadcrumb('kin_board_thin_out');
    renderAll();
    const done = info => {
        if (!S.cull || S.cull.species !== species) return;
        S.cull.info = info && typeof info === 'object' && !info.error ? info : null;
        S.cull.infoError = info && info.error ? String(info.error) : '';
        S.cull.state = 'ready';
        S.cull.key = '';
        queueRender();
    };
    // like the breeding programme: the habitat checks first, then the game's facts
    const ids = [];
    for (const a of model.animals.values()) if (a.species === species && !a.exhibit) ids.push(a.id);
    const ready = destKnown() ? Promise.resolve() : requestDestinations(ids).then(d => {
        if (d) S.dest = d;
    }, () => {});
    ready.then(() => requestSpeciesInfo(species, habitatsToDescribe(getKinModel() || model, species))).then(done, e => {
        reportError('mod', 'Species board: species facts failed', e, { silent: true });
        done(null);
    });
}

function recomputeBtn() {
    return btn('Recompute', 'Icon_CircleWithArrows', recomputePanel, { title: 'Read the animals, the habitat checks and the game\'s room and group sizes again, and work this out afresh' });
}

function closeCull() {
    S.cull = null;
    renderAll();
}

function cullFill(c) {
    const st = FILL_STEPS.find(x => x.id === c.fill) || FILL_STEPS[1];
    return st.fill;
}

// cullPlan for the current choices (cached until a choice or the model changes)
function cullResult() {
    const c = S.cull;
    const model = getKinModel();
    if (!c || !model || c.state !== 'ready') return null;
    const ratio = ratioChoice(c.species);
    const key = [c.fill, c.oldAlways, c.genes, c.zeroFertility, ratio, Array.from(c.keepIds).sort().join(','), Array.from(c.cullIds).sort().join(',')].join('|');
    if (c.modelRef === model && c.key === key) return c.result;
    let r = null;
    try {
        r = cullPlan(model, c.species, c.info || {}, {
            options: { fill: cullFill(c), oldAlways: c.oldAlways, genes: c.genes, zeroFertility: c.zeroFertility, keepIds: c.keepIds, cullIds: c.cullIds, ratio },
        });
        c.error = null;
        if (r) {
            let over = 0;
            for (const hb of r.habitats) if (hb.room) over += Math.max(0, hb.adults - hb.capacity);
            overBySpecies.set(c.species, over);
        }
    }
    catch (e) {
        c.error = e;
        reportError('ui', 'Species board: Thin out failed', e);
    }
    c.modelRef = model;
    c.key = key;
    c.result = r;
    return r;
}

// Kept -> leaving, leaving -> kept (the player's choice wins over the plan).
function toggleCull(id, leaving) {
    const c = S.cull;
    const model = getKinModel();
    const a = model && model.animals.get(String(id));
    if (!c || !a) return;
    if (leaving) {
        if (c.cullIds.has(a.id)) c.cullIds.delete(a.id);
        else c.keepIds.add(a.id);
    }
    else {
        if (a.moving) {
            notice(`${a.name} is already on the move.`, 'warn');
            return;
        }
        if (isPinned(a)) {
            notice(`${a.name} is pregnant: Thin out never sends her away (the market won't take her until she gives birth). To move her anyway, drag her on the board.`, 'warn');
            return;
        }
        if (c.keepIds.has(a.id)) c.keepIds.delete(a.id);
        else c.cullIds.add(a.id);
    }
    renderAll();
}

function useCull() {
    const model = getKinModel();
    const r = cullResult();
    if (!model || !r || !r.moves.length) return;
    let plan = S.plan;
    let n = 0;
    for (const m of r.moves) {
        const a = model.animals.get(String(m.id));
        if (!a || !canMove(a) || isPinned(a)) continue;
        plan = setMove(model, plan, a.id, TRADE);
        S.reasons.set(a.id, `Thin out: ${m.reason}`);
        n++;
    }
    S.plan = plan;
    S.cull = null;
    S.planTab = 'plan';
    notice(`Thin out: ${n} animal${n === 1 ? '' : 's'} to the trade centre in the plan. Nothing moves until you run the plan or press Move now.`, 'ok');
    breadcrumb('kin_board_thin_out_use');
    renderAll();
}

function cullEl(model) {
    const c = S.cull;
    const name = speciesName(c.species);
    const wrap = h(`div.PZ2QoL_kbProg.PZ2QoL_kbCull.state_${c.state}`);
    const cancel = btn('Cancel', null, closeCull, { title: 'Back to the board (Esc)' });
    if (c.state === 'loading') {
        wrap.appendChild(h('div.PZ2QoL_kpEmpty', null,
            h('div.PZ2QoL_kpEmptyIcon.wait'),
            h('div.PZ2QoL_kpEmptyTitle', { text: 'Asking the game…' }),
            h('div.PZ2QoL_kpEmptyText', { text: `${name}: how many each habitat has room for, the group size and the fertile ages.` }),
            h('div.PZ2QoL_kpEmptyActions', null, cancel)));
        return wrap;
    }
    const r = cullResult();
    if (!r || !r.habitats.length) {
        wrap.appendChild(h('div.PZ2QoL_kpEmpty', null,
            h('div.PZ2QoL_kpEmptyTitle', { text: 'Nothing to thin out' }),
            h('div.PZ2QoL_kpEmptyText', { text: c.error ? 'Thin out failed for this species. The board is unchanged.' : `${name} has no animals in habitats.` }),
            h('div.PZ2QoL_kpEmptyActions', null, cancel)));
        return wrap;
    }
    const n = r.moves.length;
    const choose = (k, v) => {
        c[k] = v;
        cullPrefs[k] = v;
        renderAll();
    };
    const fill = h('div.PZ2QoL_kbSeg', null, FILL_STEPS.map(st => h(`div.PZ2QoL_kbSegItem${st.id === c.fill ? '.on' : ''}`, {
        'data-fill': st.id,
        title: st.fill ? `Keep up to ${Math.round(st.fill * 100)}% of each habitat's room${st.fill < 1 ? ' (the rest is room for young)' : ''}` : 'Keep only the breeding core of each habitat (1 male, 2 females)',
        onClick: guard('Fill', () => choose('fill', st.id)),
    }, h('span', { text: st.label }))));
    const genes = h('div.PZ2QoL_kbSeg.genes', null, GENE_STEPS.map(st => h(`div.PZ2QoL_kbSegItem${st.id === c.genes ? '.on' : ''}`, {
        'data-genes': st.id,
        title: st.id === 'off' ? st.tip : `${st.tip}: sent away from every habitat, full or not`,
        onClick: guard('Poor genes', () => choose('genes', st.id)),
    }, h('span', { text: st.label }))));
    const sw = (k, label, title) => {
        const el = switchEl(label, c[k], () => choose(k, !c[k]), title);
        el.setAttribute('data-opt', k);
        return el;
    };
    const zero = sw('zeroFertility', '0% fertility genes', 'Animals with a 0% fertility gene leave from every habitat, full or not (they pass it on to their young)');
    const old = sw('oldAlways', 'Too old or infertile', 'Animals past breeding age or infertile leave even where there is room');
    const words = { polygyny: 'harem', polyandry: 'one breeding female per habitat', monogamy: 'pairs', mixed: 'mixed groups' };
    wrap.appendChild(h('div.PZ2QoL_kbProgHead', null,
        h('div.PZ2QoL_kbProgTitles', null,
            h('div.PZ2QoL_kbProgTitle', { text: `Thin out · ${trunc(name, 24)}` }),
            h('div.PZ2QoL_kbProgSub', { text: `${n} to the trade centre${r.atTrade ? ` · ${r.atTrade} already there` : ''} · ${words[r.system] || 'mixed groups'}` })),
        h('div.PZ2QoL_kpFlex'),
        fill,
        recomputeBtn(),
        btn(`Send ${n} to the trade centre`, null, useCull, { cls: `primary${n ? '' : '.disabled'}`, title: 'Put these moves in the plan; Execute (or Move now) on the board sends them, one at a time' }),
        cancel));
    wrap.appendChild(h('div.PZ2QoL_kbCullBar', null,
        h('div.PZ2QoL_kbCullLabel', { text: 'Poor genes' }), genes, zero, old, h('div.PZ2QoL_kpFlex'),
        h('div.PZ2QoL_kbCullHint', { text: 'From the trade centre you can sell them (Animal Storage, Market lister), trade or release them.' })));
    if (r.poorKept) {
        wrap.appendChild(h('div.PZ2QoL_kbCullNote', { text: `${r.poorKept} with poor genes stay${r.poorKept === 1 ? 's' : ''}: pregnant, on the move, kept by you, or the last breeder of its sex. Run Thin out again later.` }));
    }
    if (r.estimated) {
        wrap.appendChild(h('div.PZ2QoL_kbProgWarn', { text: 'The game gave no room for these habitats, so Thin out sends none away for room: only for poor genes, old age (when chosen) or by your choice.' }));
    }
    else {
        const guess = r.habitats.filter(hb => !hb.room).map(hb => whereName(model, hb.hab));
        if (guess.length) wrap.appendChild(h('div.PZ2QoL_kbProgWarn', { text: `No room from the game for ${guess.join(', ')}: there the current adults count as full.` }));
    }
    const b = r.before, a = r.after;
    wrap.appendChild(h('div.PZ2QoL_kbStats', { 'data-moves': String(n) },
        statTile('animals', 'Animals', b.animals, a.animals, 'down'),
        statTile('adults', 'Adults', b.adults, a.adults, 'down'),
        statTile('gene', 'Average genes', b.gene, a.gene, 'up'),
        statTile('old', 'Too old to breed', b.old, a.old, 'down'),
        statTile('zeroFert', '0% fertility genes', b.zeroFert, a.zeroFert, 'down'),
        h('div.PZ2QoL_kbStat.moves.wide', { 'data-key': 'moves' },
            h('div.PZ2QoL_kbStatLabel', { text: 'To the trade centre' }),
            h('div.PZ2QoL_kbStatValue', null, h('span.PZ2QoL_kbStatAfter', { text: String(n) }),
                r.removedGene != null ? h('span.PZ2QoL_kbStatNote', { text: `genes avg ${r.removedGene}` }) : null))));
    const box = makeScroll('kbProgGroups', { x: true, y: true, onScroll: (x, y) => { S.scroll.cullX = x; S.scroll.cull = y; } });
    S.boxes.cull = box;
    const row = h('div.PZ2QoL_kbGroupRow');
    for (const hb of r.habitats) row.appendChild(cullHabEl(model, hb));
    box.content.appendChild(row);
    wrap.appendChild(box.wrap);
    restoreScroll(box, S.scroll.cullX || 0, S.scroll.cull || 0);
    return wrap;
}

function cullRow(model, entry, leaving) {
    const a = model.animals.get(entry.id);
    if (!a) return null;
    const tag = fertilityTag(a);
    const mark = !leaving && entry.whyCode ? CULL_MARKS[entry.whyCode] : null;
    const gene = entry.gene != null ? Math.round(entry.gene * 100) : null;
    const node = h(`div.PZ2QoL_kbCullRow.${sexClass(a.sex)}.${leaving ? 'leave' : 'keep'}`, {
        'data-id': a.id,
        'data-state': leaving ? 'cull' : 'keep',
        'data-why': leaving ? entry.reason : (entry.why || ''),
        title: leaving ? `${a.name} leaves: ${entry.reason}. Click to keep it.` : `${a.name} stays${entry.why ? ` (${entry.why})` : ''}${entry.poor ? `, despite ${entry.poor}` : ''}. Click to send it to the trade centre.`,
        onClick: guard('Thin out', () => toggleCull(a.id, leaving)),
    },
    h('div.PZ2QoL_kbCullTop', null,
        h('span.PZ2QoL_kbGroupWho', { text: `${sexSymbol(a.sex)} ${trunc(a.name, 14)}` }),
        a.juv ? h('span.PZ2QoL_kbTag.young', { text: 'young' }) : null,
        tag && !a.juv ? h(`span.PZ2QoL_kbTag.fert_${tag.cls}`, { text: tag.text, title: tag.title }) : null,
        mark ? h(`span.PZ2QoL_kbTag.mark_${mark.cls}`, { text: mark.text, title: mark.title }) : null,
        h('div.PZ2QoL_kpFlex'),
        gene != null ? h('span.PZ2QoL_kbGene', { text: String(gene), title: `Gene score ${gene}` }) : null,
        leaving
            ? h('span.PZ2QoL_kbCullUndo', { text: 'keep' })
            : h('div.PZ2QoL_kbCullX', null, crossMark())),
    leaving ? h('div.PZ2QoL_kbCullWhy', { text: entry.reason }) : null);
    return node;
}

function cullHabEl(model, hb) {
    const over = hb.adults > hb.target;
    const node = h(`div.PZ2QoL_kbGroup.PZ2QoL_kbCullHab${over ? '.over' : ''}`, { 'data-hab': hb.hab });
    node.appendChild(h('div.PZ2QoL_kbGroupHead', null,
        icon('IconHabitat', 'brown', 'sm'),
        h('div.PZ2QoL_kbGroupName', { text: trunc(whereName(model, hb.hab), 22), title: whereName(model, hb.hab) })));
    node.appendChild(h('div.PZ2QoL_kbGroupCap', {
        text: `${hb.adults} adult${hb.adults === 1 ? '' : 's'} · room for ${hb.capacity}${hb.room ? '' : '?'} → keep ${hb.target}${hb.juveniles ? ` · ${hb.juveniles} young` : ''}`,
        title: hb.room ? 'Room from the game (group size and space)' : 'The game gave no room: the current adults count as full',
    }));
    // who leaves first: that is what the player checks
    if (hb.cull.length) {
        node.appendChild(h('div.PZ2QoL_kbCullHead.leave.first', { text: `To the trade centre (${hb.cull.length})` }));
        for (const k of hb.cull) {
            const el = cullRow(model, k, true);
            if (el) node.appendChild(el);
        }
    }
    else node.appendChild(h('div.PZ2QoL_kbGroupEmpty', { text: over ? 'Nothing it can spare' : 'Fits: nobody leaves' }));
    const keep = hb.keep.slice().sort((x, y) => (y.value || 0) - (x.value || 0));
    node.appendChild(h('div.PZ2QoL_kbCullHead', { text: `Stay (${keep.length}) · click one to send it away` }));
    for (const k of keep) {
        const el = cullRow(model, k, false);
        if (el) node.appendChild(el);
    }
    return node;
}

function fitCull() {
    const box = S.boxes.cull;
    if (!box || !S.el.board) return;
    try {
        const top = box.wrap.getBoundingClientRect().top;
        const hgt = Math.max(remPx() * 6, Math.floor(panelBottom() - top - Math.ceil(remPx() * 0.45)));
        box.wrap.style.flex = '0 0 auto';
        box.wrap.style.height = `${hgt}px`;
        setTimeout(() => refreshBars({ cull: box }), 0);
    }
    catch (e) {
        // cosmetic
    }
}

// Like Thin out: the Auto panel's scroll area gets its height after layout.
function fitAuto() {
    const box = S.boxes.auto;
    if (!box || !S.el.board) return;
    try {
        const top = box.wrap.getBoundingClientRect().top;
        const hgt = Math.max(remPx() * 6, Math.floor(panelBottom() - top - Math.ceil(remPx() * 0.45)));
        box.wrap.style.flex = '0 0 auto';
        box.wrap.style.height = `${hgt}px`;
        setTimeout(() => refreshBars({ auto: box }), 0);
    }
    catch (e) {
        // cosmetic
    }
}

// ---------------------------------------------------------------- footer

function renderFoot() {
    const el = S.el.status;
    if (!el) return;
    const model = getKinModel();
    let text = 'No data yet';
    if (!getKinSettings().enabled) text = 'Kin is off';
    else if (model && S.modelTime) {
        text = `Updated ${ago(Date.now() - S.modelTime)}`;
        if (model.mode === 'franchise') text += ' · Franchise zoo';
    }
    setText(el, text);
}

// ------------------------------------------------------------ navigation

function openPlanner(opts) {
    const p = panelApi('planner');
    if (!p) return;
    const o = Object.assign({}, opts || {});
    if (o.animalId == null && S.species && S.columns.length) {
        const c = S.columns.find(x => x.kind === 'habitat' && x.animals.length);
        if (c) {
            o.habitatId = c.id;
            o.species = S.species;
        }
    }
    p.open(o);
}

function loadDestinations(force) {
    const model = getKinModel();
    if (!model || !S.species) return;
    const species = S.species;
    const ids = [];
    for (const a of model.animals.values()) if (a.species === species && !a.exhibit) ids.push(a.id);
    if (!ids.length) return;
    S.destLoading = true;
    requestDestinations(ids, { force: !!force }).then(d => {
        if (d) S.dest = d;
        S.destLoading = false;
        if (S.open && S.species === species) queueRender();
    }, e => {
        S.destLoading = false;
        reportError('mod', 'Species board: habitat checks failed', e, { silent: true });
        queueRender();
    });
}

// The programme, Thin out and Auto panels belong to one species: another
// species closes them (a hidden one would still recompute, hold Esc and
// keep Auto mode waiting).
function closeSpeciesPanels() {
    S.prog = null;
    S.cull = null;
    S.auto = null;
}

function focusSpecies(species, animalId) {
    if (species !== S.species) {
        S.species = species;
        closeSpeciesPanels();
        S.selected.clear();
        S.scroll.board = 0;
        S.scroll.cols = {};
        S.storedAll = false;
        S.hoverId = null;
    }
    closeMenu();
    loadDestinations(false);
    requestStorageCounts([species]);
    if (animalId != null) {
        const model = getKinModel();
        const a = model && model.animals.get(String(animalId).replace(/^animal_/, ''));
        if (a && canMove(a)) {
            S.selected.clear();
            S.selected.add(a.id);
        }
    }
    renderAll();
    // bring the chosen animal's column into view
    if (animalId != null) {
        setTimeout(() => {
            try {
                const card = S.cards.get(String(animalId).replace(/^animal_/, ''));
                const board = S.boxes.board;
                if (!card || !board) return;
                const cr = card.getBoundingClientRect(), br = board.vp.getBoundingClientRect();
                if (cr.left < br.left || cr.right > br.right) scrollBoxTo(board, board.vp.scrollLeft + cr.left - br.left - remPx(), 0);
            }
            catch (e) {
                // cosmetic
            }
        }, 0);
    }
}

// ------------------------------------------------------------ open/close

function tick() {
    if (!S.open) return;
    try {
        markKinActive();
        renderFoot();
        if (S.notice && Date.now() >= S.notice.until) {
            S.notice = null;
            renderNotice();
        }
        if (!S.drag) {
            fitColumns();
            refreshBars(S.boxes);
        }
    }
    catch (e) {
        reportError('ui', 'Species board refresh failed', e, { silent: true });
    }
}

function subscribe() {
    unsubscribe();
    S.unsub.push(onKin(() => queueRender()));
    S.unsub.push(onKinSettings(() => queueRender()));
    S.unsub.push(onAssignments(() => queueRender()));
    S.unsub.push(onMuted(() => queueRender()));
    S.unsub.push(onStorageCounts(() => queueRender()));
    S.unsub.push(onPlanRun(() => queueRender()));
    S.unsub.push(onOptimiser(() => queueRender()));
    S.unsub.push(onDeep(kind => (kind === 'progress' ? renderDeepProgress() : queueRender())));
    S.timer = setInterval(tick, TICK_MS);
}

function unsubscribe() {
    for (const fn of S.unsub) {
        try {
            fn();
        }
        catch (e) {
            // gone
        }
    }
    S.unsub = [];
    if (S.timer) clearInterval(S.timer);
    S.timer = 0;
}

// Opens the board. opts: { species, animalId }; without them it keeps the
// last species (or the one with the worst problems).
export function openSpeciesBoard(opts = {}) {
    try {
        ensureRoot();
        hideKinCard();
        closeOtherPanels('board');
        const o = opts || {};
        const model = getKinModel();
        let species = o.species != null ? String(o.species) : null;
        if (o.animalId != null && model) {
            const a = model.animals.get(String(o.animalId).replace(/^animal_/, ''));
            if (a) species = a.species;
        }
        if (!S.dest) S.dest = cachedDestinations();
        const wasOpen = S.open;
        S.open = true;
        setClass(S.root, 'hidden', false);
        placePanel(S.root, BOARD_SIZE);
        if (!wasOpen) subscribe();
        breadcrumb('kin_board_open');
        requestKinScan('board');
        markKinActive();
        // live storage counts each time the board opens (the player may have been to the hub)
        if (!wasOpen && (species || S.species)) requestStorageCounts([species || S.species], { force: true });
        // stored adults: asked again (past the cache) once the board draws
        if (!wasOpen) {
            S.storedTried.clear();
            S.storedFresh = true;
        }
        if (species) focusSpecies(species, o.animalId);
        else {
            renderAll();
            loadDestinations(false);
            if (S.species) requestStorageCounts([S.species]);
        }
        return true;
    }
    catch (e) {
        reportError('ui', 'Species board could not open', e);
        return false;
    }
}

export function closeSpeciesBoard() {
    try {
        cancelDrag();
        closeMenu();
        S.open = false;
        S.hoverId = null;
        unsubscribe();
        if (S.root) setClass(S.root, 'hidden', true);
        // the plan stays for next time (a running plan keeps running)
    }
    catch (e) {
        reportError('ui', 'Species board could not close', e, { silent: true });
    }
    return true;
}

export function isSpeciesBoardOpen() {
    return S.open;
}

// Another park (or the same one loaded again) hands out entity ids afresh:
// a staged move, a sent id or a habitat check of the last one could name
// another animal now. reason: 'park' or 'data' (the zoo's data became
// readable); none counts as a park.
function onStoreReset(reason) {
    if (reason && reason !== 'park') return;
    breadcrumb('kin_board_park_reset');
    cancelDrag();
    closeMenu();
    closeSpeciesPanels();
    S.plan = [];
    S.reasons.clear();
    S.selected.clear();
    S.sent.clear();
    S.pendingMove.clear();
    S.dest = null;
    S.storedBy.clear();
    S.storedTried.clear();
    S.storedView = null;
    S.columns = [];
    S.after = null;
    S.lastModel = undefined;
    queueRender();
}

let installed = false;
export function installSpeciesBoard() {
    if (installed) return true;
    installed = true;
    installDeep();
    if (typeof engine !== 'undefined') engine.on('PZ2QoL_StoreReset', guard('Park reset', onStoreReset));
    document.addEventListener('keydown', e => {
        if (!S.open) return;
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        try {
            e.preventDefault();
            e.stopPropagation();
            if (S.drag) cancelDrag();
            else if (S.menu) closeMenu();
            else if (S.prog) closeProgramme();
            else if (S.cull) closeCull();
            else if (S.auto) closeAuto();
            else closeSpeciesBoard();
        }
        catch (err) {
            reportError('ui', 'Species board: Esc failed', err, { silent: true });
        }
    }, true);
    window.addEventListener('resize', () => {
        if (!S.open) return;
        placePanel(S.root, BOARD_SIZE);
        setTimeout(() => {
            fitColumns();
            fitAuto();
            refreshBars(S.boxes);
        }, 0);
    });
    return true;
}

registerPanel('board', { open: openSpeciesBoard, close: closeSpeciesBoard, isOpen: isSpeciesBoardOpen });
