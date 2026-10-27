// Market price analysis and price recommendation. Pure functions, no game
// imports, so they run under Node tests.
//
// A "listing" is { id, species, gender, maturity, isShoal, isExhibit, score,
// medal, colormorph, price, isCC, source: 'market' | 'history', seenAt }. Its id is listingKey(),
// not the game's row id: market and history rows reuse the same row ids on
// every page (they are screen slots), so keying by them kept only one page.
import { Gender, geneScore, Maturity } from './scores.js';

export const LifeStage = { Juvenile: 'juvenile', Adult: 'adult', Elderly: 'elderly' };

export function lifeStage(maturity) {
    if (maturity == Maturity.Infant) return LifeStage.Juvenile;
    if (maturity == Maturity.Elderly) return LifeStage.Elderly;
    return LifeStage.Adult;
}

export function median(values) {
    const v = values.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    if (v.length == 0) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// The genetics medal the game shows in the market's Rating column (row field
// `ratings`: 'none' | 'bronze' | 'silver' | 'gold'). undefined when unknown:
// rows recorded before 1.3, or shoals (the game shows a dash for them).
export const MEDALS = ['none', 'bronze', 'silver', 'gold'];
const MEDAL_RANK = { none: 0, bronze: 1, silver: 2, gold: 3 };
const MEDAL_LABEL = { none: 'Unranked', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

export function medalOf(a) {
    if (!a || a.isShoal || typeof a.medal !== 'string') return undefined;
    const m = a.medal.toLowerCase();
    return MEDAL_RANK[m] != undefined ? m : undefined;
}

export function medalLabel(m) {
    return MEDAL_LABEL[m] || '';
}

// "1,240": thousands separators without toLocaleString (unsure in Gameface).
function fmt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Round to a price a person would pick: 5s under 500, 10s under 5,000, 50s above.
export function nicePrice(p) {
    if (!(p > 0)) return p;
    const step = p < 500 ? 5 : p < 5000 ? 10 : 50;
    return Math.max(step, Math.round(p / step) * step);
}

// the slopes grow with the square of the points: the fit takes at most this many, spread over x
const FIT_SAMPLE = 60;

function spreadSample(points, xOf, size) {
    if (points.length <= size) return points;
    const sorted = points.slice().sort((a, b) => xOf(a) - xOf(b));
    return Array.from({ length: size }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (size - 1))]);
}

// Theil-Sen fit of price against x (pairs at least minGap apart): robust to a
// few odd listings. The slope is never negative: more never sells for less.
function fitPrice(points, xOf, minGap) {
    const pts = points.filter(p => xOf(p) != null && p.price > 0);
    if (pts.length < 4) return null;
    const sample = spreadSample(pts, xOf, FIT_SAMPLE);
    const slopes = [];
    for (let i = 0; i < sample.length; i++) {
        for (let j = i + 1; j < sample.length; j++) {
            const dx = xOf(sample[j]) - xOf(sample[i]);
            if (Math.abs(dx) >= minGap) slopes.push((sample[j].price - sample[i].price) / dx);
        }
    }
    if (slopes.length < 3) return null;
    const slope = Math.max(0, median(slopes));
    const intercept = median(pts.map(p => p.price - slope * xOf(p)));
    return { slope, intercept, predict: x => intercept + slope * x };
}

// Price against gene score.
export function fitPriceVsScore(points) {
    return fitPrice(points, p => p.score, 3);
}

// Stable id for a market or history row, built from what the row shows.
// Two listings equal in every field merge into one entry, which is rare.
export function listingKey(a) {
    if (!a || !a.species || !(a.price > 0)) return undefined;
    const g = a.genes || {};
    const num = v => typeof v === 'number' && isFinite(v) ? Math.round(v * 10000) : '';
    return [a.species, a.name == undefined ? '' : String(a.name), a.gender, a.maturity,
        a.isShoal ? 1 : 0, a.isExhibit ? 1 : 0,
        num(g.size), num(g.longevity), num(g.fertility), num(g.immunity),
        a.price, a.isCC ? 1 : 0].join('|');
}

// Fewest comparables to price from a group alone.
const MIN_COMPS = 3;

