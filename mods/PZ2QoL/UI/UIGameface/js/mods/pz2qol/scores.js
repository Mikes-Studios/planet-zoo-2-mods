// Pure computations for PZ2QoL. No game imports, so it runs under Node tests.
//
// An "animal" here is a plain object:
// { id, species, gender, maturity, age (years), isShoal, isExhibit, isPregnant, isAlpha,
//   storageTag, price, isCC, genes: { size, longevity, fertility, immunity } }
// Gene values are 0..1 as the game sends them; missing genes are undefined.

import { speciesRules } from './speciesrules.js';

export const Gender = { Male: 0, Female: 1, Unisex: 2 };
// The game's EAnimalMaturity (ManagementDataTypes.js): age stage plus
// fertility in one value. Storage and market rows carry it as `maturity`.
export const Maturity = { Infant: 0, YoungAdult: 1, Adult: 2, Elderly: 3, YoungAdultInfertile: 4, AdultInfertile: 5, ElderlyInfertile: 6 };

function isNum(v) {
    return typeof v === 'number' && isFinite(v);
}

// Which genes count for this animal. The game shows a dash for size and
// immunity on exhibit animals and for every gene on shoals.
export function relevantGenes(a) {
    if (a.isShoal) {
        return [];
    }
    if (a.isExhibit) {
        return ['longevity', 'fertility'];
    }
    return ['size', 'longevity', 'fertility', 'immunity'];
}

// Mean of the relevant genes, 0..100, or null when unknown.
export function geneScore(a) {
    const genes = a.genes || {};
    const values = relevantGenes(a).map(k => genes[k]).filter(isNum);
    if (values.length == 0) {
        return null;
    }
    return Math.round(values.reduce((s, v) => s + v, 0) / values.length * 100);
}

// Weighted for breeding: fertility matters most, then longevity, immunity.
export function breederScore(a) {
    const genes = a.genes || {};
    const weights = a.isExhibit ? { fertility: 0.55, longevity: 0.45 } : { fertility: 0.4, longevity: 0.3, immunity: 0.3 };
    if (a.isShoal) {
        return null;
    }
    let total = 0;
    let weightSum = 0;
    for (const k in weights) {
        if (isNum(genes[k])) {
            total += genes[k] * weights[k];
            weightSum += weights[k];
        }
    }
    return weightSum > 0 ? Math.round(total / weightSum * 100) : null;
}

// Gene score per price unit: per 1,000 cash or per 100 CC. Higher is better.
export function valueIndex(a) {
    const score = geneScore(a);
    if (score == null || !isNum(a.price) || a.price <= 0) {
        return null;
    }
    const units = a.isCC ? a.price / 100 : a.price / 1000;
    return Math.round(score / units * 10) / 10;
}

// Judged by its own genes, a Market pick (marketpickcore) is only an animal worth having at all.
export const PICK_MIN_SCORE = 60;

export function isAdult(a) {
    return a.maturity != undefined && a.maturity != Maturity.Infant;
}

// An adult the game marks fertile (young adult, adult or elderly). Infants
// and the three "infertile" stages are out.
export function isFertileAdult(a) {
    return a.maturity == Maturity.YoungAdult || a.maturity == Maturity.Adult || a.maturity == Maturity.Elderly;
}

// Elderly, fertile or not: the Franchise market refuses one, and the
// refusal can take the game down (pz2-modding animals-and-breeding.md, Trading near elderly).
export function isElderly(a) {
    return a.maturity == Maturity.Elderly || a.maturity == Maturity.ElderlyInfertile;
}

// The server refuses an animal close to elderly while its row still says
// adult and the game still offers the buttons: a listing 0.8 years short
// (the refusal took the game down), a sale 1.9 and releases 2.0 and 2.7
// years short, while it takes a release 3.1 years short. The mod lists,
// sells and releases none this close.
export const MARKET_ELDERLY_MARGIN_YEARS = 3;

// Within MARKET_ELDERLY_MARGIN_YEARS of the species' elderly age (an unknown
// age or species: no).
export function isNearlyElderly(a) {
    const rules = speciesRules(normSpecies(a.species));
    return !!rules && rules.elderlyAge > 0 && typeof a.age === 'number' && rules.elderlyAge - a.age <= MARKET_ELDERLY_MARGIN_YEARS;
}

