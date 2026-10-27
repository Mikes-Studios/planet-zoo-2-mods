// Zoo management Animals list: filter by habitat, sex, age, pregnancy,
// alpha, contraception, welfare and genes, and sort by computed scores.
//
// Same technique as Animal Storage: the list's rows are filtered at the
// data level (listfilter.js), and the toolbar is our own DOM placed over
// the top of the Animals panel.
import { applyZooFilters, DEFAULT_ZOO_FILTERS, habitatCounts, storageSummary, UNHAPPY_WELFARE, zooFiltersActive } from '/js/mods/pz2qol/scores.js';
import { get, readZooAnimal, reopenZooAnimals, ZOO_LIST_KEY } from '/js/mods/pz2qol/game.js';
import { getListSource, liveListCount, rebindList, refreshList, registerListFilter } from '/js/mods/pz2qol/listfilter.js';
import { dlog } from '/js/mods/pz2qol/debuglog.js';
import { chip, collapser, next, safe, segmented, setChip } from '/js/mods/pz2qol/bars.js';
// (segmented is used for sex/age)
import { clear, h, icon, isGamePopupOpen, setClass, setText, tierOf, visibleBox } from '/js/mods/pz2qol/ui.js';
import { GAME_TOOLTIPS, GAME_WINDOWS, stepAside } from '/js/mods/pz2qol/stepaside.js';
import { breadcrumb, reportError } from '/js/mods/pz2qol/errors.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';
import { zooKinCounts, zooKinInfo } from '/js/mods/pz2qol/kinzoo.js';
import { getKinModel, isBreedingHeatmapOn, onKin, setBreedingHeatmap } from '/js/mods/pz2qol/kin.js';
import { habitatByName } from '/js/mods/pz2qol/kincore.js';
import { openKinPlanner } from '/js/mods/pz2qol/kinplanner.js';

const SCORE_STEPS = [0, 50, 60, 70, 80, 90];
const ALL_HABITATS = null;

let filters = Object.assign({}, DEFAULT_ZOO_FILTERS);
const listeners = new Set();

function setFilters(patch) {
    filters = Object.assign({}, filters, patch);
    breadcrumb('zoo_filter');
    // hidden animals must never stay selected for Release / Sell / Rehome
    try {
        engine.trigger('Management_SelectAllCheckboxToggled', 'selectAllAnimals', false);
    }
    catch (e) {
        reportError('ui', 'Could not clear the animal selection', e);
    }
    refreshList(ZOO_LIST_KEY);
    callAll(listeners, filters);
}

// Zoo row plus its Kin state (kinSeverity, kinCluster) for filter and sort.
function readWithKin(ctx) {
    const a = readZooAnimal(ctx);
    return Object.assign(a, zooKinInfo(a.id));
}

registerListFilter(ZOO_LIST_KEY, {
    active: () => zooFiltersActive(filters),
    filter: source => applyZooFilters(source.map(ctx => Object.assign(readWithKin(ctx), { _ctx: ctx })), filters).map(a => a._ctx),
    selectAll: {
        matches: (name, args) => name === 'Management_SelectAllCheckboxToggled' && args[0] === 'selectAllAnimals' && args[1] === true,
        clear: trigger => trigger('Management_SelectAllCheckboxToggled', 'selectAllAnimals', false),
        select: (trigger, ctx) => {
            const id = readZooAnimal(ctx).id;
            if (id != undefined) trigger('Management_ItemCheckboxToggled', id, true);
        },
    },
    selection: {
        isSelected: ctx => !!get(ctx, 'selected'),
        deselect: ctx => engine.trigger('Management_ItemCheckboxToggled', get(ctx, 'id'), false),
    },
});

function allAnimals() {
    return getListSource(ZOO_LIST_KEY).map(readWithKin);
}

// The kin data changed: re-filter if Kin drives the list (the re-filter
// unticks the rows it hides).
onKin(() => {
    try {
        if ((filters.kin && filters.kin != 'off') || filters.sort == 'kin') refreshList(ZOO_LIST_KEY);
        if (bar) {
            bar.__sync();
            bar.__updateSummary(true);
        }
    }
    catch (e) {
        reportError('ui', 'Kin toolbar update failed', e, { silent: true });
    }
});

const KIN_STEPS = ['off', 'risk', 'any'];
const KIN_LABEL = { off: 'Kin', risk: 'Kin: risk', any: 'Kin: all' };

// ------------------------------------------------------- habitat picker

