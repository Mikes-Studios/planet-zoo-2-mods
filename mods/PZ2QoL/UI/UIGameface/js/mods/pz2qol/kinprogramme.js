// Breeding programme: the best layout of one species' breeders across its
// habitats, for genetics. Pure, no game imports (Node tests).
//
// Objective (higher is better), summed over the habitats:
//   + each breeding pair's value: expected young (the mean of the predicted
//     fertility, immunity, size and longevity, by the game's own gene
//     formula) x the chance of conception (the game's own probability, by
//     fertility grade) x how long the pair can breed (fertile years left of
//     the one that ages out first; old or infertile animals are not
//     breeders)
//   - relatives living together: a related male and female in one habitat,
//     both able to breed some day (contracepted ones too), breaks a hard
//     rule; so does going over the game's most adults per sex (animals.fdb,
//     every adult counted)
//   - adults over the habitat's room, breeders over the group make-up
//   + a little per distinct family line (room to swap partners later)
// minus the cost of the moves: each moved animal, joining an established
// group, moving in next to a juvenile relative of the other sex (it will
// have to leave once grown), separating monogamous mates (they mourn).
//
// Monogamous mates living together pair only with each other, as the game
// lets them (groupPairs); a breeder whose monogamous mate does not breed
// pairs with no one while they share a habitat.
//
// Species where only the leader of a sex mates (animals.fdb Social_MatingRules:
// hippos, lions, meerkats...) breed through that leader alone (leaderPairs):
// any number may live together up to the game's limits per sex.
//
// Group make-up (groupRule): m males with f females. 1:1 pairs, 1:3 a male
// with three females, 1:any a harem (one breeding male per habitat), any:1
// one breeding female per habitat, or mixed groups (every female with her
// best unrelated male). First found: the player's choice for the species,
// the game's most of each sex per habitat, the game's own social groups for
// the species, the mating system. In a habitat each male breeds with up to
// f/m females (each female with up to m/f males) and the pairs are the best
// possible set (maxWeightPairs, exact). Breeders beyond what the other sex
// needs (1:3 with 4 females: 2 males) are a penalty, so the surplus moves
// on, and open places draw breeders in from the trade centre and from other
// habitats' surplus.
//
// Habitat room (adults of this species) comes from the species' social
// maximum and the habitat's space (estimated per animal from the game's own
// requirement for the current population, juveniles included). Juveniles
// stay where they are and don't count against the adults' room (the
// developer, 2026-10-19). Young waiting at the trade centre go back to a
// habitat (option youngBack): their mother's, else their father's, else
// the one with the most room. The programme never sends a juvenile to the
// trade centre.
//
// Non-breeding adults (contraception, infertile, too old) don't breed, but
// they fill the make-up's places (option spareOut, on by default; developer
// 2026-10-19: a 1:1 Eurasian lynx habitat kept a contracepted second male
// for ever). The search places the breeders as if those places were free;
// then each habitat keeps the non-breeders that fit (keepSpares): no
// relative of the other sex there, within the game's limits per sex and the
// room, and with spareOut able to breed again and within the make-up's
// places. One that doesn't fit moves to another habitat where it does
// (rehomeSpares), else to the trade centre. A pregnant, pinned or away
// animal stays and counts as before.
//
// Breeders waiting at the trade centre (bought, or sent there) count as
// breeders with no group: the search may bring them into a habitat
// (option useTradeCentre, on by default).
//
// Pregnant breeders are pinned where they are (she can't be sold and has to
// give birth first): they still count in their group and can anchor it (the
// search brings partners to her), but no step ever moves one. Each pregnant
// female gets contraception advice (contraceptionAdvice, below).
//
// Search (solveLayout), the same answer every time for the same zoo:
//   - few breeders (up to exactLimit layouts): every layout is scored, the
//     best wins (ties: fewer moves);
//   - more: local search from the current layout (move one breeder, swap
//     two, move a male and a female together into a habitat) and each sex
//     placed at once given the other (reassign: an exact assignment of the
//     plentiful sex to the habitats' room and partners); then rounds of a
//     kick (one or two breeders of the scarce sex, often a group's head,
//     moved at random and the rest placed again around them) or a ruin and
//     recreate (the breeders of one or two habitats, or a few at random,
//     taken out and put back where they do the most good, a male and a
//     female as a new group). Simulated annealing decides whether to keep
//     each round, and the best layout seen is kept. A seeded random source,
//     an evaluation budget, and a time cap as a safety net.
// One line for the detailed log: the make-up, its limits and each group
// (`kin prog_*_done`: the room and targets the plan was made with).
export function programmeLogData(r) {
    if (!r || !r.rule) return {};
    const rule = r.rule;
    return {
        makeup: ratioKey(rule), source: rule.source, system: rule.system, maxM: rule.maxMales, maxF: rule.maxFemales, caps: rule.capsFromGame ? 'game' : 'none',
        groups: (r.groups || []).map(g => `${g.hab}:${g.males}m${g.females}f/${g.capacity == null ? '-' : g.capacity}+${g.staying || 0}`).join(' '),
        moves: r.moves ? r.moves.length : 0, score: Math.round(r.score * 1000) / 1000,
    };
}

// The deep engine (opts.engine 'deep', solveDeep below) runs the same steps
// from many starts after the Classic plan, with exact repairs; the player
// picks how many starts and how long (the board's Optimiser options).
// Then every move the result does not need is undone (an equal layout with
// fewer moves wins). A habitat's score is cached by who lives there, and a
// step only scores again the habitats it changes. Checked against every
// layout on small zoos and against long runs on big ones
// (tests/kinprogramme.test.mjs).
import { bestOffspringScore, canBreedNow, offspringScore, overcrowdingOn, predictOffspring, Sex, fertileNow, kinTier, ownGrades, relationWord } from './kincore.js';
import { TRADE, normalizeAssignments, assignedHabitatsOf, habitatAllowedFor, mustHouse, simulatePlan } from './kinboardcore.js';
import { speciesRules } from './speciesrules.js';
import { growthOf } from './kinlife.js';

// A rule no layout may break: far above everything a layout can gain (every pair is worth at most 1).
const HARD_LIMIT = 1000;

// every page's Classic budget: it runs in slices, so it can search longer than a one-go call
export const PROGRAMME_SEARCH = Object.freeze({ maxEvaluations: 3000000, timeBudgetMs: 6000 });

// how far under the best pair's young an animal's best young may fall and it still breeds
export const YOUNG_MARGIN = 10;

export const PROGRAMME_DEFAULTS = Object.freeze({
    moveCost: 0.04,          // per moved animal, in pair-value units (0..1)
    bondBreakCost: 0.15,     // separating two monogamous mates (mourning)
    outsiderCost: 0.02,      // joining a habitat that already has this species
    relatedPenalty: HARD_LIMIT, // per related pair that can breed, living together
    juvenileKinCost: 0.5,    // moving an adult in next to a juvenile relative of the other sex
    growUpSoonYears: 1,      // a juvenile growing up within this is kin like an adult (it is never moved)
    youngMargin: YOUNG_MARGIN,
    // Room and make-up are hard limits in practice: each penalty is well
    // above the best pair's value (0..1) and the line bonus, so no layout
    // gains by going over (2026-10-18: 1 let a third Sumatran tiger in once
    // Best genetics had no move cost).
    overCapacityPenalty: 2,  // per adult over capacity
    structurePenalty: 2,     // per breeder over the group make-up or the game's most per sex
    lineBonus: 0.01,         // per distinct family line in a habitat (future flexibility)
    // the long run: a sire in a group is worth this share of each pairing he
    // can give a young one of the other sex who is no kin of his and grows
    // up while he still breeds (his daughters need another sire), at most
    // futureMateCap; below structurePenalty, so it never buys a second sire
    futureMateWeight: 0.25,
    futureMateCap: 1,
    maxEvaluations: 600000,  // search budget: layout changes scored (about 0.4 s for 100 breeders)
    timeBudgetMs: 1500,      // safety net: stop searching after this long
    exactLimit: 20000,       // score every layout when there are no more than this many
    defaultCapacity: 8,
    useTradeCentre: true,    // breeders waiting at the trade centre may join a group
    spareOut: true,          // non-breeding adults over the make-up go to the trade centre
    youngBack: true,         // young waiting at the trade centre go back to a habitat
    houseBack: true,         // pregnant and past-selling adults waiting there go to a habitat
    pairEvery: true,         // after the search: a breeding pair in every habitat the breeders allow
    ratio: 'auto',           // the player's group make-up (RATIO_CHOICES); 'auto': the game's
    seed: 0,                 // mixed into the zoo's own seed (tests)
    // the engine: 'classic' (one search, a few seconds) or 'deep' (many
    // starts and exact repairs, as long as the player allows)
    engine: 'classic',
    starts: 12,              // deep: searched starts (after the Classic plan, start 0)
    effort: 1,               // deep: rounds per start, times the classic search's
    patience: 0,             // deep: stop after this many rounds (of 4 starts) without a better plan (0: never)
    repair: 'light',         // deep: exact repairs, 'off' | 'light' | 'strong'
    warm: null,              // deep: the Classic plan's moves [{id, to}] (start 0)
    resume: null,            // deep: { round, base: [{id, to}] } from a stopped run (Continue)
    classic: PROGRAMME_SEARCH, // deep: start 0 when no warm plan
    wallLimitMs: Infinity,   // deep: wall-clock limit
    stop: null,              // deep: () => true ends the search (the best so far is kept)
    onStart: null,           // deep: ({ done, planned, bestStart, total, ms }) after each start
    // Auto mode only (kinautocore.js; unset: the same plan as before): ids of
    // breeders that count where they are but never move (hands off, moved
    // by the player, sent away by Auto), like a pregnant one
    pinIds: null,
});

// "Fewer moves <-> Best genetics": the optimiser's cost per moved animal
// (and for joining an established group: the default unless given). Best
// genetics counts no move cost at all (developer, 2026-10-18); a move that
// gains nothing is still undone at the end. The board's slider and Auto
// mode's setting.
export const PROGRAMME_STEPS = Object.freeze([
    Object.freeze({ label: 'Fewest moves', cost: 0.15 }),
    Object.freeze({ label: 'Fewer moves', cost: 0.08 }),
    Object.freeze({ label: 'Balanced', cost: 0.04 }),
    Object.freeze({ label: 'Best genetics', cost: 0, outsider: 0 }),
]);
export const PROGRAMME_DEFAULT_STEP = 3; // Best genetics (developer, 2026-10-18)

const MATING = new Set(['monogamy', 'polygyny', 'polyandry', 'mixed']);
const EPS = 1e-9;
const AWAY = 'away';

function fertGrade(a) {
    const g = a.genes && a.genes.F;
    if (typeof g !== 'string') return null;
    const s = g.length === 12 ? g.split('') : g.split('.');
    if (s.length !== 12) return null;
    let d = 0;
    for (let i = 0; i < 6; i++) if (s[i] !== s[i + 6]) d++;
    return d; // 0..6, the game's fertility grade x 6
}

// A 0% fertility gene counts as never conceiving
// (the programme, Thin out, sell advice and storage suggestions alike).
export function noFertility(a) {
    return ownGrades(a && a.genes).fertility === 0;
}

// Breeds now by the game's own flags (kincore canBreedNow), so the badges,
// alerts, the programme and Auto mode agree on every animal.
export function isBreeder(a) {
    if (!a || a.exhibit || a.alive === false || !canBreedNow(a)) return false;
    return a.sex === Sex.Male || a.sex === Sex.Female || a.sex === Sex.Unisex;
}

// Conception chance for a pair: the game's own table by fertility grades
// (info.conception[fM][fF], 0..1), else a fertility-based estimate.
export function conceptionChance(m, f, info = {}) {
    const fm = fertGrade(m), ff = fertGrade(f);
    const t = info.conception;
    if (t && fm != null && ff != null && t[fm] && typeof t[fm][ff] === 'number') return t[fm][ff];
    if (fm == null || ff == null) return 0.5;
    return Math.max(0.05, Math.min(1, (fm + ff) / 12));
}

// Fertile years left (null: unknown or for life): the snapshot's
// fertility, else the species' fertility ages from the game.
export function fertileYearsLeft(a, info = {}) {
    if (a.fert && a.fert.yearsLeft != null) return a.fert.yearsLeft;
    const b = info.fertilityAges;
    if (b && typeof a.age === 'number' && b.infertility != null && b.infertility < 900) return Math.max(0, b.infertility - a.age);
    return null;
}

// How long a pair can breed, as a weight 0.25..1: full when both have at
// least `horizon` fertile years left (a third of the species' fertile span,
// at least 2 years), less as the first of them ages out.
export function longevityWeight(m, f, info = {}) {
    const left = [fertileYearsLeft(m, info), fertileYearsLeft(f, info)].filter(v => v != null);
    if (!left.length) return 1;
    const b = info.fertilityAges;
    const span = b && b.infertility != null && b.infertility < 900 && b.maturity != null ? b.infertility - b.maturity : null;
    const horizon = Math.max(2, span != null ? span / 3 : 3);
    return Math.max(0.25, Math.min(1, Math.min(...left) / horizon));
}

// Expected young genetics (0..1): mean of the predicted means.
export function youngQuality(m, f) {
    const pred = predictOffspring(m.genes, f.genes);
    if (!pred) return 0.5;
    const vals = ['fertility', 'immunity', 'size', 'longevity'].map(k => pred[k] && pred[k].mean).filter(v => typeof v === 'number');
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0.5;
}

// ---------------------------------------------------------- group make-up

// What the player can pick per species ('auto': the game's facts).
// '1:*' one male with any number of females (a harem), '*:1' the reverse.
export const RATIO_CHOICES = Object.freeze(['auto', '1:1', '1:2', '1:3', '1:4', '1:5', '1:*', '2:1', '3:1', '*:1', 'mixed']);

// '1:3' -> { m: 1, f: 3 }, '1:*' -> { m: 1, f: Infinity }, 'mixed' ->
// 'mixed'; anything else (or 'auto') -> null. One side is always 1.
export function parseRatio(s) {
    const t = String(s == null ? '' : s).trim();
    if (t === 'mixed') return 'mixed';
    const x = /^(\d+|\*):(\d+|\*)$/.exec(t);
    if (!x) return null;
    const n = v => (v === '*' ? Infinity : parseInt(v, 10));
    const m = n(x[1]), f = n(x[2]);
    if (!(m >= 1) || !(f >= 1) || (m !== 1 && f !== 1)) return null;
    return { m, f };
}

// Counts of males and females -> the nearest 1:k or k:1.
export function reduceRatio(males, females) {
    if (!(males > 0) || !(females > 0)) return null;
    if (females >= males) return { m: 1, f: Math.max(1, Math.round(females / males)) };
    return { m: Math.max(1, Math.round(males / females)), f: 1 };
}

// '1:3', '1:*', 'mixed'...: a rule's make-up in RATIO_CHOICES words.
export function ratioKey(rule) {
    if (!rule || rule.m == null) return 'mixed';
    const w = v => (v === Infinity ? '*' : String(v));
    return `${w(rule.m)}:${w(rule.f)}`;
}

const harem = r => !!r && r.m === 1 && r.f > 1;
const reverseHarem = r => !!r && r.f === 1 && r.m > 1;
// a make-up that agrees with the mating system
function fitsSystem(r, system) {
    if (system === 'monogamy') return r.m === 1 && r.f === 1;
    if (system === 'polygyny') return harem(r);
    if (system === 'polyandry') return reverseHarem(r);
    return true;
}
const SYSTEM_RATIO = {
    monogamy: { m: 1, f: 1 },
    polygyny: { m: 1, f: Infinity },
    polyandry: { m: Infinity, f: 1 },
};
const GROUP_ORDER = ['mixed', 'mixedLarge', 'pair'];