// Guessed price of each medal relative to Bronze, used only for a medal step
// the price book has no ratio for. Guesses, not measured: Silver about 1.6x
// and Gold about 3x Bronze (the medal is the game's genetic rating, the most
// visible quality signal in the market list), Unranked a little under Bronze.
export const DEFAULT_MEDAL_VALUE = Object.freeze({ none: 0.8, bronze: 1, silver: 1.6, gold: 3 });
const DEFAULT_SOURCE = 'default guess';

// Median price of medal `hi` over medal `lo` in one list, when both have 2+.
const MIN_PER_MEDAL = 2;
function observedRatio(list, lo, hi) {
    const hiP = list.filter(l => medalOf(l) == hi).map(l => l.price);
    const loP = list.filter(l => medalOf(l) == lo).map(l => l.price);
    if (hiP.length < MIN_PER_MEDAL || loP.length < MIN_PER_MEDAL) return null;
    const r = median(hiP) / median(loP);
    return isFinite(r) && r > 0 ? r : null;
}
const clampRatio = (r, steps = 1) => Math.max(1, Math.min(4 ** steps, r));

// How much more the next medal up sells for: the median price of medal
// `upper` over the median of the medal below it. Taken from the narrowest
// group with 2+ listings of both medals (same sex and age group, then the
// species), else the median of that ratio over every species in the book.
// Clamped to 1..4: a better medal is never cheaper. null when unknown.
export function medalStepRatio(upper, groups, allListings) {
    if (!(MEDAL_RANK[upper] > 0)) return null;
    const lower = MEDALS[MEDAL_RANK[upper] - 1];
    for (const g of groups) {
        const r = observedRatio(g.list, lower, upper);
        if (r != null) return { ratio: clampRatio(r), source: g.source };
    }
    const bySpecies = new Map();
    for (const l of allListings || []) {
        if (!l.isCC || !(l.price > 0) || medalOf(l) == undefined) continue;
        if (!bySpecies.has(l.species)) bySpecies.set(l.species, []);
        bySpecies.get(l.species).push(l);
    }
    const ratios = [];
    for (const list of bySpecies.values()) {
        const r = observedRatio(list, lower, upper);
        if (r != null) ratios.push(r);
    }
    return ratios.length ? { ratio: clampRatio(median(ratios)), source: 'all species' } : null;
}

// Price factor from medal `from` to medal `to` (to/from; below 1 going down).
//   1. observed directly between the two medals in the groups (this sex and
//      age group, then this species);
//   2. else chained step by step (Bronze→Silver→Gold), each step from the
//      groups, then all species, then DEFAULT_MEDAL_VALUE (guessed: true).
// { ratio, source, guessed } or null for an unknown medal.
export function medalRatio(from, to, groups, allListings) {
    const a = MEDAL_RANK[from];
    const b = MEDAL_RANK[to];
    if (a == undefined || b == undefined) return null;
    if (a == b) return { ratio: 1, source: 'same medal', guessed: false };
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let up = null;
    for (const g of groups) {
        const r = observedRatio(g.list, MEDALS[lo], MEDALS[hi]);
        if (r != null) {
            up = { ratio: clampRatio(r, hi - lo), source: g.source, guessed: false };
            break;
        }
    }
    if (!up) {
        let ratio = 1;
        const sources = [];
        for (let k = lo + 1; k <= hi; k++) {
            const step = medalStepRatio(MEDALS[k], groups, allListings)
                || { ratio: DEFAULT_MEDAL_VALUE[MEDALS[k]] / DEFAULT_MEDAL_VALUE[MEDALS[k - 1]], source: DEFAULT_SOURCE };
            ratio *= step.ratio;
            if (!sources.includes(step.source)) sources.push(step.source);
        }
        up = { ratio, source: sources.join(' + '), guessed: sources.includes(DEFAULT_SOURCE) };
    }
    return b > a ? up : Object.assign({}, up, { ratio: 1 / up.ratio });
}