// The one rule for whether the mod puts a storage animal on the market
// (the Sellable chip, the Market desk, the lister), every reason that
// holds, the desk's first. The game's own sell flow blocks juveniles and
// pregnant animals (RelocateAnimalsPopup g_tSellPreventers: bJuvenileSell,
// bPregnant, bPendingTransport); its Market takes a shoal only as a group.
// An infertile adult is not blocked: the game may refuse it (cautionOf).
// "Can't be sold" has no row field, so the game's own check still has the
// last word. Unknown maturity blocks nothing.
export const SELL_BLOCKERS = Object.freeze({
    listed: 'Already listed',
    shoal: 'Shoal',
    moving: 'Being moved',
    pregnant: 'Pregnant',
    juvenile: 'Juvenile',
    elderly: 'Elderly and infertile',
    nearlyElderly: 'Nearly elderly',
});

export function sellBlockers(a) {
    const out = [];
    if (isOnMarket(a)) out.push('listed');
    if (a.isShoal) out.push('shoal');
    if (a.isMoving) out.push('moving');
    if (a.isPregnant) out.push('pregnant');
    if (a.maturity == Maturity.Infant) out.push('juvenile');
    if (isElderly(a)) out.push('elderly');
    else if (isNearlyElderly(a)) out.push('nearlyElderly');
    return out;
}

export function cautionOf(a) {
    return a.maturity == Maturity.YoungAdultInfertile || a.maturity == Maturity.AdultInfertile ? 'infertile' : null;
}

// The row's source text says it came from a Frontier zoo (not a player's):
// "[AnimalExchange_Source_Description:Value=|Frontier Zoo|]". The game's
// market refuses those (NoBirthZoo); Quick trade and Quick release take them.
export function isFrontierZoo(a) {
    return !!a && typeof a.source === 'string' && /\|\s*Frontier Zoo\s*\|/i.test(a.source);
}

// The market would take it: nothing blocks it and a player's zoo bred it.
export function isSellable(a) {
    return sellBlockers(a).length == 0 && !isFrontierZoo(a);
}

export function canBreed(a) {
    return a.maturity == Maturity.YoungAdult || a.maturity == Maturity.Adult;
}

// Per-species summary used by the storage filters and summary bar.
export function speciesStats(animals) {
    const stats = new Map();
    for (const a of animals) {
        const key = a.species || '?';
        let s = stats.get(key);
        if (!s) {
            s = { species: key, total: 0, males: [], females: [], breedingMales: 0, breedingFemales: 0 };
            stats.set(key, s);
        }
        s.total++;
        if (a.gender == Gender.Male) {
            s.males.push(a);
            if (canBreed(a)) s.breedingMales++;
        }
        else if (a.gender == Gender.Female) {
            s.females.push(a);
            if (canBreed(a)) s.breedingFemales++;
        }
    }
    for (const s of stats.values()) {
        s.pairs = Math.min(s.breedingMales, s.breedingFemales);
    }
    return stats;
}

// Animals beyond the best `keep` of each species+sex, ranked by gene score.
// These are trade or release candidates.
export function surplusIds(animals, keep) {
    const ids = new Set();
    for (const s of speciesStats(animals).values()) {
        for (const group of [s.males, s.females]) {
            if (group.length <= keep) {
                continue;
            }
            const ranked = group.slice().sort((x, y) => (geneScore(y) ?? -1) - (geneScore(x) ?? -1));
            for (const a of ranked.slice(keep)) {
                ids.add(a.id);
            }
        }
    }
    return ids;
}

export const SURPLUS_KEEP_STEPS = [1, 2, 3, 4];

// The Surplus chip's count: what it shows on, or what its first click would
// show while off. Listed animals are leaving, so Not listed leaves them out.
export function surplusChipCount(animals, f) {
    const pool = f.hideListed ? animals.filter(a => !isOnMarket(a)) : animals;
    return surplusIds(pool, f.surplusOnly ? f.surplusKeep : SURPLUS_KEEP_STEPS[0]).size;
}

