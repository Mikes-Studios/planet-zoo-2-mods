// Score badges on market and storage rows.
//
// Rows are recycled by the game's Repeater and re-rendered by preact, which
// drops foreign DOM children. So badges are (re)applied from two places:
// preact's afterUpdate hook (same tick as the game's render, so no flicker)
// and a slow interval for freshly mounted rows.
import { options } from '/js/common/lib/preact.js';
import { breederScore, geneScore, isAdult, isFrontierZoo, normSpecies, relevantGenes, valueIndex } from '/js/mods/pz2qol/scores.js';
import { FRONTIER_TEXT } from '/js/mods/pz2qol/listercore.js';
import { bestOfYours, createSeenListings } from '/js/mods/pz2qol/marketpickcore.js';
import { GENES, geneBars, h, remPx, tierOf } from '/js/mods/pz2qol/ui.js';
import { contextKey, MARKET_LIST_KEY, readAnimal, STORAGE_LIST_KEY } from '/js/mods/pz2qol/game.js';
import { reportError } from '/js/mods/pz2qol/errors.js';
import { adviceFor } from '/js/mods/pz2qol/selladvice.js';
import { adviceWhy } from '/js/mods/pz2qol/advicecore.js';
import { callAll } from '/js/mods/pz2qol/storecore.js';
import { isHudPage } from '/js/mods/pz2qol/kinhooks.js';
import { bestCalvesFor, calvesFor, floorFor, judgedByStandard, knowsMates, listingId, noteMarketRows, strictWeak, yoursCalvesFor } from '/js/mods/pz2qol/marketcalves.js';

const ROW_SELECTOR = '.MarketAnimalListItem_root';
const DIMMED = 'PZ2QoL_dimmed';
let marketDimBelow = 0;
let enabled = true;
let failures = 0;
const dimListeners = new Set();

export function setMarketDimBelow(score) {
    const changed = score !== marketDimBelow;
    marketDimBelow = score;
    refreshBadges();
    if (changed) callAll(dimListeners, score);
}

export function onMarketDimChange(fn) {
    dimListeners.add(fn);
    return () => dimListeners.delete(fn);
}

export function getMarketDimBelow() {
    return marketDimBelow;
}

export function setBadgesEnabled(on) {
    enabled = on;
    if (!on) {
        document.querySelectorAll('.PZ2QoL_badge').forEach(e => e.parentNode && e.parentNode.removeChild(e));
        document.querySelectorAll(`.${DIMMED}`).forEach(e => e.classList.remove(DIMMED));
    }
    refreshBadges();
}

// Finds the DataStore context a row DOM element was rendered for.
function rowContext(rowEl) {
    for (let node = rowEl, depth = 0; node && depth < 5; node = node.parentNode, depth++) {
        let c = node._component;
        while (c) {
            const ctx = c.props && c.props.context;
            if (Array.isArray(ctx)) {
                return ctx;
            }
            c = c._component;
        }
    }
    return null;
}

function screenOf(ctx) {
    const key = contextKey(ctx);
    if (key.startsWith(MARKET_LIST_KEY + '/')) return 'market';
    if (key.startsWith(STORAGE_LIST_KEY + '/')) return 'storage';
    return null;
}

function fmt(v) {
    return v == null ? '–' : String(v);
}

// Badges live inside the row's ListItem element, which the game's CSS
// already makes position: relative. Never change the row root's own
// styles: the game's Repeater positions rows itself, and touching them
// breaks the list layout (rows wrap into a grid).
function badgeHost(rowEl) {
    return rowEl.querySelector('.MarketAnimalListItem_listRoot');
}

function badgeFor(host) {
    for (const child of host.childNodes) {
        if (child.className && child.className.indexOf && child.className.indexOf('PZ2QoL_badge') == 0) return child;
    }
    return null;
}

