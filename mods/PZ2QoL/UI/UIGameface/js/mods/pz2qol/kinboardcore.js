// Species board: the planning engine. Pure, no game imports (Node tests).
//
// The board shows one species at a time: every habitat it lives in (and
// every habitat it could move to) as a column of animal cards. The player
// stages moves into a plan; the plan is simulated on the kin model so its
// effect shows before anything happens ("fixes 3 risks, creates 0").
//
// A plan is an array of moves: { id, to } where id is an animal id from the
// kin snapshot and `to` is a habitat id, or 'trade' for the trade centre.
// Destinations come from the Lua side (the game's own checks):
//   { bySpecies: { <species>: { <habitatId>: { ok, reason } } },
//     habitats: [{ id, name }], tradeCentre: { id, name } | null }
import { buildKinModel, normalizeSnapshot, isCollective, severityRank, offspringScore, predictOffspring, fertileNow, fertilityText, Sex, withStored, pairSeverity, compatibleSexes, kinTier } from './kincore.js';

import { pastSelling } from './kinageing.js';
export const TRADE = 'trade';
// the board's column for animals outside a habitat and the trade centre
export const AWAY = 'away';
const COUNTED = s => s === 'risk' || s === 'kin' || s === 'future';

// Animals that may be moved: in a habitat or the trade centre, not exhibit
// animals, not already on their way somewhere.
export function canMove(a) {
    return !!a && !a.exhibit && !a.moving && a.alive !== false && (a.lt === 'habitat' || a.lt === 'trade' || (!a.lt && !!a.hab));
}

// A pregnant animal stays where she is: she can't be sold and has to give
// birth first. Kin's own plans (Suggest fixes, the breeding programme, Thin
// out) never move her and Execute skips such a move unless the player
// planned it by hand (the game itself allows moving her: its move
// preventers are only dead and escaped, RelocateAnimalsPopup
// g_tMovePreventers).
export function isPinned(a) {
    return !!a && !!a.preg;
}

// The rule above every other: a pregnant, young or past-selling
// adult never waits at the trade centre (a pregnancy only goes on in a
// habitat, a young one only grows there, and the market takes none of them;
// the trade centre ages nothing, so they would stay for good), whatever
// lock or leaving mark it has.
export function mustHouse(a) {
    return canMove(a) && a.lt === 'trade' && (!!a.preg || !!a.juv || pastSelling(a));
}

// A plan's move of a pregnant female is skipped (she gives birth where she
// is), except the one the golden rule asks for: out of the trade centre into
// a habitat (mustHouse). A move the player planned by hand always runs.
export function heldPregnant(a, m) {
    return isPinned(a) && !m.byPlayer && !(mustHouse(a) && String(m.to) !== TRADE);
}

export const PREGNANT_STAYS ="pregnant: she stays until she gives birth (she can't be sold)";

function emptyCounts() {
    return { risk: 0, kin: 0, future: 0, held: 0, covered: 0 };
}

// -------------------------------------------------------------- species

// Every species in the zoo (not exhibits, shoals or colonies), worst
// problems first.
// `muted` (a Set, optional): those species are flagged and listed after the rest.
export function speciesList(model, { muted = null } = {}) {
    if (!model) return [];
    const map = new Map();
    for (const a of model.animals.values()) {
        if (a.exhibit || !a.species || isCollective(model, a.species)) continue;
        let s = map.get(a.species);
        if (!s) map.set(a.species, s = { species: a.species, animals: 0, males: 0, females: 0, juveniles: 0, habitats: new Set(), away: 0, counts: emptyCounts() });
        s.animals++;
        if (a.sex === Sex.Male) s.males++;
        else if (a.sex === Sex.Female) s.females++;
        if (a.juv) s.juveniles++;
        if (a.hab) s.habitats.add(a.hab);
        else s.away++;
    }
    for (const p of model.pairs) {
        const s = map.get(p.species);
        if (s && p.severity in s.counts) s.counts[p.severity]++;
    }
    return Array.from(map.values()).map(s => Object.assign(s, { habitats: Array.from(s.habitats), muted: !!(muted && muted.has(s.species)) }))
        .sort((x, y) => (x.muted - y.muted) || y.counts.risk - x.counts.risk || y.counts.kin - x.counts.kin || y.counts.future - x.counts.future
            || y.animals - x.animals || (x.species < y.species ? -1 : 1));
}

// ----------------------------------------------------------- simulation

// Where an animal is: its habitat, TRADE or AWAY.
export function homeOf(a) {
    return a.hab || (a.lt === 'trade' ? TRADE : AWAY);
}

