// Toolbars for the Animal Market (Trading) and Animal Storage screens.
//
// Plain DOM in our own root under <body>, positioned under the screen's
// header each tick. Nothing is inserted into the game's preact tree; the
// list is pushed down with a stylesheet rule so nothing overlaps.
import { MARKET_PRESETS, SELL_ADVICE_WAYS, TRADE_WAYS, tradesSomeWay, storageFiltersActive, storageSummary, applyStorageFilters, speciesStats, SURPLUS_KEEP_STEPS, surplusChipCount, ADULT_STAGES, isFrontierZoo, isOnMarket, sellBlockers, SELL_BLOCKERS, cautionOf, normSpecies } from '/js/mods/pz2qol/scores.js';
import { MARKET_EVENT, readAnimal, sendScreenEvent } from '/js/mods/pz2qol/game.js';
import { getStorageFilters, getStoragePredicates, getStorageSource, getStorageVerdicts, onStorageFiltersChanged, resetStorageFilters, setStorageFilters } from '/js/mods/pz2qol/listfilter.js';
import { getMarketDimBelow, onMarketDimChange, setMarketDimBelow } from '/js/mods/pz2qol/badges.js';
import { clearMarketMates, onMarketMatesChange, setShowWeak, shownFading, strictState } from '/js/mods/pz2qol/marketcalves.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { isListerEnabled, onListerSettingChanged, setListerEnabled } from '/js/mods/pz2qol/lister.js';
import { getPriceBook } from '/js/mods/pz2qol/pricebook.js';
import { GAME_COVERS, stepAside } from '/js/mods/pz2qol/stepaside.js';
import { fmtInt, h, icon, isGamePopupOpen, setClass, setText, tierOf, visibleBox } from '/js/mods/pz2qol/ui.js';
import { panelApi, speciesName, trunc } from '/js/mods/pz2qol/kinpanel.js';

const SCORE_STEPS = [0, 50, 60, 70, 80, 90];

export function next(list, value) {
    const i = list.indexOf(value);
    return list[(i + 1) % list.length];
}

export function safe(label, fn) {
    return () => {
        try {
            fn();
        }
        catch (err) {
            reportError('ui', `"${label}" failed`, err);
        }
    };
}

// Pill button: optional icon, label, optional live count bubble.
export function chip(label, tooltip, onClick, iconName) {
    const text = h('span.PZ2QoL_chipText', { text: label });
    const count = h('span.PZ2QoL_chipCount');
    const c = h('div.PZ2QoL_chip', { title: tooltip, onClick: safe(label, () => onClick(c)) },
        iconName ? icon(iconName, 'brown', 'sm') : null, text, count);
    c.__text = text;
    c.__count = count;
    return c;
}

export function setChip(c, on, label, count) {
    setClass(c, 'on', on);
    if (label != undefined) setText(c.__text, label);
    const showCount = count != undefined && count !== '';
    setClass(c.__count, 'show', showCount);
    if (showCount) setText(c.__count, String(count));
}

// Segmented control: one option active.
export function segmented(label, options, onPick) {
    const items = options.map(o => {
        const item = h('div.PZ2QoL_segItem', { text: o.label, title: o.tooltip, onClick: safe(o.label, () => onPick(o.value)) });
        item.__value = o.value;
        return item;
    });
    const node = h('div.PZ2QoL_segmented', null, label ? h('div.PZ2QoL_segLabel', { text: label }) : null, items);
    node.__set = value => items.forEach(i => setClass(i, 'on', i.__value === value));
    return node;
}

// Collapsible bars: a small toggle at the left; collapsed shows one line.
function collapsedKey(key) {
    return `PZ2QoL.collapsed.${key}`;
}
function loadCollapsed(key) {
    try {
        return window.localStorage && window.localStorage.getItem(collapsedKey(key)) === 'true';
    }
    catch (e) {
        return false;
    }
}
function saveCollapsed(key, on) {
    try {
        if (window.localStorage) window.localStorage.setItem(collapsedKey(key), on ? 'true' : 'false');
    }
    catch (e) {
        // session only
    }
}
export function collapser(bar, key, title) {
    const arrow = h('div.PZ2QoL_collapseArrow', { text: '▾' });
    const label = h('div.PZ2QoL_collapseLabel', { text: title });
    const toggle = h('div.PZ2QoL_collapse', { title: 'Show or hide the mod toolbar', onClick: () => set(!bar.classList.contains('collapsed')) }, arrow, label);
    function set(on) {
        setClass(bar, 'collapsed', on);
        setText(arrow, on ? '▸' : '▾');
        saveCollapsed(key, on);
    }
    set(loadCollapsed(key));
    return toggle;
}