// At the right end of the name column, level with the species name: the
// row clips anything reaching out of it, and that end of the column is
// empty. Measured on the row, since the column's width follows the list's.
const BADGE_GAP_REM = 0.6;
// Measured once per row width: mid-scroll the row and its label can be a
// frame apart, and each fresh measure would move the badge a few pixels.
function measurePlace(host, badge) {
    const col = host.querySelector('.MarketAnimalListItem_container');
    const label = host.querySelector('.ListItem_label');
    if (!col) return null;
    const row = host.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    if (!row.width || !c.width) return null;
    const place = { width: Math.round(row.width), right: Math.max(0, Math.round(row.right - c.left + BADGE_GAP_REM * remPx())), top: null };
    const l = label && label.getBoundingClientRect();
    if (l && l.height) place.top = Math.max(0, Math.round(l.top - row.top + (l.height - badge.getBoundingClientRect().height) / 2));
    return place;
}

function placeBadge(host, badge) {
    const width = Math.round(host.getBoundingClientRect().width);
    if (!host.__badgePlace || host.__badgePlace.width !== width) host.__badgePlace = measurePlace(host, badge);
    const place = host.__badgePlace;
    // the pass runs for every row twice a second and on each update: write only a new place
    if (!place || badge.__place === place) return;
    badge.__place = place;
    badge.style.left = 'auto';
    badge.style.right = `${place.right}px`;
    if (place.top != null) badge.style.top = `${place.top}px`;
}

// Gameface can leave a badge built on a row scrolled out of view without
// its text; on screen that shows as an empty score pill and no B stat.
function textMissing(host, badge) {
    const stat = badge.querySelector('.PZ2QoL_badgeStat');
    if (!stat) return false;
    const row = host.getBoundingClientRect();
    const onScreen = row.height > 0 && row.top >= 0 && row.bottom <= window.innerHeight;
    return onScreen && stat.getBoundingClientRect().width === 0;
}

// a row element with what it shows; screen 'market' | 'storage' | null
function readRow(rowEl) {
    const ctx = rowContext(rowEl);
    const screen = ctx && screenOf(ctx);
    return { rowEl, screen, a: screen ? readAnimal(ctx) : null };
}

const sexOf = a => (Number(a.gender) === 0 ? 'm' : Number(a.gender) === 1 ? 'f' : '');
const zeroFertility = a => !!(a.genes && a.genes.fertility === 0);

// this row's tags: on the Market { best: { basis, score, of }, value: true },
// on the Storage window { best: { basis: 'yours', score }, advice: { keep, reason, young } }
function tagsOf(a, screen, picks) {
    const id = listingId(a);
    if (screen == 'storage') {
        const yours = picks && picks.yours && picks.yours.get(normSpecies(a.species));
        const p = yours && yours[sexOf(a)];
        const best = p && p.id === id ? { basis: 'yours', score: p.score } : null;
        const w = adviceFor(a);
        const advice = w ? { keep: w.keep, reason: w.reason, young: w.young } : null;
        return best || advice ? { best, advice } : null;
    }
    const bySex = picks && picks.market && picks.market.get(normSpecies(a.species));
    const p = bySex && bySex[sexOf(a)];
    if (!p) return null;
    const best = p.best === id ? { basis: p.basis, score: p.score, of: p.of } : null;
    const value = p.value === id;
    return best || value ? { best, value } : null;
}

// a row's calves: a Market listing's with your breeders; one of your own on
// the Storage window as the park judged it, by the same rule
function calvesOfRow(a, screen) {
    if (screen == 'market') {
        const score = calvesFor(a);
        return score == null ? null : { score, best: bestCalvesFor(a) };
    }
    return screen == 'storage' ? yoursCalvesFor(a) : null;
}