export const DEFAULT_STORAGE_FILTERS = Object.freeze({
    minScore: 0,
    pregnant: false,
    alpha: false,
    adults: 'off', // 'off' | one of ADULT_STAGES
    pairsOnly: false,
    surplusOnly: false,
    surplusKeep: 2,
    hideListed: false, // hide animals already listed on the market
    related: false, // only animals with a close relative in storage (Kin)
    sellAdvice: false, // false | one of SELL_ADVICE_WAYS: the animals the breeding programme advises letting go (selladvice.js)
    sellable: 'any', // 'any' | one of TRADE_WAYS | 'no' (no way takes it)
    species: '', // one species only (the Species board's "Storage" button); '' = all
    sort: 'none', // 'none' | 'gene' | 'breeder'
});

// The Adults chip's stages: all adults (no infants), the adults the game marks
// fertile (no infertile elderly), or juveniles only
export const ADULT_STAGES = { all: isAdult, fertile: isFertileAdult, juvenile: a => !isAdult(a) };

// The ways an animal can leave: the market, release, and the rest, which
// only Quick trade takes (the Sellable and Sell advice chips). How an animal
// was bought decides it and its row doesn't say (one adopted for cash can't
// be released), so the game's own verdict from selecting it (v: listercore
// verdictOf, the Market desk's Check storage) decides where there is one;
// else a medal means the market and none release. One the game blocks
// (sellBlockers: listed, pregnant, young, too close to elderly...) goes no way.
const hasMedal = a => !!a.medal && a.medal !== 'none';
const unblocked = a => sellBlockers(a).length === 0;
const forMarket = (a, v) => unblocked(a) && (v ? v.trade : !isFrontierZoo(a) && hasMedal(a));
const forRelease = (a, v) => unblocked(a) && (v ? v.quickRelease === true : !isFrontierZoo(a) && !hasMedal(a));
export const TRADE_WAYS = {
    market: forMarket,
    release: forRelease,
    quick: (a, v) => unblocked(a) && !forMarket(a, v) && !forRelease(a, v) && (!v || v.quickTrade === true),
};

export function tradesSomeWay(a, v) {
    return Object.values(TRADE_WAYS).some(way => way(a, v));
}

// The Sell advice chip: every advised animal, or the ones of one way.
export const SELL_ADVICE_WAYS = Object.assign({ all: () => true }, TRADE_WAYS);

