// The Market's picks for each sex (badges.js), pure. Best buy: the listing
// whose calves with your breeders of the other sex score highest (a male's
// average over your females, a female's best male: marketcalves calvesOf),
// or with none of yours known the best own genes. Best value: the most gene
// score per price among the listings that meet the standard (best calves at
// or above it, as Auto mode judges a newcomer, or with none of yours known
// a gene score of at least PICK_MIN_SCORE).
// A 0% fertility gene never breeds: never a pick.
// Equal calves: the better breeder score, then the better value, wins.
//   rows: [{ id, sex: 'm' | 'f', adult, infertile, gene, breeder, value, calves, bestCalves, floor, known }]
//     calves: the score it is ranked by, null while its genes are still being
//     read; bestCalves: its best young; known: breeders of yours of the
//     other sex are known for it
//   -> { m: pick, f: pick }, pick: { best, value (ids), basis: 'calves' | 'genes', score (the best's), of (listings compared) } | null

import { PICK_MIN_SCORE } from './scores.js';

function pickFor(rows) {
    const known = rows.some(r => r.known);
    const basis = known ? 'calves' : 'genes';
    const quality = r => (known ? r.calves : r.gene);
    const fit = rows.filter(r => r.adult && !r.infertile && quality(r) != null
        && (known ? r.floor == null || (r.bestCalves ?? r.calves) >= r.floor : r.gene >= PICK_MIN_SCORE));
    if (!fit.length) return null;
    const better = (x, y) => {
        const d = quality(x) - quality(y);
        if (d !== 0) return d > 0;
        if ((x.breeder ?? -1) !== (y.breeder ?? -1)) return (x.breeder ?? -1) > (y.breeder ?? -1);
        return (x.value ?? -1) > (y.value ?? -1);
    };
    let best = fit[0];
    for (const r of fit) if (better(r, best)) best = r;
    let value = null;
    for (const r of fit) {
        if (r.value == null) continue;
        if (!value || r.value > value.value || (r.value === value.value && quality(r) > quality(value))) value = r;
    }
    return { best: best.id, value: value ? value.id : null, basis, score: quality(best), of: rows.length };
}

export function marketPicks(rows) {
    const of = sex => pickFor((rows || []).filter(r => r.sex === sex));
    return { m: of('m'), f: of('f') };
}

// The rows seen on one visit to a list the game renders only in part (each
// row as `pick` takes it, with its species and an id): the picks are the
// best of every page paged or scrolled through, not of those on screen.
// Forgotten once the list has been off screen `forgetMs`. note(rows on
// screen) -> Map(species -> pick(its rows)) or null off the list. A row's id
// is the animal itself (marketcalves listingId): the game's own ids and keys
// move with the sort.
export function createSeenListings({ pick = marketPicks, now = () => Date.now(), forgetMs = 5000 } = {}) {
    const seen = new Map();
    let at = 0;
    return function note(rows) {
        if (!rows.length) {
            if (now() - at > forgetMs) seen.clear();
            return null;
        }
        at = now();
        for (const r of rows) seen.set(r.id, r);
        const bySpecies = new Map();
        for (const r of seen.values()) {
            if (!bySpecies.has(r.species)) bySpecies.set(r.species, []);
            bySpecies.get(r.species).push(r);
        }
        return new Map(Array.from(bySpecies, ([sp, list]) => [sp, pick(list)]));
    };
}

// The Storage window's pick among your own animals of one species, for each
// sex: the best calves as the park judged them (kinautocore
// marketMatesOfSpecies unplaced, a listing's rule), a 0% fertility or young
// one never. rows: [{ id, sex, adult, infertile, calves }]
// -> { m: { id, score } | null, f: { id, score } | null }
export function bestOfYours(rows) {
    const out = { m: null, f: null };
    for (const r of rows || []) {
        if (!r.adult || r.infertile || r.calves == null || (r.sex !== 'm' && r.sex !== 'f')) continue;
        if (!out[r.sex] || r.calves > out[r.sex].score) out[r.sex] = { id: r.id, score: r.calves };
    }
    return out;
}