// ------------------------------------------------------------ colour morphs
// Market, history and storage rows carry `colormorphLabel`: what the game's
// info panel shows under "Colour morph" (it translates it, so it may be a
// loc token). Its values are not known yet (guess): '' or a "normal"-like
// word for an animal without a morph, else the morph's name ("Albino").
// The game has no field for a carried (hidden) morph.
const NORMAL_MORPH_WORDS = /\b(normal|default|standard|regular|none|no colou?r ?morph|no colou?r ?variant)\b/i;
const MORPH_TOKEN = /_variation_colou?rmorph\d/i;
export const DEFAULT_MORPH_PREMIUM = 2;

export function morphLabelOf(a) {
    const v = a && a.colormorph;
    return typeof v === 'string' ? v.trim() : '';
}

// The label most of a species' listings carry, when clearly dominant (60 %+
// of all its listings, labelled or not; a colour morph is rare: about 1 in
// 40 young): that one is "normal" whatever it says. '' when unclear.
export function normalMorphLabel(species, listings) {
    const counts = new Map();
    let total = 0;
    for (const l of listings || []) {
        if (l.species != species) continue;
        const label = morphLabelOf(l);
        total++;
        // listings without a label (or recorded before labels) count against
        if (!label || MORPH_TOKEN.test(label)) continue;
        counts.set(label, (counts.get(label) || 0) + 1);
    }
    let best = '', n = 0;
    for (const [label, c] of counts) {
        if (c > n) {
            best = label;
            n = c;
        }
    }
    return n >= 3 && n / total >= 0.6 ? best : '';
}

// '' for no colour morph (normal), else the morph's label. `normal`: the
// species' usual label (normalMorphLabel), which counts as normal too.
export function morphOf(a, normal = '') {
    const label = morphLabelOf(a);
    if (!label) return '';
    if (MORPH_TOKEN.test(label)) return label;
    if (normal && label === normal) return '';
    if (NORMAL_MORPH_WORDS.test(label.replace(/[[\]_|]/g, ' '))) return '';
    return label;
}

function morphRatioIn(list, normal) {
    const morphP = list.filter(l => morphOf(l, normal) !== '').map(l => l.price);
    const normalP = list.filter(l => morphOf(l, normal) === '').map(l => l.price);
    if (morphP.length < 2 || normalP.length < 2) return null;
    const r = median(morphP) / median(normalP);
    return isFinite(r) && r > 0 ? Math.max(1, Math.min(10, r)) : null;
}

// How much more a colour morph sells for than a normal animal: median morph
// price over median normal price, in this species (2+ of each), else the
// median of that over all species, else DEFAULT_MORPH_PREMIUM (guessed).
export function morphPremium(species, listings) {
    const bySpecies = new Map();
    for (const l of listings || []) {
        if (!l.isCC || !(l.price > 0)) continue;
        if (!bySpecies.has(l.species)) bySpecies.set(l.species, []);
        bySpecies.get(l.species).push(l);
    }
    const ratioOf = sp => morphRatioIn(bySpecies.get(sp) || [], normalMorphLabel(sp, bySpecies.get(sp) || []));
    const own = ratioOf(species);
    if (own != null) return { ratio: own, source: 'this species', guessed: false };
    const all = [];
    for (const sp of bySpecies.keys()) {
        if (sp == species) continue;
        const r = ratioOf(sp);
        if (r != null) all.push(r);
    }
    if (all.length) return { ratio: median(all), source: 'all species', guessed: false };
    return { ratio: DEFAULT_MORPH_PREMIUM, source: DEFAULT_SOURCE, guessed: true };
}

