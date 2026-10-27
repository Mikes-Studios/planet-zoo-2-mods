// Kin planner: pure helpers (no DOM, no game imports), so Node tests can run
// them. kinplanner.js draws what these return.
//
// Planner state: { habId, species, pair: { a, b } | null, animal, includeYoung }
//   habId null = the zoo overview. pair = the selected matrix square (animal
//   ids, row first). animal = the animal whose mates are listed.
import {
    Sex, habitatsAtRisk, habitatSummary, offspringScore, predictOffspring, relationWord, severityRank,
} from './kincore.js';
import { placeName } from './kinboardcore.js';

// Severities a habitat counts (distant pairs are only shown in the matrix).
export const COUNTED = ['risk', 'kin', 'future', 'held', 'covered'];

export const COUNT_WORDS = {
    risk: ['inbreeding risk', 'inbreeding risks'],
    kin: ['close kin', 'close kin'],
    future: ['later', 'later'],
    held: ['bonded elsewhere', 'bonded elsewhere'],
    covered: ['covered', 'covered'],
};

export function countWord(severity, n) {
    const w = COUNT_WORDS[severity] || [severity, severity];
    return n === 1 ? w[0] : w[1];
}

// The counts the player wants to see (covered pairs can be hidden; pairs
// held apart by a bond are always shown).
export function visibleCounts(counts, showCovered = true) {
    const c = counts || {};
    return { risk: c.risk || 0, kin: c.kin || 0, future: c.future || 0, held: c.held || 0, covered: showCovered ? c.covered || 0 : 0 };
}

export function worstOf(counts) {
    for (const s of COUNTED) if (counts && counts[s]) return s;
    return null;
}

function nameKey(x) {
    return String((x && x.name) || '').toLowerCase();
}

function byName(x, y) {
    const a = nameKey(x), b = nameKey(y);
    return a < b ? -1 : a > b ? 1 : 0;
}

// ------------------------------------------------------------- sidebar

// Every habitat or exhibit with animals: the ones with problems first (worst
// first), then the rest by name.
export function plannerHabitats(model, { showCovered = true } = {}) {
    if (!model || !model.habitatSummaries) return [];
    const atRisk = habitatsAtRisk(model);
    const seen = new Set(atRisk.map(h => h.id));
    const rest = Array.from(model.habitatSummaries.values()).filter(h => !seen.has(h.id)).sort(byName);
    return atRisk.concat(rest).map(h => {
        const counts = visibleCounts(h.counts, showCovered);
        let animals = 0;
        for (const sp of h.species) animals += sp.animals.length;
        return { id: h.id, name: h.name || placeName(model, h.id), kind: h.kind, counts, animals, species: h.species.length, worst: worstOf(counts) };
    }).filter(h => h.animals > 0);
}

export function zooCounts(model, showCovered = true) {
    return visibleCounts(model && model.counts, showCovered);
}

// ------------------------------------------------------------ overview

// Every counted pair, grouped by habitat; groups worst first, pairs in the
// model's order (severity, mates now, kinship).
export function overviewGroups(model, { showCovered = true } = {}) {
    if (!model) return [];
    const byHab = new Map();
    for (const p of model.pairs) {
        if (p.severity === 'distant') continue;
        if (!showCovered && p.severity === 'covered') continue;
        if (!byHab.has(p.hab)) byHab.set(p.hab, []);
        byHab.get(p.hab).push(p);
    }
    const groups = [];
    for (const [hab, pairs] of byHab) {
        const s = model.habitatSummaries.get(hab);
        const counts = visibleCounts(s ? s.counts : null, showCovered);
        groups.push({ hab, name: (s && s.name) || placeName(model, hab), kind: s ? s.kind : 'habitat', pairs, counts, worst: worstOf(counts) });
    }
    return groups.sort((x, y) => severityRank(y.worst) - severityRank(x.worst)
        || y.counts.risk - x.counts.risk || y.counts.kin - x.counts.kin || y.counts.future - x.counts.future
        || byName(x, y));
}

// ------------------------------------------------------------- species

// The species tabs of one habitat, worst first.
export function speciesTabs(summary, showCovered = true) {
    if (!summary) return [];
    return summary.species.map(sp => {
        const counts = visibleCounts(sp.counts, showCovered);
        return {
            species: sp.species,
            animals: sp.animals.length,
            males: sp.males.length,
            females: sp.females.length,
            unisex: sp.animals.length - sp.males.length - sp.females.length,
            counts,
            worst: worstOf(counts),
        };
    }).sort((x, y) => severityRank(y.worst) - severityRank(x.worst) || y.animals - x.animals
        || (x.species < y.species ? -1 : x.species > y.species ? 1 : 0));
}