function habitatPicker() {
    const label = h('span.PZ2QoL_chipText', { text: 'All habitats' });
    const arrow = h('span.PZ2QoL_pickerArrow', { text: '▾' });
    const menu = h('div.PZ2QoL_menu');
    const button = h('div.PZ2QoL_chip.picker', { title: 'Show only the animals in one habitat or exhibit' }, icon('IconHabitat', 'brown', 'sm'), label, arrow);
    const wrap = h('div.PZ2QoL_pickerWrap', null, button, menu);
    const close = () => setClass(menu, 'open', false);
    button.addEventListener('click', e => {
        e.stopPropagation();
        if (menu.classList.contains('open')) return close();
        clear(menu);
        const animals = allAnimals();
        const item = (name, count, value) => h(`div.PZ2QoL_menuItem${filters.habitat === value ? '.on' : ''}`, {
            onClick: safe('Habitat', () => {
                close();
                setFilters({ habitat: value });
            }),
        }, h('span.PZ2QoL_menuName', { text: name }), h('span.PZ2QoL_menuCount', { text: String(count) }));
        menu.appendChild(item('All habitats', animals.length, ALL_HABITATS));
        const list = habitatCounts(animals);
        if (!list.length) menu.appendChild(h('div.PZ2QoL_menuEmpty', { text: 'No habitats found' }));
        list.forEach(x => menu.appendChild(item(x.name, x.count, x.name)));
        setClass(menu, 'open', true);
    });
    document.addEventListener('click', close);
    wrap.__sync = () => {
        setText(label, filters.habitat == null ? 'All habitats' : filters.habitat);
        setClass(button, 'on', filters.habitat != null);
    };
    return wrap;
}

// ---------------------------------------------------------------- bar