// The listings that are comparable to `animal`, best first. Always the same
// species, CC, shoal or not, and never the animal's own listing.
//   When the animal's medal and some listings' medals are known:
//     1. 3+ listings of the same medal: same sex and age group, then same age
//        group (any sex), then the whole species (medalMode 'same');
//     2. else the narrowest of those groups with 3+ medal listings in all:
//        the same medal plus the nearest other medals, their prices scaled by
//        medalRatio() (medalMode 'scaled'); the whole species with fewer than
//        3 when no group has 3.
//     Fewer than 3 rated listings in the species but some unrated: the
//     tiers below over all of them, other medals scaled (medalMode 'unrated').
//   Otherwise (no medals recorded), as before medals were known:
//     tier 1: same gender and life stage; tier 2: same gender; tier 3: any.
// Scaled entries are copies with the scaled `price`, the listed `rawPrice`
// and `medalFactor`.
// Colour morphs first: a normal animal is compared with normal listings
// only; a morph with 3+ listings of the same morph, else 3+ of any morph,
// else normal listings x morphPremium() (morphMode 'same' | 'anyMorph' |
// 'scaled'). Listings recorded without a label count as normal.
export function comparables(animal, listings) {
    const normal = normalMorphLabel(animal.species, listings);
    const morph = morphOf(animal, normal);
    const own = l => l.species == animal.species;
    const cls = l => morphOf(l, normal);
    const ownKey = listingKey(animal);
    const usable = l => own(l) && l.isCC && l.price > 0 && l.id != animal.id && l.id != ownKey && !!l.isShoal == !!animal.isShoal;
    const normalPool = listings.filter(l => !own(l) || cls(l) === '');
    if (!morph) {
        // a normal animal: colour-morph listings would lift its price
        const comp = comparablesIn(animal, normalPool);
        const left = listings.filter(l => usable(l) && cls(l) !== '').length;
        if (left) comp.morphLeftOut = left;
        return comp;
    }
    const sameN = listings.filter(l => usable(l) && cls(l) === morph).length;
    if (sameN >= MIN_COMPS) {
        return Object.assign(comparablesIn(animal, listings.filter(l => !own(l) || cls(l) === morph)), { morph, morphMode: 'same', morphCount: sameN });
    }
    const anyN = listings.filter(l => usable(l) && cls(l) !== '').length;
    if (anyN >= MIN_COMPS) {
        return Object.assign(comparablesIn(animal, listings.filter(l => !own(l) || cls(l) !== '')),
            { morph, morphMode: 'anyMorph', morphCount: anyN, sameMorphCount: sameN });
    }
    // too few colour-morph listings: normal ones, scaled by the morph premium
    const comp = comparablesIn(animal, normalPool);
    const premium = morphPremium(animal.species, listings);
    comp.list = comp.list.map(l => Object.assign({}, l, { price: l.price * premium.ratio, rawPrice: l.rawPrice ?? l.price, morphScale: premium.ratio }));
    return Object.assign(comp, { morph, morphMode: 'scaled', morphFactor: premium, sameMorphCount: sameN });
}

// comparables() among one pool of listings (one colour-morph class).
function comparablesIn(animal, listings) {
    const stage = lifeStage(animal.maturity);
    // A storage animal that is already listed shows up on the market too.
    const ownKey = listingKey(animal);
    const base = listings.filter(l => l.species == animal.species && l.isCC && l.price > 0
        && l.id != animal.id && l.id != ownKey && !!l.isShoal == !!animal.isShoal);
    const group = base.filter(l => l.gender == animal.gender && lifeStage(l.maturity) == stage);
    const medal = medalOf(animal);
    const rated = l => medalOf(l) != undefined;
    const ratedCount = medal != undefined ? base.filter(rated).length : 0;
    const ratioGroups = [{ list: group, source: 'this sex and age group' }, { list: base, source: 'this species' }];
    if (ratedCount > 0 && ratedCount < MIN_COMPS && ratedCount < base.length) {
        // too few rated listings to price by medal alone: the unrated ones count too
        return unratedComparables(animal, medal, sexAgeTiers(animal, base, group), ratioGroups, listings);
    }
    if (ratedCount > 0) {
        const pools = [
            { tier: 1, scope: 'same sex and age group', list: group },
            { tier: 2, scope: 'same age group, any sex', list: base.filter(l => lifeStage(l.maturity) == stage) },
            { tier: 3, scope: 'any sex or age', list: base },
        ];
        for (const p of pools) {
            const same = p.list.filter(l => medalOf(l) == medal);
            if (same.length >= MIN_COMPS) {
                return { tier: p.tier, label: `same medal, ${p.scope}`, medal, medalMode: 'same', sameCount: same.length, list: same };
            }
        }
        const pool = pools.find(p => p.list.filter(rated).length >= MIN_COMPS) || pools[2];
        return Object.assign(scaledComparables(animal, medal, pool, ratioGroups, listings), { tier: pool.tier });
    }
    return pickTier(sexAgeTiers(animal, base, group));
}