// ---------------------------------------------------------------- market

function applyMarketPreset(preset) {
    for (const [suffix, value] of preset.events) {
        sendScreenEvent(MARKET_EVENT, suffix, value);
    }
    sendScreenEvent(MARKET_EVENT, 'FilterMenuConfirm');
}

const PRESET_ICONS = {
    topGenes: 'IconMedalStandard',
    breeders: 'IconFertility',
    longLived: 'IconLongevity',
    endingSoon: 'TimeRemaining',
    cash: 'Icon_Cash',
    cc: 'Icon_ConservationCredits',
};

function buildMarketBar() {
    const presets = MARKET_PRESETS.map(p => chip(p.label, `${p.tooltip}. Uses the game's own filters, so it covers every page.`, () => applyMarketPreset(p), PRESET_ICONS[p.id]));
    const reset = chip('Reset', 'Reset all market filters', () => sendScreenEvent(MARKET_EVENT, 'ResetAllFilters'), 'reset');
    reset.classList.add('ghost');
    const dim = segmented('Dim below', SCORE_STEPS.map(v => ({ value: v, label: v ? String(v) : 'Off', tooltip: v ? `Fade listings on this page with gene score below ${v}` : 'No dimming' })), v => {
        setMarketDimBelow(v);
        clearMarketMates();
    });
    // a needs notice's dim line: a score off the steps
    const handedOver = h('div.PZ2QoL_segItem.on');
    dim.appendChild(handedOver);
    // a species you keep fades by your breeding standard instead of a step
    const standard = h('div.PZ2QoL_pill.subtle.standard', {
        title: "Listings whose best juveniles with your breeders fall under your breeding standard (your best pair's young less 10, as Auto mode judges a newcomer) are faded, and so is any with 0% fertility. The Dim below steps are for a species you don't keep yet.",
    });
    // a notice's Market: the listings whose calves miss its floor are hidden
    const strictText = h('span');
    const strictToggle = chip('Show them', 'Show the hidden listings, faded', () => setShowWeak(!strictState().showWeak));
    const strict = h('div.PZ2QoL_pill.subtle.standard', {
        title: "From a notice: the listings whose juveniles with the animals they would breed with fall under the minimum the notice asks for are hidden (a male by his average over the females, as he fathers every litter). Only CC listings with fertility above 0% are asked for: a juvenile's fertility and immunity come from how unlike its parents' genes are, so higher minimums would hide good mates.",
    }, strictText, strictToggle);
    const syncDim = () => {
        const below = getMarketDimBelow();
        const fading = shownFading();
        const offStep = !SCORE_STEPS.includes(below);
        dim.style.display = fading.others || fading.standard == null ? '' : 'none';
        dim.__set(offStep ? null : below);
        handedOver.style.display = offStep ? '' : 'none';
        setText(handedOver, offStep ? String(below) : '');
        handedOver.title = `From a needs notice: listings with gene score below ${below} are faded. Pick a step to replace it.`;
        standard.style.display = fading.standard == null ? 'none' : '';
        setText(standard, typeof fading.standard === 'number' ? `Faded: juveniles < ${fading.standard} (your standard)` : 'Faded: juveniles under your standard');
        const st = strictState();
        strict.style.display = st.on ? '' : 'none';
        setText(strictText, st.showWeak ? `Showing listings with juveniles under ${st.floor}, faded` : `${st.hidden} hidden: juveniles under ${st.floor}`);
        setChip(strictToggle, false, st.showWeak ? 'Hide them' : 'Show them');
        strictToggle.style.display = st.showWeak || st.hidden ? '' : 'none';
    };
    onMarketDimChange(syncDim);
    onMarketMatesChange(syncDim);
    syncDim();
    const prices = h('div.PZ2QoL_pill.subtle.prices');
    const bar = h('div.PZ2QoL_bar.PZ2QoL_card.market');
    bar.appendChild(collapser(bar, 'market', 'Quick filters'));
    bar.appendChild(h('div.PZ2QoL_expandOnly', null, presets, reset, h('div.PZ2QoL_divider'), dim, standard, strict));
    bar.appendChild(h('div.PZ2QoL_flex1'));
    bar.appendChild(prices);
    let lastCount = -1;
    bar.__updateSummary = () => {
        const total = getPriceBook().filter(l => l.isCC).length;
        setText(prices, `${fmtInt(total)} prices recorded`);
        if (lastCount >= 0 && total > lastCount) {
            // brief pulse when new prices arrive
            prices.classList.remove('pulse');
            void prices.offsetWidth;
            prices.classList.add('pulse');
        }
        lastCount = total;
    };
    return bar;
}