// How the species' breeders form groups:
//   m, f                 m males with f females (null: mixed groups)
//   maxMales, maxFemales the game's most adults of a sex in a mixed group (or null)
//   leaderMale, leaderFemale        only the leading animal of that sex mates
//   source               'leader' (only a leader mates: the game decides),
//                        'yours' (the player's choice), 'game' (the game's most
//                        per sex), 'groups' (the game's social groups for the
//                        species), 'mating' (the mating system; 'mixed' for
//                        Polygyandry, where both sexes take several mates),
//                        'none' (no mating system the mod could read)
//   system               the mating system ('mixed' when unknown)
//   solitary             the game's groups are all of one sex (male alone,
//                        female alone, bachelor groups): a solitary species
// The per-sex limits and leaders come from the game's animals.fdb (speciesrules.js); info.sexMax
// = { male, female } (read from the scan, a guess) only stands in for a species missing there.
// info.groups = [{ kind, m, f }] come from the game (Kin.SpeciesInfo); choice is a RATIO_CHOICES entry.
export function groupRule(info = {}, choice = 'auto') {
    const known = MATING.has(info && info.mating);
    const system = known ? info.mating : 'mixed';
    const game = speciesRules(info && info.species);
    const scanned = info && info.sexMax && typeof info.sexMax === 'object' ? info.sexMax : {};
    const caps = game ? { male: game.mixedMale, female: game.mixedFemale } : scanned;
    const allGroups = (info && Array.isArray(info.groups) ? info.groups : []).filter(g => g && typeof g === 'object');
    const solitary = allGroups.length > 0 && allGroups.every(g => !(g.m > 0 && g.f > 0));
    // without the game's most per sex: at most the group size less one (the
    // other sex must fit too); a group of 2 (tigers) is one male and one female
    const social = info && info.social && info.social.max >= 2 ? Math.floor(info.social.max) : null;
    const derived = social != null ? social - 1 : null;
    const out = (r, source) => ({
        m: r ? r.m : null,
        f: r ? r.f : null,
        maxMales: caps.male > 0 ? Math.floor(caps.male) : derived,
        maxFemales: caps.female > 0 ? Math.floor(caps.female) : derived,
        leaderMale: !!(game && game.leaderMale),
        leaderFemale: !!(game && game.leaderFemale),
        capsFromGame: !!game,
        source,
        system,
        solitary,
    });
    // only the leader mates: any number may live together, the leader's pairs are what count
    if (game && (game.leaderMale || game.leaderFemale)) return out(null, 'leader');
    const mine = parseRatio(choice);
    if (mine) return out(mine === 'mixed' ? null : mine, 'yours');
    const fromCaps = reduceRatio(caps.male, caps.female);
    if (fromCaps && fitsSystem(fromCaps, system)) return out(fromCaps, 'game');
    const groups = allGroups.filter(g => g.m > 0 && g.f > 0);
    const rank = g => {
        const i = GROUP_ORDER.indexOf(g.kind);
        return i < 0 ? GROUP_ORDER.length : i;
    };
    for (const g of groups.slice().sort((x, y) => rank(x) - rank(y))) {
        const r = reduceRatio(g.m, g.f);
        if (r && fitsSystem(r, system)) return out(r, 'groups');
    }
    if (SYSTEM_RATIO[system]) return out(SYSTEM_RATIO[system], 'mating');
    // Polygyandry (both sexes take several mates; the Zoopedia's
    // "Promiscuous", e.g. tigers and bears): mixed groups, as the game says
    if (known) return out(null, 'mating');
    return out(null, 'none');
}

// With the park's social groups off (a sandbox setting) no group rule binds
// the animals; what counts is knowing every calf's father, so one breeding
// male per habitat with any number of females (oneSire, a hard limit).
// Leaders (only the leader mates: one sire already) and monogamous pairs
// keep their own make-up, and the game's most per sex only as the
// make-up's limit (overStructure), not as a hard one.
export function sandboxRule(rule) {
    if (!rule) return rule;
    if (rule.leaderMale || rule.leaderFemale || rule.system === 'monogamy') return Object.assign({}, rule, { capsFromGame: false });
    return Object.assign({}, rule, { m: 1, f: Infinity, maxMales: 1, maxFemales: null, capsFromGame: false, oneSire: true, source: 'sandbox' });
}

// The game's social group kinds (Kin.SpeciesInfo `groups[].kind`) in words.
export const GROUP_KIND_WORDS = Object.freeze({
    mixed: 'mixed group', mixedLarge: 'large mixed group', pair: 'breeding pair', maleBachelor: 'male group',
    femaleBachelor: 'female group', maleSolitary: 'male alone', femaleSolitary: 'female alone',
});

// Why the make-up is not known (groupRule source 'none'), with what the game
// did give: its mating rule as it came when the mod could not read it
// (info.matingRaw), and its groups, which then have no group with both sexes
// (all one sex: a solitary species; or none at all).
export function unknownMakeupText(info = {}) {
    const groups = (info && Array.isArray(info.groups) ? info.groups : []).filter(g => g && typeof g === 'object');
    const raw = info && info.matingRaw != null && String(info.matingRaw) !== '' ? String(info.matingRaw) : null;
    const rule = raw ? `The game's mating rule came as "${raw}", which the mod can't read` : 'The game gave no mating rule';
    const solitary = groups.length > 0 && groups.every(g => !(g.m > 0 && g.f > 0));
    let about;
    if (!groups.length) about = 'and no group make-up';
    else {
        const list = groups.map(g => `${GROUP_KIND_WORDS[g.kind] || g.kind || 'group'}: ${g.m || 0} ♂ ${g.f || 0} ♀`).join(', ');
        about = solitary ? `and its groups are all of one sex (${list}), as for a solitary species` : `and its groups (${list}) don't say`;
    }
    const max = info && info.social && info.social.max > 0 ? `, up to ${info.social.max} adults per habitat` : '';
    return `${rule}, ${about}. Mixed groups are assumed: each female with her best unrelated male${max}. `
        + 'If you know how it breeds, choose the make-up with the arrows (kept for this zoo).';
}

// Partners per animal: a male breeds with up to `male` females, a female
// with up to `female` males (one of the two is always 1).
function partnersPer(rule) {
    if (!rule || rule.m == null) return { male: Infinity, female: 1 }; // mixed: each female her best male
    return { male: rule.m === 1 ? rule.f : 1, female: rule.f === 1 ? rule.m : 1 };
}

// The breeders a habitat with room for `room` adults asks for under the
// make-up: { males, females }, the most pairs (ties: fewer of the scarce
// sex), within the game's most per sex. null for mixed groups.
export function groupTarget(rule, room) {
    if (!rule || rule.m == null || !(room >= 1) || !Number.isFinite(room)) return null;
    room = Math.floor(room);
    const scarceIsMale = rule.m === 1;
    const k = scarceIsMale ? rule.f : rule.m;               // partners of one scarce-sex animal
    const capScarce = (scarceIsMale ? rule.maxMales : rule.maxFemales) ?? Infinity;
    const capOther = (scarceIsMale ? rule.maxFemales : rule.maxMales) ?? Infinity;
    let best = null;
    for (let s = 1; s <= Math.min(room, capScarce); s++) {
        const o = Math.min(room - s, s * k, capOther);
        if (!best || o > best.o) best = { s, o };
    }
    if (!best) return null;
    return scarceIsMale ? { males: best.s, females: best.o } : { males: best.o, females: best.s };
}

// ---------------------------------------------------------- best pairs

// Hungarian method (shortest augmenting paths): n rows <= m columns, cost
// n x m (flat), the lowest total. -> column of each row.
function hungarian(n, m, cost) {
    const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
    const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
    const minv = new Float64Array(m + 1), used = new Uint8Array(m + 1);
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        minv.fill(Infinity);
        used.fill(0);
        do {
            used[j0] = 1;
            const i0 = p[j0];
            let delta = Infinity, j1 = 0;
            const row = (i0 - 1) * m;
            for (let j = 1; j <= m; j++) {
                if (used[j]) continue;
                const cur = cost[row + j - 1] - u[i0] - v[j];
                if (cur < minv[j]) {
                    minv[j] = cur;
                    way[j] = j0;
                }
                if (minv[j] < delta) {
                    delta = minv[j];
                    j1 = j;
                }
            }
            for (let j = 0; j <= m; j++) {
                if (used[j]) {
                    u[p[j]] += delta;
                    v[j] -= delta;
                }
                else minv[j] -= delta;
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do {
            const j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
        } while (j0);
    }
    const match = new Int32Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) match[p[j] - 1] = j - 1;
    return match;
}

// The best set of pairs: each male with up to perMale females, each female
// with up to perFemale males, the most total value (only pairs worth more
// than 0). Exact: when one side may take any number of partners, each
// animal of the other side simply takes its best; otherwise the Hungarian
// method on copies of the animals that take several partners.
// value(m, f) -> number. Returns [[value, male, female], ...].
export function maxWeightPairs(males, females, value, perMale = 1, perFemale = 1) {
    const out = [];
    const M = males.length, F = females.length;
    if (!M || !F) return out;
    const w = new Float64Array(M * F);
    let any = false;
    for (let i = 0; i < M; i++) {
        for (let j = 0; j < F; j++) {
            const v = males[i] === females[j] ? 0 : value(males[i], females[j]);
            if (v > 0) {
                w[i * F + j] = v;
                any = true;
            }
        }
    }
    if (!any) return out;
    if (perMale >= F && perFemale === 1) {
        // each female with her best male
        for (let j = 0; j < F; j++) {
            let bi = -1;
            for (let i = 0; i < M; i++) if (w[i * F + j] > 0 && (bi < 0 || w[i * F + j] > w[bi * F + j])) bi = i;
            if (bi >= 0) out.push([w[bi * F + j], males[bi], females[j]]);
        }
        return out;
    }
    if (perFemale >= M && perMale === 1) {
        for (let i = 0; i < M; i++) {
            let bj = -1;
            for (let j = 0; j < F; j++) if (w[i * F + j] > 0 && (bj < 0 || w[i * F + j] > w[i * F + bj])) bj = j;
            if (bj >= 0) out.push([w[i * F + bj], males[i], females[bj]]);
        }
        return out;
    }
    const rows = [], cols = [];
    for (let i = 0; i < M; i++) for (let c = 0; c < Math.min(perMale, F); c++) rows.push(i);
    for (let j = 0; j < F; j++) for (let c = 0; c < Math.min(perFemale, M); c++) cols.push(j);
    const flip = rows.length > cols.length;
    const n = flip ? cols.length : rows.length, m = flip ? rows.length : cols.length;
    const cost = new Float64Array(n * m);
    for (let a = 0; a < n; a++) {
        for (let b = 0; b < m; b++) {
            const r = flip ? rows[b] : rows[a], c = flip ? cols[a] : cols[b];
            cost[a * m + b] = -w[r * F + c];
        }
    }
    const match = hungarian(n, m, cost);
    for (let a = 0; a < n; a++) {
        const b = match[a];
        if (b < 0) continue;
        const r = flip ? rows[b] : rows[a], c = flip ? cols[a] : cols[b];
        const v = w[r * F + c];
        if (v > 0) out.push([v, males[r], females[c]]);
    }
    return out;
}

// ------------------------------------------------------------------ setup

// Related by the game's rule or as close kin.
export function relatedPair(model, a, b) {
    if (!a.guid || !b.guid) return false;
    const tier = kinTier(model, model.ped.relation(a.guid, b.guid));
    return tier === 'game' || tier === 'close';
}

// Old or sterile animals never breed again; a contracepted one may, and a juvenile will.
export function canEverBreed(a) {
    const s = a.fert && a.fert.state;
    return s !== 'old' && s !== 'sterile';
}

// Elderly and past breeding: left where it is, still counted where it lives.
function isRetired(a) {
    return !!(a.fert && a.fert.state === 'old');
}

// Two animals that must not live together: the other sex, both able to breed some day, related.
export function kinPair(model, a, b) {
    const opposite = (isMaleSide(a.sex) && isFemaleSide(b.sex)) || (isFemaleSide(a.sex) && isMaleSide(b.sex));
    return a !== b && opposite && canEverBreed(a) && canEverBreed(b) && relatedPair(model, a, b);
}

function lineOf(a) {
    return a.par && a.par.length ? a.par.slice().sort().join('+') : 'f:' + a.id;
}

// capacity in adults of this species, per habitat
export function habitatCapacity(info, habId, fallback) {
    const h = info.habitats && info.habitats[habId];
    const social = info.social && info.social.max > 0 ? info.social.max : null;
    let space = null;
    if (h && h.available) {
        const perAdult = info.spacePerAdult || {};
        for (const k of Object.keys(perAdult)) {
            const need = perAdult[k];
            const have = h.available[k];
            if (!(need > 0) || typeof have !== 'number') continue;
            const n = Math.floor(have / need);
            space = space == null ? n : Math.min(space, n);
        }
    }
    let cap = social != null && space != null ? Math.min(social, space) : (social != null ? social : space);
    if (cap == null) cap = fallback;
    return Math.max(0, cap);
}

// Space one adult needs, per area type: the game's requirement for the
// current population divided by that population, averaged over habitats.
// young (habitat -> juveniles living there): the requirement covers them
// too, so they share it; the adults' room then leaves them out.
export function estimateSpacePerAdult(info, young = null) {
    const sums = {}, counts = {};
    for (const [hab, h] of Object.entries(info.habitats || {})) {
        if (!h.required || !(h.adults > 0)) continue;
        const pop = h.adults + ((young && young.get(String(hab))) || 0);
        for (const [k, v] of Object.entries(h.required)) {
            if (!(v > 0)) continue;
            sums[k] = (sums[k] || 0) + v / pop;
            counts[k] = (counts[k] || 0) + 1;
        }
    }
    const out = {};
    for (const k of Object.keys(sums)) out[k] = sums[k] / counts[k];
    return out;
}

const isMaleSide = s => s === Sex.Male || s === Sex.Unisex;
const isFemaleSide = s => s === Sex.Female || s === Sex.Unisex;

const wallClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function hashSeed(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}