function sexAgeTiers(animal, base, group) {
    return [
        { tier: 1, label: 'same sex and age group', list: group },
        { tier: 2, label: 'same sex', list: base.filter(l => l.gender == animal.gender) },
        { tier: 3, label: 'any sex', list: base },
    ];
}

function pickTier(tiers) {
    return tiers.find(t => t.list.length >= MIN_COMPS) || tiers.find(t => t.list.length > 0) || { tier: 0, label: 'no market data', list: [] };
}

// a single rated listing must not stand in for many unrated ones: all of them count, other medals scaled
function unratedComparables(animal, medal, tiers, ratioGroups, allListings) {
    const pick = pickTier(tiers);
    let guessed = false;
    const list = pick.list.map(l => {
        const listingMedal = medalOf(l);
        if (listingMedal == undefined || listingMedal == medal) return l;
        const r = medalRatio(listingMedal, medal, ratioGroups, allListings);
        guessed = guessed || r.guessed;
        return Object.assign({}, l, { price: l.price * r.ratio, rawPrice: l.price, medalFactor: r.ratio });
    });
    return Object.assign({}, pick, {
        medal,
        medalMode: 'unrated',
        ratedCount: list.filter(l => medalOf(l) != undefined).length,
        sameCount: list.filter(l => medalOf(l) == medal).length,
        guessed,
        list,
    });
}

// Too few listings of the animal's own medal: add the nearest other medals
// (one rank away first, then two, ...) until there are 3, scaling their
// prices to the animal's medal.
function scaledComparables(animal, medal, pool, ratioGroups, allListings) {
    const rank = MEDAL_RANK[medal];
    const same = pool.list.filter(l => medalOf(l) == medal);
    const scaled = [];
    const factors = {};
    for (let d = 1; d < MEDALS.length && same.length + scaled.length < MIN_COMPS; d++) {
        for (const other of [MEDALS[rank - d], MEDALS[rank + d]]) {
            if (!other) continue;
            const list = pool.list.filter(l => medalOf(l) == other);
            if (!list.length) continue;
            const r = medalRatio(other, medal, ratioGroups, allListings);
            factors[other] = { factor: r.ratio, source: r.source, guessed: r.guessed, count: list.length, median: median(list.map(l => l.price)) };
            for (const l of list) scaled.push(Object.assign({}, l, { price: l.price * r.ratio, rawPrice: l.price, medalFactor: r.ratio }));
        }
    }
    return {
        label: `${medalLabel(medal)} from other medals, ${pool.scope}`,
        medal,
        medalMode: 'scaled',
        sameCount: same.length,
        factors,
        guessed: Object.values(factors).some(f => f.guessed),
        scope: pool.tier,
        list: same.concat(scaled),
    };
}

// "Silver adult females", "Gold adult animals", "adult animals". scope: 1
// same sex and age group, 2 same age group, 3 any sex or age.
function groupName(animal, medal, scope = 1) {
    const sex = scope > 1 ? 'animals' : animal.gender == Gender.Male ? 'males' : animal.gender == Gender.Female ? 'females' : 'animals';
    return [medal != undefined ? medalLabel(medal) : '', scope > 2 ? '' : lifeStage(animal.maturity), sex].filter(Boolean).join(' ');
}

function groupSummary(list) {
    const prices = list.map(l => l.price);
    return {
        count: list.length,
        median: median(prices),
        min: prices.length ? Math.min(...prices) : null,
        max: prices.length ? Math.max(...prices) : null,
        medianScore: median(list.map(l => l.score)),
    };
}