export function pickSpecies(summary, wanted) {
    if (!summary) return null;
    if (wanted != null && summary.species.some(s => s.species === wanted)) return wanted;
    const tabs = speciesTabs(summary);
    return tabs.length ? tabs[0].species : null;
}

// --------------------------------------------------------------- words

const SHORT = {
    "parent's sibling": 'aunt/uncle',
    "half-parent's sibling": 'half aunt/uncle',
    "sibling's offspring": 'niece/nephew',
    "half-sibling's offspring": 'half niece/nephew',
};

// What y is to x, short enough for a matrix square ("half-sister").
export function shortRelation(rel, ySex) {
    if (!rel) return '';
    const w = relationWord(rel, ySex);
    return SHORT[w] || w.replace(/^great-/, 'gt-');
}

// 0.0625 -> "1/16"; '' when it is not a simple fraction.
export function kinshipFraction(k) {
    if (!(k > 0)) return '';
    const n = 1 / k;
    const r = Math.round(n);
    if (Math.abs(n - r) > 1e-6 || r < 2 || (r & (r - 1)) !== 0) return '';
    return `1/${r}`;
}

export function tierNote(tier, closeKinship) {
    switch (tier) {
        case 'game':
            return 'The game itself counts this pair as inbred (a parent and its young, or siblings).';
        case 'close':
            return 'The game does not warn about this pair, but they are close kin: their young lose fertility and immunity all the same.';
        case 'distant':
            return `Distantly related, below the close-kin line (${kinshipFraction(closeKinship) || 'the threshold'}). Little effect on their young.`;
        default:
            return 'Not related as far as the game records. Their young keep their full genetic variety.';
    }
}

// ---------------------------------------------------------------- matrix

// One square: the pair (if related), its relation word, kinship, mates now,
// and the expected offspring score (0..100, null without genes).
export function cellFor(model, r, c, pairMap) {
    if (r === c) return { self: true, a: r, b: c, severity: 'self', tier: 'none', word: '', kinship: 0, mated: false, score: null, pair: null };
    const pair = (pairMap && pairMap.get(r.id + '|' + c.id)) || null;
    const rel = pair && r.guid && c.guid ? model.ped.relation(r.guid, c.guid) : null;
    return {
        self: false,
        a: r,
        b: c,
        pair,
        severity: pair ? pair.severity : 'none',
        tier: pair ? pair.tier : 'none',
        word: rel ? shortRelation(rel, c.sex) : '',
        kinship: pair ? pair.kinship : 0,
        mated: pair ? !!pair.mated : (r.mates || []).includes(c.id) || (c.mates || []).includes(r.id),
        score: offspringScore(predictOffspring(r.genes, c.genes)),
    };
}