// --------------------------------------------------------------- storage

const SELL_ADVICE_TIP = "The animals the breeding programme advises letting go, in the zoo or in storage: their young would score well below your best pair's, with better ones breeding in their place. Click to cycle: all of them, the ones for the market, the ones to release, the ones to quick sell, then off. How an animal was bought decides which (one adopted for cash can't be released), so where the Market desk's Check storage has asked the game, its answer decides; for the rest a genetics medal means the market, none means release, and a Frontier zoo means quick sell.";
const SELL_ADVICE_NONE_TIP = "No sell advice yet. It comes from Auto mode's runs in a zoo: each species' run, from a minute after the zoo loads, names the animals in the zoo and in storage that fall short of your best breeders.";

function buildStorageBar() {
    const chips = {};
    const toggles = [
        ['pregnant', 'Pregnant', 'Only pregnant animals', 'IconFertility'],
        ['alpha', 'Alpha', 'Only alphas', 'IconStar'],
        ['adults', 'Adults', "Click to cycle: all adults (hides infants), then fertile adults only (also hides infertile adults, such as elderly animals past breeding age, which the market won't take), then juveniles only, then off", 'Icon_Maturation'],
        ['pairsOnly', 'Has pair', 'Only species where you hold at least one breeding-age male and female', 'IconGender'],
        ['hideListed', 'Not listed', 'Hide animals already listed on the market', 'IconTrade'],
        ['related', 'Kin', 'Kin: only animals with a close relative in storage (same species, from the family records the game keeps)', 'IconGenetics'],
        ['sellAdvice', 'Sell advice', SELL_ADVICE_TIP, 'IconTrade'],
    ];
    // Adults cycles: off -> all adults -> fertile adults -> juveniles -> off
    const ADULTS_NEXT = { off: 'all', all: 'fertile', fertile: 'juvenile', juvenile: 'off' };
    const ADULTS_LABEL = { off: 'Adults', all: 'Adults', fertile: 'Fertile adults', juvenile: 'Juveniles' };
    // Sell advice cycles: off -> all -> for the market -> to release -> to quick sell -> off
    const ADVICE_NEXT = { all: 'market', market: 'release', release: 'quick', quick: false };
    const ADVICE_LABEL = { all: 'Sell advice', market: 'Advice: market', release: 'Advice: release', quick: 'Advice: quick sell' };
    for (const [key, label, tip, ic] of toggles) {
        chips[key] = chip(label, tip, () => {
            const f = getStorageFilters();
            if (key == 'adults') setStorageFilters({ adults: ADULTS_NEXT[f.adults] || 'all' });
            else if (key == 'sellAdvice') setStorageFilters({ sellAdvice: f.sellAdvice ? ADVICE_NEXT[f.sellAdvice] : 'all' });
            else setStorageFilters({ [key]: !f[key] });
        }, ic);
    }
    chips.surplus = chip('Surplus', 'Animals beyond your best N of each species and sex (by gene score): trade or release candidates. Click to step N; off after the last step.', () => {
        const f = getStorageFilters();
        if (!f.surplusOnly) setStorageFilters({ surplusOnly: true, surplusKeep: SURPLUS_KEEP_STEPS[0] });
        else if (f.surplusKeep == SURPLUS_KEEP_STEPS[SURPLUS_KEEP_STEPS.length - 1]) setStorageFilters({ surplusOnly: false });
        else setStorageFilters({ surplusKeep: next(SURPLUS_KEEP_STEPS, f.surplusKeep) });
    }, 'IconTrade');
    // Sellable cycles: off -> the market -> release -> quick sell -> not sellable -> off
    const SELLABLE_NEXT = { any: 'market', market: 'release', release: 'quick', quick: 'no', no: 'any' };
    const SELLABLE_LABEL = { any: 'Sellable', market: 'Sellable: market', release: 'Sellable: release', quick: 'Sellable: quick sell', no: 'Not sellable' };
    const SELLABLE_TIP = "Click to cycle: the animals for the market (a bronze, silver or gold genetics medal), the ones to release (no medal), the ones only Quick trade takes, the ones no way takes, then off. Where the Market desk's Check storage has asked the game, its answer decides. Never in the first three: animals already listed, shoals (the game's Market trades them as a group), animals being moved, pregnant animals, juveniles, and animals within three years of elderly (the server refuses them).";
    chips.sellable = chip('Sellable', SELLABLE_TIP, () => setStorageFilters({ sellable: SELLABLE_NEXT[getStorageFilters().sellable] || 'market' }), 'IconTrade');
    chips.minScore = chip('Gene ≥ any', 'Minimum gene score; click to step', () => setStorageFilters({ minScore: next(SCORE_STEPS, getStorageFilters().minScore) }), 'IconMedalStandard');
    // one species only: set by the Species board's / Kin planner's Storage button (trade shortcuts)
    chips.species = chip('Species', 'Showing one species (from the Species board). Click to show all again.', () => setStorageFilters({ species: '' }), 'IconAnimals');
    chips.species.classList.add('PZ2QoL_speciesChip');
    const clearChip = chip('Clear', "Clear the mod's storage filters", () => resetStorageFilters(), 'reset');
    clearChip.classList.add('ghost');
    // one chip that cycles, so the bar stays two rows high
    const SORTS = ['none', 'gene', 'breeder'];
    const SORT_LABEL = { none: 'Sort: Game', gene: 'Sort: Gene', breeder: 'Sort: Breeder' };
    const sort = chip('Sort: Game', "Click to cycle: the game's order, best gene score first, best breeder score first", () => setStorageFilters({ sort: next(SORTS, getStorageFilters().sort) }), 'IconMedalStandard');

    const knob = h('div.PZ2QoL_switchKnob');
    const listerSwitch = h('div.PZ2QoL_switch', {
        title: 'Market lister: live prices, a recommended price and "Sell at recommended price" (Franchise only). Listing only starts when you click Sell.',
        onClick: safe('Market lister', () => setListerEnabled(!isListerEnabled())),
    }, h('div.PZ2QoL_switchTrack', null, knob), h('div.PZ2QoL_switchLabel', { text: 'Market lister' }));
    const syncLister = () => setClass(listerSwitch, 'on', isListerEnabled());
    onListerSettingChanged(syncLister);
    syncLister();

    const stats = h('div.PZ2QoL_stats');
    const bar = h('div.PZ2QoL_bar.PZ2QoL_card.storage');
    bar.appendChild(collapser(bar, 'storage', 'Filters'));
    bar.appendChild(h('div.PZ2QoL_expandOnly', null,
        toggles.map(([key]) => chips[key]), chips.sellable, chips.surplus, chips.minScore, sort, clearChip));
    bar.appendChild(h('div.PZ2QoL_flex1'));
    // the species chip sits above the stats, so the filter rows keep their width
    bar.appendChild(h('div.PZ2QoL_statsCol', null, chips.species, stats));
    bar.appendChild(h('div.PZ2QoL_divider'));
    // the Market desk under the lister's switch (2026-10-18; it was in the
    // price panel's header), one column so the filter rows keep their width
    bar.appendChild(h('div.PZ2QoL_listerCol', null, listerSwitch, h('div.PZ2QoL_btn.PZ2QoL_deskBtn', {
        title: 'Market desk: pick and list many animals at once, species by species, with every price and result in one place. Nothing is listed until you press List.',
        onClick: safe('Market desk', () => {
            const desk = panelApi('desk');
            if (desk) desk.open();
        }),
    }, icon('IconTrade', 'brown', 'sm'), h('span', { text: 'Market desk' }))));

    const sync = () => {
        const f = getStorageFilters();
        for (const [key] of toggles) if (key != 'adults' && key != 'sellAdvice') setClass(chips[key], 'on', !!f[key]);
        setChip(chips.sellAdvice, !!f.sellAdvice, ADVICE_LABEL[f.sellAdvice] || 'Sell advice');
        setChip(chips.adults, f.adults != 'off', ADULTS_LABEL[f.adults] || 'Adults');
        setChip(chips.sellable, (f.sellable || 'any') != 'any', SELLABLE_LABEL[f.sellable] || 'Sellable');
        setChip(chips.surplus, f.surplusOnly, f.surplusOnly ? `Surplus · keep ${f.surplusKeep}` : 'Surplus');
        setChip(chips.minScore, f.minScore > 0, f.minScore > 0 ? `Gene ≥ ${f.minScore}` : 'Gene ≥ any');
        setChip(sort, f.sort != 'none', SORT_LABEL[f.sort]);
        setChip(chips.species, !!f.species, f.species ? `${trunc(speciesName(f.species), 24)} only ✕` : 'Species');
        chips.species.style.display = f.species ? '' : 'none';
        setClass(clearChip, 'hiddenSoft', !storageFiltersActive(f));
    };
    onStorageFiltersChanged(() => {
        sync();
        bar.__updateSummary();
    });
    sync();

    const statPill = (label, value, cls) => h(`div.PZ2QoL_stat${cls ? '.' + cls : ''}`, { title: label }, h('div.PZ2QoL_statValue', { text: value }), h('div.PZ2QoL_statLabel', { text: label }));
    bar.__updateSummary = () => {
        const animals = getStorageSource().map(readAnimal);
        const s = storageSummary(animals);
        const f = getStorageFilters();
        const predicates = getStoragePredicates();
        const shown = storageFiltersActive(f) ? applyStorageFilters(animals, f, predicates, getStorageVerdicts()).length : s.count;
        // live counts on the chips (what each filter alone would show)
        const st = speciesStats(animals);
        setChip(chips.pregnant, !!f.pregnant, undefined, animals.filter(a => a.isPregnant).length);
        setChip(chips.alpha, !!f.alpha, undefined, animals.filter(a => a.isAlpha).length);
        setChip(chips.adults, f.adults != 'off', undefined, animals.filter(ADULT_STAGES[f.adults] || ADULT_STAGES.all).length);
        setChip(chips.pairsOnly, !!f.pairsOnly, undefined, animals.filter(a => (st.get(a.species || '?') || {}).pairs > 0).length);
        setChip(chips.surplus, f.surplusOnly, undefined, surplusChipCount(animals, f));
        setChip(chips.hideListed, !!f.hideListed, undefined, animals.filter(a => !isOnMarket(a)).length);
        if (f.species) setChip(chips.species, true, undefined, animals.filter(a => normSpecies(a.species) === normSpecies(f.species)).length);
        // count for the state the chip is in (off: how many are sellable),
        // and why the rest aren't in the tooltip
        const reasons = {};
        for (const a of animals) for (const r of sellBlockers(a)) reasons[r] = (reasons[r] || 0) + 1;
        const verdictNow = getStorageVerdicts();
        const verdictFor = a => (verdictNow ? verdictNow(a) : null);
        const sellable = animals.filter(a => tradesSomeWay(a, verdictFor(a)));
        const sellableCount = sellable.length;
        const cautioned = sellable.filter(cautionOf).length;
        const shownWay = TRADE_WAYS[f.sellable];
        setChip(chips.sellable, (f.sellable || 'any') != 'any', undefined,
            f.sellable == 'no' ? animals.length - sellableCount : shownWay ? animals.filter(a => shownWay(a, verdictFor(a))).length : sellableCount);
        const why = Object.keys(SELL_BLOCKERS).filter(r => reasons[r]).map(r => `${reasons[r]} ${SELL_BLOCKERS[r].toLowerCase()}`);
        const frontier = animals.filter(a => !sellBlockers(a).length && isFrontierZoo(a)).length;
        if (frontier) why.push(`${frontier} from a Frontier zoo (Quick trade or Quick release only)`);
        chips.sellable.title = `Sellable now: ${sellableCount} of ${animals.length}.${why.length ? ` Not sellable: ${why.join(', ')}.` : ''}${cautioned ? ` ${cautioned} infertile: the game may refuse them.` : ''} ${SELLABLE_TIP}`;
        // Kin adds the `related` predicate when it has lineage for storage
        setChip(chips.related, !!f.related, undefined, predicates.related ? animals.filter(predicates.related).length : '');
        setClass(chips.related, 'disabled', !predicates.related && !f.related);
        // the breeding programme's advice (selladvice.js adds `sellAdvice` once it has some)
        const way = SELL_ADVICE_WAYS[f.sellAdvice] || SELL_ADVICE_WAYS.all;
        const verdictOf = getStorageVerdicts();
        setChip(chips.sellAdvice, !!f.sellAdvice, undefined, predicates.sellAdvice ? animals.filter(a => predicates.sellAdvice(a) && way(a, verdictOf ? verdictOf(a) : null)).length : '');
        setClass(chips.sellAdvice, 'disabled', !predicates.sellAdvice && !f.sellAdvice);
        chips.sellAdvice.title = predicates.sellAdvice || f.sellAdvice ? SELL_ADVICE_TIP : SELL_ADVICE_NONE_TIP;
        const sig = JSON.stringify([s, shown, storageFiltersActive(f)]);
        if (stats.__sig == sig) return;
        stats.__sig = sig;
        while (stats.firstChild) stats.removeChild(stats.firstChild);
        stats.appendChild(statPill(storageFiltersActive(f) ? `of ${s.count}` : 'animals', storageFiltersActive(f) ? String(shown) : String(s.count), storageFiltersActive(f) ? 'accent' : ''));
        stats.appendChild(statPill('♂', String(s.males), 'male'));
        stats.appendChild(statPill('♀', String(s.females), 'female'));
        stats.appendChild(statPill('pairs', String(s.pairs)));
        stats.appendChild(statPill('avg gene', s.avgScore == null ? '–' : String(s.avgScore), tierOf(s.avgScore)));
    };
    return bar;
}