// mulberry32: a small seeded random source (the same plan every time)
export function randomSource(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Evaluations and time (opts.clock: the async runner's searching time).
function makeBudget(opts) {
    const clock = typeof opts.clock === 'function' ? opts.clock : wallClock;
    const t0 = clock();
    let checked = 0;
    const b = {
        evals: 0,
        limit: opts.maxEvaluations,
        timedOut: false,
        ms: () => clock() - t0,
        out() {
            if (b.evals >= b.limit) return true;
            if (b.evals - checked >= 200) {
                checked = b.evals;
                if (clock() - t0 > opts.timeBudgetMs) b.timedOut = true;
                // the player's Stop (deep search)
                if (typeof opts.stop === 'function' && opts.stop()) b.timedOut = b.stopped = true;
            }
            return b.timedOut;
        },
    };
    return b;
}

// What each breeder is worth to the young of the other sex growing up in
// the zoo (opts.futureMateWeight): only the sires of the rule (the males
// of a harem, the females of a reverse one, both otherwise).
// -> { value: per breeder, count: how many such young per breeder }
function futureMateValues(model, info, opts, rule, breeders, all) {
    const sires = harem(rule) ? isMaleSide : reverseHarem(rule) ? isFemaleSide : null;
    const young = all.filter(a => a.juv && canEverBreed(a) && !noFertility(a));
    const value = new Float64Array(breeders.length), count = new Int32Array(breeders.length);
    breeders.forEach((b, i) => {
        if (sires && !sires(b.sex)) return;
        const left = fertileYearsLeft(b, info);
        let v = 0;
        for (const j of young) {
            const opposite = (isMaleSide(b.sex) && isFemaleSide(j.sex)) || (isFemaleSide(b.sex) && isMaleSide(j.sex));
            if (!opposite || relatedPair(model, b, j)) continue;
            const g = growthOf(j);
            if (left != null && g && g.years >= left) continue;
            v += youngQuality(b, j) * conceptionChance(b, j, info);
            count[i]++;
        }
        value[i] = Math.min(opts.futureMateCap, opts.futureMateWeight * v);
    });
    return { value, count };
}

// The search's view of the species: breeders by index, places by index
// (the habitats, the breeders' own habitats, the trade centre).
function makeContext(model, info, opts, breeders, all, habitats, home, spares = []) {
    const n = breeders.length;
    const placeKeys = habitats.slice();
    for (const a of breeders) if (!placeKeys.includes(home.get(a.id))) placeKeys.push(home.get(a.id));
    if (!placeKeys.includes(TRADE)) placeKeys.push(TRADE);
    const P = placeKeys.length;
    const placeOf = new Map(placeKeys.map((k, i) => [k, i]));
    const trade = placeOf.get(TRADE);
    const groupPlace = placeKeys.map(k => k !== TRADE && k !== AWAY);
    const allowed = new Set(habitats);
    // juveniles stay put; soonAt: those that grow up soon, kin like the adults staying there
    const youngAt = new Map(), soonAt = new Map();
    const spareSet = new Set(spares);
    for (const a of all) {
        if (!a.juv || !a.hab || a.lt === 'trade') continue;
        const g = growthOf(a);
        const at = g && g.kind === 'adult' && g.years <= opts.growUpSoonYears ? soonAt : youngAt;
        at.set(a.hab, [...(at.get(a.hab) || []), a]);
    }
    const capacity = new Map();
    const crowding = overcrowdingOn(model);
    for (const k of placeKeys) if (k !== TRADE && k !== AWAY) capacity.set(k, crowding ? habitatCapacity(info, k, opts.defaultCapacity) : Infinity);
    const established = new Set(all.filter(a => a.hab && !a.juv).map(a => a.hab));
    const gameRule = groupRule(info, opts.ratio);
    const rule = model.rules && model.rules.socialGroups === false ? sandboxRule(gameRule) : gameRule;
    const per = partnersPer(rule);
    const ctx = {
        model, info, opts, rule, per, n, P, placeKeys, placeOf, trade, groupPlace,
        B: breeders,
        sex: breeders.map(a => a.sex),
        line: breeders.map(lineOf),
        home: Int32Array.from(breeders.map(a => placeOf.get(home.get(a.id)))),
        cap: placeKeys.map(k => (capacity.has(k) ? capacity.get(k) : null)),
        estab: placeKeys.map(k => established.has(k)),
        capacity, spares, youngAt, soonAt,
        // adults the plan never moves (not breeders, not spares)
        stayingBase: all.filter(a => !a.juv && a.hab && !breeders.includes(a) && !spareSet.has(a)),
        memo: new Map(),
        pvCache: new Float64Array(n * n).fill(NaN),
        // random words for the score cache's keys (32 + 21 bits)
        zA: new Uint32Array(n), zB: new Uint32Array(n), zpA: new Uint32Array(P), zpB: new Uint32Array(P),
        all: Array.from({ length: n }, (_, i) => i),
    };
    const zr = randomSource(hashSeed(`z|${n}|${P}`));
    for (let i = 0; i < n; i++) {
        ctx.zA[i] = Math.floor(zr() * 4294967296);
        ctx.zB[i] = Math.floor(zr() * 2097152);
    }
    for (let q = 0; q < P; q++) {
        ctx.zpA[q] = Math.floor(zr() * 4294967296);
        ctx.zpB[q] = Math.floor(zr() * 2097152);
    }
    const future = futureMateValues(model, info, opts, rule, breeders, all);
    ctx.futureMates = future.value;
    ctx.futureMateCount = future.count;
    withStaying(ctx, []);
    ctx.kinWithYoung = kinCounter(ctx, youngAt);
    ctx.kinWithSoon = kinCounter(ctx, soonAt);
    ctx.maleSide = ctx.all.filter(i => isMaleSide(ctx.sex[i]));
    ctx.femaleSide = ctx.all.filter(i => isFemaleSide(ctx.sex[i]));
    ctx.allowedPlace = placeKeys.map(k => allowed.has(k));
    ctx.groupPlaces = placeKeys.map((k, p) => p).filter(p => groupPlace[p] && allowed.has(placeKeys[p]));
    // where each breeder may go: the allowed habitats, the trade centre, home
    // pregnant breeders stay where they are (pinned): home is their only place
    // pregnant, or away from its habitat for now (vet, quarantine): stays
    // (and the animals Auto mode must leave where they are, opts.pinIds)
    const pinIds = opts.pinIds instanceof Set ? opts.pinIds : new Set(Array.isArray(opts.pinIds) ? opts.pinIds.map(String) : []);
    ctx.pinned = Uint8Array.from(breeders.map(a => (a.preg || a.away || pinIds.has(a.id) ? 1 : 0)));
    ctx.targetsOf = ctx.all.map(i => {
        if (ctx.pinned[i]) return [ctx.home[i]];
        const t = new Set(ctx.groupPlaces);
        t.add(trade);
        t.add(ctx.home[i]);
        return Array.from(t).sort((x, y) => x - y);
    });
    ctx.canGo = (i, p) => p === ctx.home[i] || (!ctx.pinned[i] && (p === trade || (groupPlace[p] && allowed.has(placeKeys[p]))));
    // the pair's value, male m with female f (indices): -1 = related
    ctx.pv = (m, f) => {
        const k = m * n + f;
        let v = ctx.pvCache[k];
        if (Number.isNaN(v)) {
            const a = breeders[m], b = breeders[f];
            v = relatedPair(model, a, b) ? -1 : youngQuality(a, b) * conceptionChance(a, b, info) * longevityWeight(a, b, info);
            ctx.pvCache[k] = v;
        }
        return v;
    };
    ctx.compatible = (i, j) => i !== j && ((isMaleSide(ctx.sex[i]) && isFemaleSide(ctx.sex[j])) || (isFemaleSide(ctx.sex[i]) && isMaleSide(ctx.sex[j])));
    // either order: the male (or the first) as the father
    ctx.pvAny = (i, j) => (isMaleSide(ctx.sex[i]) && isFemaleSide(ctx.sex[j]) ? ctx.pv(i, j) : ctx.pv(j, i));
    // monogamous bonds between current mates: { a, b (breeder index or -1),
    // ext (the other's place, or -1) }. Only these matter: while the two live
    // together the game pairs each with no one else (IconLock), and parting
    // them costs mourning. Other species list mates too, but have neither
    // (animals.fdb: MourningSeasons is 0 for every species without single
    // mates). Monogamous: the bond pass saw the bond (either side), or the
    // species' mating system is monogamy.
    const byId = new Map(breeders.map((a, i) => [a.id, i]));
    const allIds = new Map(all.map(a => [a.id, a]));
    const monoSpecies = info && info.mating === 'monogamy';
    ctx.bonds = [];
    ctx.bondsOf = ctx.all.map(() => []);
    // each breeder's monogamous mate: a breeder (index) or a non-breeder's place
    ctx.monoMate = new Int32Array(n).fill(-1);
    ctx.monoExt = new Int32Array(n).fill(-1);
    const seen = new Set();
    breeders.forEach((a, i) => {
        for (const mateId of a.mates || []) {
            const mate = allIds.get(mateId);
            if (!mate) continue;
            if (!(monoSpecies || (a.bond && a.bond.mate === mateId) || (mate.bond && mate.bond.mate === a.id))) continue;
            const key = a.id < mateId ? a.id + '|' + mateId : mateId + '|' + a.id;
            if (seen.has(key)) continue;
            seen.add(key);
            const j = byId.has(mateId) ? byId.get(mateId) : -1;
            const extKey = j < 0 ? home.get(mateId) : null;
            const bond = { a: i, b: j, ext: j < 0 && placeOf.has(extKey) ? placeOf.get(extKey) : -1 };
            ctx.bonds.push(bond);
            ctx.bondsOf[i].push(ctx.bonds.length - 1);
            if (j >= 0) ctx.bondsOf[j].push(ctx.bonds.length - 1);
            // one mate each (the first found)
            if (ctx.monoMate[i] >= 0 || ctx.monoExt[i] >= 0 || (j >= 0 && (ctx.monoMate[j] >= 0 || ctx.monoExt[j] >= 0))) continue;
            if (j >= 0) {
                ctx.monoMate[i] = j;
                ctx.monoMate[j] = i;
            }
            else ctx.monoExt[i] = bond.ext;
        }
    });
    ctx.hasMono = ctx.bonds.length > 0;
    return ctx;
}

// Breeder i's relatives of the other sex among byHab's animals at place p (cached).
function kinCounter(ctx, byHab) {
    const cache = new Map();
    return (i, p) => {
        const key = i * ctx.P + p;
        let count = cache.get(key);
        if (count === undefined) {
            count = (byHab.get(ctx.placeKeys[p]) || []).filter(a => kinPair(ctx.model, ctx.B[i], a)).length;
            cache.set(key, count);
        }
        return count;
    };
}

// The adults the score counts as staying put: the ones the plan never
// moves, and `spares` (non-breeders, each in its habitat), for the room,
// the game's most per sex and relatives alike.
function withStaying(ctx, spares) {
    const stayingAt = new Map(), fixedAdults = new Map(), fixedSex = new Map();
    for (const a of ctx.stayingBase.concat(spares)) {
        stayingAt.set(a.hab, [...(stayingAt.get(a.hab) || []), a]);
        fixedAdults.set(a.hab, (fixedAdults.get(a.hab) || 0) + 1);
        const s = fixedSex.get(a.hab) || { m: 0, f: 0 };
        if (a.sex === Sex.Male) s.m++;
        else if (a.sex === Sex.Female) s.f++;
        fixedSex.set(a.hab, s);
    }
    Object.assign(ctx, { stayingAt, fixedAdults, fixedSex, fixed: ctx.placeKeys.map(k => fixedAdults.get(k) || 0) });
    ctx.kinWithStaying = kinCounter(ctx, stayingAt);
    ctx.memo.clear();
}

// ------------------------------------------------------------- evaluation

// The breeding pairs of one habitat's (place p) breeders (indices), under the
// make-up. Monogamous mates living together pair with each other only (a
// related couple breeds nothing worth counting, but still takes both out);
// a breeder whose monogamous mate lives there and does not breed (old,
// contracepted) pairs with no one. The rest are matched freely.
function groupPairs(ctx, list, p) {
    if (ctx.rule.leaderMale || ctx.rule.leaderFemale) return leaderPairs(ctx, list);
    if (!ctx.hasMono) return freePairs(ctx, list);
    const here = new Set(list);
    const out = [], free = [];
    const done = new Set();
    for (const i of list) {
        if (done.has(i)) continue;
        const j = ctx.monoMate[i];
        if (j >= 0 && here.has(j)) {
            done.add(i);
            done.add(j);
            const v = ctx.compatible(i, j) ? ctx.pvAny(i, j) : 0;
            if (v > 0) out.push(isMaleSide(ctx.sex[i]) && isFemaleSide(ctx.sex[j]) ? [v, i, j] : [v, j, i]);
        }
        else if (j < 0 && ctx.monoExt[i] >= 0 && ctx.monoExt[i] === p) done.add(i);
        else free.push(i);
    }
    return free.length < 2 ? out : out.concat(freePairs(ctx, free));
}

// Only the leading animal of a sex mates (animals.fdb OnlyLeaderMaleCanMate / FemaleCanMate): the
// leader worth the most with every partner of the other sex, or with leaders of both sexes the
// one best couple. The others of the leader's sex live there without breeding.
function leaderPairs(ctx, list) {
    const males = list.filter(i => isMaleSide(ctx.sex[i]));
    const females = list.filter(i => isFemaleSide(ctx.sex[i]));
    const worth = pairs => pairs.reduce((s, pr) => s + pr[0], 0);
    const pairsWith = (others, pairOf) => others.map(pairOf).filter(pr => pr[1] !== pr[2] && pr[0] > 0);
    let best = [];
    if (ctx.rule.leaderMale && ctx.rule.leaderFemale) {
        for (const m of males) {
            for (const pr of pairsWith(females, f => [ctx.pv(m, f), m, f])) if (!best.length || pr[0] > best[0][0]) best = [pr];
        }
        return best;
    }
    for (const leader of ctx.rule.leaderMale ? males : females) {
        const pairs = ctx.rule.leaderMale
            ? pairsWith(females, f => [ctx.pv(leader, f), leader, f])
            : pairsWith(males, m => [ctx.pv(m, leader), m, leader]);
        if (worth(pairs) > worth(best)) best = pairs;
    }
    return best;
}

// The best pairs among breeders free to choose (maxWeightPairs). A unisex
// animal is on both sides: two of them make one couple (the lower index as
// the father), and it keeps its number of partners over both roles.
function freePairs(ctx, list) {
    const males = [], females = [];
    let unisex = false;
    for (const i of list) {
        if (isMaleSide(ctx.sex[i])) males.push(i);
        if (isFemaleSide(ctx.sex[i])) females.push(i);
        if (ctx.sex[i] === Sex.Unisex) unisex = true;
    }
    if (!unisex) return maxWeightPairs(males, females, ctx.pv, ctx.per.male, ctx.per.female);
    const U = Sex.Unisex;
    const value = (m, f) => (ctx.sex[m] === U && ctx.sex[f] === U && m > f ? 0 : ctx.pv(m, f));
    const pairs = maxWeightPairs(males, females, value, ctx.per.male, ctx.per.female);
    // a unisex animal used as father and as mother: keep its best pairs only
    const most = ctx.per.male === 1 && ctx.per.female === 1 ? 1 : Infinity;
    if (most === Infinity) return pairs;
    const used = new Map();
    return pairs.sort((x, y) => y[0] - x[0]).filter(([, m, f]) => {
        if (ctx.sex[m] !== U && ctx.sex[f] !== U) return true;
        if ((used.get(m) || 0) >= most || (used.get(f) || 0) >= most) return false;
        used.set(m, (used.get(m) || 0) + 1);
        used.set(f, (used.get(f) || 0) + 1);
        return true;
    });
}

function relatedCount(ctx, list) {
    let n = 0;
    for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
            const i = list[x], j = list[y];
            if (ctx.compatible(i, j) && ctx.pvAny(i, j) < 0) n++;
        }
    }
    return n;
}

// Breeders of a place related to adults that stay there anyway (not breeders, not moved).
function residentKin(ctx, p, list) {
    let n = 0;
    for (const i of list) n += ctx.kinWithStaying(i, p) + ctx.kinWithSoon(i, p);
    return n;
}

// Breeders over the make-up: males beyond what the females need (1:3 with
// 4 females: 2); the same for females, and for 1:1 either sex beyond the
// other. Without the game's limits for the species, also beyond the scan's
// guess at its most per sex.
function overStructure(ctx, nm, nf) {
    const r = ctx.rule;
    let allowM = Infinity, allowF = Infinity;
    if (harem(r)) allowM = Math.max(1, Math.ceil(nf / r.f));
    else if (reverseHarem(r)) allowF = Math.max(1, Math.ceil(nm / r.m));
    else if (r.m === 1 && r.f === 1) {
        allowM = Math.max(1, nf);
        allowF = Math.max(1, nm);
    }
    if (!r.capsFromGame && r.maxMales != null) allowM = Math.min(allowM, r.maxMales);
    if (!r.capsFromGame && r.maxFemales != null) allowF = Math.min(allowF, r.maxFemales);
    return Math.max(0, nm - allowM) + Math.max(0, nf - allowF);
}

// Adults over the game's most per sex in a mixed group, every adult counted.
// A breeding habitat is a mixed group even while it holds one sex only, so
// the larger one-sex (bachelor) limits never apply: they would let a
// habitat waiting for females fill up with males.
export function overSexLimits(rule, males, females) {
    if (!rule || !rule.capsFromGame) return 0;
    return (rule.maxMales != null ? Math.max(0, males - rule.maxMales) : 0)
        + (rule.maxFemales != null ? Math.max(0, females - rule.maxFemales) : 0);
}

// Score of one place's breeders (indices); cached by who is there.
function placeScore(ctx, p, list) {
    if (!ctx.groupPlace[p] || !list.length) return 0;
    // key: the place and who is there, as two xor-hashes in one number
    let ha = ctx.zpA[p], hb = ctx.zpB[p];
    for (const i of list) {
        ha ^= ctx.zA[i];
        hb ^= ctx.zB[i];
    }
    const key = hb * 4294967296 + (ha >>> 0);
    const hit = ctx.memo.get(key);
    if (hit !== undefined) return hit;
    const P = ctx.opts;
    let value = 0, penalty = (relatedCount(ctx, list) + residentKin(ctx, p, list)) * P.relatedPenalty;
    for (const pr of groupPairs(ctx, list, p)) value += pr[0];
    for (const i of list) value += ctx.futureMates[i];
    let nm = 0, nf = 0;
    for (const i of list) {
        if (ctx.sex[i] === Sex.Male) nm++;
        else if (ctx.sex[i] === Sex.Female) nf++;
    }
    penalty += overStructure(ctx, nm, nf) * P.structurePenalty;
    if (ctx.rule.oneSire && nm > 1) penalty += (nm - 1) * HARD_LIMIT;
    const staying = ctx.fixedSex.get(ctx.placeKeys[p]) || { m: 0, f: 0 };
    penalty += overSexLimits(ctx.rule, nm + staying.m, nf + staying.f) * HARD_LIMIT;
    const adults = list.length + ctx.fixed[p];
    const cap = ctx.cap[p];
    if (cap != null && adults > cap) penalty += (adults - cap) * P.overCapacityPenalty;
    const lines = new Set();
    for (const i of list) lines.add(ctx.line[i]);
    value += lines.size * P.lineBonus;
    const s = value - penalty;
    if (ctx.memo.size > 200000) ctx.memo.clear();
    ctx.memo.set(key, s);
    return s;
}

function moveCost(ctx, i, p) {
    if (p === ctx.home[i]) return 0;
    return ctx.opts.moveCost + (ctx.groupPlace[p] && ctx.estab[p] ? ctx.opts.outsiderCost : 0)
        + ctx.kinWithYoung(i, p) * ctx.opts.juvenileKinCost;
}

// a bond is broken when one of the two moved and they live apart
function bondBroken(ctx, b, at) {
    const bond = ctx.bonds[b];
    const pa = at(bond.a);
    if (bond.b < 0) return pa !== ctx.home[bond.a] && pa !== bond.ext;
    const pb = at(bond.b);
    return (pa !== ctx.home[bond.a] || pb !== ctx.home[bond.b]) && pa !== pb;
}

function makeState(ctx, place) {
    const members = ctx.placeKeys.map(() => []);
    for (let i = 0; i < ctx.n; i++) members[place[i]].push(i);
    const hs = new Float64Array(ctx.P);
    let total = 0;
    for (let p = 0; p < ctx.P; p++) {
        hs[p] = placeScore(ctx, p, members[p]);
        total += hs[p];
    }
    for (let i = 0; i < ctx.n; i++) total -= moveCost(ctx, i, place[i]);
    const at = i => place[i];
    for (let b = 0; b < ctx.bonds.length; b++) if (bondBroken(ctx, b, at)) total -= ctx.opts.bondBreakCost;
    return { place, members, hs, total };
}