// Per-sex and per-medal breakdown of current CC prices for a species, plus
// your own sales.
export function speciesMarketSummary(species, listings) {
    const live = listings.filter(l => l.species == species && l.isCC && l.price > 0 && l.source != 'history');
    const sold = listings.filter(l => l.species == species && l.isCC && l.price > 0 && l.source == 'history');
    return {
        species,
        male: groupSummary(live.filter(l => l.gender == Gender.Male)),
        female: groupSummary(live.filter(l => l.gender == Gender.Female)),
        other: groupSummary(live.filter(l => l.gender != Gender.Male && l.gender != Gender.Female)),
        juvenile: groupSummary(live.filter(l => lifeStage(l.maturity) == LifeStage.Juvenile)),
        all: groupSummary(live),
        history: groupSummary(sold),
        // only the medals seen, best first; empty when no listing has one
        byMedal: Object.fromEntries(MEDALS.slice().reverse()
            .map(m => [m, live.filter(l => medalOf(l) == m)])
            .filter(([, list]) => list.length)
            .map(([m, list]) => [m, Object.assign(groupSummary(list), {
                males: list.filter(l => l.gender == Gender.Male).length,
                females: list.filter(l => l.gender == Gender.Female).length,
            })])),
        // colour morphs listed now: { label: { count, median } } (normal left out)
        byMorph: morphSummary(live, normalMorphLabel(species, listings)),
    };
}

function morphSummary(live, normal) {
    const by = new Map();
    for (const l of live) {
        const m = morphOf(l, normal);
        if (!m) continue;
        if (!by.has(m)) by.set(m, []);
        by.get(m).push(l.price);
    }
    return Object.fromEntries(Array.from(by, ([m, prices]) => [m, { count: prices.length, median: median(prices) }]));
}

export const PRICING_DEFAULTS = Object.freeze({
    undercut: 0.03,       // list a little under the fitted price so it sells
    gamePriceWeightMin: 0, // weight on the game's own value once data is plentiful
    fullConfidenceAt: 6,   // comparables needed to rely on the market alone
    offset: 0,             // player's global adjustment, e.g. -0.1 = 10% under
});

// The player's offset as a label: "-10%", "+20%", "" for none.
export function offsetLabel(offset) {
    const pct = Math.round((offset || 0) * 100);
    return pct ? `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` : '';
}

// Recommends a CC price.
//   animal: plain animal (scores.js shape) with id/species/gender/maturity/genes,
//           and medal when the row shows it
//   listings: price book entries
//   game: { defaultPrice, min, max } from the game's trade listing data
//   opts: overrides for PRICING_DEFAULTS, e.g. { offset: -0.1 }
// The market price is the median of the comparables (scaled to the animal's
// medal when needed), adjusted for gene score (appeal is left out: it is the
// species' value less the seller's welfare and viewing time, not the animal's), kept within 25% of what the comparables span,
// blended with the game's value while data is thin, then the player's
// offset, rounding, and the game's min/max.
export function recommendPrice(animal, listings, game = {}, options = {}) {
    const opts = Object.assign({}, PRICING_DEFAULTS, options);
    const score = geneScore(animal);
    const comp = comparables(animal, listings);
    const list = comp.list;
    const prices = list.map(l => l.price);
    const med = median(prices);
    const medScore = median(list.map(l => l.score));
    let marketPrice = null;
    let method = 'none';
    if (list.length > 0) {
        const fit = score != null ? fitPriceVsScore(list) : null;
        if (fit) {
            marketPrice = fit.predict(score);
            method = 'fit';
        }
        else if (score != null && medScore != null) {
            // About 1% per gene point above or below the typical listing, capped at 40%.
            const adj = Math.max(-0.4, Math.min(0.4, (score - medScore) * 0.01));
            marketPrice = med * (1 + adj);
            method = 'median-adjusted';
        }
        else {
            marketPrice = med;
            method = 'median';
        }
        // never recommend outside what the comparables span by more than 25%
        marketPrice = Math.max(Math.min(...prices) * 0.75, Math.min(Math.max(...prices) * 1.25, marketPrice));
        marketPrice *= 1 - opts.undercut;
    }
    const gameValue = game.defaultPrice > 0 ? game.defaultPrice : null;
    const weight = Math.min(1, list.length / opts.fullConfidenceAt);
    let price;
    if (marketPrice != null && gameValue != null) {
        price = weight * marketPrice + (1 - weight) * gameValue;
    }
    else {
        price = marketPrice ?? gameValue;
    }
    const confidence = confidenceOf(comp, opts.fullConfidenceAt);
    if (price == null) {
        return { price: null, confidence: 'none', reason: 'No market data and no game value', comps: comp, score, gameValue };
    }
    const offset = isFinite(opts.offset) ? opts.offset : 0;
    // the game's own limits always win
    const clamp = p => {
        if (game.min != null) p = Math.max(game.min, p);
        if (game.max != null) p = Math.min(game.max, p);
        return p;
    };
    // the price before the player's offset, for display
    const wanted = nicePrice(price);
    const basePrice = clamp(wanted);
    // the offset applies to the price as shown: -50% of 14,000 capped at 10,000 is 5,000
    const unclamped = nicePrice(basePrice * (1 + offset));
    price = clamp(unclamped);
    const parts = reasonParts(animal, comp, { med, medScore, method, morphName: typeof opts.morphName === 'function' ? opts.morphName : null });
    if (gameValue != null) parts.push(`game value ${gameValue} CC (weight ${Math.round((1 - weight) * 100)}%)`);
    if (offset) parts.push(`your offset ${offsetLabel(offset)} (${basePrice} CC before it)`);
    // a limit held the price, before the offset or after it
    if (price === game.max && (wanted > game.max || unclamped > game.max)) parts.push(`capped at the game's maximum ${fmt(game.max)} CC`);
    if (price === game.min && (wanted < game.min || unclamped < game.min)) parts.push(`raised to the game's minimum ${fmt(game.min)} CC`);
    return {
        price,
        basePrice,
        offset,
        confidence,
        method,
        reason: parts.join('; ') || 'game value only',
        comps: comp,
        medal: medalOf(animal),
        morph: comp.morph || '',
        score,
        gameValue,
        marketPrice: marketPrice != null ? Math.round(marketPrice) : null,
    };
}