function animalOrder(x, y) {
    return (x.juv - y.juv) || byName(x, y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
}

// Rows = males, columns = females (one square matrix when the species is
// unisex). Adults first, then by name, so the order does not jump when a
// pair's severity changes.
export function buildMatrix(model, habId, species, { includeYoung = true } = {}) {
    const sum = habitatSummary(model, habId);
    if (!sum) return null;
    const sp = sum.species.find(s => s.species === species);
    if (!sp) return null;
    const list = sp.animals.filter(a => includeYoung || !a.juv);
    const unisex = list.some(a => a.sex === Sex.Unisex);
    let rows, cols;
    if (unisex) {
        rows = list.slice().sort(animalOrder);
        cols = rows;
    }
    else {
        rows = list.filter(a => a.sex === Sex.Male).sort(animalOrder);
        cols = list.filter(a => a.sex === Sex.Female).sort(animalOrder);
    }
    const pairMap = new Map();
    for (const p of model.pairs) {
        if (p.hab !== sum.id || p.species !== species) continue;
        pairMap.set(p.a.id + '|' + p.b.id, p);
        pairMap.set(p.b.id + '|' + p.a.id, p);
    }
    const cells = rows.map(r => cols.map(c => cellFor(model, r, c, pairMap)));
    // the worst counted severity of each animal in this matrix
    const worst = new Map();
    for (const row of cells) {
        for (const cell of row) {
            if (cell.self || cell.severity === 'none' || cell.severity === 'distant') continue;
            for (const a of [cell.a, cell.b]) {
                if (severityRank(cell.severity) > severityRank(worst.get(a.id))) worst.set(a.id, cell.severity);
            }
        }
    }
    return {
        habId: sum.id,
        species,
        unisex,
        rows,
        cols,
        cells,
        worst,
        pairMap,
        total: sp.animals.length,
        hiddenYoung: sp.animals.length - list.length,
    };
}

// Everything a matrix shows, as one string: the planner rebuilds the
// squares only when this changes (a scan every few seconds usually changes
// nothing in the habitat on screen). `extra`: settings and the like.
export function matrixSig(m, extra = null) {
    if (!m) return '';
    const animal = a => JSON.stringify(a, (k, v) => (k === 'genes' || k === 'par' ? undefined : v));
    const parts = [m.habId, m.species, m.unisex, m.total, m.hiddenYoung, JSON.stringify(extra)];
    for (const a of m.rows) parts.push('r' + animal(a));
    for (const a of m.cols) parts.push('c' + animal(a));
    for (const row of m.cells) {
        for (const c of row) {
            parts.push(c.self ? 's' : [c.severity, c.tier, c.word, c.kinship, c.mated ? 1 : 0, c.score,
                c.pair && c.pair.held ? JSON.stringify(c.pair.held) : ''].join(','));
        }
    }
    for (const [id, sev] of m.worst) parts.push(id + '=' + sev);
    return parts.join('|');
}

// --------------------------------------------------------------- mates

export const MATE_SECTIONS = [
    { tier: 'none', label: 'Unrelated', note: 'Best choices: no shared ancestors the game knows of.' },
    { tier: 'distant', label: 'Distant kin', note: 'Related far back; little effect on their young.' },
    { tier: 'close', label: 'Close kin: avoid', note: 'The game does not warn, but their young lose fertility and immunity.' },
    { tier: 'game', label: 'Inbred by the game\'s rule: avoid', note: 'Parent and young, or siblings.' },
];

// mateCandidates() output split into sections (in ranking order).
export function mateSections(cands) {
    return MATE_SECTIONS.map(s => Object.assign({}, s, { cands: (cands || []).filter(c => c.tier === s.tier) }))
        .filter(s => s.cands.length);
}

// ------------------------------------------------------------- selection

// The selection asked for by openKinPlanner({ habitatId, animalId, species,
// pairKey }). A pair key wins, then the animal (its own habitat), then the
// habitat.
export function stateFromOpen(model, opts, prev) {
    const o = opts || {};
    const st = { habId: null, species: null, pair: null, animal: null, includeYoung: prev ? prev.includeYoung !== false : true };
    if (o.pairKey != null && model) {
        const want = o.habitatId != null ? String(o.habitatId) : null;
        const p = model.pairs.find(x => x.key === String(o.pairKey) && (!want || x.hab === want))
            || model.pairs.find(x => x.key === String(o.pairKey));
        if (p) {
            st.habId = p.hab;
            st.species = p.species;
            st.pair = { a: p.a.id, b: p.b.id };
            if (p.a.juv || p.b.juv) st.includeYoung = true;
            return st;
        }
    }
    if (o.animalId != null && model) {
        const a = model.animals.get(String(o.animalId).replace(/^animal_/, ''));
        if (a) {
            st.animal = a.id;
            if (a.hab && model.habitatSummaries.has(a.hab)) {
                st.habId = a.hab;
                st.species = a.species;
                if (a.juv) st.includeYoung = true;
            }
        }
    }
    if (o.habitatId != null && !st.habId) {
        st.habId = String(o.habitatId);
        if (o.species != null) st.species = String(o.species);
    }
    if (o.species != null && !st.species) st.species = String(o.species);
    return st;
}

// Drops what is no longer in the model (habitat emptied, animal gone...).
// With no model yet, everything is kept.
export function resolveState(model, st) {
    const out = Object.assign({}, st);
    if (!model) return out;
    if (out.habId != null && !model.habitatSummaries.has(String(out.habId))) {
        out.habId = null;
        out.species = null;
        out.pair = null;
    }
    if (out.habId != null) {
        out.habId = String(out.habId);
        out.species = pickSpecies(habitatSummary(model, out.habId), out.species);
    }
    else {
        out.species = null;
    }
    if (out.pair) {
        const a = model.animals.get(out.pair.a);
        const b = model.animals.get(out.pair.b);
        const ok = a && b && out.habId != null && a.hab === out.habId && b.hab === out.habId
            && a.species === out.species && b.species === out.species
            && (out.includeYoung || (!a.juv && !b.juv));
        if (!ok) out.pair = null;
    }
    if (out.animal != null && !model.animals.has(String(out.animal))) out.animal = null;
    return out;
}