function restore(ctx, st, place) {
    Object.assign(st, makeState(ctx, Int32Array.from(place)));
}

// The change in score if breeders move: changes = [[i, place], ...].
function evaluate(ctx, st, changes) {
    ctx.budget.evals++;
    const moved = new Map();
    for (const [i, q] of changes) {
        if (st.place[i] === q) continue;
        // a pinned (pregnant) breeder never leaves home
        if (ctx.pinned[i] && q !== ctx.home[i]) return null;
        moved.set(i, q);
    }
    if (!moved.size) return null;
    const lists = new Map();
    for (const [i, q] of moved) {
        const p = st.place[i];
        if (!lists.has(p)) lists.set(p, st.members[p].slice());
        if (!lists.has(q)) lists.set(q, st.members[q].slice());
    }
    for (const [i, q] of moved) {
        const lp = lists.get(st.place[i]);
        lp.splice(lp.indexOf(i), 1);
        lists.get(q).push(i);
    }
    let d = 0;
    const scores = new Map();
    for (const [p, list] of lists) {
        const s = placeScore(ctx, p, list);
        scores.set(p, s);
        d += s - st.hs[p];
    }
    for (const [i, q] of moved) d -= moveCost(ctx, i, q) - moveCost(ctx, i, st.place[i]);
    if (ctx.bonds.length) {
        const after = i => (moved.has(i) ? moved.get(i) : st.place[i]);
        const before = i => st.place[i];
        const seen = new Set();
        for (const i of moved.keys()) {
            for (const b of ctx.bondsOf[i]) {
                if (seen.has(b)) continue;
                seen.add(b);
                d -= ctx.opts.bondBreakCost * (bondBroken(ctx, b, after) - bondBroken(ctx, b, before));
            }
        }
    }
    return { d, moved, lists, scores };
}

function apply(st, ev) {
    if (!ev) return;
    for (const [i, q] of ev.moved) st.place[i] = q;
    for (const [p, list] of ev.lists) {
        st.members[p] = list;
        st.hs[p] = ev.scores.get(p);
    }
    st.total += ev.d;
}

// ----------------------------------------------------------------- search
//
// The search steps are generators: they yield now and then (a progress
// fraction) so the page can run them in short slices (planProgrammeAsync)
// and the game's UI never stalls; planProgramme runs them in one go.

// Every layout (few breeders): the best score, then the fewest moves.
function* exhaustive(ctx, st, count) {
    let best = { total: st.total, moves: 0, place: Int32Array.from(st.place) };
    let leaves = 0;
    function* rec(k, moves) {
        if (k === ctx.n) {
            if (st.total > best.total + EPS || (st.total > best.total - EPS && moves < best.moves)) {
                best = { total: st.total, moves, place: Int32Array.from(st.place) };
            }
            if ((++leaves & 1023) === 0) yield leaves / count;
            return;
        }
        for (const q of ctx.targetsOf[k]) {
            const from = st.place[k];
            const mv = moves + (q !== ctx.home[k] ? 1 : 0);
            if (q === from) {
                yield* rec(k + 1, mv);
                continue;
            }
            apply(st, evaluate(ctx, st, [[k, q]]));
            yield* rec(k + 1, mv);
            apply(st, evaluate(ctx, st, [[k, from]]));
        }
    }
    yield* rec(0, 0);
    return best.place;
}

function layoutCount(ctx, limit) {
    let n = 1;
    for (const t of ctx.targetsOf) {
        n *= t.length;
        if (n > limit) return Infinity;
    }
    return n;
}

const progress = ctx => (ctx.progressOf ? ctx.progressOf() : Math.min(0.99, ctx.budget.evals / ctx.budget.limit));

// Improve until no step helps: move one breeder (to its best place), swap
// two in different places, move a male and a female together into a
// habitat. Cheaper steps first. `only`: move only these breeders.
function* localSearch(ctx, st, { swaps = true, pairs = true, only = null } = {}) {
    const B = ctx.budget;
    const order = only || ctx.all;
    let improved = true;
    while (improved && !B.out()) {
        improved = false;
        for (const i of order) {
            let best = null;
            for (const q of ctx.targetsOf[i]) {
                if (q === st.place[i]) continue;
                const ev = evaluate(ctx, st, [[i, q]]);
                if (ev && ev.d > EPS && (!best || ev.d > best.d)) best = ev;
            }
            if (best) {
                apply(st, best);
                improved = true;
            }
            if (B.out()) return;
        }
        yield progress(ctx);
        if (improved || !swaps) continue;
        for (let x = 0; x < order.length && !B.out(); x++) {
            for (let y = x + 1; y < order.length; y++) {
                const i = order[x], j = order[y];
                const p = st.place[i], q = st.place[j];
                if (p === q || !ctx.canGo(i, q) || !ctx.canGo(j, p)) continue;
                const ev = evaluate(ctx, st, [[i, q], [j, p]]);
                if (ev && ev.d > EPS) {
                    apply(st, ev);
                    improved = true;
                }
            }
            if ((x & 7) === 7) yield progress(ctx);
        }
        if (improved || !pairs) continue;
        let best = null;
        for (const m of ctx.maleSide) {
            if (B.out()) break;
            for (const f of ctx.femaleSide) {
                if (m === f || ctx.pv(m, f) <= 0) continue;
                for (const q of ctx.groupPlaces) {
                    // one of them there already: a single move (above)
                    if (st.place[m] === q || st.place[f] === q) continue;
                    const ev = evaluate(ctx, st, [[m, q], [f, q]]);
                    if (ev && ev.d > EPS && (!best || ev.d > best.d)) best = ev;
                }
            }
            yield progress(ctx);
        }
        if (best) {
            apply(st, best);
            improved = true;
        }
    }
}

function shuffle(list, rnd) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = list[i];
        list[i] = list[j];
        list[j] = t;
    }
    return list;
}

// Take some breeders out (to the trade centre) and put them back one at a
// time, each where it does the most good; a male and a female still out
// may go in together (a new group). -> the breeders that were taken out.
function ruinRecreate(ctx, st, rnd) {
    const n = ctx.n;
    const pick = list => list[Math.floor(rnd() * list.length)];
    const out = new Set();
    const groups = ctx.groupPlaces.filter(p => st.members[p].length);
    const r = rnd();
    if (r < 0.4 && groups.length) {
        // the breeders of one or two habitats
        const first = pick(groups);
        for (const i of st.members[first]) out.add(i);
        if (groups.length > 1 && rnd() < 0.5) {
            const second = pick(groups);
            if (second !== first) for (const i of st.members[second]) out.add(i);
        }
    }
    else if (r < 0.7) {
        // a few at random
        const k = 2 + Math.floor(rnd() * Math.max(1, Math.min(8, Math.ceil(n / 3))));
        for (let t = 0; t < k; t++) out.add(Math.floor(rnd() * n));
    }
    else {
        // one breeder's group, and rivals of its sex from elsewhere
        const i = Math.floor(rnd() * n);
        for (const j of st.members[st.place[i]]) out.add(j);
        const rivals = ctx.all.filter(j => ctx.sex[j] === ctx.sex[i] && st.place[j] !== st.place[i]);
        for (let t = 0; t < 3 && rivals.length; t++) out.add(pick(rivals));
    }
    // breeders waiting without a group join in now and then
    const waiting = st.members[ctx.trade];
    if (waiting.length && rnd() < 0.5) for (let t = 0; t < 2; t++) out.add(pick(waiting));
    let list = shuffle(Array.from(out).filter(i => !ctx.pinned[i]), rnd);
    const most = Math.max(6, Math.ceil(n * 0.4));
    if (list.length > most) list = list.slice(0, most);
    const ev = evaluate(ctx, st, list.map(i => [i, ctx.trade]));
    if (ev) apply(st, ev);
    for (const _ of placeBack(ctx, st, list)) { /* run to the end */ }
    return list;
}

// Put breeders back one at a time, each where it does the most good; a
// male and a female still out may go in together (a new group). Yields
// now and then (the deep search's rebuilds put back every breeder).
function* placeBack(ctx, st, list) {
    const left = new Set(list);
    let placed = 0;
    for (const i of list) {
        if (!left.has(i)) continue;
        left.delete(i);
        let best = null, partner = -1;
        for (const q of ctx.targetsOf[i]) {
            if (q === st.place[i]) continue;
            const e = evaluate(ctx, st, [[i, q]]);
            if (e && (!best || e.d > best.d)) best = e;
        }
        const partners = Array.from(left).filter(j => ctx.compatible(i, j) && ctx.pvAny(i, j) > 0)
            .sort((x, y) => ctx.pvAny(i, y) - ctx.pvAny(i, x)).slice(0, 2);
        for (const j of partners) {
            for (const q of ctx.groupPlaces) {
                if (!ctx.canGo(i, q) || !ctx.canGo(j, q)) continue;
                const e = evaluate(ctx, st, [[i, q], [j, q]]);
                if (e && (!best || e.d > best.d)) {
                    best = e;
                    partner = j;
                }
            }
        }
        if (best && best.d > EPS) {
            apply(st, best);
            if (partner >= 0 && best.moved.has(partner)) left.delete(partner);
        }
        if ((++placed & 7) === 0) yield progress(ctx);
    }
}

// The sexes the search places all at once (reassign): the plentiful one
// (females under a harem or mixed groups, males under any:1), both for 1:1.
function plentifulSides(ctx) {
    const r = ctx.rule;
    if (reverseHarem(r)) return ['M'];
    if (r && r.m === 1 && r.f === 1) return ['F', 'M'];
    return ['F'];
}

// Every breeder of one sex placed at once, the best way given where the
// other sex is: an assignment (Hungarian method) of those breeders to the
// places in each habitat (its room) and, where partners are limited (1:1,
// 1:3), to their partners' free places. A place is worth the pair's value,
// less the relatives living there and the move. The make-up's penalties and
// bonds are left to the exact score: the result is a proposal, scored and
// kept only if the zoo is better. side: 'F' or 'M'. -> evaluate() or null.
function reassign(ctx, st, side) {
    // pinned (pregnant) breeders stay: they are partners, never movers
    const movers = ctx.all.filter(i => ctx.sex[i] === (side === 'F' ? Sex.Female : Sex.Male) && !ctx.pinned[i]);
    if (!movers.length) return null;
    const isMover = new Uint8Array(ctx.n);
    for (const i of movers) isMover[i] = 1;
    const perPartner = side === 'F' ? ctx.per.male : ctx.per.female;
    const partnerSide = side === 'F' ? isMaleSide : isFemaleSide;
    const capSide = side === 'F' ? ctx.rule.maxFemales : ctx.rule.maxMales;
    const pvOf = (x, i) => (side === 'F' ? ctx.pv(x, i) : ctx.pv(i, x));
    const cols = [];      // { p, x (partner or -1), own (one mover only, or -1) }
    for (const p of ctx.groupPlaces) {
        const stay = st.members[p].filter(i => !isMover[i]);
        const partners = stay.filter(i => partnerSide(ctx.sex[i]));
        let room = ctx.cap[p] == null ? movers.length : ctx.cap[p] - ctx.fixed[p] - stay.length;
        if (capSide != null) room = Math.min(room, capSide);
        room = Math.min(room, movers.length);
        if (room <= 0) continue;
        if (perPartner >= movers.length) {
            for (let k = 0; k < room; k++) cols.push({ p, x: -2, own: -1, partners });
        }
        else {
            let used = 0;
            for (const x of partners) for (let k = 0; k < perPartner && used < room; k++, used++) cols.push({ p, x, own: -1, partners });
            for (; used < room; used++) cols.push({ p, x: -1, own: -1, partners });
        }
    }
    // the places outside any group (the trade centre, a home elsewhere), and
    // a home outside the allowed habitats: one each, for that breeder only
    for (const i of movers) {
        for (const q of ctx.targetsOf[i]) {
            if (!ctx.groupPlace[q]) cols.push({ p: q, x: -1, own: i, partners: [] });
            else if (!ctx.allowedPlace[q]) cols.push({ p: q, x: -2, own: i, partners: st.members[q].filter(y => !isMover[y] && partnerSide(ctx.sex[y])) });
        }
    }
    const n = movers.length, m = cols.length;
    if (m < n) return null;
    const P = ctx.opts;
    const cost = new Float64Array(n * m);
    // per mover and place, as a place has many columns: the move and the
    // relatives there, and its best partner there
    const baseOf = new Float64Array(n * ctx.P).fill(NaN), bestOf = new Float64Array(n * ctx.P);
    for (let a = 0; a < n; a++) {
        const i = movers[a];
        for (let b = 0; b < m; b++) {
            const c = cols[b];
            if ((c.own >= 0 && c.own !== i) || !ctx.canGo(i, c.p)) {
                cost[a * m + b] = 1e6;
                continue;
            }
            const key = a * ctx.P + c.p;
            if (Number.isNaN(baseOf[key])) {
                let base = -moveCost(ctx, i, c.p), best = 0;
                if (ctx.groupPlace[c.p]) {
                    let rel = 0;
                    for (const y of st.members[c.p]) if (!isMover[y] && ctx.compatible(i, y) && ctx.pvAny(i, y) < 0) rel++;
                    base -= rel * P.relatedPenalty;
                    for (const x of c.partners) best = Math.max(best, pvOf(x, i));
                }
                baseOf[key] = base;
                bestOf[key] = best;
            }
            let v = baseOf[key];
            if (ctx.groupPlace[c.p]) {
                if (c.x >= 0) v += Math.max(0, pvOf(c.x, i));
                else if (c.x === -2) v += bestOf[key];
            }
            cost[a * m + b] = -v;
        }
    }
    const match = hungarian(n, m, cost);
    ctx.budget.evals += Math.ceil(n * m / 4);
    const changes = [];
    for (let a = 0; a < n; a++) {
        const b = match[a];
        if (b < 0 || cost[a * m + b] >= 1e5) return null;
        if (cols[b].p !== st.place[movers[a]]) changes.push([movers[a], cols[b].p]);
    }
    return changes.length ? evaluate(ctx, st, changes) : null;
}

// The scarce sex placed at once, given where the plentiful sex is: each
// habitat takes as many as the make-up allows for its plentiful breeders
// (a harem: one male), each worth the pairs it would make there (its best
// partners up to its number of partners), less relatives and the move. A
// proposal like reassign(), kept only if the zoo scores better.
function reassignScarce(ctx, st, side) {
    const r = ctx.rule;
    if (!r || r.m == null || (r.m === 1 && r.f === 1)) return null;
    const movers = ctx.all.filter(i => ctx.sex[i] === (side === 'M' ? Sex.Male : Sex.Female) && !ctx.pinned[i]);
    if (!movers.length) return null;
    const isMover = new Uint8Array(ctx.n);
    for (const i of movers) isMover[i] = 1;
    const k = side === 'M' ? ctx.per.male : ctx.per.female;           // partners of one scarce animal
    const ratioOther = side === 'M' ? r.f : r.m;
    const capSide = side === 'M' ? r.maxMales : r.maxFemales;
    const plentiful = side === 'M' ? isFemaleSide : isMaleSide;
    const pvOf = (i, x) => (side === 'M' ? ctx.pv(i, x) : ctx.pv(x, i));
    const cols = [];
    for (const p of ctx.groupPlaces) {
        const stay = st.members[p].filter(i => !isMover[i]);
        const partners = stay.filter(i => plentiful(ctx.sex[i]));
        let slots = Math.max(1, Math.ceil(partners.length / ratioOther));
        if (capSide != null) slots = Math.min(slots, capSide);
        if (ctx.cap[p] != null) slots = Math.min(slots, ctx.cap[p] - ctx.fixed[p] - stay.length);
        for (let t = 0; t < Math.min(slots, movers.length); t++) cols.push({ p, partners });
    }
    for (const i of movers) {
        for (const q of ctx.targetsOf[i]) {
            if (!ctx.groupPlace[q]) cols.push({ p: q, own: i, partners: [] });
            else if (!ctx.allowedPlace[q]) cols.push({ p: q, own: i, partners: st.members[q].filter(y => !isMover[y] && plentiful(ctx.sex[y])) });
        }
    }
    const n = movers.length, m = cols.length;
    if (m < n) return null;
    const P = ctx.opts;
    const cost = new Float64Array(n * m);
    const worth = new Map();
    for (let a = 0; a < n; a++) {
        const i = movers[a];
        for (let b = 0; b < m; b++) {
            const c = cols[b];
            if ((c.own != null && c.own !== i) || !ctx.canGo(i, c.p)) {
                cost[a * m + b] = 1e6;
                continue;
            }
            let v = -moveCost(ctx, i, c.p);
            if (ctx.groupPlace[c.p]) {
                const key = i * ctx.P + c.p;
                let w = worth.get(key);
                if (w === undefined) {
                    let rel = 0;
                    const vals = [];
                    for (const y of st.members[c.p]) {
                        if (isMover[y] || !ctx.compatible(i, y)) continue;
                        if (ctx.pvAny(i, y) < 0) rel++;
                        else if (plentiful(ctx.sex[y])) vals.push(Math.max(0, pvOf(i, y)));
                    }
                    vals.sort((x, y) => y - x);
                    w = -rel * P.relatedPenalty;
                    for (let t = 0; t < Math.min(k, vals.length); t++) w += vals[t];
                    worth.set(key, w);
                }
                v += w;
            }
            cost[a * m + b] = -v;
        }
    }
    const match = hungarian(n, m, cost);
    ctx.budget.evals += Math.ceil(n * m / 4);
    const changes = [];
    for (let a = 0; a < n; a++) {
        const b = match[a];
        if (b < 0 || cost[a * m + b] >= 1e5) return null;
        if (cols[b].p !== st.place[movers[a]]) changes.push([movers[a], cols[b].p]);
    }
    return changes.length ? evaluate(ctx, st, changes) : null;
}