// A place by name, for every Kin view alike: the trade centre, 'away' (on
// the move, at the vet, in a quarantine) or a habitat, named by the model,
// the destination check or the scan's full habitat list.
export function placeName(model, to, destinations) {
    if (to == null || to === '') return '';
    if (to === TRADE) return (destinations && destinations.tradeCentre && destinations.tradeCentre.name) || (model && model.tradeCentre && model.tradeCentre.name) || 'Trade centre';
    if (to === AWAY) return 'Elsewhere';
    const id = String(to);
    const h = model && model.habitats ? model.habitats.get(id) : null;
    if (h && h.name) return h.name;
    const d = destinations && Array.isArray(destinations.habitats) ? destinations.habitats.find(x => String(x.id) === id) : null;
    if (d && d.name) return String(d.name);
    const s = model && model.snapshot && Array.isArray(model.snapshot.habs) ? model.snapshot.habs.find(x => x && String(x.id) === id) : null;
    return s && s.name ? String(s.name) : `Habitat ${id}`;
}

// The snapshot as it would be after the plan: moved animals sit in their
// destination habitat (or the trade centre, outside any habitat). A move
// breaks the moved animal's pair bond, and its mate's: neither holds a
// related pair apart any more (whether a bond comes back when the mate
// returns is not known, so it does not).
export function plannedSnapshot(model, plan, destinations) {
    const snap = model.snapshot;
    const moves = new Map((plan || []).map(m => [String(m.id), m]));
    const animals = snap.animals.map(a => {
        const m = moves.get(a.id);
        if (!m) return a.bond && moves.has(a.bond.mate) ? Object.assign({}, a, { bond: null }) : a;
        // at its destination, not in transit (a run's confirmed moves)
        if (m.to === TRADE) return Object.assign({}, a, { hab: '', loc: placeName(model, TRADE, destinations), lt: 'trade', moving: false, mates: [], bond: null });
        return Object.assign({}, a, { hab: String(m.to), loc: placeName(model, m.to, destinations), lt: 'habitat', moving: false, mates: [], bond: null });
    });
    const habitats = snap.habitats.slice();
    for (const m of moves.values()) {
        if (m.to !== TRADE && !habitats.some(h => h.id === String(m.to))) {
            habitats.push({ id: String(m.to), name: placeName(model, m.to, destinations), kind: 'habitat' });
        }
    }
    return Object.assign({}, snap, { animals, habitats, normalized: true });
}

// A rebuilt model keeps the options of the one it comes from (close-kin
// threshold, the pair bond switch).
function modelOptsOf(model) {
    return model.opts || { closeKinship: model.closeKinship };
}

export function simulatePlan(model, plan, destinations) {
    if (!model) return null;
    if (!plan || !plan.length) return model;
    // a plan never changes parentage: the model's pedigree caches carry over
    return buildKinModel(plannedSnapshot(model, plan, destinations), Object.assign({}, modelOptsOf(model), { ped: model.ped || null }));
}

// What a plan changes: pairs it removes and pairs it creates (counted
// severities only), and the counts before and after. Optionally for one
// species.
export function planImpact(before, after, species = null) {
    const pick = m => (m ? m.pairs.filter(p => COUNTED(p.severity) && (!species || p.species === species)) : []);
    const key = p => p.key;
    const b = new Map(pick(before).map(p => [key(p), p]));
    const a = new Map(pick(after).map(p => [key(p), p]));
    const fixed = [], created = [], changed = [];
    for (const [k, p] of b) {
        const q = a.get(k);
        if (!q) fixed.push(p);
        else if (severityRank(q.severity) < severityRank(p.severity)) fixed.push(p);
        else if (q.severity !== p.severity || q.hab !== p.hab) changed.push(q);
    }
    for (const [k, q] of a) {
        const p = b.get(k);
        if (!p || severityRank(q.severity) > severityRank(p.severity)) created.push(q);
    }
    const count = list => {
        const c = emptyCounts();
        for (const p of list) if (p.severity in c) c[p.severity]++;
        return c;
    };
    return {
        fixed, created, changed,
        before: count(pick(before)),
        after: count(pick(after)),
        risksFixed: fixed.filter(p => p.severity === 'risk').length,
        risksCreated: created.filter(p => p.severity === 'risk').length,
    };
}

// ----------------------------------------------------------- assignments

// The player's habitat assignments: habitat id -> Set of species. A habitat
// with an assignment is reserved for those species: suggestions put no
// other species there, and a species with assigned habitats is only ever
// suggested into those. Accepts a Map or a plain { habId: [species] }.
export function normalizeAssignments(a) {
    const out = new Map();
    if (!a) return out;
    const entries = a instanceof Map ? a.entries() : Object.entries(a);
    for (const [hab, v] of entries) {
        const list = v instanceof Set ? Array.from(v) : Array.isArray(v) ? v : (v && Array.isArray(v.species) ? v.species : []);
        if (list.length) out.set(String(hab), new Set(list.map(String)));
    }
    return out;
}