// One spelling for a species id, wherever it comes from: storage and market
// rows say "[Animal_Leopard_African]", the park "Leopard_African".
// -> "leopard_african" ('' for nothing).
export function normSpecies(s) {
    return String(s == null ? '' : s).trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^Animal_/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// Same test the game's storage row uses (MarketAnimalListItem: isOnMarket).
export function isOnMarket(a) {
    return a.auctionTimerSeconds != undefined && a.auctionTimerSeconds > 0;
}

export function storageFiltersActive(f) {
    return f.minScore > 0 || f.pregnant || f.alpha || (!!f.adults && f.adults != 'off') || f.pairsOnly || f.surplusOnly || f.hideListed || !!f.related || !!f.sellAdvice || (!!f.sellable && f.sellable != 'any') || !!f.species || f.sort != 'none';
}

// Returns the animals to show, in display order. Input order is kept
// unless a sort is chosen. `predicates` holds filters other modules add
// (key -> animal -> bool, e.g. Kin's `related`); each applies while the
// flag of the same name is on. A flag without a predicate filters nothing.
// verdictOf(animal) -> the game's verdict on it, or null (SELL_ADVICE_WAYS)
export function applyStorageFilters(animals, f, predicates = {}, verdictOf = null) {
    // listed animals are leaving: they don't count for pairs or surplus either
    if (f.hideListed) animals = animals.filter(a => !isOnMarket(a));
    const stats = (f.pairsOnly) ? speciesStats(animals) : null;
    const surplus = (f.surplusOnly) ? surplusIds(animals, f.surplusKeep) : null;
    const extra = Object.keys(predicates || {}).filter(k => f[k] && typeof predicates[k] === 'function').map(k => predicates[k]);
    const onlySpecies = f.species ? normSpecies(f.species) : '';
    const stage = ADULT_STAGES[f.adults];
    const way = SELL_ADVICE_WAYS[f.sellAdvice];
    const tradeWay = TRADE_WAYS[f.sellable];
    let out = animals.filter(a => {
        if (onlySpecies && normSpecies(a.species) !== onlySpecies) return false;
        for (const test of extra) {
            if (!test(a)) return false;
        }
        if (f.minScore > 0) {
            const s = geneScore(a);
            if (s == null || s < f.minScore) return false;
        }
        if (f.pregnant && !a.isPregnant) return false;
        if (f.alpha && !a.isAlpha) return false;
        if (stage && !stage(a)) return false;
        const v = verdictOf ? verdictOf(a) : null;
        if (way && !way(a, v)) return false;
        if (tradeWay && !tradeWay(a, v)) return false;
        if (f.sellable == 'no' && tradesSomeWay(a, v)) return false;
        if (stats) {
            const s = stats.get(a.species || '?');
            if (!s || s.pairs < 1) return false;
        }
        if (surplus && !surplus.has(a.id)) return false;
        return true;
    });
    if (f.sort == 'gene' || f.sort == 'breeder') {
        const fn = f.sort == 'gene' ? geneScore : breederScore;
        out = out.map((a, i) => ({ a, i, s: fn(a) }))
            .sort((x, y) => ((y.s ?? -1) - (x.s ?? -1)) || (x.i - y.i))
            .map(x => x.a);
    }
    return out;
}

export function storageSummary(animals) {
    const scores = animals.map(geneScore).filter(isNum);
    const stats = speciesStats(animals);
    let pairs = 0;
    for (const s of stats.values()) pairs += s.pairs;
    return {
        count: animals.length,
        males: animals.filter(a => a.gender == Gender.Male).length,
        females: animals.filter(a => a.gender == Gender.Female).length,
        pregnant: animals.filter(a => a.isPregnant).length,
        species: stats.size,
        pairs,
        avgScore: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    };
}

// Market presets: lists of [eventSuffix, value] sent through the game's own
// filter events, so they run in native code across every page.
export const MARKET_PRESETS = [
    {
        id: 'topGenes', label: 'Top genes', tooltip: 'Size, longevity, fertility and immunity all 80%+',
        events: [['FilterSizeMin', 80], ['FilterLongevityMin', 80], ['FilterFertilityMin', 80], ['FilterImmunityMin', 80]],
    },
    {
        id: 'breeders', label: 'Breeders', tooltip: 'Fertility 75%+, longevity 60%+, immunity 60%+',
        events: [['FilterSizeMin', 0], ['FilterLongevityMin', 60], ['FilterFertilityMin', 75], ['FilterImmunityMin', 60]],
    },
    {
        id: 'longLived', label: 'Long-lived', tooltip: 'Longevity 85%+',
        events: [['FilterSizeMin', 0], ['FilterLongevityMin', 85], ['FilterFertilityMin', 0], ['FilterImmunityMin', 0]],
    },
    {
        id: 'endingSoon', label: 'Ending ≤1h', tooltip: 'Listings with an hour or less remaining',
        events: [['FilterAuctionTimeMax', 2]],
    },
    {
        id: 'cash', label: 'Cash', tooltip: 'Only listings priced in cash',
        events: [['FilterCredits', false], ['FilterCash', true]],
    },
    {
        id: 'cc', label: 'CC', tooltip: 'Only listings priced in Conservation Credits',
        events: [['FilterCash', false], ['FilterCredits', true]],
    },
];

// ------------------------------------------------------------ zoo list
// Filters for the zoo management Animals list. Animals there also carry
// `habitat` (location name), `contracepted` and `welfare` (0..1).

export const DEFAULT_ZOO_FILTERS = Object.freeze({
    habitat: null,      // location name, or null for all
    sex: 'any',         // 'any' | 'male' | 'female'
    stage: 'any',       // 'any' | 'adult' | 'juvenile'
    pregnant: false,
    alpha: false,
    contracepted: false,
    unhappy: false,     // welfare below a third
    minScore: 0,
    minFertility: 0,    // 0..100
    kin: 'off',         // 'off' | 'risk' (inbreeding risk) | 'any' (risk, close kin, later)
    sort: 'none',       // 'none' | 'gene' | 'breeder' | 'welfare' | 'kin'
});

// Zoo animals may carry kinSeverity ('risk' | 'kin' | 'future' | 'held' | 'covered')
// and kinCluster (relatives share one key), set from the Kin model.
const KIN_RANK = { risk: 5, kin: 4, future: 3, held: 2, covered: 1 };

export const UNHAPPY_WELFARE = 1 / 3;

export function zooFiltersActive(f) {
    return f.habitat != null || f.sex != 'any' || f.stage != 'any' || f.pregnant || f.alpha || f.contracepted
        || f.unhappy || f.minScore > 0 || f.minFertility > 0 || f.sort != 'none' || (!!f.kin && f.kin != 'off');
}

export function applyZooFilters(animals, f) {
    let out = animals.filter(a => {
        if (f.habitat != null && a.habitat != f.habitat) return false;
        if (f.sex == 'male' && a.gender != Gender.Male) return false;
        if (f.sex == 'female' && a.gender != Gender.Female) return false;
        if (f.stage == 'adult' && !isAdult(a)) return false;
        if (f.stage == 'juvenile' && isAdult(a)) return false;
        if (f.pregnant && !a.isPregnant) return false;
        if (f.alpha && !a.isAlpha) return false;
        if (f.contracepted && !a.contracepted) return false;
        if (f.unhappy && !(typeof a.welfare === 'number' && a.welfare < UNHAPPY_WELFARE)) return false;
        if (f.minScore > 0) {
            const s = geneScore(a);
            if (s == null || s < f.minScore) return false;
        }
        if (f.minFertility > 0) {
            const v = a.genes && a.genes.fertility;
            if (typeof v !== 'number' || v * 100 < f.minFertility) return false;
        }
        if (f.kin == 'risk' && a.kinSeverity != 'risk') return false;
        if (f.kin == 'any' && !(KIN_RANK[a.kinSeverity] >= KIN_RANK.future)) return false;
        return true;
    });
    if (f.sort == 'kin') {
        // worst first, relatives next to each other (where the first of them
        // is in the game's order), then the game's order
        const clusterRank = new Map();
        const clusterFirst = new Map();
        out.forEach((a, i) => {
            if (a.kinCluster == null) return;
            const r = KIN_RANK[a.kinSeverity] || 0;
            if (r > (clusterRank.get(a.kinCluster) || 0)) clusterRank.set(a.kinCluster, r);
            if (!clusterFirst.has(a.kinCluster)) clusterFirst.set(a.kinCluster, i);
        });
        return out.map((a, i) => a.kinCluster != null
            ? { a, i, c: clusterRank.get(a.kinCluster) || 0, at: clusterFirst.get(a.kinCluster) }
            : { a, i, c: KIN_RANK[a.kinSeverity] || 0, at: i })
            .sort((x, y) => y.c - x.c || x.at - y.at || x.i - y.i)
            .map(x => x.a);
    }
    if (f.sort != 'none') {
        const key = f.sort == 'gene' ? geneScore : f.sort == 'breeder' ? breederScore : (a => typeof a.welfare === 'number' ? Math.round(a.welfare * 100) : null);
        const desc = f.sort != 'welfare'; // welfare: worst first, so problems surface
        out = out.map((a, i) => ({ a, i, s: key(a) }))
            .sort((x, y) => {
                const xs = x.s ?? (desc ? -1 : 101);
                const ys = y.s ?? (desc ? -1 : 101);
                return (desc ? ys - xs : xs - ys) || (x.i - y.i);
            })
            .map(x => x.a);
    }
    return out;
}

// Habitat names with counts, most populated first (for the habitat picker).
export function habitatCounts(animals) {
    const counts = new Map();
    for (const a of animals) {
        if (!a.habitat) continue;
        counts.set(a.habitat, (counts.get(a.habitat) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
        .sort((x, y) => y.count - x.count || (x.name < y.name ? -1 : 1));
}