// Place each sex at once (the plentiful one, then the scarce one) until
// that no longer helps.
function intensify(ctx, st, rounds = 6) {
    let any = false;
    const sides = plentifulSides(ctx);
    const scarce = sides.length === 1 ? (sides[0] === 'F' ? 'M' : 'F') : null;
    for (let round = 0; round < rounds; round++) {
        let improved = false;
        for (const side of sides) {
            const ev = reassign(ctx, st, side);
            if (ev && ev.d > EPS) {
                apply(st, ev);
                improved = any = true;
            }
        }
        if (scarce) {
            const ev = reassignScarce(ctx, st, scarce);
            if (ev && ev.d > EPS) {
                apply(st, ev);
                improved = any = true;
            }
        }
        if (!improved) break;
    }
    return any;
}

// A kick: move one or two breeders of the scarce sex (or anyone, now and
// then) somewhere at random, then place the plentiful sex again around
// them. -> the breeders the kick moved.
function kick(ctx, st, rnd) {
    const side = plentifulSides(ctx)[0];
    const scarce = ctx.all.filter(i => ctx.sex[i] !== (side === 'F' ? Sex.Female : Sex.Male));
    const pool = scarce.length && rnd() < 0.8 ? scarce : ctx.all;
    // the heads of groups (the pool's breeders in a habitat) and the others
    const heads = pool.filter(i => ctx.groupPlace[st.place[i]]);
    const moved = [];
    const k = 1 + (rnd() < 0.4 ? 1 : 0);
    for (let t = 0; t < k; t++) {
        const i = heads.length && rnd() < 0.7 ? heads[Math.floor(rnd() * heads.length)] : pool[Math.floor(rnd() * pool.length)];
        if (rnd() < 0.5) {
            const others = pool.filter(j => st.place[j] !== st.place[i]);
            if (!others.length) continue;
            const j = others[Math.floor(rnd() * others.length)];
            const p = st.place[i], q = st.place[j];
            if (p !== q && ctx.canGo(i, q) && ctx.canGo(j, p)) {
                apply(st, evaluate(ctx, st, [[i, q], [j, p]]));
                moved.push(i, j);
            }
        }
        else {
            const tg = ctx.targetsOf[i];
            const q = tg[Math.floor(rnd() * tg.length)];
            if (q !== st.place[i]) {
                apply(st, evaluate(ctx, st, [[i, q]]));
                moved.push(i);
            }
        }
    }
    intensify(ctx, st, 2);
    return moved;
}

// The best layout found: { place (Int32Array of place indices), exact
// (every layout was scored) }. Few breeders: every layout. More: local
// search and both sexes placed at once, then rounds of a kick (80%: one or
// two breeders of the scarce sex moved, the rest placed again around them)
// or a ruin and recreate (20%), each settled by local search and kept or
// not by simulated annealing; the best layout seen wins, polished at the
// end.
function* solveLayout(ctx) {
    const st = makeState(ctx, Int32Array.from(ctx.home));
    const count = layoutCount(ctx, ctx.opts.exactLimit);
    if (count <= ctx.opts.exactLimit) return { place: yield* exhaustive(ctx, st, count), exact: true };
    yield* localSearch(ctx, st);
    if (intensify(ctx, st)) yield* localSearch(ctx, st);
    yield progress(ctx);
    const rounds = Math.min(6000, 300 + 40 * ctx.n);
    const { place } = yield* annealRounds(ctx, st, ctx.rnd, rounds, { stopAt: Math.floor(ctx.budget.limit * 0.85) });
    return { place, exact: false };
}

// Rounds of a kick, a ruin and recreate or (with `repair`) an exact repair,
// each settled by local search and kept or not by simulated annealing
// (cooling over the rounds), until `stopAt` evaluations; then the best
// layout seen, polished. -> { total, place }
function* annealRounds(ctx, st, rnd, rounds, { stopAt = Infinity, repair = false, yieldEvery = 1 } = {}) {
    const B = ctx.budget;
    const best = { total: st.total, place: Int32Array.from(st.place) };
    const T0 = 0.03, T1 = 0.001;
    const cool = Math.pow(T1 / T0, 1 / Math.max(1, rounds));
    let T = T0;
    for (let it = 0; it < rounds && B.evals < stopAt && !B.out(); it++) {
        const snap = Int32Array.from(st.place);
        const before = st.total;
        const r = rnd();
        let list = [];
        if (repair && r < 0.1) yield* repairExact(ctx, st, rnd);
        else list = r < 0.8 ? kick(ctx, st, rnd) : ruinRecreate(ctx, st, rnd);
        // settle: the breeders moved and the groups they joined
        const touched = new Set(list);
        for (const i of list) for (const j of st.members[st.place[i]]) touched.add(j);
        if (touched.size) yield* localSearch(ctx, st, { swaps: false, pairs: false, only: Array.from(touched) });
        const d = st.total - before;
        if (d > -EPS || rnd() < Math.exp(d / T)) {
            if (st.total > best.total + EPS) {
                best.total = st.total;
                best.place = Int32Array.from(st.place);
            }
        }
        else restore(ctx, st, snap);
        T *= cool;
        if (it % yieldEvery === yieldEvery - 1) yield progress(ctx);
    }
    restore(ctx, st, best.place);
    intensify(ctx, st);
    yield* localSearch(ctx, st);
    return { total: st.total, place: Int32Array.from(st.place) };
}

// ------------------------------------------------------------ deep search
//
// The deep engine (opts.engine 'deep'): start 0 is the Classic plan; then
// `starts` more searches, in rounds of four. Each start rebuilds part or all
// of the best layout of the rounds before it and runs the classic search's
// steps for `effort` times its rounds, with exact repairs (the breeders of
// two or three habitats placed again in every possible way). A round's
// starts depend only on the layout it began with, so they could run side by
// side, and a stopped search continues where it stopped with the same
// result. Never worse than Classic: its plan is the first best. Measured
// against an exact solver (MILP, 2026-10-18): Classic is 2.6 % short on
// average for 70-100 breeders (up to 14 %), 30 s of deep search 0.6 %
// (docs/RESEARCH-breeding-optimisation.md).

const DEEP_ROUND = 4;
const REPAIR = { off: null, light: { habitats: 2, limit: 2000 }, strong: { habitats: 3, limit: 20000 } };

// Every way of placing a few breeders among a few places (the repair's
// core): a depth-first walk that keeps the best. -> true if it improved.
function* exactPlace(ctx, st, movers, placesOf) {
    const n = movers.length;
    const startTotal = st.total;
    let best = { total: st.total, place: movers.map(i => st.place[i]) };
    let leaves = 0;
    function* rec(k) {
        if (ctx.budget.out()) return;
        if (k === n) {
            if (st.total > best.total + EPS) best = { total: st.total, place: movers.map(i => st.place[i]) };
            if ((++leaves & 1023) === 0) yield progress(ctx);
            return;
        }
        const i = movers[k];
        for (const q of placesOf[k]) {
            const from = st.place[i];
            if (q === from) {
                yield* rec(k + 1);
                continue;
            }
            const ev = evaluate(ctx, st, [[i, q]]);
            if (!ev) continue;
            apply(st, ev);
            yield* rec(k + 1);
            apply(st, evaluate(ctx, st, [[i, from]]));
        }
    }
    yield* rec(0);
    if (best.total > startTotal + EPS) {
        const ev = evaluate(ctx, st, movers.map((i, k) => [i, best.place[k]]));
        if (ev) apply(st, ev);
        return true;
    }
    return false;
}

// The exact repair: the breeders of a few habitats (half the time, plus an
// empty habitat to found a group in) and up to two from the trade centre
// placed again in every possible way among those places, the trade centre
// and their homes, within the strength's layout limit (the breeders with
// the most choices are left where they are until it fits).
function* repairExact(ctx, st, rnd) {
    const R = REPAIR[ctx.opts.repair];
    if (!R) return false;
    const used = ctx.groupPlaces.filter(p => st.members[p].length);
    if (!used.length) return false;
    shuffle(used, rnd);
    const chosen = used.slice(0, Math.min(used.length, R.habitats));
    const empty = ctx.groupPlaces.filter(p => !st.members[p].length);
    if (empty.length && rnd() < 0.5) chosen.push(empty[Math.floor(rnd() * empty.length)]);
    const places = new Set(chosen);
    places.add(ctx.trade);
    let movers = [];
    for (const p of chosen) movers.push(...st.members[p]);
    const waiting = st.members[ctx.trade];
    for (let t = 0; t < 2 && waiting.length; t++) movers.push(waiting[Math.floor(rnd() * waiting.length)]);
    movers = shuffle(Array.from(new Set(movers)), rnd);
    const opts = movers.map(i => ctx.targetsOf[i].filter(q => places.has(q) || q === ctx.home[i] || q === st.place[i]));
    let count = opts.reduce((c, o) => c * o.length, 1);
    while (count > R.limit && movers.length > 1) {
        let k = 0;
        for (let t = 1; t < movers.length; t++) if (opts[t].length > opts[k].length) k = t;
        count /= opts[k].length;
        movers.splice(k, 1);
        opts.splice(k, 1);
    }
    if (count <= 1) return false;
    ctx.budget.evals++;
    return yield* exactPlace(ctx, st, movers, opts);
}

// A start built afresh: a share of the breeders (all: frac 1) taken out
// and put back one at a time where they do the most good.
function* rebuild(ctx, st, rnd, frac) {
    const free = ctx.all.filter(i => ctx.targetsOf[i].length > 1);
    if (!free.length) return;
    const list = shuffle(free, rnd).slice(0, Math.max(1, Math.round(free.length * frac)));
    const ev = evaluate(ctx, st, list.map(i => [i, ctx.trade]));
    if (ev) apply(st, ev);
    yield* placeBack(ctx, st, list);
}

// One start: a settle, then the annealing rounds with exact repairs.
// -> the start's best { total, place }.
function* deepStart(ctx, st, rnd, rounds) {
    yield* localSearch(ctx, st);
    if (intensify(ctx, st)) yield* localSearch(ctx, st);
    return yield* annealRounds(ctx, st, rnd, rounds, { repair: !!REPAIR[ctx.opts.repair], yieldEvery: 4 });
}

// Moves [{id, to}] -> a layout (from home): moves of animals that are not
// breeders here, to unknown places or to places they may not go, are left
// out (a plan from an older scan, a breeder now pinned).
function layoutFromMoves(ctx, moves) {
    const place = Int32Array.from(ctx.home);
    const index = new Map(ctx.B.map((a, i) => [String(a.id), i]));
    for (const m of moves || []) {
        const i = index.get(String(m.id));
        const p = ctx.placeOf.get(m.to);
        if (i != null && p != null && ctx.canGo(i, p)) place[i] = p;
    }
    return place;
}

const movesOf = (ctx, place) => ctx.B.map((a, i) => (place[i] === ctx.home[i] ? null : { id: a.id, to: ctx.placeKeys[place[i]] })).filter(Boolean);

// The deep engine. -> { place, exact, starts (searched), bestStart,
// stopped ('time' | 'stop' | null), resume ({ round, base } to continue,
// or null when it finished), msPerStart }.
function* solveDeep(ctx) {
    const O = ctx.opts;
    const st = makeState(ctx, Int32Array.from(ctx.home));
    const count = layoutCount(ctx, O.exactLimit);
    if (count <= O.exactLimit) return { place: yield* exhaustive(ctx, st, count), exact: true, starts: 0, bestStart: 0 };
    const wall = makeBudget({ maxEvaluations: Infinity, timeBudgetMs: O.wallLimitMs > 0 ? O.wallLimitMs : Infinity, clock: wallClock, stop: O.stop });
    const K = Math.max(1, Math.floor(O.starts));
    const roundsOfStarts = Math.ceil(K / DEEP_ROUND);
    let round = 0, base;
    if (O.resume && Array.isArray(O.resume.base) && O.resume.round >= 0) {
        round = Math.min(roundsOfStarts, Math.floor(O.resume.round));
        base = layoutFromMoves(ctx, O.resume.base);
    }
    else if (Array.isArray(O.warm)) base = layoutFromMoves(ctx, O.warm);
    else {
        // start 0: the Classic search, with the board's budget
        ctx.budget = makeBudget(Object.assign({}, O, O.classic, { stop: null }));
        base = (yield* solveLayout(ctx)).place;
    }
    ctx.budget = wall;
    restore(ctx, st, base);
    // shown: the best seen (the plan); best: the best at the start of the round
    let best = { total: st.total, place: Int32Array.from(base) };
    let shown = best, bestStart = 0, done = Math.min(K, round * DEEP_ROUND), quiet = 0;
    if (O.resume && Array.isArray(O.resume.base)) {
        // Continue: the plan shown when it stopped stays the plan unless a
        // start beats it; the quiet rounds count on (Stop early)
        quiet = Math.max(0, Math.floor(O.resume.quiet || 0));
        bestStart = Math.max(0, Math.floor(O.resume.bestStart || 0));
        if (Array.isArray(O.resume.shown)) {
            restore(ctx, st, layoutFromMoves(ctx, O.resume.shown));
            if (st.total > shown.total + EPS) shown = { total: st.total, place: Int32Array.from(st.place) };
            restore(ctx, st, base);
        }
    }
    const steps = Math.max(50, Math.round(Math.min(6000, 300 + 40 * ctx.n) * Math.max(0.1, O.effort)));
    const time = Number.isFinite(O.wallLimitMs) && O.wallLimitMs > 0 ? O.wallLimitMs : null;
    ctx.progressOf = () => Math.min(0.99, Math.max(done / K, time ? wall.ms() / time : 0));
    let stopped = null, resume = null;
    for (; round < roundsOfStarts; round++) {
        const roundBase = best;
        let roundBest = roundBase;
        for (let k = 0; k < DEEP_ROUND; k++) {
            const s = round * DEEP_ROUND + k + 1;
            if (s > K) break;
            if (wall.out()) break;
            const rnd = randomSource(hashSeed(`${ctx.seedKey}|start ${s}`));
            restore(ctx, st, roundBase.place);
            yield* rebuild(ctx, st, rnd, s % 2 ? 0.25 + 0.25 * rnd() : 1);
            const r = yield* deepStart(ctx, st, rnd, steps);
            if (wall.out()) {
                // cut short: keep what it found for the plan, not for Continue
                if (r.total > shown.total + EPS) shown = { total: r.total, place: Int32Array.from(r.place) };
                break;
            }
            done++;
            if (r.total > roundBest.total + EPS) roundBest = { total: r.total, place: Int32Array.from(r.place), s };
            if (r.total > shown.total + EPS) {
                shown = { total: r.total, place: Int32Array.from(r.place) };
                bestStart = s;
            }
            // the page's progress text (start 5 of 32, best at 3)
            if (typeof O.onStart === 'function') {
                try {
                    O.onStart({ done, planned: K, bestStart, total: shown.total, ms: wall.ms() });
                }
                catch (e) {
                    // the page's business
                }
            }
            yield progress(ctx);
        }
        if (wall.out()) {
            stopped = wall.stopped ? 'stop' : 'time';
            resume = { round, base: movesOf(ctx, roundBase.place), shown: movesOf(ctx, shown.place), quiet, bestStart };
            break;
        }
        quiet = roundBest === roundBase ? quiet + 1 : 0;
        best = roundBest;
        if (O.patience > 0 && quiet >= O.patience) break;
    }
    // a last polish of exact repairs on the best layout
    restore(ctx, st, shown.place);
    if (!stopped && REPAIR[O.repair]) {
        const rnd = randomSource(hashSeed(`${ctx.seedKey}|polish`));
        let calm = 0;
        for (let t = 0; t < 4 * ctx.groupPlaces.length && calm < ctx.groupPlaces.length && !wall.out(); t++) {
            if (yield* repairExact(ctx, st, rnd)) {
                calm = 0;
                yield* localSearch(ctx, st);
            }
            else calm++;
        }
        if (wall.out()) {
            // cut short in the polish: Continue runs the polish again
            stopped = wall.stopped ? 'stop' : 'time';
            resume = { round: roundsOfStarts, base: movesOf(ctx, best.place), shown: movesOf(ctx, shown.place), quiet, bestStart };
        }
        intensify(ctx, st);
        yield* localSearch(ctx, st);
    }
    const place = st.total > shown.total + EPS ? Int32Array.from(st.place) : shown.place;
    return { place, exact: false, starts: done, bestStart, stopped, resume, msPerStart: done ? Math.round(wall.ms() / Math.max(1, done - (O.resume ? O.resume.round * DEEP_ROUND : 0))) : null };
}