const CONF_ORDER = ['none', 'low', 'medium', 'high'];

// high: 6+ comparables of the animal's own medal (or, without medals, sex)
// medium: 3+; low: fewer. Prices scaled from other medals are at most
// medium, and at most low when a step ratio was a default guess; so are
// prices mostly from listings without a medal.
function confidenceOf(comp, fullAt) {
    const n = comp.list.length;
    let c = n >= fullAt && comp.tier <= 2 ? 'high' : n >= MIN_COMPS ? 'medium' : n > 0 ? 'low' : 'none';
    if (comp.medalMode == 'scaled' || comp.medalMode == 'unrated') {
        const cap = comp.guessed ? 'low' : 'medium';
        if (CONF_ORDER.indexOf(c) > CONF_ORDER.indexOf(cap)) c = cap;
    }
    // a colour morph priced from other morphs or from normal listings
    if (comp.morphMode == 'anyMorph' || comp.morphMode == 'scaled') {
        const cap = comp.morphMode == 'scaled' && comp.morphFactor && comp.morphFactor.guessed ? 'low' : 'medium';
        if (CONF_ORDER.indexOf(c) > CONF_ORDER.indexOf(cap)) c = cap;
    }
    return c;
}

// "Albino" from a label, translated when the caller can (opts.morphName).
export function morphText(label, morphName) {
    let t = label;
    if (morphName) {
        try {
            t = morphName(label) || label;
        }
        catch (e) {
            t = label;
        }
    }
    return String(t).replace(/^\[|\]$/g, '');
}