function buildZooBar() {
    const habitat = habitatPicker();
    const sex = segmented(null, [
        { value: 'any', label: 'All', tooltip: 'Both sexes' },
        { value: 'male', label: '♂', tooltip: 'Males only' },
        { value: 'female', label: '♀', tooltip: 'Females only' },
    ], v => setFilters({ sex: v }));
    const stage = segmented(null, [
        { value: 'any', label: 'Any age', tooltip: 'Any age' },
        { value: 'adult', label: 'Adults', tooltip: 'Hide juveniles' },
        { value: 'juvenile', label: 'Young', tooltip: 'Juveniles only' },
    ], v => setFilters({ stage: v }));
    const toggles = {
        pregnant: chip('Pregnant', 'Only pregnant animals', () => setFilters({ pregnant: !filters.pregnant }), 'IconFertility'),
        alpha: chip('Alpha', 'Only alphas', () => setFilters({ alpha: !filters.alpha }), 'IconStar'),
        contracepted: chip('Contra', 'Only animals on contraception', () => setFilters({ contracepted: !filters.contracepted }), 'Icon_Contracepted'),
        unhappy: chip('Unhappy', 'Only animals with welfare below a third', () => setFilters({ unhappy: !filters.unhappy }), 'IconWelfare'),
    };
    const minScore = chip('Gene ≥ any', 'Minimum gene score (average of the genes); click to step', () => setFilters({ minScore: next(SCORE_STEPS, filters.minScore) }), 'IconMedalStandard');
    const minFert = chip('Fertility ≥ any', 'Minimum fertility gene; click to step', () => setFilters({ minFertility: next(SCORE_STEPS, filters.minFertility) }), 'IconFertility');
    const kinChip = chip('Kin', "Relatives that could breed. Click to cycle: off, only animals with an inbreeding risk (the game's own rule: parent, child or sibling in the same habitat), or every related pair including close kin the game does not warn about and young animals", () => setFilters({ kin: next(KIN_STEPS, filters.kin || 'off') }), 'IconGenetics');
    kinChip.classList.add('kin');
    const plannerChip = chip('Planner', 'Who can safely breed with whom: relatedness of every pair, expected young, and the best unrelated mates', () => {
        const model = getKinModel();
        const hab = model && filters.habitat != null ? habitatByName(model, filters.habitat) : null;
        openKinPlanner(hab ? { habitatId: hab.id } : {});
    }, 'IconGenetics');
    const boardChip = chip('Board', 'Every habitat of one species side by side: see where the related animals are, plan moves, and run the plan', () => {
        import('/js/mods/pz2qol/kinboard.js').then(m => m.openSpeciesBoard({})).catch(e => reportError('ui', 'Species board could not open', e));
    }, 'IconAnimals');
    const heatChip = chip('Heat', "The game's own breeding heat map (inbreeding risk in the world)", () => {
        setBreedingHeatmap(!isBreedingHeatmapOn());
        setTimeout(sync, 200);
    }, 'Icon_Heatmap');
    const clearChip = chip('Clear', "Clear the mod's animal filters", () => setFilters(DEFAULT_ZOO_FILTERS), 'reset');
    clearChip.classList.add('ghost');
    // compact: one chip that cycles, the Animals panel is narrower than Storage
    const SORTS = ['none', 'gene', 'breeder', 'welfare', 'kin'];
    const SORT_LABEL = { none: 'Sort: Game', gene: 'Sort: Gene', breeder: 'Sort: Breeder', welfare: 'Sort: Welfare', kin: 'Sort: Kin' };
    const sort = chip('Sort: Game', "Click to cycle: the game's order, best gene score, best breeder score, lowest welfare first, related animals together (worst first)", () => setFilters({ sort: next(SORTS, filters.sort) }), 'IconMedalStandard');
    const stats = h('div.PZ2QoL_stats');

    const bar = h('div.PZ2QoL_bar.PZ2QoL_card.zoo');
    bar.appendChild(collapser(bar, 'zoo', 'Filters'));
    bar.appendChild(h('div.PZ2QoL_expandOnly', null,
        habitat, sex, stage, toggles.pregnant, toggles.alpha, toggles.contracepted, toggles.unhappy, minScore, minFert, clearChip,
        sort, h('div.PZ2QoL_divider'), kinChip, plannerChip, boardChip, heatChip));
    bar.appendChild(h('div.PZ2QoL_flex1'));
    bar.appendChild(stats);

    const sync = () => {
        habitat.__sync();
        sex.__set(filters.sex);
        stage.__set(filters.stage);
        for (const k in toggles) setClass(toggles[k], 'on', !!filters[k]);
        setChip(minScore, filters.minScore > 0, filters.minScore > 0 ? `Gene ≥ ${filters.minScore}` : 'Gene ≥ any');
        setChip(minFert, filters.minFertility > 0, filters.minFertility > 0 ? `Fertility ≥ ${filters.minFertility}` : 'Fertility ≥ any');
        setChip(sort, filters.sort != 'none', SORT_LABEL[filters.sort]);
        const kin = filters.kin || 'off';
        setChip(kinChip, kin != 'off', KIN_LABEL[kin], kinCounts.risk || '');
        setClass(kinChip, 'alert', kinCounts.risk > 0 && kin == 'off');
        setChip(heatChip, isBreedingHeatmapOn());
        setClass(clearChip, 'hiddenSoft', !zooFiltersActive(filters));
    };
    let kinCounts = zooKinCounts();
    bar.__sync = sync;
    listeners.add(() => {
        sync();
        bar.__updateSummary();
    });
    sync();

    const stat = (label, value, cls) => h(`div.PZ2QoL_stat${cls ? '.' + cls : ''}`, { title: label }, h('div.PZ2QoL_statValue', { text: value }), h('div.PZ2QoL_statLabel', { text: label }));
    bar.__updateSummary = force => {
        kinCounts = zooKinCounts();
        setChip(kinChip, (filters.kin || 'off') != 'off', undefined, kinCounts.risk || '');
        setClass(kinChip, 'alert', kinCounts.risk > 0 && (filters.kin || 'off') == 'off');
        const animals = allAnimals();
        const shown = zooFiltersActive(filters) ? applyZooFilters(animals, filters) : animals;
        // live counts on the toggles (what each would show on its own)
        setChip(toggles.pregnant, filters.pregnant, undefined, animals.filter(a => a.isPregnant).length);
        setChip(toggles.alpha, filters.alpha, undefined, animals.filter(a => a.isAlpha).length);
        setChip(toggles.contracepted, filters.contracepted, undefined, animals.filter(a => a.contracepted).length);
        setChip(toggles.unhappy, filters.unhappy, undefined, animals.filter(a => typeof a.welfare === 'number' && a.welfare < UNHAPPY_WELFARE).length);
        const summary = storageSummary(shown);
        const riskPairs = kinCounts.pairs ? kinCounts.pairs.risk : null;
        const sig = JSON.stringify([animals.length, summary, riskPairs, zooFiltersActive(filters)]);
        if (stats.__sig == sig && !force) return;
        stats.__sig = sig;
        clear(stats);
        const active = zooFiltersActive(filters);
        stats.appendChild(stat(active ? `of ${animals.length}` : 'animals', String(summary.count), active ? 'accent' : ''));
        stats.appendChild(stat('♂', String(summary.males), 'male'));
        stats.appendChild(stat('♀', String(summary.females), 'female'));
        stats.appendChild(stat('pairs', String(summary.pairs)));
        stats.appendChild(stat('avg gene', summary.avgScore == null ? '–' : String(summary.avgScore), tierOf(summary.avgScore)));
        if (riskPairs != null) stats.appendChild(stat('inbreeding risks', String(riskPairs), riskPairs > 0 ? 'kinRisk' : 'kinOk'));
    };
    return bar;
}