// Undo every move the layout does not need: alone, then two at a time.
function prune(ctx, place) {
    const st = makeState(ctx, Int32Array.from(place));
    let again = true;
    while (again) {
        again = false;
        for (let i = 0; i < ctx.n; i++) {
            if (st.place[i] === ctx.home[i]) continue;
            const ev = evaluate(ctx, st, [[i, ctx.home[i]]]);
            if (ev && ev.d >= -EPS) {
                apply(st, ev);
                again = true;
            }
        }
        if (again) continue;
        const moved = ctx.all.filter(i => st.place[i] !== ctx.home[i]);
        for (let x = 0; x < moved.length && !again; x++) {
            for (let y = x + 1; y < moved.length; y++) {
                const i = moved[x], j = moved[y];
                const ev = evaluate(ctx, st, [[i, ctx.home[i]], [j, ctx.home[j]]]);
                if (ev && ev.d >= -EPS) {
                    apply(st, ev);
                    again = true;
                    break;
                }
            }
        }
    }
    return st.place;
}

// The adults in a habitat after the plan: its breeders there and the adults that stay anyway.
function adultsAt(ctx, place, hab) {
    const out = (ctx.stayingAt.get(hab) || []).slice();
    for (let i = 0; i < ctx.n; i++) if (ctx.placeKeys[place[i]] === hab) out.push(ctx.B[i]);
    return out;
}

// The make-up's places per sex in a habitat when spare adults go out (option spareOut), else null.
function makeupPlaces(ctx, hab) {
    const cap = ctx.capacity.has(hab) ? ctx.capacity.get(hab) : null;
    const target = ctx.opts.spareOut !== false && cap != null ? groupTarget(ctx.rule, cap) : null;
    return target ? { [Sex.Male]: target.males, [Sex.Female]: target.females } : null;
}

// Why non-breeding adult `a` can't live with `adults` in `hab`, or null when it can.
function misfit(ctx, a, adults, hab) {
    const cap = ctx.capacity.has(hab) ? ctx.capacity.get(hab) : null;
    if (adults.some(b => kinPair(ctx.model, a, b))) return 'kin';
    if ((ctx.soonAt.get(hab) || []).some(b => kinPair(ctx.model, a, b))) return 'soon';
    const count = (list, sex) => list.filter(b => b.sex === sex).length;
    const m = count(adults, Sex.Male), f = count(adults, Sex.Female);
    const add = sex => (a.sex === sex ? 1 : 0);
    if (overSexLimits(ctx.rule, m + add(Sex.Male), f + add(Sex.Female)) > overSexLimits(ctx.rule, m, f)) return 'limit';
    if (cap != null && adults.length + 1 > cap) return 'room';
    const places = makeupPlaces(ctx, hab);
    if (places && count(adults, a.sex) >= places[a.sex]) return 'makeup';
    return null;
}

// Which non-breeding adults (ctx.spares) stay where they are, contracepted
// ones first (they can breed again), then the best own genes. One leaves
// (with why) when it is related to an adult of the other sex there, would
// take the habitat over the game's most per sex or its room, or, with
// spare adults going out (option spareOut), can never breed again or finds
// the make-up's places for its sex taken. -> { kept, leave: [{ a, why }] }
function keepSpares(ctx, place) {
    const kept = [], leave = [];
    if (!ctx.spares || !ctx.spares.length) return { kept, leave };
    const byHab = new Map();
    for (const a of ctx.spares) {
        if (!byHab.has(a.hab)) byHab.set(a.hab, []);
        byHab.get(a.hab).push(a);
    }
    const order = (x, y) => (y.contra ? 1 : 0) - (x.contra ? 1 : 0) || ownGeneScore(y) - ownGeneScore(x) || (String(x.id) < String(y.id) ? -1 : 1);
    for (const [hab, list] of byHab) {
        const adults = adultsAt(ctx, place, hab);
        const keptHere = [];
        for (const a of list.slice().sort(order)) {
            const out = ctx.opts.spareOut !== false;
            const why = out && noFertility(a) ? 'nofert' : out && ctx.weak.has(a.id) ? 'weak' : out && !canEverBreed(a) ? 'never' : misfit(ctx, a, adults, hab);
            if (why) leave.push({ a, why });
            else {
                keptHere.push(a);
                adults.push(a);
            }
        }
        // one whose young would meet the standard but has no partner here joins a group elsewhere
        // (a weak one has no match worth breeding; contraception is the player's choice)
        for (const a of keptHere) {
            if (!a.contra && !ctx.weak.has(a.id) && canEverBreed(a) && !hasPartnerSex(a, adults)) leave.push({ a, why: 'alone' });
            else kept.push(a);
        }
    }
    return { kept, leave };
}

const hasPartnerSex = (a, adults) => adults.some(b => (a.sex === Sex.Male && b.sex === Sex.Female) || (a.sex === Sex.Female && b.sex === Sex.Male));

// Where each leaving adult goes: the roomiest allowed habitat it fits in,
// with no juvenile relative of the other sex there either; else the trade
// centre, where animals sent on to storage stop growing up. One that can
// never breed again goes to the trade centre. -> [{ a, why, to }]
function rehomeSpares(ctx, place, kept, leave) {
    const adultsOf = new Map(ctx.groupPlaces.map(p => [ctx.placeKeys[p], adultsAt(ctx, place, ctx.placeKeys[p])]));
    for (const a of kept) if (adultsOf.has(a.hab)) adultsOf.get(a.hab).push(a);
    return leave.map(({ a, why }) => {
        let best = null;
        for (const [hab, adults] of why === 'never' || why === 'weak' || why === 'nofert' ? [] : adultsOf) {
            if (hab === a.hab || misfit(ctx, a, adults, hab) || (ctx.youngAt.get(hab) || []).some(y => kinPair(ctx.model, a, y))) continue;
            if (why === 'alone' && !hasPartnerSex(a, adults)) continue;
            const cap = ctx.capacity.has(hab) ? ctx.capacity.get(hab) : Infinity;
            if (!best || cap - adults.length > best.room) best = { hab, room: cap - adults.length };
        }
        if (best) adultsOf.get(best.hab).push(a);
        // alone with no group to join: it stays (spares are kept) and its habitat asks for a partner
        return { a, why, to: best ? best.hab : why === 'alone' ? a.hab : TRADE };
    });
}

// Elderly animals past breeding that take the last place of their sex in a
// breeding habitat (the game's most per sex): no breeder of that sex can
// join while they live. -> [{ id, hab, sex }]
function retiredBlockers(ctx, place) {
    const out = [];
    for (const p of ctx.groupPlaces) {
        const hab = ctx.placeKeys[p];
        const adults = adultsAt(ctx, place, hab);
        const m = adults.filter(a => a.sex === Sex.Male).length, f = adults.filter(a => a.sex === Sex.Female).length;
        for (const a of adults) {
            if (!isRetired(a)) continue;
            const more = a.sex === Sex.Male ? overSexLimits(ctx.rule, m + 1, f) : overSexLimits(ctx.rule, m, f + 1);
            if (more > overSexLimits(ctx.rule, m, f)) out.push({ id: a.id, hab, sex: a.sex });
        }
    }
    return out;
}

// A layout that sends every breeder of a sex in the habitats to the trade
// centre: Auto mode keeps the last one (kinautocore keepLastBreeders), so
// the moves planned around its leaving would be wrong. -> the one to keep
// at home (the best, where no relative of the other sex lives), or -1
function lastBreederSent(ctx, place) {
    for (const side of [ctx.maleSide, ctx.femaleSide]) {
        const housed = side.filter(i => ctx.groupPlace[ctx.home[i]]);
        if (!housed.length || housed.some(i => place[i] !== ctx.trade)) continue;
        const home = i => ctx.home[i];
        const kinAtHome = i => ctx.kinWithStaying(i, home(i)) + ctx.kinWithSoon(i, home(i)) > 0
            || ctx.all.some(k => k !== i && place[k] === home(i) && ctx.compatible(i, k) && ctx.pvAny(i, k) < 0);
        const best = housed.filter(i => !ctx.pinned[i] && !kinAtHome(i)).sort((x, y) => (ownGeneScore(ctx.B[y]) ?? 0) - (ownGeneScore(ctx.B[x]) ?? 0))[0];
        if (best != null) return best;
    }
    return -1;
}

// A breeding pair (unrelated breeders of the two sexes) at place q.
function hasPair(ctx, place, q) {
    for (let i = 0; i < ctx.n; i++) {
        if (place[i] !== q) continue;
        for (let j = i + 1; j < ctx.n; j++) if (place[j] === q && ctx.compatible(i, j) && ctx.pvAny(i, j) > 0) return true;
    }
    return false;
}

// Breeder i may join place p without leaving its own group short of a pair.
function canJoin(ctx, place, i, p) {
    if (place[i] === p) return true;
    if (ctx.pinned[i] || !ctx.canGo(i, p)) return false;
    const from = place[i];
    if (from === ctx.trade || !hasPair(ctx, place, from)) return true;
    place[i] = p;
    const kept = hasPair(ctx, place, from);
    place[i] = from;
    return kept;
}

// Every habitat set aside for the species keeps a breeding pair while the
// breeders allow one: of the habitats the plan leaves without a pair, each
// round pairs the one whose male and female cost the plan least to bring
// (from the trade centre or a group that keeps its own pair), until none
// can be paired. The other breeders still go where their young score best.
// -> Set(breeder index) placed for a pair
function pairEveryHabitat(ctx, place) {
    const placed = new Set();
    if (ctx.B.some(a => a.sex === Sex.Unisex)) return placed;
    for (;;) {
        let best = null;
        for (const p of ctx.groupPlaces) {
            if (hasPair(ctx, place, p)) continue;
            const pick = bestPairFor(ctx, place, p);
            if (pick && (!best || pick.total > best.total)) best = Object.assign({ p }, pick);
        }
        if (!best) return placed;
        for (const i of [best.m, best.f]) {
            if (place[i] === best.p) continue;
            place[i] = best.p;
            placed.add(i);
        }
    }
}

// The male and female to pair at place p, the layout's total with them
// there; every other pair stays. -> { m, f, total } or null
function bestPairFor(ctx, place, p) {
    const others = ctx.groupPlaces.filter(q => q !== p && hasPair(ctx, place, q));
    // within the game's most per sex and the habitat's room, as the adults there stand
    const adults = adultsAt(ctx, place, ctx.placeKeys[p]);
    const males = adults.filter(a => a.sex === Sex.Male).length, females = adults.filter(a => a.sex === Sex.Female).length;
    const fits = (m, f) => {
        const dm = place[m] === p ? 0 : 1, df = place[f] === p ? 0 : 1;
        return overSexLimits(ctx.rule, males + dm, females + df) <= overSexLimits(ctx.rule, males, females)
            && (ctx.cap[p] == null || adults.length + dm + df <= ctx.cap[p]);
    };
    // never in beside a relative of the other sex: an adult staying there, one growing up soon, or a
    // breeder there (one already living there moves in beside no one)
    const kinThere = i => place[i] !== p && (ctx.kinWithStaying(i, p) + ctx.kinWithSoon(i, p) > 0
        || ctx.all.some(k => k !== i && place[k] === p && ctx.compatible(i, k) && ctx.pvAny(i, k) < 0));
    let best = null;
    for (const m of ctx.maleSide) {
        if (!canJoin(ctx, place, m, p) || kinThere(m)) continue;
        for (const f of ctx.femaleSide) {
            if (!ctx.compatible(m, f) || ctx.pvAny(m, f) <= 0 || !canJoin(ctx, place, f, p) || kinThere(f) || !fits(m, f)) continue;
            const was = [place[m], place[f]];
            place[m] = p;
            place[f] = p;
            if (others.every(q => hasPair(ctx, place, q))) {
                const total = makeState(ctx, place).total;
                if (!best || total > best.total) best = { m, f, total };
            }
            place[m] = was[0];
            place[f] = was[1];
        }
    }
    return best;
}

// Breeding habitats left without a partner after the plan: breeders of one
// sex and none of the other (or, in a habitat the player assigned to the
// species, none at all) where the game's limits leave room for one. The
// plan used every animal in the zoo and at the trade centre, so what is
// missing has to come from storage or the market; an empty habitat asks
// only for the sex no group can spare. -> [{ hab, sex }] where sex is a Sex
// value or 'pair'
function partnerNeeds(ctx, place) {
    const out = [];
    if (ctx.B.some(a => a.sex === Sex.Unisex)) return out;
    for (const p of ctx.groupPlaces) {
        if (!ctx.allowedPlace[p]) continue;
        // a breeder there leaves within a year, when a relative of the other sex grows up beside it: no need yet
        if (ctx.all.some(i => place[i] === p && ctx.kinWithSoon(i, p) > 0)) continue;
        const hab = ctx.placeKeys[p];
        let bm = 0, bf = 0;
        for (let i = 0; i < ctx.n; i++) {
            if (place[i] !== p) continue;
            if (ctx.sex[i] === Sex.Male) bm++;
            else if (ctx.sex[i] === Sex.Female) bf++;
        }
        const adults = adultsAt(ctx, place, hab);
        const m = adults.filter(a => a.sex === Sex.Male).length, f = adults.filter(a => a.sex === Sex.Female).length;
        const fits = (dm, df) => overSexLimits(ctx.rule, m + dm, f + df) <= overSexLimits(ctx.rule, m, f);
        const spare = sex => ctx.all.some(i => ctx.sex[i] === sex && canJoin(ctx, place, i, p));
        if (bm && !bf && fits(0, 1)) out.push({ hab, sex: Sex.Female });
        else if (bf && !bm && fits(1, 0)) out.push({ hab, sex: Sex.Male });
        else if (!bm && !bf && !adults.length && ctx.assigned.has(hab)) out.push({ hab, sex: spare(Sex.Female) ? Sex.Male : spare(Sex.Male) ? Sex.Female : 'pair' });
    }
    return out;
}

// Gene score points under the best breeder of its sex that make an adult weak.
export const SELL_MARGIN = 15;

// Animals not worth breeding: the best young each could have (the game's
// offspring prediction, with any unrelated breeder of the other sex) score
// `margin` or more under the best pair of the species. The best `keep` of
// each sex always stay (at least the last one), so no sex is left without a
// breeder, nor a habitat set aside for the species without one. -> Set(id)
export function weakBreeders(model, list, margin, keep = 1) {
    const opposite = (x, y) => (isMaleSide(x.sex) && isFemaleSide(y.sex)) || (isFemaleSide(x.sex) && isMaleSide(y.sex));
    const bestYoung = new Map();
    const raise = (a, s) => {
        if (!(bestYoung.get(a.id) >= s)) bestYoung.set(a.id, s);
    };
    // the prediction is the same either way round: each pair once
    for (let ix = 0; ix < list.length; ix++) {
        for (let iy = ix + 1; iy < list.length; iy++) {
            const x = list[ix], y = list[iy];
            if (!opposite(x, y) || kinPair(model, x, y)) continue;
            const s = offspringScore(predictOffspring(x.genes, y.genes));
            if (s == null) continue;
            raise(x, s);
            raise(y, s);
        }
    }
    const top = Math.max(-1, ...bestYoung.values());
    const weak = new Set();
    for (const [id, s] of bestYoung) if (top - s >= margin) weak.add(id);
    for (const side of [isMaleSide, isFemaleSide]) {
        const ofSide = list.filter(a => side(a.sex) && bestYoung.has(a.id)).sort((a, b) => bestYoung.get(b.id) - bestYoung.get(a.id));
        for (const a of ofSide.slice(0, Math.max(1, keep))) weak.delete(a.id);
    }
    return weak;
}