function applyToRow({ rowEl, screen, a }, picks) {
    const host = badgeHost(rowEl);
    if (!host) return null;
    let badge = badgeFor(host);
    if (!screen || !enabled) {
        if (badge) host.removeChild(badge);
        host.classList.remove(DIMMED);
        return null;
    }
    const g = geneScore(a);
    const b = breederScore(a);
    const v = screen == 'market' ? valueIndex(a) : null;
    const tags = tagsOf(a, screen, picks);
    const c = calvesOfRow(a, screen);
    const calves = c ? c.score : null;
    const bestCalves = c ? c.best : null;
    const floor = screen == 'market' ? floorFor(a) : null;
    // Rebuild only when something visible changed (rows re-render often).
    const key = [screen, g, b, v, JSON.stringify(tags), calves, bestCalves, floor, ...GENES.map(x => a.genes[x.id])].join('|');
    if (!badge || badge.__key != key || textMissing(host, badge)) {
        const fresh = buildBadge(a, screen, g, b, v, tags, calves, bestCalves, floor);
        fresh.__key = key;
        if (badge) host.replaceChild(fresh, badge);
        else host.appendChild(fresh);
        badge = fresh;
    }
    placeBadge(host, badge);
    // one fade at a time: by its best calves against your standard (Auto
    // mode's) where it can be judged so, not while its genes are still read;
    // else by the player's Dim below step on its own score. A 0% fertility
    // gene never breeds
    const shouldDim = screen == 'market' && (zeroFertility(a) || strictWeak(a) || (judgedByStandard(a)
        ? bestCalves != null && bestCalves < floor
        : marketDimBelow > 0 && (g == null || g < marketDimBelow)));
    // preact rewrites the host's className on a state change; afterUpdate puts this back in the same tick
    if (host.classList.contains(DIMMED) != shouldDim) host.classList.toggle(DIMMED, shouldDim);
    return a;
}

function buildBadge(a, screen, g, b, v, tags, calves, bestCalves, floor) {
    const tips = [`Gene score ${fmt(g)} (average of ${relevantGenes(a).join(', ') || 'no genes'})`, `Breeder score ${fmt(b)} (fertility-weighted)`];
    if (calves != null) {
        tips.push(`Juveniles ${calves}: ${sexOf(a) === 'm' ? 'his average juvenile score with your females (he fathers every litter)' : 'her best juvenile score with your males'}`
            + (floor != null ? `; faded when its best juveniles fall under ${floor}, your breeding standard` : ''));
    }
    if (v != null) tips.push(`Value ${v}: gene score per ${a.isCC ? '100 CC' : '1,000 cash'}`);
    const best = tags && tags.best;
    if (best && best.basis === 'yours') {
        tips.push(`Best of your ${sexOf(a) === 'm' ? 'males' : 'females'} on this screen: ${sexOf(a) === 'm' ? 'the best average juveniles with your females' : 'the best juveniles with your males'} (${best.score}), the same score a Market listing gets`);
    }
    else if (best) {
        tips.push(best.basis === 'calves'
            ? `Best buy of this sex among the ${best.of} you paged through: ${sexOf(a) === 'm' ? 'the best average juveniles with your females' : 'the best juveniles with your males'} (${best.score})`
            : `Best buy of this sex by its own genes (${best.score}): none of yours of the other sex in the zoo or the trade centre to judge its juveniles by`);
    }
    if (screen == 'market' && zeroFertility(a)) tips.push('0% fertility: it never breeds, so it is never a pick');
    if (tags && tags.value) tips.push('Best value of this sex: the most genes per price among those that meet your standard');
    const advice = tags && tags.advice;
    // one adopted for cash goes only by Quick trade: no market, no release
    const quick = advice && !advice.keep && isFrontierZoo(a);
    if (advice) tips.push(`${advice.keep ? 'Keep for later' : quick ? 'Let go' : 'Sell'} (your breeding programme): ${adviceWhy(advice.reason, advice.young)}${quick ? `. ${FRONTIER_TEXT}` : ''}`);
    return h(`div.PZ2QoL_badge.${tierOf(g)}.${screen}${best ? '.best' : ''}`, { title: tips.join(String.fromCharCode(10)) },
        h('div.PZ2QoL_badgeScore', { text: fmt(g) }),
        geneBars(a.genes, relevantGenes(a)),
        h('div.PZ2QoL_badgeStat', null, h('span.PZ2QoL_badgeKey', { text: 'B' }), h('span', { text: fmt(b) })),
        // a male's average, and his best match where it differs: the fading follows the best
        calves != null && h('div.PZ2QoL_badgeStat.calves', null, h('span.PZ2QoL_badgeKey', { text: 'J' }),
            h('span', { text: bestCalves != null && bestCalves !== calves ? `${calves} \u00b7 best ${bestCalves}` : String(calves) })),
        v != null && h('div.PZ2QoL_badgeStat.value', null, h('span.PZ2QoL_badgeKey', { text: 'V' }), h('span', { text: String(v) })),
        best && h('div.PZ2QoL_badgeTag.best', { text: best.basis === 'yours' ? 'Best of yours' : `Best buy · ${best.basis === 'calves' ? 'juveniles' : 'genes'} ${best.score} (of ${best.of})` }),
        tags && tags.value && h('div.PZ2QoL_badgeTag.value', { text: 'Best value' }),
        advice && h(`div.PZ2QoL_badgeTag.${advice.keep ? 'keep' : 'sell'}`, { text: advice.keep ? 'Keep' : quick ? 'Quick trade' : 'Sell' }));
}