// ------------------------------------------------------------ placement

let bar = null;
let reserveStyle = null;
let reservedPx = -1;
let tick = 0;
// the list was hidden or covered (a popup, the Zoopedia) at the last look
let covered = true;

// Room for the bar inside the Animals panel: padding on the panel root via
// a stylesheet rule, so the panel's own position (our anchor) never moves.
function reserve(px) {
    px = Math.max(0, Math.round(px));
    if (px === reservedPx) return;
    reservedPx = px;
    if (!reserveStyle) {
        reserveStyle = document.createElement('style');
        document.head.appendChild(reserveStyle);
    }
    reserveStyle.textContent = `.PZ2QoL .ManagementAnimals_root { padding-top: ${px}px; }`;
}

// The Zoopedia, opened from this list, ends the game's management mode and
// closes to the world, leaving the screen up without its rows: the Animals
// tab is opened again as its own navigation would.
let zoopediaFromList = false;
const REOPEN_CHECK_MS = 1500;

function backFromZoopedia(screen) {
    if (visibleBox(document.querySelector('.ZoopediaModule_root'))) {
        if (screen) zoopediaFromList = true;
        return;
    }
    if (!zoopediaFromList) return;
    zoopediaFromList = false;
    const rows = getListSource(ZOO_LIST_KEY).length;
    dlog('ui', 'zoopedia_back', { rows });
    if (rows > 0) return;
    reopenZooAnimals();
    // a list still bound to the deleted rows asks the data store again
    setTimeout(() => {
        const after = getListSource(ZOO_LIST_KEY).length;
        if (after === 0) rebindList(ZOO_LIST_KEY);
        dlog('ui', 'zoopedia_reopened', { rows: after, rebound: getListSource(ZOO_LIST_KEY).length, lists: liveListCount(ZOO_LIST_KEY) });
    }, REOPEN_CHECK_MS);
}

function place() {
    tick++;
    const screen = document.querySelector('.ManagementAnimals_root');
    backFromZoopedia(screen);
    const r = isGamePopupOpen() ? null : visibleBox(screen);
    if (!r) {
        if (bar) bar.style.display = 'none';
        if (reservedPx !== 0) reserve(0);
        covered = true;
        return;
    }
    if (!bar) {
        bar = buildZooBar();
        document.body.appendChild(bar);
    }
    const shown = bar.style.display == 'flex';
    bar.style.display = 'flex';
    bar.style.left = `${Math.round(r.left + 6)}px`;
    bar.style.top = `${Math.round(r.top + 4)}px`;
    bar.style.width = `${Math.round(r.width - 12)}px`;
    // the list's own tooltips (a welfare bar's breakdown) open over the bar
    stepAside(bar, `${GAME_TOOLTIPS}, ${GAME_WINDOWS}`, 'zoo toolbar', screen);
    // the rows can't be read while a window covers the list, and the filter
    // shows none of them then; the game sees no change once it closes
    const nowCovered = !!bar.__yieldedTo;
    if (covered && !nowCovered) {
        const active = zooFiltersActive(filters);
        const rows = getListSource(ZOO_LIST_KEY).length;
        if (active) refreshList(ZOO_LIST_KEY);
        dlog('ui', 'list_back', { list: 'zoo animals', rows, after: getListSource(ZOO_LIST_KEY).length, lists: liveListCount(ZOO_LIST_KEY), filter: active });
    }
    covered = nowCovered;
    if (tick % 4 == 1 || !shown) bar.__updateSummary();
    reserve(bar.getBoundingClientRect().height + 10);
}

export function installZoo() {
    setInterval(() => {
        try {
            place();
        }
        catch (e) {
            reportError('ui', 'Animal filter toolbar failed', e, { silent: true });
        }
    }, 250);
}