// Adults the zoo can do without: weak genes (SELL_MARGIN under the best
// breeder of their sex, or a 0% fertility gene) and not needed to breed,
// because the plan leaves them out of the breeding habitats or their
// habitat keeps a better breeder of their sex. And every good breeder the
// plan leaves out of the groups (a better one bought in its place) that
// keepAdvice does not keep. Only animals the game will sell (fertile, not
// elderly, not pregnant). endOf(a) -> where the plan leaves it.
// -> [{ id, sex, score, best, reason: 'weak'|'nofert'|'below'|'replaced' (advicecore) }]
function sellAdvice(ctx, all, endOf) {
    const bestOf = bestScores(ctx);
    const weak = weakOf(ctx, bestOf);
    const breedingPlace = breedingPlaceOf(ctx);
    const breeders = new Set(ctx.B);
    const out = [];
    for (const a of all) {
        if (a.juv || a.exhibit || a.preg || a.infertile || a.moving || !canEverBreed(a) || isRetired(a) || !weak(a)) continue;
        const hab = endOf(a);
        const covered = !breedingPlace(hab)
            || all.some(b => b !== a && b.sex === a.sex && breeders.has(b) && endOf(b) === hab && !weak(b));
        if (covered) out.push({ id: a.id, sex: a.sex, score: ownGeneScore(a), best: bestOf.get(a.sex), reason: noFertility(a) ? 'nofert' : 'weak' });
    }
    const told = new Set(out.map(x => x.id));
    for (const x of leftOut(ctx, endOf, bestOf)) {
        if (told.has(x.a.id) || x.keep) continue;
        out.push({ id: x.a.id, sex: x.a.sex, score: ownGeneScore(x.a), best: bestOf.get(x.a.sex), reason: x.below ? 'below' : 'replaced' });
    }
    return out.sort((x, y) => x.score - y.score);
}

// bestOf: the best own gene score per sex among the breeders
function bestScores(ctx) {
    const bestOf = new Map();
    for (const a of ctx.B) {
        const score = ownGeneScore(a);
        if (score != null && score > (bestOf.get(a.sex) ?? -1)) bestOf.set(a.sex, score);
    }
    return bestOf;
}

function weakOf(ctx, bestOf) {
    return a => noFertility(a) || (ownGeneScore(a) != null && bestOf.get(a.sex) != null && ctx.weak.has(a.id));
}

function breedingPlaceOf(ctx) {
    return hab => ctx.placeOf.has(hab) && ctx.groupPlace[ctx.placeOf.get(hab)] && ctx.allowedPlace[ctx.placeOf.get(hab)];
}

// An animal's average young with the breeders of the other sex in the
// groups (null: none to judge by).
function averageYoung(a, mates) {
    const each = mates.filter(b => (isMaleSide(a.sex) && isFemaleSide(b.sex)) || (isFemaleSide(a.sex) && isMaleSide(b.sex)))
        .map(b => offspringScore(predictOffspring(a.genes, b.genes))).filter(v => v != null);
    return each.length ? each.reduce((t, v) => t + v, 0) / each.length : null;
}

// Good breeders at the trade centre the plan leaves there (one it sends
// there is judged on the run after it arrives: a move can be held back).
// One whose young with the groups' breeders fall below every one of its
// sex breeding there would bring the standard down: sold, later use or
// not. Else kept for later when young of yours of the other sex, no kin
// of it, grow up while it still breeds (the trade centre keeps it from
// ageing); and the last good one of its sex outside the groups is kept.
// -> [{ a, keep, young, last, below }]
function leftOut(ctx, endOf, bestOf) {
    const weak = weakOf(ctx, bestOf);
    const breedingPlace = breedingPlaceOf(ctx);
    const inGroups = ctx.B.filter(b => breedingPlace(endOf(b)));
    const out = [];
    ctx.B.forEach((a, i) => {
        if (ctx.placeKeys[ctx.home[i]] !== TRADE || endOf(a) !== TRADE) return;
        if (weak(a) || a.preg || a.moving || (a.fert && a.fert.elderly) || isRetired(a)) return;
        const young = ctx.futureMateCount[i];
        const peers = inGroups.filter(b => b.sex === a.sex && !weak(b));
        const last = !peers.length;
        const own = averageYoung(a, inGroups);
        const theirs = peers.map(b => averageYoung(b, inGroups)).filter(v => v != null);
        const below = own != null && theirs.length > 0 && own < Math.min(...theirs);
        out.push({ a, keep: last || (young > 0 && !below), young, last, below });
    });
    return out;
}

// The good breeders to keep at the trade centre for later (leftOut).
// -> [{ id, sex, score, young, reason: 'young'|'last' (advicecore) }]
function keepAdvice(ctx, endOf) {
    return leftOut(ctx, endOf, bestScores(ctx)).filter(x => x.keep).map(({ a, young, last }) => ({
        id: a.id, sex: a.sex, score: ownGeneScore(a), young, reason: young ? 'young' : 'last',
    }));
}

const LEAVE_REASONS = {
    kin: 'related to an adult of the other sex there',
    soon: 'related to a youngster of the other sex there that grows up soon',
    limit: "over the game's most of its sex in one habitat",
    room: "over the habitat's room",
    never: 'can no longer breed',
    weak: "its young would score well below your best pair's",
    nofert: '0% fertility genes',
    makeup: 'over the group make-up (not breeding)',
    alone: 'no partner of the other sex here to breed with',
};

// ---------------------------------------------------------------- planner

// The search's setup for one species (planProgramme, scoreLayout).
function prepare(model, species, info, destinations, assignments, options) {
    const opts = Object.assign({}, PROGRAMME_DEFAULTS, options);
    if (!model || !species) return null;
    // the game's rules for the species (groupRule) whether or not the game's species info arrived
    info = Object.assign({}, info || {}, { species });
    // the species' fertility ages from the kin snapshot when the game was not asked
    const facts = model.speciesFacts && model.speciesFacts[species];
    if (!info.fertilityAges && facts && facts.maturity != null) info = Object.assign({}, info, { fertilityAges: { maturity: facts.maturity, infertility: facts.infertility } });
    const all = Array.from(model.animals.values()).filter(a => a.species === species && !a.exhibit && a.alive !== false);
    const canMoveA = a => !a.moving && (a.lt === 'habitat' || a.lt === 'trade' || (!a.lt && !!a.hab));
    const inTrade = a => a.lt === 'trade' && !a.hab;
    const pinSet = new Set(Array.isArray(opts.pinIds) ? opts.pinIds.map(String) : opts.pinIds instanceof Set ? Array.from(opts.pinIds, String) : []);
    // an animal away for a while (vet, quarantine, transit) breeds in its
    // assigned habitat: a breeder there, pinned (it can't be moved now); one
    // held at the trade centre (sent there to leave, hands off) never breeds
    // here, so it neither breeds nor sets the standard the others are held to
    const able = all.filter(a => isBreeder(a) && (canMoveA(a) || (a.away && a.hab)) && (opts.useTradeCentre || !inTrade(a)) && !(inTrade(a) && pinSet.has(String(a.id))));
    const assign = normalizeAssignments(assignments);
    const mine = assignedHabitatsOf(assign, species);
    // the best possible young for each calf: animals whose young would fall well
    // behind do not breed, unless a habitat set aside for the species needs them
    const weak = weakBreeders(model, able.filter(a => !noFertility(a)), opts.youngMargin, mine.length);
    for (const a of able) if (noFertility(a)) weak.add(a.id);
    const breeders = able.filter(a => !weak.has(a.id));
    const tradeWaiting = all.filter(a => inTrade(a) && isBreeder(a) && canMoveA(a)).length;
    const home = new Map(all.map(a => [a.id, a.hab || (a.lt === 'trade' ? TRADE : AWAY)]));
    // non-breeding adults that may leave (keepSpares); elderly ones past breeding stay where they
    // are: the game won't rehome them, so a move would only strand them in storage
    const spares = all.filter(a => a.hab && !a.juv && !breeders.includes(a)
        && canMoveA(a) && a.lt !== 'trade' && !a.preg && !a.away && !pinSet.has(String(a.id)) && !isRetired(a)
        && (a.sex === Sex.Male || a.sex === Sex.Female));
    // where the species may live
    const ok = destinations && destinations.bySpecies && destinations.bySpecies[species];
    let habitats;
    if (mine.length) habitats = mine.filter(h => !ok || !ok[h] || ok[h].ok);
    else {
        const set = new Set(all.filter(a => a.hab).map(a => a.hab));
        if (ok) for (const [h, d] of Object.entries(ok)) if (d.ok) set.add(h);
        habitats = Array.from(set).filter(h => habitatAllowedFor(assign, h, species));
    }
    // breeders already in a habitat outside the allowed list stay allowed there
    const allowed = new Set(habitats);
    for (const a of breeders) if (a.hab && !allowed.has(a.hab) && !mine.length) allowed.add(a.hab);
    habitats = Array.from(allowed);
    const infoX = Object.assign({}, info);
    if (!infoX.spacePerAdult) infoX.spacePerAdult = estimateSpacePerAdult(info, youngByHabitat(all));
    // non-breeders elsewhere are not the programme's, unless one lives beside a relative of the other sex: never inbreed
    const besideKin = a => all.some(b => b !== a && !b.juv && b.hab === a.hab && kinPair(model, a, b));
    const ctx = makeContext(model, infoX, opts, breeders, all, habitats, home, spares.filter(a => habitats.includes(a.hab) || besideKin(a)));
    ctx.assigned = new Set(mine.map(String));
    ctx.weak = weak;
    // the deep engine has its own budgets (solveDeep)
    ctx.budget = makeBudget(opts);
    ctx.seedKey = `${species}|${breeders.map(a => a.id).join(',')}|${opts.seed}`;
    ctx.rnd = randomSource(hashSeed(ctx.seedKey));
    return { ctx, opts, breeders, habitats, tradeWaiting, all };
}

// A move that takes a young or pregnant animal out of the trade centre (mustHouse).
export function isHousingMove(m) {
    return !!(m && (m.young || m.pregnant || m.retiring));
}

// A kept plan (a deep search) with the housing moves of the fresh plan:
// young and pregnant animals that arrived at the trade centre since go into
// a habitat too.
export function withFreshYoung(r, fresh) {
    if (!r || !fresh || r === fresh) return r;
    const young = (fresh.moves || []).filter(isHousingMove);
    const ids = new Set(young.map(m => String(m.id)));
    const keep = (r.moves || []).filter(m => !isHousingMove(m) && !ids.has(String(m.id)));
    return Object.assign({}, r, { moves: keep.concat(young) });
}

// habitat -> juveniles of the species living there (not the ones waiting at the trade centre)
export function youngByHabitat(all) {
    const out = new Map();
    for (const a of all || []) if (a && a.juv && a.hab && a.lt !== 'trade') out.set(String(a.hab), (out.get(String(a.hab)) || 0) + 1);
    return out;
}

// Young waiting at the trade centre back to a habitat: the mother's (where
// the plan puts her), else the father's, else the allowed habitat with the
// most room for adults, one without an adult relative of the other sex if
// there is one. endOf(animal) -> its habitat after the plan.
export function youngBackMoves(model, all, habitats, endOf, roomOf = () => 0) {
    const allowed = new Set((habitats || []).map(String));
    if (!allowed.size) return [];
    const parentHab = (a, sex) => {
        for (const g of a.par || []) {
            const p = model.byGuid.get(String(g));
            if (!p || p.sex !== sex) continue;
            const h = endOf(p);
            if (h && allowed.has(String(h))) return String(h);
        }
        return null;
    };
    const byRoom = Array.from(allowed).sort((x, y) => roomOf(y) - roomOf(x) || (x < y ? -1 : 1));
    const kinThere = (a, hab) => (all || []).some(b => !b.juv && String(endOf(b)) === hab && kinPair(model, a, b));
    const out = [];
    for (const a of all || []) {
        if (!mustHouse(a) || !a.juv) continue;
        const mum = parentHab(a, Sex.Female);
        const dad = mum ? null : parentHab(a, Sex.Male);
        // its own habitat (it waits there with one assigned), else the roomiest
        const own = a.hab && allowed.has(String(a.hab)) ? String(a.hab) : null;
        const to = mum || dad || own || byRoom.find(hab => !kinThere(a, hab)) || byRoom[0];
        out.push({ id: a.id, to, fromTrade: true, young: true, reason: mum ? "young: back to its mother's habitat" : dad ? "young: back to its father's habitat" : own ? 'young: back to its habitat' : 'young: back to a habitat' });
    }
    return out;
}

// Adults waiting at the trade centre into a habitat (mustHouse): a pregnant
// female gives birth there, and only then can she be sold; one past selling
// lives out its life there. Never beside a relative of the other sex, adult
// or young (never inbreed), nor over the game's most per sex; of the rest
// the ones with room first, then the best young with the breeders of the
// other sex there, then the most room. One with no such habitat waits.
// endOf(animal) -> its habitat after the plan; roomOf(habitat) -> adults it
// can still take.
export function adultBackMoves(model, all, habitats, endOf, roomOf, rule) {
    // habitat|sex -> adults housed there by this call
    const added = new Map();
    const addedOf = (hab, sex) => added.get(`${hab}|${sex}`) || 0;
    const out = [];
    for (const a of all || []) {
        if (!mustHouse(a) || a.juv) continue;
        const plus = sex => (a.sex === sex ? 1 : 0);
        let best = null;
        for (const hab of (habitats || []).map(String)) {
            const there = all.filter(b => b !== a && String(endOf(b)) === hab);
            if (there.some(b => b.sex !== a.sex && kinPair(model, a, b))) continue;
            const adults = there.filter(b => !b.juv);
            // the limits count who lives there now as well: the plan is solved
            // again with this one housed, and may keep a resident it moved out
            const counted = all.filter(b => b !== a && !b.juv && (String(endOf(b)) === hab || String(b.hab) === hab));
            const males = counted.filter(b => b.sex === Sex.Male).length + addedOf(hab, Sex.Male);
            const females = counted.filter(b => b.sex === Sex.Female).length + addedOf(hab, Sex.Female);
            // only its own sex counts: a habitat already over on the other sex takes it all the same
            if (overSexLimits(rule, males + plus(Sex.Male), females + plus(Sex.Female)) > overSexLimits(rule, males, females)) continue;
            const room = roomOf(hab) - addedOf(hab, Sex.Male) - addedOf(hab, Sex.Female);
            const young = bestOffspringScore(a.genes, adults.filter(b => b.sex !== a.sex && isBreeder(b)).map(b => b.genes)) ?? -1;
            const c = { hab, fits: room > 0, young, room };
            if (!best || c.fits > best.fits || (c.fits === best.fits && (c.young > best.young || (c.young === best.young && c.room > best.room)))) best = c;
        }
        if (!best) continue;
        added.set(`${best.hab}|${a.sex}`, addedOf(best.hab, a.sex) + 1);
        out.push(a.preg
            ? { id: a.id, to: best.hab, fromTrade: true, pregnant: true, reason: 'pregnant: into a habitat to give birth' }
            : { id: a.id, to: best.hab, fromTrade: true, retiring: true, reason: 'past selling: into a habitat to live out its life' });
    }
    return out;
}

// The objective of the current layout with `moves` ([{id, to}]) applied
// (tests, benchmarks). Same arguments as planProgramme.
export function scoreLayout(model, species, info = {}, destinations = null, { assignments = null, options = {} } = {}, moves = []) {
    const prep = prepare(model, species, info, destinations, assignments, options);
    if (!prep) return null;
    const { ctx } = prep;
    const place = Int32Array.from(ctx.home);
    const index = new Map(ctx.B.map((a, i) => [a.id, i]));
    for (const m of moves) {
        const i = index.get(m.id);
        if (i == null) continue;
        if (!ctx.placeOf.has(m.to)) return null;
        place[i] = ctx.placeOf.get(m.to);
    }
    return makeState(ctx, place).total;
}

// A pregnant or past-selling adult waiting at the trade centre goes into a habitat first
// (adultBackMoves); the layout is then solved again with it there, so
// the groups are built around it rather than undone on the next run.
function* programmeSteps(model, species, info, destinations, assignments, options) {
    const first = yield* layoutSteps(model, species, info, destinations, assignments, options);
    const housing = first ? first.moves.filter(m => m.pregnant || m.retiring) : [];
    if (!housing.length) return first;
    const r = yield* layoutSteps(simulatePlan(model, housing, destinations), species, info, destinations, assignments, options);
    return Object.assign({}, r, { moves: housing.concat(r.moves), fromTrade: r.fromTrade + housing.length, startScore: first.startScore, before: first.before });
}