// the picks are the best of every page paged through on one Market visit
const noteSeen = createSeenListings();
// and the best of yours of every row scrolled through on one Storage visit
const noteSeenYours = createSeenListings({ pick: bestOfYours });

// your own animals on the Storage window, as bestOfYours judges them
function yoursPicksOf(stored) {
    return noteSeenYours(stored.map(a => {
        const c = yoursCalvesFor(a);
        return { id: listingId(a), species: normSpecies(a.species), sex: sexOf(a), adult: isAdult(a), infertile: zeroFertility(a), calves: c ? c.score : null };
    }));
}

// a Market row as the picks judge it, known as itself (marketcalves listingId)
function pickRow(a) {
    return {
        id: listingId(a), species: normSpecies(a.species), sex: sexOf(a), adult: isAdult(a), infertile: zeroFertility(a),
        gene: geneScore(a), breeder: breederScore(a), value: valueIndex(a),
        calves: calvesFor(a), bestCalves: bestCalvesFor(a), floor: floorFor(a), known: knowsMates(a),
    };
}

function picksOf(market) {
    return noteSeen(market.map(pickRow));
}

let cachedPicks = null;
export function refreshBadges() {
    try {
        const rows = Array.from(document.querySelectorAll(ROW_SELECTOR), readRow);
        const market = rows.filter(row => row.screen == 'market').map(row => row.a);
        const stored = rows.filter(row => row.screen == 'storage').map(row => row.a);
        noteMarketRows(market);
        cachedPicks = { market: picksOf(market), yours: yoursPicksOf(stored) };
        for (const row of rows) {
            applyToRow(row, cachedPicks);
        }
        failures = 0;
    }
    catch (e) {
        if (++failures == 3) {
            reportError('ui', 'Score badges failed repeatedly and were turned off', e);
            enabled = false;
        }
    }
}

// Rows affected by a component update: rows inside it, or the row that
// contains it (e.g. when only the row's ListItem re-rendered).
function rowsUnder(component) {
    const base = component && component.base;
    if (!base || !base.querySelectorAll) return [];
    for (let n = base, i = 0; n && i < 8; n = n.parentNode, i++) {
        if (n.classList && n.classList.contains('MarketAnimalListItem_root')) return [n];
    }
    return base.querySelectorAll(ROW_SELECTOR);
}

export function installBadges() {
    // market and storage rows only exist on the hub page
    if (isHudPage()) return true;
    const previous = options.afterUpdate;
    options.afterUpdate = function (component, ...rest) {
        if (previous) previous.call(this, component, ...rest);
        if (!enabled) return;
        try {
            for (const rowEl of rowsUnder(component)) {
                applyToRow(readRow(rowEl), cachedPicks);
            }
        }
        catch (e) {
            // the interval pass reports persistent failures
        }
    };
    setInterval(refreshBadges, 500);
}