export function assignedHabitatsOf(assignments, species) {
    const out = [];
    for (const [hab, set] of normalizeAssignments(assignments)) if (set.has(species)) out.push(hab);
    return out;
}

// May `species` go into `habId` under the assignments?
export function habitatAllowedFor(assignments, habId, species) {
    const set = normalizeAssignments(assignments).get(String(habId));
    return !set || set.has(species);
}

// ------------------------------------------------- saved assignments
//
// Habitat entity ids are handed out afresh each time a zoo loads, so a saved
// id may point at nothing (a ghost column) or at another habitat. Each saved
// assignment keeps a fingerprint of its habitat, refreshed while the zoo
// runs: { species, name, hid (the game's habitat id), guids (some residents),
// seen (the load the player last changed it in) }. After a reload the
// fingerprints are matched to the zoo's habitats; the entity id only counts
// within the load the player clicked in (a re-key never sets `seen`: it may
// run on a board built before the zoo reloaded).

const PRINT_GUIDS = 8;
const DROP_AFTER_MISSES = 3;

function nameKey(s) {
    return String(s || '').trim().toLowerCase();
}

// May a saved assignment that matches nothing count as "not found this load"?
// Only when the scan sent its full habitat list (empty habitats too): without
// it an empty habitat is missing from the model and would age out wrongly.
export function fullHabitatList(model) {
    return !!(model && model.snapshot && Array.isArray(model.snapshot.habs) && model.snapshot.habs.length);
}

// The zoo's habitats as fingerprints: [{ id, name, names, hid, guids }].
// Uses the scan's full habitat list (empty habitats too) when there is one.
export function habitatPrints(model) {
    if (!model) return [];
    const out = new Map();
    const add = (id, name, hid) => {
        id = String(id);
        let p = out.get(id);
        if (!p) out.set(id, p = { id, name: '', names: new Set(), hid: null, guids: [] });
        if (name) {
            if (!p.name) p.name = String(name);
            p.names.add(nameKey(name));
        }
        if (hid != null && hid !== '' && p.hid == null) p.hid = String(hid);
    };
    const habs = model.snapshot && Array.isArray(model.snapshot.habs) ? model.snapshot.habs : [];
    for (const h of habs) if (h && h.id != null) add(h.id, h.name, h.hid);
    for (const h of model.habitats ? model.habitats.values() : []) {
        if (h.kind === 'exhibit') continue;
        if (habs.length && !out.has(String(h.id))) continue; // not a habitat any more
        add(h.id, h.name, null);
    }
    for (const a of model.animals ? model.animals.values() : []) {
        if (!a.hab || a.exhibit || !a.guid) continue;
        const p = out.get(String(a.hab));
        if (p) p.guids.push(String(a.guid));
    }
    for (const p of out.values()) p.guids.sort();
    return Array.from(out.values());
}

// What is saved for one habitat besides its species. `token`: the load the
// player clicked in (toggleAssignment only).
export function printOf(p, token) {
    return { name: p.name || '', hid: p.hid != null ? p.hid : undefined, guids: p.guids.slice(0, PRINT_GUIDS), seen: token || undefined };
}

// How sure are we that saved entry `e` (saved under `key`) is habitat `p`?
// 0 = no evidence. An entity id only counts within its own load.
function matchScore(key, e, p, token, nameCount) {
    let score = 0;
    let evidence = false;
    if (token && e.seen === token && String(key) === p.id) {
        score += 100;
        evidence = true;
    }
    const n = nameKey(e.name);
    if (n && p.names.has(n)) {
        score += nameCount.get(n) > 1 ? 8 : 20;
        evidence = true;
    }
    if (Array.isArray(e.guids) && e.guids.length && p.guids.length) {
        const mine = new Set(p.guids);
        let shared = 0;
        for (const g of e.guids) if (mine.has(String(g))) shared++;
        if (shared) {
            score += 5 * Math.min(shared, 5);
            evidence = true;
        }
    }
    if (e.hid != null && p.hid != null && String(e.hid) === p.hid) score += 4;
    return evidence ? score : 0;
}