// ------------------------------------------------------------ placement

const screens = [
    { key: 'market', anchor: '.AnimalMarketMarket_header', content: '.AnimalMarketMarket_content', build: buildMarketBar, bar: null },
    { key: 'storage', anchor: '.AnimalMarketStorage_header', content: '.AnimalMarketStorage_content', build: buildStorageBar, bar: null },
];

// Push the game's list down by exactly the height of our widgets, via a
// stylesheet rule (the game's elements are never restyled directly).
let reserveStyle = null;
const reserved = {};
function reserve(screen, px) {
    px = Math.max(0, Math.round(px));
    if (reserved[screen.key] === px) return;
    reserved[screen.key] = px;
    if (!reserveStyle) {
        reserveStyle = document.createElement('style');
        document.head.appendChild(reserveStyle);
    }
    reserveStyle.textContent = screens
        .filter(s => reserved[s.key] != undefined)
        .map(s => `.PZ2QoL ${s.content} { margin-top: ${reserved[s.key]}px; }`)
        .join('\n');
}

let tick = 0;
function place() {
    tick++;
    const popupOpen = isGamePopupOpen();
    for (const s of screens) {
        try {
            const header = document.querySelector(s.anchor);
            const r = popupOpen ? null : visibleBox(header);
            if (!r) {
                if (s.bar) {
                    s.bar.style.display = 'none';
                    s.bar.__shown = false;
                }
                continue;
            }
            if (!s.bar) {
                s.bar = s.build();
                document.body.appendChild(s.bar);
            }
            s.bar.style.display = 'flex';
            s.bar.style.left = `${Math.round(r.left + 8)}px`;
            s.bar.style.top = `${Math.round(r.bottom + 6)}px`;
            s.bar.style.width = `${Math.round(r.width - 16)}px`;
            // the screen around its header and content
            stepAside(s.bar, GAME_COVERS, `${s.key} toolbar`, header && header.parentElement);
            // reading every stored animal is not free; once a second is plenty
            if (tick % 4 == 1 || !s.bar.__shown) s.bar.__updateSummary();
            s.bar.__shown = true;
            // reserve room for the bar plus the lister panel below it (storage)
            let bottom = s.bar.getBoundingClientRect().bottom;
            const lister = s.key == 'storage' ? document.querySelector('.PZ2QoL_lister') : null;
            if (lister && lister.style.display != 'none') bottom = Math.max(bottom, lister.getBoundingClientRect().bottom);
            reserve(s, bottom - r.bottom + 10);
        }
        catch (e) {
            reportError('ui', 'Toolbar placement failed', e, { silent: true });
        }
    }
}

export function installBars() {
    setInterval(place, 250);
}