function* layoutSteps(model, species, info, destinations, assignments, options) {
    const prep = prepare(model, species, info, destinations, assignments, options);
    if (!prep) return null;
    const { ctx, opts, breeders, habitats, tradeWaiting, all } = prep;
    const start = Int32Array.from(ctx.home);
    const deep = opts.engine === 'deep';
    let solved = breeders.length ? yield* (deep ? solveDeep(ctx) : solveLayout(ctx)) : { place: start, exact: true };
    const keep = lastBreederSent(ctx, solved.place);
    if (keep >= 0) {
        ctx.pinned[keep] = 1;
        ctx.targetsOf[keep] = [ctx.home[keep]];
        solved = yield* (deep ? solveDeep(ctx) : solveLayout(ctx));
    }
    const place = prune(ctx, solved.place);
    const paired = opts.pairEvery !== false ? pairEveryHabitat(ctx, place) : new Set();
    // the non-breeders that stay; the rest leave, to another habitat where they fit if one does
    const { kept: keptHome, leave } = keepSpares(ctx, place);
    const rehomed = rehomeSpares(ctx, place, keptHome, leave);
    const kept = keptHome.concat(rehomed.filter(r => r.to !== TRADE).map(r => Object.assign({}, r.a, { hab: r.to })));
    // the reported numbers scored afresh: before, every non-breeder in its
    // habitat; after, the ones kept
    withStaying(ctx, ctx.spares);
    const startState = makeState(ctx, start);
    withStaying(ctx, kept);
    const finalState = makeState(ctx, Int32Array.from(place));
    // where each animal of the species ends: a habitat, TRADE or AWAY
    const index = new Map(breeders.map((a, i) => [a.id, i]));
    const spareTo = new Map(rehomed.map(r => [r.a.id, r.to]));
    const endPlace = a => (index.has(a.id) ? ctx.placeKeys[place[index.get(a.id)]] : spareTo.has(a.id) ? spareTo.get(a.id) : a.hab || (a.lt === 'trade' ? TRADE : AWAY));
    // the plan: every breeder that ends up somewhere else
    const moves = [];
    breeders.forEach((a, i) => {
        if (place[i] === ctx.home[i]) return;
        const to = ctx.placeKeys[place[i]];
        const fromTrade = ctx.home[i] === ctx.trade;
        const why = paired.has(i) ? 'a breeding pair for every habitat' : to === TRADE ? 'no place in a breeding group' : fromTrade ? 'from the trade centre into a breeding group' : 'breeding programme';
        moves.push({ id: a.id, to, fromTrade, reason: why });
    });
    for (const { a, why, to } of rehomed) {
        if (to === a.hab) continue;
        moves.push({ id: a.id, to, fromTrade: false, spare: true, reason: LEAVE_REASONS[why] + (a.contra ? ' (on contraception)' : '') });
    }
    // pregnant females waiting at the trade centre into a habitat, then the
    // young waiting there go home (to her too: she comes first)
    const housed = new Map();
    const endOf = a => {
        const k = housed.get(a.id) || endPlace(a);
        return k === TRADE || k === AWAY ? null : k;
    };
    const roomOf = hab => {
        const p = ctx.placeOf.get(hab);
        const cap = ctx.capacity.get(hab);
        if (p == null || cap == null) return 0;
        let n = ctx.fixedAdults.get(hab) || 0;
        for (let i = 0; i < ctx.n; i++) if (place[i] === p) n++;
        return cap - n;
    };
    if (opts.houseBack !== false) {
        for (const m of adultBackMoves(model, all, habitats, endOf, roomOf, ctx.rule)) {
            housed.set(m.id, m.to);
            moves.push(m);
        }
    }
    if (opts.youngBack !== false) moves.push(...youngBackMoves(model, all, habitats, endOf, roomOf));
    return {
        system: ctx.rule.system,
        rule: ctx.rule,
        moves,
        // pregnant breeders: they stay where they are (never in moves)
        pinned: breeders.filter((a, i) => ctx.pinned[i]).map(a => a.id),
        retiredBlockers: retiredBlockers(ctx, place),
        needs: partnerNeeds(ctx, place),
        sellable: sellAdvice(ctx, all, endPlace),
        keep: keepAdvice(ctx, endPlace),
        // pregnant females who should get contraception, and why
        contraception: contraceptionAdvice(model, species, { moves, rule: ctx.rule }),
        // breeders taken out of the trade centre / waiting there (and usable)
        fromTrade: moves.filter(m => m.fromTrade).length,
        tradeWaiting,
        usedTradeCentre: !!opts.useTradeCentre,
        score: finalState.total,
        startScore: startState.total,
        exact: solved.exact,
        engine: deep ? 'deep' : 'classic',
        starts: solved.starts != null ? solved.starts : 1,
        bestStart: solved.bestStart || 0,
        startsPlanned: deep ? Math.max(1, Math.floor(opts.starts)) : 1,
        stopped: solved.stopped || null,
        resume: solved.resume || null,
        msPerStart: solved.msPerStart || null,
        evaluations: ctx.budget.evals,
        timedOut: ctx.budget.timedOut,
        searchMs: Math.round(ctx.budget.ms()),
        before: programmeStats(ctx, start),
        after: programmeStats(ctx, place),
        groups: groupsOf(ctx, place),
        capacity: Object.fromEntries(ctx.capacity),
        // per habitat: the adults staying (not breeders) and the make-up's target
        staying: Object.fromEntries(ctx.fixedAdults),
        targets: Object.fromEntries(Array.from(ctx.capacity, ([k, cap]) => [k, groupTarget(ctx.rule, cap - (ctx.fixedAdults.get(k) || 0))])),
        habitats,
    };
}

// info: { social: {min,max}, fertilityAges: {maturity, infertility},
//         mating: 'monogamy'|'polygyny'|'polyandry'|'mixed'|null,
//         sexMax: {male, female}, groups: [{kind, m, f}],
//         conception: [[p]], habitats: { habId: { available, required, adults } } }
// destinations: the Species board destinations; assignments: habitat -> species.
// options: PROGRAMME_DEFAULTS. Runs the whole search at once.
export function planProgramme(model, species, info = {}, destinations = null, { assignments = null, options = {} } = {}) {
    const gen = programmeSteps(model, species, info, destinations, assignments, options);
    for (;;) {
        const r = gen.next();
        if (r.done) return r.value;
    }
}


// What a search of this species reads, as one string: a deep result
// stays good while it is the same (problemSig below). Same arguments as
// planProgramme.
export function programmeProblemSig(model, species, info = {}, destinations = null, { assignments = null, options = {} } = {}) {
    const prep = prepare(model, species, info, destinations, assignments, options);
    if (!prep) return '';
    // the young waiting at the trade centre: the plan's "young: back to a
    // habitat" moves come from them, so a kept (deep) plan made before they
    // arrived must not be reused (2026-10-19: young from Bring all stayed
    // in the trade centre)
    const opts = Object.assign({}, PROGRAMME_DEFAULTS, options);
    const waiting = (prep.all || []).filter(a => mustHouse(a) && (a.juv ? opts.youngBack !== false : opts.houseBack !== false)).map(a => a.id).sort();
    return `${problemSig(prep.ctx)}#young:${waiting.join(',')}`;
}

// The breeders (where they are, pinned, mates), the adults that only count
// towards room, each place's room, the make-up, the facts the pair values
// use and the juveniles growing up soon (kin like adults); not the other
// juveniles or the game's raw habitat data, so a birth or a habitat that
// finishes measuring with the same room changes nothing.
function problemSig(ctx) {
    const rows = ctx.B.map((a, i) => [a.id, ctx.placeKeys[ctx.home[i]], a.sex, ctx.pinned && ctx.pinned[i] ? 1 : 0,
        (a.mates || []).slice().sort().join('+'), (a.bond && a.bond.mate) || '', (a.fert && a.fert.state) || '',
        a.genes ? ['F', 'I', 'S', 'L'].map(k => a.genes[k] || '').join('/') : ''].join(','));
    rows.sort();
    const places = ctx.placeKeys.map((k, p) => `${k}:${ctx.cap[p] == null ? '' : ctx.cap[p]}:${ctx.fixed[p]}:${ctx.allowedPlace[p] ? 1 : 0}`).sort();
    const r = ctx.rule;
    const facts = [ratioKey(r), r.maxMales, r.maxFemales, r.system, JSON.stringify(ctx.info.fertilityAges || null), JSON.stringify(ctx.info.conception || null)].join('|');
    const spares = (ctx.spares || []).map(a => `${a.id}@${a.hab}:${a.sex}:${a.contra ? 1 : 0}`).sort();
    const soon = Array.from(ctx.soonAt, ([hab, list]) => list.map(a => `${a.id}@${hab}`)).flat().sort();
    return `${rows.join(';')}#${places.join(';')}#${facts}#${spares.join(';')}#${soon.join(';')}`;
}

// The same, in slices of about sliceMs with restMs between them (CPU use),
// so the page stays responsive. onProgress(0..1) after each slice;
// isCancelled() -> true drops it (the promise then gives null; the deep
// engine's options.stop instead ends it with the best so far). Classic's
// time cap counts only the time spent searching, the deep engine's
// wallLimitMs the wall clock.
export function planProgrammeAsync(model, species, info = {}, destinations = null, { assignments = null, options = {}, sliceMs = 24, restMs = 0, onProgress = null, isCancelled = null } = {}) {
    let busy = 0, sliceStart = 0, running = false;
    const clock = () => busy + (running ? wallClock() - sliceStart : 0);
    const gen = programmeSteps(model, species, info, destinations, assignments, Object.assign({}, options, { clock }));
    return new Promise((resolve, reject) => {
        const slice = () => {
            if (isCancelled && isCancelled()) return resolve(null);
            sliceStart = wallClock();
            running = true;
            let last = 0;
            try {
                for (;;) {
                    const r = gen.next();
                    if (r.done) return resolve(r.value);
                    if (typeof r.value === 'number') last = r.value;
                    if (wallClock() - sliceStart >= sliceMs) break;
                }
            }
            catch (e) {
                return reject(e);
            }
            finally {
                busy += wallClock() - sliceStart;
                running = false;
            }
            if (onProgress) {
                try {
                    onProgress(last);
                }
                catch (e) {
                    // the page's business
                }
            }
            setTimeout(slice, Math.max(0, restMs));
        };
        setTimeout(slice, 0);
    });
}

// Breeding pairs, expected young and related pairs for a layout.
function programmeStats(ctx, place) {
    const st = makeState(ctx, Int32Array.from(place));
    let pairs = 0, related = 0, quality = 0, chance = 0, idle = 0;
    const breedingFemales = new Set();
    for (let p = 0; p < ctx.P; p++) {
        const list = st.members[p];
        if (!list.length) continue;
        if (!ctx.groupPlace[p]) {
            idle += list.length;
            continue;
        }
        related += relatedCount(ctx, list);
        const busy = new Set();
        for (const [, m, f] of groupPairs(ctx, list, p)) {
            pairs++;
            quality += youngQuality(ctx.B[m], ctx.B[f]);
            chance += conceptionChance(ctx.B[m], ctx.B[f], ctx.info);
            busy.add(m);
            busy.add(f);
            breedingFemales.add(f);
        }
        for (const i of list) if (!busy.has(i)) idle++;
    }
    return {
        breedingPairs: pairs,
        relatedPairs: related,
        youngQuality: pairs ? Math.round(quality / pairs * 100) : null,     // 0..100
        conception: pairs ? Math.round(chance / pairs * 100) : null,        // %
        breedingFemales: breedingFemales.size,
        idle,                                                               // breeders without a partner
    };
}

// Each place's breeders, with its room and the make-up's target.
function groupsOf(ctx, place) {
    const map = new Map();
    for (let i = 0; i < ctx.n; i++) {
        const k = ctx.placeKeys[place[i]];
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(ctx.B[i]);
    }
    return Array.from(map.entries()).map(([hab, animals]) => {
        const capacity = ctx.capacity.has(hab) ? ctx.capacity.get(hab) : null;
        const staying = ctx.fixedAdults.get(hab) || 0;
        return {
            hab,
            animals,
            males: animals.filter(a => a.sex === Sex.Male).length,
            females: animals.filter(a => a.sex === Sex.Female).length,
            capacity,
            staying,
            target: hab === TRADE || capacity == null ? null : groupTarget(ctx.rule, capacity - staying),
        };
    });
}

// ------------------------------------------------- contraception advice
//
// A pregnant female stays where she is (plans never move her), so the
// programme says instead whether she should get contraception once she has
// given birth. The game lets contraception be set during a pregnancy
// (AnimalInfoPopUp sets canHaveContraceptives = true for every animal and
// its toggle has no pregnancy check); whether it touches the pregnancy
// itself is native and not known, so the advice reads "after birth".
//
// The rule, for each pregnant female of the species in a habitat, not on
// contraception (first match wins; never applied, only shown):
//   1. no mate:     no male (unisex: any partner) in her habitat, now or
//                   after the plan, that breeds now or matures within
//                   futureMateYears (a juvenile whose maturity is unknown
//                   counts as a mate: no advice on a guess);
//   2. related:     there are such mates, but every one is related to her
//                   (the game's rule or close kin);
//   3. genes:       her own gene score (mean of her gene grades, 0..100) is
//                   at least geneMargin below the median of the other
//                   breeding females in her habitat after the plan (at least
//                   minPeers of them with gene data);
//   4. surplus:     more breeding females there after the plan than its
//                   breeding males can take under the make-up (1:1, 1:3...)
//                   and hers is the lowest gene score of them (at least one
//                   other with gene data).
// Rules 3 and 4 need her gene data; without it there is no gene advice.
export const CONTRA_ADVICE = Object.freeze({
    geneMargin: 10,       // points (0..100) below the other females' median
    minPeers: 2,          // other breeding females with gene data, for rule 3
    futureMateYears: 2,   // a young male maturing within this counts as a mate
});

// Her own gene score, 0..100 (null without gene data): the mean of the
// game's gene grades (kincull.js geneScore, x100).
export function ownGeneScore(a) {
    const g = ownGrades(a && a.genes);
    const v = Object.values(g).filter(x => typeof x === 'number' && isFinite(x));
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 100) : null;
}

function medianOf(list) {
    const s = list.slice().sort((x, y) => x - y);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// -> [{ id, name, hab, kind: 'nomate'|'related'|'genes'|'surplus', reason,
//       text ("Contraception after birth: ..."), score, median }]
// options: moves (the plan, [{ id, to }]), rule (groupRule; null:
// mixed), limits (CONTRA_ADVICE overrides).
export function contraceptionAdvice(model, species, { moves = [], rule = null, limits = null } = {}) {
    if (!model || !model.animals || !species) return [];
    const L = Object.assign({}, CONTRA_ADVICE, limits || {});
    const all = Array.from(model.animals.values()).filter(a => a.species === species && !a.exhibit && a.alive !== false);
    const moved = new Map((moves || []).map(m => [String(m.id), String(m.to)]));
    const after = a => (moved.has(a.id) ? moved.get(a.id) : a.hab);
    const per = partnersPer(rule);
    const out = [];
    for (const f of all) {
        if (!f.preg || f.contra || f.sex !== Sex.Female || !f.hab) continue;
        const hab = f.hab;
        // her mates: now in her habitat or there after the plan
        const around = all.filter(b => b.id !== f.id && (b.hab === hab || after(b) === hab));
        const mateOf = b => {
            if (b.contra || !(b.sex === Sex.Male || b.sex === Sex.Unisex)) return false;
            if (fertileNow(b)) return true;
            const st = b.fert && b.fert.state;
            if (b.juv || st === 'juvenile' || st === 'young') {
                const y = b.fert ? b.fert.yearsToMature : null;
                return y == null || y <= L.futureMateYears;
            }
            return false;
        };
        const mates = around.filter(mateOf);
        const related = mates.filter(b => relatedPair(model, f, b));
        const add = (kind, reason, extra = {}) => out.push(Object.assign({ id: f.id, name: f.name, hab, kind, reason, text: `Contraception after birth: ${reason}`, score: null, median: null }, extra));
        if (!mates.length) {
            add('nomate', all.some(b => b.sex === Sex.Unisex) ? 'no partner here, now or after the plan' : 'no male here, now or after the plan');
            continue;
        }
        if (related.length === mates.length) {
            const names = related.slice(0, 2).map(b => {
                const rel = f.guid && b.guid ? model.ped.relation(f.guid, b.guid) : null;
                const word = rel ? relationWord(rel, b.sex) : '';
                return word ? `${b.name}, her ${word}` : b.name;
            });
            add('related', `only related mates here (${names.join('; ')}${related.length > 2 ? '…' : ''})`);
            continue;
        }
        // the genes: against the other breeding females there after the plan
        const score = ownGeneScore(f);
        if (score == null) continue;
        const peers = all.filter(b => b.id !== f.id && b.sex === Sex.Female && after(b) === hab && !b.contra && (b.preg || isBreeder(b)));
        const known = peers.map(ownGeneScore).filter(v => v != null);
        const median = medianOf(known);
        const weakest = known.length > 0 && known.every(v => score <= v);
        if (known.length >= L.minPeers && median != null && score <= median - L.geneMargin) {
            add('genes', `${weakest ? 'weakest genes in the group' : 'genes well below the group'} (${score} vs median ${median})`, { score, median });
            continue;
        }
        const males = all.filter(b => b.sex === Sex.Male && after(b) === hab && canBreedNow(b)).length;
        const females = peers.length + 1;
        if (males > 0 && per.male !== Infinity && females > males * per.male && weakest) {
            add('surplus', `weakest genes of ${females} females for ${males} male${males === 1 ? '' : 's'} (${score} vs median ${median})`, { score, median });
        }
    }
    return out;
}