// Saved entries of one zoo -> its habitats now, one to one, best match first.
//   section: { <saved key>: { species, name, hid, guids, seen } }
//   returns { byHab: Map(habitat id -> saved key), orphans: [saved keys] }
export function resolveAssignments(section, prints, token) {
    const byHab = new Map();
    const orphans = [];
    const entries = Object.entries(section && typeof section === 'object' ? section : {})
        .filter(([, e]) => e && Array.isArray(e.species) && e.species.length);
    const nameCount = new Map();
    for (const p of prints || []) for (const n of p.names) nameCount.set(n, (nameCount.get(n) || 0) + 1);
    const cands = [];
    for (const [key, e] of entries) {
        for (const p of prints || []) {
            const s = matchScore(key, e, p, token, nameCount);
            if (s > 0) cands.push({ key, hab: p.id, s });
        }
    }
    cands.sort((x, y) => y.s - x.s || (x.key === x.hab ? -1 : 0) - (y.key === y.hab ? -1 : 0) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
    const used = new Set();
    for (const c of cands) {
        if (used.has(c.key) || byHab.has(c.hab)) continue;
        used.add(c.key);
        byHab.set(c.hab, c.key);
    }
    for (const [key] of entries) if (!used.has(key)) orphans.push(key);
    return { byHab, orphans };
}

// The section again, keyed by today's habitat ids with fresh fingerprints.
// Entries that match nothing are kept for a few loads (the habitat list may
// be incomplete), then dropped: their habitat is gone. A change replayed
// on data read later passes countMisses = false.
export function rekeyAssignments(section, prints, token, { countMisses = true } = {}) {
    const src = section && typeof section === 'object' ? section : {};
    if (!prints || !prints.length) return Object.assign({}, src);
    const { byHab, orphans } = resolveAssignments(src, prints, token);
    const byId = new Map(prints.map(p => [p.id, p]));
    const out = {};
    for (const [hab, key] of byHab) {
        const e = src[key];
        const fresh = printOf(byId.get(hab), e.seen);
        if (!fresh.name && e.name) fresh.name = e.name;
        if (fresh.hid === undefined && e.hid != null) fresh.hid = e.hid;
        out[hab] = Object.assign({ species: e.species.slice() }, fresh);
    }
    for (const key of orphans) {
        const e = Object.assign({}, src[key]);
        if (countMisses && e.missAt !== token) {
            e.miss = (Number(e.miss) || 0) + 1;
            e.missAt = token;
        }
        if (e.miss >= DROP_AFTER_MISSES) continue;
        // never under an id that is a habitat today
        let k = key;
        while (out[k] || byId.has(k)) k = '~' + k;
        out[k] = e;
    }
    for (const e of Object.values(out)) for (const f of Object.keys(e)) if (e[f] === undefined) delete e[f];
    return out;
}

// habitat id -> Set(species), only for habitats the zoo has now.
export function assignmentsFromSection(section, prints, token) {
    const { byHab } = resolveAssignments(section, prints, token);
    const out = {};
    for (const [hab, key] of byHab) out[hab] = section[key].species;
    return normalizeAssignments(out);
}

// --------------------------------------------------------------- columns

function habitatOk(destinations, species, habId) {
    const bySpecies = destinations && destinations.bySpecies && destinations.bySpecies[species];
    if (!bySpecies) return null;                          // not known (yet)
    const d = bySpecies[String(habId)];
    return d ? d : { ok: false, reason: 'Not a suitable habitat for this species.' };
}

// Does no habitat suit the species besides the one it lives in (or none)?
// checks: the destination check for the species ({ <habitatId>: { ok } }),
// homes: the habitats it lives in now.
export function noOtherHabitat(checks, homes) {
    if (homes.size > 1) return false;
    return !Object.entries(checks || {}).some(([id, d]) => d && d.ok && !homes.has(String(id)));
}

function countsOf(animals) {
    const c = { males: 0, females: 0, juveniles: 0, total: animals.length };
    for (const x of animals) {
        if (x.a.juv) c.juveniles++;
        else if (x.a.sex === Sex.Male) c.males++;
        else if (x.a.sex === Sex.Female) c.females++;
    }
    return c;
}

// The board for one species after the plan: columns of animal cards.
//   columns: [{ id, name, kind: 'habitat' | 'trade' | 'away', dest: { ok, reason } | null,
//               animals: [{ a, severity, pairs, planned: 'in' | null, from }],
//               leaving: [{ a, to, toName }], other: [{ species, count }], counts, risk: counts }]
// `after`: the plan's simulated model when the caller has it already
// (simulatePlan(model, plan, destinations)); saves building it again.
// `stored`: the player's stored adults of the species (kincore normalizeStored);
// the trade column then carries `stored` (storedCards), else an empty list.
export function boardColumns(model, species, plan, destinations, { includeEmpty = true, assignments = null, after: given = null, stored = null } = {}) {
    if (!model || !species) return [];
    const assign = normalizeAssignments(assignments);
    const after = given || simulatePlan(model, plan, destinations);
    const moves = new Map((plan || []).map(m => [String(m.id), m]));
    const columns = new Map();
    const col = (id, name, kind) => {
        if (!columns.has(id)) {
            columns.set(id, { id, name, kind, dest: kind === 'habitat' ? habitatOk(destinations, species, id) : null, animals: [], leaving: [], other: [], counts: null, risk: emptyCounts() });
        }
        return columns.get(id);
    };
    // m: the model that names the place (a planned destination is only in the simulated one)
    const placeCol = (m, id) => col(id, placeName(m, id, destinations), id === TRADE ? 'trade' : id === AWAY ? 'away' : 'habitat');
    // where every animal of the species is after the plan
    for (const a of after.animals.values()) {
        if (a.species !== species || a.exhibit) continue;
        const before = model.animals.get(a.id);
        const m = moves.get(a.id);
        const c = placeCol(after, homeOf(a));
        const pairs = (after.byAnimal.get(a.id) || []).filter(p => COUNTED(p.severity) || p.severity === 'held' || p.severity === 'covered');
        c.animals.push({ a, severity: pairs.length ? pairs[0].severity : null, pairs, planned: m ? 'in' : null, from: m && before ? (before.hab || before.lt || '') : null });
        if (m && before) {
            placeCol(model, homeOf(before)).leaving.push({ a: before, to: m.to, toName: placeName(model, m.to, destinations) });
        }
    }
    // suitable habitats without this species yet, and every habitat assigned to it
    if (includeEmpty && destinations && destinations.bySpecies && destinations.bySpecies[species]) {
        for (const [habId, d] of Object.entries(destinations.bySpecies[species])) {
            if (!d.ok || columns.has(habId)) continue;
            col(habId, placeName(model, habId, destinations), 'habitat');
        }
    }
    for (const [habId, set] of assign) {
        if (set.has(species) && !columns.has(habId)) col(habId, placeName(model, habId, destinations), 'habitat');
    }
    // the trade centre is always offered: the Lua side finds it when the
    // move is made (the game's own "send to trade centre" does the same);
    // it lists the player's stored adults (Franchise): read-only, outside counts and risk
    placeCol(model, TRADE).stored = storedCards(model, species, stored);
    // the other species sharing each habitat, and its risks for this species
    for (const c of columns.values()) {
        c.counts = countsOf(c.animals);
        // assignments: whose habitat this is, and who does not belong there
        const set = c.kind === 'habitat' ? assign.get(c.id) : null;
        c.assigned = set ? Array.from(set) : [];
        c.mine = !!set && set.has(species);
        c.reservedOther = !!set && !set.has(species);
        c.intruders = [];
        if (c.kind !== 'habitat') continue;
        const bySpecies = after.groups.get(c.id);
        if (bySpecies) {
            for (const [sp, list] of bySpecies) if (sp !== species) c.other.push({ species: sp, count: list.length });
        }
        if (set) c.intruders = c.other.filter(o => !set.has(o.species));
        if (set && !set.has(species) && c.animals.length) c.intruders.unshift({ species, count: c.animals.length });
        const s = after.habitatSummaries.get(c.id);
        const sp = s && s.species.find(x => x.species === species);
        if (sp) c.risk = Object.assign({}, sp.counts);
        c.animals.sort((x, y) => severityRank(y.severity) - severityRank(x.severity) || (x.a.sex - y.a.sex) || (x.a.juv - y.a.juv) || (x.a.name < y.a.name ? -1 : 1));
    }
    const order = c => (c.kind === 'habitat' ? (c.animals.length ? 0 : 1) : c.kind === 'trade' ? 2 : 3);
    return Array.from(columns.values()).sort((x, y) => order(x) - order(y)
        || (y.mine - x.mine) || (x.reservedOther - y.reservedOther)
        || (y.risk.risk - x.risk.risk) || (y.animals.length - x.animals.length) || (x.name < y.name ? -1 : 1));
}

// ------------------------------------------------ stored adults (Franchise)

// Stored adults the trade column shows before "N more".
export const STORED_SHOW = 6;
const storedCardCache = new WeakMap(); // stored answer -> { model, species, out }

// The player's stored adults of one species for the pinned trade column
// (kinmoves requestStoredAdults -> kincore normalizeStored). The park scan
// sees only the stored animals that still have an entity (they are in the
// trade column already); the rest exist in the park only as hub records,
// and the game shows the park only the adults among them. Read-only: never
// in model.animals, counts, risk or a plan. An animal already scanned in the
// park (same guid or id) is skipped.
//   -> [{ a, severity, pairs: [{ other, rel, tier, severity }] }]
// pairs: its relatives among the species' park animals of a compatible sex
// (merged pedigree, kincore withStored), worst first; distant kin left out.
export function storedCards(model, species, stored) {
    if (!model || !species || !stored || stored.error || !Array.isArray(stored.animals) || !stored.animals.length) return [];
    const hit = storedCardCache.get(stored);
    if (hit && hit.model === model && hit.species === species) return hit.out;
    const ids = new Set(), guids = new Set(), park = [];
    for (const a of model.animals.values()) {
        ids.add(String(a.id));
        if (a.guid) guids.add(String(a.guid));
        if (a.species === species && !a.exhibit && a.alive !== false && a.guid) park.push(a);
    }
    const view = withStored(model, stored);
    const ped = (view && view.ped) || model.ped;
    const out = [];
    for (const a of stored.animals) {
        if (!a || a.species !== species || ids.has(String(a.id)) || (a.guid && guids.has(String(a.guid)))) continue;
        const pairs = [];
        if (a.guid && ped) {
            for (const o of park) {
                if (!compatibleSexes(a, o)) continue;
                const rel = ped.relation(a.guid, o.guid);
                if (!rel) continue;
                const tier = kinTier(model, rel);
                if (tier === 'distant') continue;
                pairs.push({ other: o, rel, tier, severity: pairSeverity(a, o, tier) });
            }
        }
        pairs.sort((p, q) => severityRank(q.severity) - severityRank(p.severity) || q.rel.kinship - p.rel.kinship);
        out.push({ a, severity: pairs.length ? pairs[0].severity : null, pairs });
    }
    out.sort((x, y) => severityRank(y.severity) - severityRank(x.severity) || (x.a.sex - y.a.sex) || (x.a.name < y.a.name ? -1 : x.a.name > y.a.name ? 1 : 0));
    storedCardCache.set(stored, { model, species, out });
    return out;
}

// --------------------------------------------------------- plan editing

// Adds or replaces the move for one animal; moving it back home removes it.
// byPlayer: the player planned it by hand (drag, Move N here); only such a
// move of a pregnant animal is run (isPinned).
export function setMove(model, plan, id, to, { byPlayer = false } = {}) {
    const a = model && model.animals.get(String(id));
    const out = (plan || []).filter(m => String(m.id) !== String(id));
    if (!a) return out;
    const home = a.hab || (a.lt === 'trade' ? TRADE : null);
    if (to == null || String(to) === String(home)) return out;
    out.push(byPlayer ? { id: String(id), to: String(to), byPlayer: true } : { id: String(id), to: String(to) });
    return out;
}

// Drops moves whose animal is gone, already moving, or already there.
export function prunePlan(model, plan) {
    return (plan || []).filter(m => {
        const a = model && model.animals.get(String(m.id));
        if (!a || !canMove(a)) return false;
        const home = a.hab || (a.lt === 'trade' ? TRADE : null);
        return String(m.to) !== String(home);
    });
}

// Problems with a plan before running it: unknown or unsuitable
// destinations, animals that cannot move.
export function planProblems(model, plan, destinations, { assignments = null } = {}) {
    const out = [];
    const assign = normalizeAssignments(assignments);
    for (const m of plan || []) {
        const a = model && model.animals.get(String(m.id));
        if (!a) {
            out.push({ id: m.id, text: 'This animal is no longer in the zoo.' });
            continue;
        }
        if (!canMove(a)) out.push({ id: m.id, text: `${a.name} cannot be moved right now${a.moving ? ' (already on the move)' : ''}.` });
        else if (m.byPlayer && isPinned(a)) {
            out.push({ id: m.id, warn: true, preg: true, text: `${a.name} is pregnant: the game lets you move her, but she can't be sold and has to give birth first.` });
        }
        else if (heldPregnant(a, m)) {
            out.push({ id: m.id, preg: true, text: `${a.name} is pregnant: Kin's plans never move her (she has to give birth first). Run skips this move.` });
        }
        if (m.to !== TRADE) {
            const d = habitatOk(destinations, a.species, m.to);
            if (d && !d.ok) out.push({ id: m.id, text: `${a.name}: ${d.reason || 'not a suitable habitat'}` });
            const set = assign.get(String(m.to));
            if (set && !set.has(a.species)) {
                out.push({ id: m.id, warn: true, text: `${a.name}: ${placeName(model, m.to, destinations)} is assigned to ${Array.from(set).join(', ')}.` });
            }
        }
    }
    return out;
}

// ------------------------------------------------------------ suggestions

// An animal that can breed now: adult, mature, alive, not on contraception,
// fertile and not too old.
export function fertileAdult(a) {
    return !!a && !a.contra && a.alive !== false && fertileNow(a);
}

// Why an animal does not breed, in words.
export function notBreedingText(a) {
    if (!a) return '';
    if (a.contra) return 'on contraception';
    return fertilityText(a) || (a.juv ? 'too young to breed yet' : 'not breeding');
}

// Not related closely enough to count (the game's rule or close kin).
function unrelatedEnough(model, a, b) {
    const rel = a.guid && b.guid ? model.ped.relation(a.guid, b.guid) : null;
    return !rel || kinTier(model, rel) === 'distant';
}

// The breeding pairs of one species in one habitat: fertile adult males x
// fertile adult females that are not related (unisex species: any two).
// { pairs, males, females, best } (best: the best expected young, 0..100)
export function breedingPairs(model, habId, species) {
    const g = model && model.groups.get(String(habId));
    const list = ((g && g.get(species)) || []).filter(fertileAdult);
    const males = list.filter(x => x.sex === Sex.Male);
    const females = list.filter(x => x.sex === Sex.Female);
    const unisex = list.filter(x => x.sex === Sex.Unisex);
    let pairs = 0, best = null;
    const partnered = new Set();
    const consider = (a, b) => {
        if (!unrelatedEnough(model, a, b)) return;
        pairs++;
        partnered.add(a).add(b);
        const sc = offspringScore(predictOffspring(a.genes, b.genes));
        if (sc != null && (best == null || sc > best)) best = sc;
    };
    for (const m of males) for (const f of females) consider(m, f);
    for (let i = 0; i < unisex.length; i++) for (let j = i + 1; j < unisex.length; j++) consider(unisex[i], unisex[j]);
    // bred: the breeders with an unrelated partner there (half for one near the end of its fertile years)
    let bred = 0;
    for (const a of partnered) bred += a.fert && a.fert.state === 'ending' ? 0.5 : 1;
    return { pairs, bred, males: males.length, females: females.length, best };
}

// The kin model of one species only (its pairs, its lineage): simulating a
// move there is fast even in a zoo of hundreds of animals.
function speciesModel(model, species) {
    const snap = model.snapshot;
    if (!snap) return model;
    return buildKinModel(Object.assign({}, snap, { animals: snap.animals.filter(a => a.species === species), normalized: true }), modelOptsOf(model));
}

// A plan that removes this species' inbreeding risks (and close kin) by
// moving as few animals as possible. A move never creates a related pair
// and never takes a habitat's last breeding pair away; among the rest each
// is scored on:
//   - related pairs fixed;
//   - breeding: where the animal goes, the new fertile, unrelated
//     male x female pairs it forms (a habitat with no breeding pair that
//     gets one counts extra), the best expected young there;
//   - no groups of only males or only females (two or more adults);
//   - the player's habitat assignments (only the species' own habitats,
//     never another species' ones).
// Only a move scoring above zero is made. Falls back to the trade centre
// only when `allowTrade` is set. Returns [{ id, to, reason }].
export function suggestPlan(model, species, destinations, { maxMoves = 12, allowTrade = false, includeKin = true, assignments = null } = {}) {
    if (!model || !species) return [];
    model = speciesModel(model, species);
    const watched = s => s === 'risk' || (includeKin && s === 'kin');
    const options = (destinations && destinations.bySpecies && destinations.bySpecies[species]) || null;
    let habitatsOk = options ? Object.entries(options).filter(([, d]) => d.ok).map(([id]) => id) : [];
    // the player's assignments: only the species' own habitats if it has
    // any, and never a habitat assigned to other species
    const assign = normalizeAssignments(assignments);
    const mine = assignedHabitatsOf(assign, species);
    // a habitat the game's check did not list is not suitable (habitatOk)
    if (mine.length) habitatsOk = mine.filter(h => !options || (options[h] && options[h].ok));
    else habitatsOk = habitatsOk.filter(h => habitatAllowedFor(assign, h, species));
    let plan = [];
    const tried = new Set();
    for (let step = 0; step < maxMoves; step++) {
        const current = simulatePlan(model, plan, destinations);
        const problems = current.pairs.filter(p => p.species === species && watched(p.severity));
        if (!problems.length) break;
        // the animals in the most problem pairs (ties: juveniles and males
        // first, they are the usual ones to move)
        const load = new Map();
        for (const p of problems) {
            for (const x of [p.a, p.b]) load.set(x.id, (load.get(x.id) || 0) + (p.severity === 'risk' ? 3 : 1));
        }
        const candidates = Array.from(load.entries())
            .map(([id, n]) => ({ a: current.animals.get(id), n }))
            .filter(x => x.a && canMove(model.animals.get(x.a.id)) && !isPinned(model.animals.get(x.a.id)) && !tried.has(x.a.id) && !plan.some(m => m.id === x.a.id))
            .sort((x, y) => y.n - x.n || (y.a.juv - x.a.juv) || ((y.a.sex === Sex.Male) - (x.a.sex === Sex.Male)) || (x.a.name < y.a.name ? -1 : 1));
        if (!candidates.length) break;
        // the best move among the most loaded animals
        const top = candidates.slice(0, 6);
        let chosen = null;
        for (const cand of top) {
            const a = cand.a;
            const from = a.hab;
            const fromBefore = from ? breedingPairs(current, from, species) : null;
            const targets = habitatsOk.filter(h => h !== a.hab);
            if (allowTrade) targets.push(TRADE);
            let movable = false;
            for (const to of targets) {
                const trial = plan.concat([{ id: a.id, to }]);
                const after = simulatePlan(model, trial, destinations);
                const impact = planImpact(current, after, species);
                const createdBad = impact.created.filter(p => watched(p.severity)).length;
                const fixedBad = impact.fixed.filter(p => watched(p.severity)).length;
                if (fixedBad === 0 || createdBad > 0) continue;
                const fromAfter = from ? breedingPairs(after, from, species) : null;
                if (fromBefore && fromBefore.pairs > 0 && fromAfter.pairs === 0) continue;
                movable = true;
                const toBefore = to === TRADE ? null : breedingPairs(current, to, species);
                const toAfter = to === TRADE ? null : breedingPairs(after, to, species);
                const gained = toAfter ? Math.max(0, toAfter.pairs - toBefore.pairs) : 0;
                const firstPair = !!toAfter && toBefore.pairs === 0 && toAfter.pairs > 0;
                // breeding across the two habitats the move touches: breeders with an
                // unrelated partner, two to a pair (one adult leaving a crowded group
                // costs one breeder, not every pair it could make), and groups of
                // only males or only females
                const pairsOf = b => (b ? b.bred / 2 : 0);
                const pairGain = (pairsOf(toAfter) - pairsOf(toBefore)) + (pairsOf(fromAfter) - pairsOf(fromBefore));
                const singleSex = b => (!!b && b.males + b.females >= 2 && (b.males === 0 || b.females === 0)) ? 1 : 0;
                const singleSexDelta = singleSex(toAfter) - singleSex(toBefore) + singleSex(fromAfter) - singleSex(fromBefore);
                const score = fixedBad * 60 - createdBad * 200
                    + pairGain * 25 + (firstPair ? 30 : 0)
                    - singleSexDelta * 60
                    + (toAfter && toAfter.best != null && gained ? toAfter.best / 20 : 0)
                    - (to === TRADE ? 50 : 0)
                    // between equal moves, the less crowded habitat
                    - (toAfter ? (toAfter.males + toAfter.females) * 0.1 : 0);
                if (score > 0 && (!chosen || score > chosen.score)) chosen = { a, to, score, fixedBad, gained, firstPair };
            }
            // no good move for this animal at all: do not try it again
            if (!movable) tried.add(a.id);
        }
        if (!chosen) break;
        const { a } = chosen;
        const parts = [`${chosen.fixedBad} related pair${chosen.fixedBad > 1 ? 's' : ''} fewer`];
        if (chosen.to === TRADE) parts.push(`to the trade centre: no habitat takes ${a.name} without another relative`);
        else if (chosen.gained) {
            const mate = a.sex === Sex.Male ? 'female' : a.sex === Sex.Female ? 'male' : 'partner';
            parts.push(chosen.firstPair
                ? `gives ${placeName(model, chosen.to, destinations)} its first breeding pair (an unrelated fertile ${mate})`
                : `${chosen.gained} more breeding pair${chosen.gained > 1 ? 's' : ''} there (unrelated fertile ${mate}${chosen.gained > 1 ? 's' : ''})`);
        }
        else if (!fertileAdult(a)) parts.push(notBreedingText(a));
        else parts.push(`no unrelated fertile ${a.sex === Sex.Male ? 'female' : a.sex === Sex.Female ? 'male' : 'partner'} there yet`);
        plan = plan.concat([{ id: a.id, to: chosen.to, reason: parts.join('; ') }]);
    }
    return plan;
}

// Text for one move ("Kito ♂: Savannah Habitat → Jungle Habitat").
export function moveText(model, m, destinations) {
    const a = model && model.animals.get(String(m.id));
    if (!a) return String(m.id);
    const sym = a.sex === Sex.Male ? '♂' : a.sex === Sex.Female ? '♀' : '';
    const home = homeOf(a);
    const from = home === AWAY ? a.loc || placeName(model, AWAY) : placeName(model, home, destinations);
    return `${a.name} ${sym}: ${from} → ${placeName(model, m.to, destinations)}`;
}

export { normalizeSnapshot };