// The text the lister shows under the price: what was compared and how.
function reasonParts(animal, comp, { med, medScore, method, morphName }) {
    const parts = [];
    const list = comp.list;
    if (comp.morph) {
        const name = morphText(comp.morph, morphName);
        if (comp.morphMode == 'same') parts.push(`${name}: ${comp.morphCount} ${name} listing${comp.morphCount == 1 ? '' : 's'}`);
        else if (comp.morphMode == 'anyMorph') parts.push(`${name}: ${comp.sameMorphCount ? `only ${comp.sameMorphCount}` : 'no'} ${name} listed; ${comp.morphCount} colour-morph listings`);
        else if (comp.morphMode == 'scaled') {
            const f = comp.morphFactor;
            const from = f.guessed ? 'guessed ratio' : `ratio from ${f.source}`;
            parts.push(`${name}: ${comp.sameMorphCount ? `only ${comp.sameMorphCount}` : 'no'} ${name} listed; normal × ${f.ratio.toFixed(1)} (${from})`);
        }
    }
    else if (comp.morphLeftOut) {
        parts.push(`${comp.morphLeftOut} colour-morph listing${comp.morphLeftOut == 1 ? '' : 's'} left out`);
    }
    const at = `median ${fmt(med)} CC at gene ${medScore ?? '–'}`;
    if (comp.medalMode == 'same') {
        parts.push(`${list.length} ${groupName(animal, comp.medal, comp.tier)}: ${at}`);
    }
    else if (comp.medalMode == 'scaled') {
        // "No Gold listed among adult males; 4 Silver at median 400 CC ×1.88 (guessed ratio): median 750 CC at gene 60"
        const mine = medalLabel(comp.medal);
        const among = groupName(animal, undefined, comp.scope);
        const head = comp.sameCount ? `Only ${comp.sameCount} ${mine} listed among ${among}` : `No ${mine} listed among ${among}`;
        const ratioFrom = x => x.source == DEFAULT_SOURCE ? 'guessed ratio' : x.guessed ? `ratio partly guessed` : `ratio from ${x.source}`;
        const from = Object.entries(comp.factors).map(([m, x]) =>
            `${x.count} ${medalLabel(m)} at median ${fmt(x.median)} CC ×${x.factor.toFixed(2)} (${ratioFrom(x)})`).join(' + ');
        parts.push(from ? `${head}; ${comp.sameCount ? 'with ' : ''}${from}: ${at}` : `${head}: ${at}`);
    }
    else if (comp.medalMode == 'unrated') {
        // "Only 1 Silver among 20 listings (same sex and age group), 19 without a medal: median ..."
        const unrated = list.length - comp.ratedCount;
        parts.push(`${comp.sameCount ? `Only ${comp.sameCount}` : 'No'} ${medalLabel(comp.medal)} among ${list.length} listings (${comp.label}), ${unrated} without a medal: ${at}`);
    }
    else if (list.length) {
        parts.push(`${list.length} listings (${comp.label}), ${at}`);
    }
    if (method == 'fit') parts.push('price fitted to gene score');
    return parts;
}

// market listings expire within hours
export const LISTING_MAX_AGE_MS = 12 * 3600 * 1000;
// the trade history keeps showing old trades: one stays remembered this long, so seeing it again never makes it new
const HISTORY_MEMORY_MS = 14 * 24 * 3600 * 1000;

const isHistory = l => l.source == 'history';

// One entry per listing id (the trade's history row wins over its market row); market rows age from their last sighting, history rows from their first.
export function mergeListings(book, observed, now, maxAgeMs = LISTING_MAX_AGE_MS) {
    const byId = new Map();
    for (const l of book) {
        const prev = byId.get(l.id);
        if (now - l.seenAt <= (isHistory(l) ? HISTORY_MEMORY_MS : maxAgeMs) && !(prev && isHistory(prev) && !isHistory(l))) byId.set(l.id, l);
    }
    for (const l of observed) {
        if (l.id == undefined || !(l.price > 0)) continue;
        const k = l.id;
        const prev = byId.get(k);
        if (prev && isHistory(prev) && !isHistory(l)) continue;
        const next = Object.assign({}, l, { seenAt: prev && isHistory(prev) && isHistory(l) ? prev.seenAt : now });
        // a row read before the game filled its medal keeps the known one
        if (next.medal == undefined && prev && prev.medal != undefined) next.medal = prev.medal;
        if (!next.colormorph && prev && prev.colormorph) next.colormorph = prev.colormorph;
        byId.set(k, next);
    }
    return Array.from(byId.values());
}

// The book's entries that count for prices now.
export function pricedListings(book, now, maxAgeMs = LISTING_MAX_AGE_MS) {
    return book.filter(l => now - l.seenAt <= maxAgeMs);
}
